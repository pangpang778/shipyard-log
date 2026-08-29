// src/static.js — static file serving for public/ (the T3 slice's missing plumbing).
// Per docs/standards/architecture.md server.js only dispatches routes, so the
// static-serving plumbing lives here: URL pathname → file under public/, or null
// when the request is not a servable asset (the caller owns the JSON 404).

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', // module scripts need a JS MIME type
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
});

/**
 * Factory: resolves URL pathnames against `publicDir` (defaults to the repo's
 * public/). Returns an async `serve(pathname)` resolving to
 * `{ status, headers, body }` for a served file, or `null` when the pathname is
 * not a servable static asset (missing file, non-web extension, traversal).
 *
 * Security: containment is enforced with path.relative after resolution — that
 * is authoritative across `..` dot segments, percent-encoded tricks and
 * Windows backslashes, where string sniffing would be fragile.
 */
export function createStaticHandler(publicDir) {
  const root = path.resolve(publicDir);
  return async function serve(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null; // malformed percent-encoding is not a file
    }
    if (decoded.includes('\0')) return null;

    // '.' + '/x' keeps resolution relative to root; anything that climbs out
    // (or is a Windows-absolute path) fails the containment check below.
    const resolved = path.resolve(root, `.${decoded}`);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

    // The root itself (`/`) serves the UI shell.
    const filePath = rel === '' ? path.join(root, 'index.html') : resolved;
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
    if (contentType === undefined) return null; // only web assets are servable

    let body;
    try {
      body = await readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') return null;
      throw err; // unexpected fs failure → surfaces as a 500, not a silent 404
    }
    return {
      status: 200,
      headers: { 'content-type': contentType, 'cache-control': 'no-cache' },
      body,
    };
  };
}
