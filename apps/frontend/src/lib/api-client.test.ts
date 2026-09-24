import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiPaginated, apiRequest, configureApiClient } from "./api-client";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api-client", () => {
  let token: string | null;
  let expired: number;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    token = "old-token";
    expired = 0;
    configureApiClient({
      getToken: () => token,
      setToken: (t) => {
        token = t;
      },
      onSessionExpired: () => {
        expired += 1;
      },
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const urlOf = (call: Parameters<typeof fetch>) => String(call[0]);
  const authOf = (call: Parameters<typeof fetch>) =>
    (call[1]?.headers as Record<string, string> | undefined)?.Authorization;

  it("unwraps the success envelope and sends the bearer token with credentials", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: { id: "a1" }, message: "OK" }));
    await expect(apiRequest<{ id: string }>("/appointments/a1")).resolves.toEqual({ id: "a1" });
    const call = fetchMock.mock.calls[0];
    expect(urlOf(call)).toMatch(/\/appointments\/a1$/);
    expect(authOf(call)).toBe("Bearer old-token");
    expect(call[1]?.credentials).toBe("include");
  });

  it("skips empty query values and keeps the rest", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: [], meta: { page: 2, limit: 10, total: 0, totalPages: 1 } }));
    const res = await apiPaginated("/invoices", { query: { page: 2, status: undefined, search: "" } });
    expect(res.meta.page).toBe(2);
    const url = new URL(urlOf(fetchMock.mock.calls[0]));
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("status")).toBe(false);
    expect(url.searchParams.has("search")).toBe(false);
  });

  it("throws ApiRequestError carrying the envelope's code and message", async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, { success: false, error: { code: "SLOT_UNAVAILABLE", message: "This slot was just booked." } }),
    );
    const error = await apiRequest("/appointments", { method: "POST", body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: "SLOT_UNAVAILABLE", message: "This slot was just booked." });
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { success: false, error: { code: "UNAUTHENTICATED", message: "expired" } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { accessToken: "new-token" } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { ok: true } }));
    await expect(apiRequest("/auth/me")).resolves.toEqual({ ok: true });
    expect(urlOf(fetchMock.mock.calls[1])).toMatch(/\/auth\/refresh$/);
    expect(authOf(fetchMock.mock.calls[1])).toBeUndefined();
    expect(authOf(fetchMock.mock.calls[2])).toBe("Bearer new-token");
    expect(token).toBe("new-token");
    expect(expired).toBe(0);
  });

  it("shares one refresh between concurrent 401s (rotated refresh tokens can't be replayed)", async () => {
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { success: true, data: { accessToken: "new-token" } });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === "Bearer new-token"
        ? json(200, { success: true, data: url })
        : json(401, { success: false, error: { code: "UNAUTHENTICATED", message: "expired" } });
    });
    const results = await Promise.all([apiRequest("/a"), apiRequest("/b"), apiRequest("/c")]);
    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });

  it("ends the session when the refresh itself fails", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { success: false, error: { code: "UNAUTHENTICATED", message: "expired" } }))
      .mockResolvedValueOnce(json(401, { success: false, error: { code: "INVALID_REFRESH_TOKEN", message: "reused" } }));
    await expect(apiRequest("/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(expired).toBe(1);
    expect(token).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("doesn't refresh for unauthenticated calls such as login", async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { success: false, error: { code: "UNAUTHENTICATED", message: "Invalid email or password." } }),
    );
    await expect(apiRequest("/auth/login", { method: "POST", body: {}, auth: false })).rejects.toMatchObject({
      message: "Invalid email or password.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authOf(fetchMock.mock.calls[0])).toBeUndefined();
  });

  it("reports a non-JSON server failure as INTERNAL_ERROR", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(apiRequest("/x")).rejects.toMatchObject({ status: 502, code: "INTERNAL_ERROR" });
  });
});
