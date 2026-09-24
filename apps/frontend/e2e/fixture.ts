import { readFileSync } from "node:fs";
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
