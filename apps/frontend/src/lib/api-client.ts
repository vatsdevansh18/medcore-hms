import type { ApiErrorBody, PaginationMeta } from "@medcore/types";
import { API_BASE_URL } from "@/constants";

/** An API error, carrying the envelope's `code` (docs/08-API-CONTRACT.md §2-3). */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Where the client reads and writes the in-memory access token. Wired to
 * the auth store by `configureApiClient`; kept as an interface so the
 * client has no React dependency and can be tested on its own. */
export interface TokenStore {
  getToken(): string | null;
  setToken(token: string | null): void;
  onSessionExpired(): void;
}

let tokenStore: TokenStore = {
  getToken: () => null,
  setToken: () => undefined,
  onSessionExpired: () => undefined,
};

export function configureApiClient(store: TokenStore): void {
  tokenStore = store;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Send the bearer token and refresh on 401 (default true). */
  auth?: boolean;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // The refresh cookie is scoped to /api/auth and only ever sent there.
    credentials: "include",
    signal: options.signal,
  });
}

async function parseError(res: Response): Promise<ApiRequestError> {
  let body: { error?: ApiErrorBody } | null = null;
  try {
    body = (await res.json()) as { error?: ApiErrorBody };
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  const error = body?.error;
  return new ApiRequestError(
    res.status,
    error?.code ?? (res.status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN_ERROR"),
    error?.message ?? `Request failed (${res.status}).`,
    error?.details,
  );
}

let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const res = await send("/auth/refresh", { method: "POST", auth: false }, null);
  if (!res.ok) return null;
  const body = (await res.json()) as { data: { accessToken: string } };
  return body.data.accessToken;
}

/**
 * Exchanges the refresh cookie for a new access token. One refresh at a
 * time: concurrent 401s in this tab share a single request, and other tabs
 * wait on a Web Lock. Refresh tokens rotate and a reused one is treated as
 * replay, revoking every session (docs/03-ARCHITECTURE.md §6), so two
 * parallel refreshes with the same cookie would log the user out everywhere.
 * Once a tab holds the lock, the browser already has the rotated cookie from
 * any refresh that finished before it.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const run = locks
      ? new Promise<string | null>((resolve, reject) => {
          void locks.request("medcore-token-refresh", async () => {
            try {
              resolve(await doRefresh());
            } catch (error) {
              reject(error);
            }
          });
        })
      : doRefresh();
    refreshInFlight = run
      .then((token) => {
        tokenStore.setToken(token);
        return token;
      })
      .catch(() => {
        tokenStore.setToken(null);
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function execute(path: string, options: RequestOptions): Promise<Response> {
  const useAuth = options.auth ?? true;
  let res = await send(path, options, useAuth ? tokenStore.getToken() : null);
  if (res.status === 401 && useAuth) {
    const token = await refreshAccessToken();
    if (!token) {
      tokenStore.onSessionExpired();
      throw await parseError(res);
    }
    res = await send(path, options, token);
    if (res.status === 401) tokenStore.onSessionExpired();
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

/** A request whose success envelope is `{success, data, message}`; returns `data`. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await execute(path, options);
  const body = (await res.json()) as { data: T };
  return body.data;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta & Record<string, unknown>;
}

/** A request whose success envelope is the paginated `{success, data, meta}`. */
export async function apiPaginated<T>(path: string, options: RequestOptions = {}): Promise<Paginated<T>> {
  const res = await execute(path, options);
  const body = (await res.json()) as Paginated<T>;
  return { data: body.data, meta: body.meta };
}
