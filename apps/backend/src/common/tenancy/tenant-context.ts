import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request tenancy + actor state, propagated via AsyncLocalStorage rather
 * than function parameters threaded through every service/repository call.
 *
 * This is Layer 1 of the three-layer tenancy enforcement in
 * docs/03-ARCHITECTURE.md §5: populated by TenantScopeGuard immediately after
 * JWT verification (Phase 3), read by the tenant-scoping Prisma extension to
 * automatically inject `hospitalId` into every tenant-scoped query.
 *
 * `userId` rides along on the same store because it's the other piece of
 * per-request identity the audit-log extension needs (the acting user) — a
 * second AsyncLocalStorage instance would just duplicate this same plumbing.
 */
export interface TenantStore {
  hospitalId: string | null;
  userId: string | null;
  /**
   * Set only by an explicitly-marked Super Admin route
   * (`@BypassTenantScope()`, added in Phase 3). When true, the tenant-scoping
   * extension skips automatic hospitalId injection entirely — it does NOT
   * infer this from hospitalId being null, so a bug that forgets to set a
   * hospital id can never accidentally fall through to unscoped access.
   */
  bypassTenancy: boolean;
}

export class TenantContext {
  private static readonly storage = new AsyncLocalStorage<TenantStore>();

  /**
   * `callback` MUST return a Promise, and this method awaits it *inside* the
   * AsyncLocalStorage-bound frame before returning. This is not stylistic —
   * it is load-bearing. `AsyncLocalStorage.run()` only reliably preserves
   * context through the synchronous execution of the function it directly
   * invokes; Prisma's query methods return a lazily-evaluated custom
   * thenable (`PrismaPromise`), not a native Promise, and awaiting one of
   * those from *outside* run()'s own call frame (e.g. `TenantContext.run(s,
   * () => prisma.x.create(...))` awaited by the caller) silently loses the
   * context by the time the query actually dispatches — no error, the
   * tenant-scoping extension just throws "No TenantContext is active" as if
   * run() had never been called at all. Wrapping the await in here, inside
   * an explicit async function, guarantees the native async/await machinery
   * (which async_hooks does track correctly) is what bridges the gap,
   * regardless of whether the caller's own callback happens to be async.
   * Verified empirically — see docs/phase-reviews/PHASE-2-REVIEW.md.
   */
  static async run<T>(store: TenantStore, callback: () => Promise<T>): Promise<T> {
    return this.storage.run(store, async () => callback());
  }

  static getStore(): TenantStore | undefined {
    return this.storage.getStore();
  }

  /** Throws if called outside an active TenantContext — used by the tenant-scoping extension. */
  static requireStore(): TenantStore {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error(
        "No TenantContext is active. A tenant-scoped query was attempted outside " +
          "TenantContext.run(...) — every request handler must establish tenant context " +
          "before touching a tenant-scoped model. Use TenantContext.bypass() explicitly " +
          "for scripts (seed, migrations) that intentionally operate outside a request.",
      );
    }
    return store;
  }

  /** Explicit escape hatch for seed scripts / one-off admin scripts — never for request handlers. */
  static async bypass<T>(callback: () => Promise<T>): Promise<T> {
    return this.run({ hospitalId: null, userId: null, bypassTenancy: true }, callback);
  }
}
