// src/server.js — HTTP entry (node:http).
// Per docs/standards/architecture.md this module only does route dispatch and HTTP
// plumbing; business logic lives in src/handlers/, storage in src/store.js.
// Static file serving for public/ is the T3 slice — unknown paths get a JSON 404.

import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStore } from './store.js';
import { createFindingsHandlers, toErrorResponse } from './handlers/findings.js';
import { createStatsHandlers } from './handlers/stats.js';

const DEFAULT_PORT = 4100;
const MAX_BODY_BYTES = 1024 * 1024; // ~1MB guard for JSON request bodies
const DEFAULT_DATA_FILE = fileURLToPath(new URL('../data/findings.json', import.meta.url));

const FINDINGS_ROUTE = '/api/findings';
const TRANSITION_PATTERN = /^\/api\/findings\/([^/]+)\/status$/;
const STATS_ROUTE = '/api/stats';
const EXPORT_ROUTE = '/api/export.md';

/** Transport-level error (malformed/oversized request body); code maps to 400 VALIDATION. */
class BodyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BodyError';
    this.code = 'VALIDATION';
  }
}

/**
 * Read a JSON request body by hand: reject payloads above `limitBytes`,
 * resolve `undefined` for empty bodies, reject anything unparseable.
 */
function readJsonBody(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new BodyError(`request body exceeds the ${limitBytes} byte limit`);
    const settled = { done: false };
    const settle = (fn, value) => {
      if (settled.done) return;
      settled.done = true;
      fn(value);
    };

    const declared = Number(req.headers['content-length']);
    if (Number.isInteger(declared) && declared > limitBytes) {
      settle(reject, tooLarge());
      req.resume(); // drain so the client can finish writing before the response
      return;
    }

    const chunks = [];
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > limitBytes) {
        settle(reject, tooLarge());
        req.resume();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (settled.done) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim().length === 0) return settle(resolve, undefined);
      try {
        settle(resolve, JSON.parse(raw));
      } catch {
        settle(reject, new BodyError('request body is not valid JSON'));
      }
    });
    req.on('error', (err) => settle(reject, err));
    req.on('close', () => {
      if (!req.complete) settle(reject, new BodyError('request aborted before the body was read'));
    });
  });
}

/** Match `method` + `pathname` to a route; null means no route (JSON 404). */
function matchRoute(method, pathname) {
  if (pathname === FINDINGS_ROUTE) {
    if (method === 'POST') return { name: 'create', needsBody: true };
    if (method === 'GET') return { name: 'list', needsBody: false };
    return null;
  }
  if (pathname === STATS_ROUTE) {
    if (method === 'GET') return { name: 'stats', needsBody: false };
    return null;
  }
  if (pathname === EXPORT_ROUTE) {
    if (method === 'GET') return { name: 'exportMarkdown', needsBody: false };
    return null;
  }
  const match = TRANSITION_PATTERN.exec(pathname);
  if (match && method === 'PATCH') {
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return { name: 'bad-id' };
    }
    return { name: 'transition', params: { id }, needsBody: true };
  }
  return null;
}

function sendJson(res, status, body) {
  if (res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Raw (non-JSON) response for handlers that resolve with a `headers` map. */
function sendRaw(res, status, body, headers) {
  if (res.writableEnded || res.destroyed) return;
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(status, { 'content-length': payload.byteLength, ...headers });
  res.end(payload);
}

async function handleRequest(req, res, handlers) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost'); // base only to satisfy URL
    const route = matchRoute(req.method ?? 'GET', url.pathname);
    if (!route) {
      sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `no route for ${req.method} ${url.pathname}` },
      });
      return;
    }
    if (route.name === 'bad-id') {
      sendJson(res, 400, {
        error: { code: 'VALIDATION', message: 'id in the URL path is not properly encoded' },
      });
      return;
    }

    let body;
    if (route.needsBody) {
      try {
        body = await readJsonBody(req);
      } catch (err) {
        if (err instanceof BodyError) {
          sendJson(res, 400, { error: { code: 'VALIDATION', message: err.message } });
          return;
        }
        throw err;
      }
    }

    const context = {
      query: Object.fromEntries(url.searchParams),
      params: route.params ?? {},
      body,
    };
    const result = await handlers[route.name](context);
    if (result.headers !== undefined) {
      sendRaw(res, result.status, result.body, result.headers);
    } else {
      sendJson(res, result.status, result.body);
    }
  } catch (err) {
    const translated = toErrorResponse(err); // unknown failures → 500, never leaking internals
    sendJson(res, translated.status, translated.body);
  }
}

/**
 * Factory: opens the store and starts listening. Resolves once the server accepts
 * connections. Options: `port` (0 → random, the testable default), `host`,
 * `dataFile` (defaults to the repo's data/findings.json).
 * Returns `{ server, store, port, close }`.
 */
export async function start({ port = 0, host, dataFile = DEFAULT_DATA_FILE } = {}) {
  const store = await createStore(dataFile);
  const handlers = {
    ...createFindingsHandlers(store),
    ...createStatsHandlers(store),
  };
  const server = createServer((req, res) => {
    // handleRequest catches everything itself; this is belt and braces.
    handleRequest(req, res, handlers).catch(() => res.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    server,
    store,
    port: server.address().port,
    async close() {
      server.closeIdleConnections?.();
      await new Promise((resolve, reject) => {
        server.close((err) => (err && err.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(err) : resolve()));
      });
    },
  };
}

function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

function portFromEnv() {
  const parsed = Number.parseInt(process.env.PORT ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PORT;
}

// Only bind the default port when run directly (`node src/server.js` / `npm start`);
// imports and `node --test` never open a socket.
if (isMainModule()) {
  start({ port: portFromEnv() })
    .then((app) => console.log(`shipyard-log listening on http://localhost:${app.port}`))
    .catch((err) => {
      console.error('failed to start shipyard-log server:', err);
      process.exitCode = 1;
    });
}
