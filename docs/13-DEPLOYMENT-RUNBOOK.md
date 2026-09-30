# Deployment Runbook — MedCore HMS

**Version:** 1.0 (Phase 16)
**Status:** Ready to execute; nothing in this document has been run against real infrastructure — see `docs/phase-reviews/PHASE-16-REVIEW.md` for exactly what is built-and-verified locally versus what needs a human to actually provision an account. This mirrors how Stripe/Razorpay/Resend/Twilio were handled throughout the project: code and config are complete, live execution is UNVERIFIED for lack of credentials, and that's a documented, accepted state — not a gap to silently paper over.
**Related:** `docs/03-ARCHITECTURE.md` §11 (deployment) and §15 (CI/CD), `docker-compose.prod.yml`, `infrastructure/nginx/nginx.prod.conf`, `scripts/deploy/blue-green.sh`, `.github/workflows/ci.yml`.

This is a one-time setup checklist followed by a short "every release" section. Every command below is written to be copy-pasted; replace the bracketed placeholders (`<your-domain>`, `<your-aws-account-id>`, etc.) with real values as you go.

## 0. What you need before starting

- An AWS account with billing enabled (EC2 + RDS + S3 all cost real money — this is the one phase of the project with ongoing cost, unlike every other UNVERIFIED provider which uses free test-mode credentials).
- A domain name you control (for the API's TLS certificate — Let's Encrypt needs a real, publicly resolvable domain; a bare IP address cannot get a certificate).
- A GitHub account, and this repository pushed to a GitHub remote (see §1 — the repository has no remote as of Phase 16, so `.github/workflows/ci.yml` has never actually executed).
- A Vercel account (free tier is enough for the frontend).
- An Upstash account (free tier is enough for the Redis instance — the architecture uses managed Upstash Redis, not AWS ElastiCache, specifically so the API's only AWS dependencies are EC2/RDS/S3).
- Optionally, a Sentry account (error reporting is fully wired and optional — see `docs/03-ARCHITECTURE.md` §14; the app runs identically with or without it).

## 1. GitHub remote + branch protection

The repository currently has no remote (`git remote -v` prints nothing) — every phase up to and including Phase 15 was verified entirely locally. This step is what makes `.github/workflows/ci.yml` actually run for the first time.

```bash
# Create the remote repo on GitHub first (via the web UI or `gh repo create`), then:
git remote add origin https://github.com/<your-org>/<your-repo>.git
git push -u origin main
```

Branch protection (GitHub web UI → Settings → Branches → Add rule, for `main`):
- Require a pull request before merging.
- Require status checks to pass before merging — select `Lint, type-check & build`, `Unit tests`, and (once it's run at least once) `Integration tests`.
- Do not allow direct pushes to `main`.

## 2. GitHub Actions secrets

Settings → Secrets and variables → Actions → New repository secret. `GITHUB_TOKEN` (used to push to `ghcr.io` in the `docker-build` job) is provided automatically by GitHub for every workflow run — nothing to add for that one.

| Secret | Used by | Value |
| --- | --- | --- |
| `EC2_HOST` | `deploy` job | The EC2 instance's public IP or DNS name (§5) |
| `EC2_SSH_USER` | `deploy` job | `ec2-user` (Amazon Linux) or `ubuntu` (Ubuntu AMI) |
| `EC2_SSH_KEY` | `deploy` job | The **private** half of the key pair created in §5 — paste the whole `-----BEGIN...-----` PEM file |

Also create a GitHub Environment named `production` (Settings → Environments → New environment) — the `deploy` job in `ci.yml` targets it, which lets you add required reviewers or a wait timer on production deploys later without touching the workflow file.

## 3. AWS: IAM, S3, and networking prep

```bash
# Configure the AWS CLI once with an IAM user that has EC2/RDS/S3/VPC permissions.
aws configure

# S3 bucket for attachments/PDFs/signatures (docs/09-SECURITY.md SEC-FILE-003).
aws s3api create-bucket --bucket medcore-hms-attachments-prod \
  --region ap-south-1 --create-bucket-configuration LocationConstraint=ap-south-1

# Block all public access — every file is served via short-lived pre-signed
# URLs (SEC-FILE-003), never a public bucket policy.
aws s3api put-public-access-block --bucket medcore-hms-attachments-prod \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# CORS so the browser can PUT/GET via pre-signed URLs from the Vercel frontend
# (docs/11-DECISIONS.md D-042 — S3Service.onModuleInit applies this
# automatically against LocalStack in dev; production needs it set here once).
aws s3api put-bucket-cors --bucket medcore-hms-attachments-prod --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["https://<your-frontend-domain>"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }]
}'
```

Create an IAM user (or role, if EC2 uses an instance profile instead — preferred, avoids long-lived keys on the box) scoped to just this bucket:

```bash
aws iam create-user --user-name medcore-hms-api-prod
aws iam put-user-policy --user-name medcore-hms-api-prod --policy-name s3-attachments --policy-document '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject"],
    "Resource": "arn:aws:s3:::medcore-hms-attachments-prod/*"
  }]
}'
aws iam create-access-key --user-name medcore-hms-api-prod
# Save the AccessKeyId/SecretAccessKey it prints — that's AWS_ACCESS_KEY_ID/
# AWS_SECRET_ACCESS_KEY in .env.production (§6). S3_ENDPOINT stays unset in
# production (real AWS S3, not LocalStack — docs/11-DECISIONS.md D-012).
```

## 4. RDS PostgreSQL

```bash
aws rds create-db-instance \
  --db-instance-identifier medcore-hms-prod \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16 \
  --master-username medcore \
  --master-user-password '<generate-a-real-password>' \
  --allocated-storage 20 \
  --publicly-accessible false \
  --vpc-security-group-ids <sg-id-allowing-5432-from-the-ec2-security-group-only>
```

Wait for it to become available (`aws rds describe-db-instances --db-instance-identifier medcore-hms-prod --query 'DBInstances[0].DBInstanceStatus'`), then note its endpoint — that's the host in `DATABASE_URL` (§6). The security group must allow inbound 5432 **only** from the EC2 instance's security group, never `0.0.0.0/0`.

Apply migrations once the EC2 host can reach it (§5 step 4):

```bash
DATABASE_URL='postgresql://medcore:<password>@<rds-endpoint>:5432/medcore_hms' \
  pnpm --filter=@medcore/backend exec prisma migrate deploy
```

## 5. Upstash Redis

No CLI needed — console.upstash.com → Create Database → pick the AWS region matching your EC2 region (keeps latency low) → copy the `rediss://` connection string it gives you (note the double `s` — Upstash requires TLS; `REDIS_URL` in `.env.production` uses this URL directly, `ioredis` handles `rediss://` transparently).

## 6. EC2 host

```bash
# A key pair for SSH (the private half becomes the EC2_SSH_KEY secret, §2).
aws ec2 create-key-pair --key-name medcore-hms-prod --query 'KeyMaterial' --output text > medcore-hms-prod.pem
chmod 400 medcore-hms-prod.pem

# Security group: 22 (your IP only), 80+443 (0.0.0.0/0 — Nginx terminates TLS).
aws ec2 create-security-group --group-name medcore-hms-prod --description "MedCore HMS production API"
aws ec2 authorize-security-group-ingress --group-name medcore-hms-prod --protocol tcp --port 22 --cidr <your-ip>/32
aws ec2 authorize-security-group-ingress --group-name medcore-hms-prod --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-name medcore-hms-prod --protocol tcp --port 443 --cidr 0.0.0.0/0

aws ec2 run-instances \
  --image-id <a-current-amazon-linux-2023-ami-id-for-your-region> \
  --instance-type t3.small \
  --key-name medcore-hms-prod \
  --security-groups medcore-hms-prod \
  --count 1
```

Point your domain's DNS `A` record (e.g. `api.<your-domain>`) at the instance's public IP before continuing — Let's Encrypt's HTTP-01 challenge (§8) needs it resolvable first.

SSH in and set up Docker + the repo:

```bash
ssh -i medcore-hms-prod.pem ec2-user@<ec2-public-ip>

sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # log out and back in for this to take effect

sudo mkdir -p /opt/medcore-hms && sudo chown "$USER" /opt/medcore-hms
git clone https://github.com/<your-org>/<your-repo>.git /opt/medcore-hms
cd /opt/medcore-hms
```

Docker Compose v2 ships as a `docker` plugin on recent Amazon Linux; if `docker compose version` fails, install the plugin per Docker's own docs for the AMI in use.

## 7. `.env.production` on the EC2 host

This file is **gitignored, never committed** — create it directly on the host (`nano /opt/medcore-hms/.env.production`), sourced from `.env.example`'s shape:

```
NODE_ENV=production
API_PORT=3001
CORS_ORIGIN=https://<your-frontend-domain>
DATABASE_URL=postgresql://medcore:<password>@<rds-endpoint>:5432/medcore_hms
REDIS_URL=rediss://<upstash-connection-string>
JWT_ACCESS_SECRET=<64-char-hex, e.g. `openssl rand -hex 32`>
ENCRYPTION_KEY=<64-char-hex, e.g. `openssl rand -hex 32` — SEC-DATA-001>
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=<from §3>
AWS_SECRET_ACCESS_KEY=<from §3>
AWS_S3_BUCKET=medcore-hms-attachments-prod
# S3_ENDPOINT intentionally unset — real AWS S3, not LocalStack.
IMAGE_REGISTRY=ghcr.io/<your-org>/<your-repo>
SENTRY_DSN_BACKEND=<optional, from sentry.io — omit to run without error reporting>
# Live payment/notification credentials (still optional/test-mode — SEC-PAY-004):
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RESEND_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

## 8. TLS certificate

Edit `infrastructure/nginx/nginx.prod.conf` on the host (or before the initial push, doesn't matter — it's the same repo checkout) and replace every `api.yourdomain.example` with your real API domain. Then, from `/opt/medcore-hms`:

```bash
# Bring up Nginx first (it'll fail the TLS server block until a cert exists —
# that's expected; only the ACME-challenge / HTTP->HTTPS-redirect block needs
# to work for this step). If it won't start at all, temporarily comment out
# the `server { listen 443 ... }` block, issue the cert, then uncomment it.
docker compose -f docker-compose.prod.yml up -d api-blue nginx

docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d api.<your-domain> \
  --email <you>@<your-domain> --agree-tos --non-interactive

docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

Renewal (certificates last 90 days) — add a host crontab entry:

```
0 3 * * 0 cd /opt/medcore-hms && docker compose -f docker-compose.prod.yml run --rm certbot renew && docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

## 9. Vercel (frontend)

No GitHub Actions job deploys the frontend — Vercel's own GitHub integration is the standard, simpler path for this (no token/secret to manage, deploys on every push automatically, preview deployments on every PR for free).

1. vercel.com → Add New Project → import this GitHub repo.
2. **Root Directory:** `apps/frontend` (Vercel auto-detects the pnpm workspace from the repo-root lockfile even with a subfolder root — `apps/frontend/vercel.json` already sets the build/install commands to `cd ../..` first, per the project's `@medcore/types`-must-be-built-first rule).
3. Framework preset: Next.js (auto-detected).
4. Environment variables (Project Settings → Environment Variables):
   - `NEXT_PUBLIC_API_BASE_URL` = `https://api.<your-domain>/api`
   - `NEXT_PUBLIC_SENTRY_DSN_FRONTEND` = (optional, from sentry.io)
5. Deploy. Every push to `main` redeploys production automatically; every PR gets its own preview URL.

## 10. Sentry (optional)

Skip this section entirely to run without error reporting — nothing else in the app depends on it (`docs/03-ARCHITECTURE.md` §14; `apps/backend/src/common/observability/sentry.ts` and `apps/frontend/src/instrumentation*.ts` both no-op cleanly with no DSN set, verified in Phase 16).

1. sentry.io → Create two projects: one Node.js (backend), one Next.js (frontend).
2. Copy each project's DSN into `SENTRY_DSN_BACKEND` (`.env.production`, §7) and `NEXT_PUBLIC_SENTRY_DSN_FRONTEND` (Vercel env vars, §9).
3. Source-map upload (nicer stack traces) needs `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` wired into the frontend build — not configured in this project (`next.config.ts` deliberately skips `withSentryConfig` for this reason); add it later if it turns out to matter.

## 11. First deploy

```bash
# From your own machine, after everything above is in place:
git tag v1.0.0
git push origin v1.0.0
```

This triggers `docker-build` (pushes `ghcr.io/<org>/<repo>/api:v1.0.0`) then `deploy` (SSHes to EC2, runs `scripts/deploy/blue-green.sh v1.0.0`). Watch the Actions tab; the `deploy` job's log mirrors `scripts/deploy/blue-green.sh`'s own `[blue-green]`-prefixed output.

**First deploy only:** `docker-compose.prod.yml`'s `api-blue` service is what `docker compose up -d` brings up initially (the very first time, before any tag exists to deploy) — bring the stack up once manually per §8 before the first tagged release, so there's a running `api-blue` for the blue-green script to find and replace.

## 12. Every release after that

```bash
git tag v1.0.1
git push origin v1.0.1
```

That's the whole workflow — build, health-gated cutover, and drain-then-stop of the previous colour all happen automatically. If the new container never becomes healthy, the script aborts and the previous colour keeps serving traffic untouched (proven locally in Phase 16 with a concurrent zero-downtime test — see `docs/phase-reviews/PHASE-16-REVIEW.md`); check `docker logs api-green` (or `api-blue`, whichever just failed) on the host for why.

**Rollback:** re-run the same deploy manually with the previous known-good tag: SSH in and run `scripts/deploy/blue-green.sh <previous-tag>` directly (no need to push a new git tag for a rollback — the image already exists in `ghcr.io`).

## 13. Database migrations on deploy

`prisma migrate deploy` is **not** run automatically by `blue-green.sh` — a schema-changing release needs it run once, by hand, before the cutover (per `CLAUDE.md`'s standing rule: a schema-changing PR always ships its migration in the same change, hand-written if `prisma migrate dev` can't run non-interactively):

```bash
ssh <user>@<ec2-host> 'cd /opt/medcore-hms && docker compose -f docker-compose.prod.yml run --rm --no-deps -e DATABASE_URL="$(grep DATABASE_URL .env.production | cut -d= -f2-)" api-blue pnpm --filter=@medcore/backend exec prisma migrate deploy'
```

Run this **before** pushing the release tag that depends on the new schema, since both the old and new API colours briefly run against the same database during a cutover's health-check window — the migration must be backward-compatible with the previous release for that window to be safe (add columns/tables freely; avoid dropping/renaming a column the previous release still reads in the same release that removes it — split into two releases instead).
