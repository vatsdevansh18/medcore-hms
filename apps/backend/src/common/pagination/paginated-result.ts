import type { PaginationMeta } from "@medcore/types";

/**
 * Marker class recognized by ResponseEnvelopeInterceptor: a controller
 * returning one of these gets the "Paginated list" envelope shape
 * (`{success, data, meta}`, no `message`) from docs/08-API-CONTRACT.md §2,
 * instead of the default `{success, data, message}` wrapping every other
 * response gets.
 */
export class PaginatedResult<T> {
  constructor(
    public readonly data: T[],
    public readonly meta: PaginationMeta,
  ) {}

  static of<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T> {
    return new PaginatedResult(data, {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  }
}
