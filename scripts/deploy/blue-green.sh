#!/usr/bin/env bash
# Health-check-gated blue-green cutover (docs/03-ARCHITECTURE.md §11):
# starts the *other* colour's container with the new image, waits for it to
# report healthy on its own HEALTHCHECK (which calls /health/ready —
# NFR-AVAIL-001), flips infrastructure/nginx/upstream.conf and reloads
# Nginx, then drains and stops the previous colour. If the new container
# never becomes healthy, it's removed and the previous colour keeps serving
# traffic untouched — the whole point of gating the switch on a real health
# check rather than just starting the new container and hoping.
#
# Usage (run on the EC2 host, in the repo root):
#   scripts/deploy/blue-green.sh <image-tag>
#
# Every deploy after the very first `docker compose -f docker-compose.prod.yml
# up -d` goes through this script, never a second `docker compose up -d
# api-blue` — see docker-compose.prod.yml's header comment for why.
set -euo pipefail

UPSTREAM_FILE="${UPSTREAM_FILE:-infrastructure/nginx/upstream.conf}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-90}"
HEALTH_POLL_INTERVAL_SECONDS="${HEALTH_POLL_INTERVAL_SECONDS:-2}"
DRAIN_SECONDS="${DRAIN_SECONDS:-10}"
# COMPOSE_ARGS overrides the full `-f ... [-p ...]` argument list passed to
# every `docker compose` call below — the real deploy needs only
# `-f docker-compose.prod.yml` (the default), but this makes the script
# testable against an isolated project/override-file combination too.
read -ra COMPOSE_ARGS <<<"${COMPOSE_ARGS:--f docker-compose.prod.yml}"

NEW_TAG="${1:?Usage: blue-green.sh <image-tag>}"

log() { echo "[blue-green] $*"; }

current_color() {
  if grep -q "api-blue" "$UPSTREAM_FILE"; then
    echo "blue"
  else
    echo "green"
  fi
}

OLD_COLOR="$(current_color)"
if [ "$OLD_COLOR" = "blue" ]; then NEW_COLOR="green"; else NEW_COLOR="blue"; fi
OLD_CONTAINER="api-$OLD_COLOR"
NEW_CONTAINER="api-$NEW_COLOR"

log "current: $OLD_CONTAINER — deploying $NEW_CONTAINER from tag '$NEW_TAG'"

# Clean up a stale container from a previous failed attempt at this colour
# (e.g. this script was interrupted last time before reaching cleanup).
docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true

# Reuses the api-blue service's full config (env_file, environment,
# healthcheck, network) — only the container name and image tag differ.
IMAGE_TAG="$NEW_TAG" docker compose "${COMPOSE_ARGS[@]}" run -d --name "$NEW_CONTAINER" --no-deps api-blue

log "waiting up to ${HEALTH_TIMEOUT_SECONDS}s for $NEW_CONTAINER to report healthy..."
elapsed=0
while true; do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$NEW_CONTAINER" 2>/dev/null || echo "missing")"
  if [ "$status" = "healthy" ]; then
    log "$NEW_CONTAINER is healthy."
    break
  fi
  if [ "$elapsed" -ge "$HEALTH_TIMEOUT_SECONDS" ]; then
    log "ABORT: $NEW_CONTAINER never became healthy (last status: $status). $OLD_CONTAINER keeps serving traffic, untouched."
    docker logs "$NEW_CONTAINER" --tail 50 >&2 || true
    docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep "$HEALTH_POLL_INTERVAL_SECONDS"
  elapsed=$((elapsed + HEALTH_POLL_INTERVAL_SECONDS))
done

log "switching Nginx upstream to $NEW_CONTAINER"
echo "server $NEW_CONTAINER:3001;" >"$UPSTREAM_FILE"
if ! docker compose "${COMPOSE_ARGS[@]}" exec nginx nginx -s reload; then
  log "ABORT: nginx -s reload failed — reverting upstream to $OLD_CONTAINER"
  echo "server $OLD_CONTAINER:3001;" >"$UPSTREAM_FILE"
  docker compose "${COMPOSE_ARGS[@]}" exec nginx nginx -s reload || true
  docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true
  exit 1
fi
log "Nginx now routes to $NEW_CONTAINER."

log "draining $OLD_CONTAINER for ${DRAIN_SECONDS}s before stopping it"
sleep "$DRAIN_SECONDS"
docker stop "$OLD_CONTAINER" >/dev/null 2>&1 || true
docker rm "$OLD_CONTAINER" >/dev/null 2>&1 || true

log "cutover complete: $OLD_CONTAINER -> $NEW_CONTAINER ($NEW_TAG)"
