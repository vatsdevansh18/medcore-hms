/**
 * Split from redis.module.ts to avoid a circular import: providers outside
 * this module (e.g. RedisThrottlerStorageService) that need to @Inject the
 * client would otherwise import back from the module that imports them,
 * which left REDIS_CLIENT undefined at evaluation time — found in Phase 3,
 * see docs/phase-reviews/PHASE-3-REVIEW.md.
 */
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
