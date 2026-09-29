import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export const API = process.env.E2E_API_URL ?? "http://localhost:3001/api";
export const FIXTURE_FILE = join(__dirname, ".fixture.json");

export interface PortalFixture {
  runId: string;
  password: string;
  hospitalId: string;
  patientA: { email: string; profileId: string; appointmentId: string };
  patientB: { email: string; profileId: string; appointmentId: string };
  doctorEmail: string;
  doctorId: string;
  /** A doctor created for this run only (schedule and signature journeys). */
  ownDoctorEmail: string;
  ownDoctorId: string;
  /** Used by the Super Admin onboarding journey; removed at teardown. */
  newHospitalSlug: string;
  newHospitalAdminEmail: string;
  receptionistEmail: string;
  labTechEmail: string;
  labApproverEmail: string;
  labTestId: string;
  medicineId: string;
  /** Filled in by global setup through the API. */
  recordA: string;
  recordB: string;
  prescriptionA: string;
  labOrderA: string;
  invoiceA: string;
  paymentA: string;
}

export function loadFixture(): PortalFixture {
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as PortalFixture;
}

export async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; error?: unknown } | null;
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${JSON.stringify(body?.error)}`);
  return body?.data as T;
}

export async function login(email: string, password: string): Promise<string> {
  const data = await api<{ accessToken: string }>("/auth/login", { method: "POST", body: { email, password } });
  return data.accessToken;
}

interface MinimalRedis {
  connect(): Promise<void>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
  disconnect(): void;
}

/**
 * Clears the API's rate-limit counters (`throttle:*` in Redis) so each test
 * starts like a fresh client. Every page load refreshes the in-memory access
 * token (D-038), and the auth routes allow 100 requests per 15 minutes per
 * route and client, so the whole browser suite ran out of budget once the
 * accessibility scan was added (Phase 14): every later test failed with
 * "Too many attempts". Same approach as the backend suite (D-041). The
 * limiter itself is tested in apps/backend/test/rate-limit.e2e-spec.ts. Uses
 * the backend's ioredis, since the frontend has no Redis client.
 */
export async function resetRateLimits(): Promise<void> {
  const requireFromBackend = createRequire(join(__dirname, "..", "..", "backend", "package.json"));
  const Redis = requireFromBackend("ioredis") as new (url: string, options: object) => MinimalRedis;
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", "throttle:*", "COUNT", 500);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
}
