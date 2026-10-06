import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A split-domain deployment sets NEXT_PUBLIC_API_BASE_URL to a relative path
 * ("/api", proxied by next.config.ts's rewrite — D-045) rather than an
 * absolute URL. `new URL()` throws on a relative string with no base, and
 * every caller then reported that as "couldn't reach MedCore" (lib/errors.ts
 * maps any TypeError to that message), masking the real cause entirely —
 * found only once deployed for real, never caught by the existing suite
 * because every other test implicitly relies on @/constants' absolute
 * development default. Isolated in its own file (not api-client.test.ts)
 * because the mock below must apply before api-client.ts's own top-level
 * `import { API_BASE_URL } from "@/constants"` resolves.
 */
vi.mock("@/constants", () => ({ API_BASE_URL: "/api" }));

describe("api-client with a relative API_BASE_URL (split-domain deployment)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("buildUrl resolves a relative API_BASE_URL against window.location.origin instead of throwing", async () => {
    const { buildUrl } = await import("./api-client");
    expect(buildUrl("/auth/login")).toBe(`${window.location.origin}/api/auth/login`);
  });

  it("apiRequest succeeds end to end against a relative API_BASE_URL", async () => {
    const { apiRequest, configureApiClient } = await import("./api-client");
    configureApiClient({ getToken: () => null, setToken: () => undefined, onSessionExpired: () => undefined });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { ok: true }, message: "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(apiRequest("/auth/login", { method: "POST", body: {}, auth: false })).resolves.toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${window.location.origin}/api/auth/login`);
  });
});
