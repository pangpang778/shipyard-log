// src/handlers/findings.js — request handlers for the findings resource.
// Per docs/standards/architecture.md: handlers own the business logic and translate
// store-layer coded errors into HTTP responses; server.js only dispatches routes.
// Dependency direction: handlers → store, one-way.

import { StoreError } from '../store.js';

// docs/standards/architecture.md error handling:
// BAD_TRANSITION→409, NOT_FOUND→404, VALIDATION→400, CORRUPT (and anything else)→500.
const HTTP_STATUS_BY_CODE = Object.freeze({
  VALIDATION: 400,
  NOT_FOUND: 404,
  BAD_TRANSITION: 409,
  CORRUPT: 500,
});

const QUERY_FILTER_KEYS = ['status', 'category', 'phase'];

/**
 * Translate any error into a uniform `{ status, body }` API error response
 * with the shape `{ "error": { "code", "message" } }`.
 * Unknown failures become a 500 INTERNAL that never leaks internals.
 */
export function toErrorResponse(err) {
  if (err instanceof StoreError) {
    const status = HTTP_STATUS_BY_CODE[err.code] ?? 500;
    return { status, body: { error: { code: err.code, message: err.message } } };
  }
  // server.js raises coded transport errors (malformed/oversized request bodies)
  // that reuse the API's VALIDATION code; anything else is an unexpected failure.
  const code = typeof err?.code === 'string' ? err.code : undefined;
  if (code !== undefined && code in HTTP_STATUS_BY_CODE) {
    return { status: HTTP_STATUS_BY_CODE[code], body: { error: { code, message: err.message } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'internal server error' } } };
}

/** Extract {status?, category?, phase?, q?} from query params; empty values count as absent. */
function filterFromQuery(query) {
  const filter = {};
  for (const key of QUERY_FILTER_KEYS) {
    const value = query[key];
    if (typeof value === 'string' && value.length > 0) {
      filter[key] = value;
    }
  }
  // q is free-text search (title+detail substring); blank/whitespace-only counts as
  // absent (the store also ignores it). multi-q keeps last-wins via Object.fromEntries.
  if (typeof query.q === 'string' && query.q.trim().length > 0) {
    filter.q = query.q;
  }
  return filter;
}

/**
 * Factory: binds handlers to a store instance. Each handler receives a request
 * context `{ query, params, body }` and resolves to `{ status, body }`.
 */
export function createFindingsHandlers(store) {
  return {
    /** POST /api/findings — record a finding (US1). */
    async create({ body }) {
      try {
        const finding = await store.add(body);
        return { status: 201, body: finding };
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    /** GET /api/findings?status=&category=&phase= — filtered list, newest first (US2). */
    async list({ query }) {
      try {
        const findings = await store.list(filterFromQuery(query ?? {}));
        return { status: 200, body: findings };
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    /** PATCH /api/findings/:id/status — move a finding along the state machine (US3). */
    async transition({ params, body }) {
      try {
        const finding = await store.transition(params.id, body?.to);
        return { status: 200, body: finding };
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    /**
     * PATCH /api/findings/:id — partially edit a finding's metadata (US? / TICKET 01).
     * Protected-key rejection lives at the store layer (it owns validation); the
     * handler just translates coded errors through toErrorResponse.
     */
    async update({ params, body }) {
      try {
        const finding = await store.update(params.id, body);
        return { status: 200, body: finding };
      } catch (err) {
        return toErrorResponse(err);
      }
    },
  };
}
