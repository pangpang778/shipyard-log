// src/server.test.js — integration tests for the HTTP API seam (S2).
// Real server on a random port (node:test + fetch, zero deps); data files live in
// os.tmpdir()-based temp dirs — the repo's real data/ is never touched.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { start } from './server.js';

const VALID_FINDING = { title: 'Checklist skips step X', category: 'protocol', phase: 'drydock' };

/** Start a real server on a random port backed by a temp data file; both are cleaned up. */
async function startServer(t, { dataFile } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = dataFile ?? path.join(dir, 'findings.json');
  const app = await start({ port: 0, dataFile: file });
  t.after(() => app.close());
  return { app, base: `http://localhost:${app.port}`, dataFile: file, dir };
}

/** Minimal JSON request helper: returns {status, contentType, body} (body is parsed JSON). */
async function json(base, requestPath, { method = 'GET', body } = {}) {
  const res = await fetch(base + requestPath, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: res.status, contentType: res.headers.get('content-type'), body: parsed, raw: text };
}

function assertErrorShape(res, status, code) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${res.raw}`);
  assert.match(res.contentType ?? '', /application\/json/);
  assert.deepEqual(Object.keys(res.body), ['error']);
  assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message']);
  assert.equal(res.body.error.code, code);
  assert.equal(typeof res.body.error.message, 'string');
  assert.ok(res.body.error.message.length > 0, 'error message must be non-empty');
}

function assertFindingShape(finding) {
  assert.deepEqual(
    Object.keys(finding).sort(),
    ['category', 'createdAt', 'detail', 'id', 'phase', 'status', 'title', 'updatedAt'].sort(),
  );
  assert.match(finding.id, /^F-\d{4}$/);
  assert.ok(!Number.isNaN(Date.parse(finding.createdAt)), 'createdAt must be ISO-8601');
  assert.ok(!Number.isNaN(Date.parse(finding.updatedAt)), 'updatedAt must be ISO-8601');
}

test('POST /api/findings records a finding and returns 201 with its JSON', async (t) => {
  const { base } = await startServer(t);

  const res = await json(base, '/api/findings', { method: 'POST', body: VALID_FINDING });
  assert.equal(res.status, 201);
  assert.match(res.contentType ?? '', /application\/json/);
  assert.equal(res.body.id, 'F-0001');
  assert.equal(res.body.title, VALID_FINDING.title);
  assert.equal(res.body.category, 'protocol');
  assert.equal(res.body.phase, 'drydock');
  assert.equal(res.body.status, 'open', 'new findings start in open');
  assert.equal(res.body.detail, '', 'detail defaults to empty string');
  assert.equal(res.body.createdAt, res.body.updatedAt);
  assertFindingShape(res.body);
});

test('POST /api/findings rejects invalid payloads with 400 VALIDATION and no side effects', async (t) => {
  const { base } = await startServer(t);

  const badBodies = [
    { category: 'protocol', phase: 'drydock' }, // title missing
    { ...VALID_FINDING, title: '' }, // empty title
    { ...VALID_FINDING, title: '   ' }, // whitespace only
    { ...VALID_FINDING, title: 'x'.repeat(121) }, // over 120 chars
    { ...VALID_FINDING, title: 42 }, // title not a string
    { ...VALID_FINDING, category: 'bug' }, // category not in enum
    { title: 'ok', phase: 'drydock' }, // category missing
    { title: 'ok', category: 'ux' }, // phase missing
    { ...VALID_FINDING, phase: 'qa' }, // phase not in enum
    { ...VALID_FINDING, detail: 7 }, // detail not a string
    {}, // nothing at all
  ];
  for (const body of badBodies) {
    const res = await json(base, '/api/findings', { method: 'POST', body });
    assertErrorShape(res, 400, 'VALIDATION');
  }

  const malformed = await json(base, '/api/findings', { method: 'POST', body: '{ not json' });
  assertErrorShape(malformed, 400, 'VALIDATION');

  // none of the failures may burn an id or leave partial records
  const first = await json(base, '/api/findings', { method: 'POST', body: VALID_FINDING });
  assert.equal(first.status, 201);
  assert.equal(first.body.id, 'F-0001');
  const list = await json(base, '/api/findings');
  assert.equal(list.body.length, 1);
});

test('GET /api/findings lists newest first and filters by any combination', async (t) => {
  const { base } = await startServer(t);

  const a = await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'A', category: 'protocol', phase: 'drydock' },
  });
  await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'B', category: 'ux', phase: 'drydock' },
  });
  const c = await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'C', category: 'ux', phase: 'execute' },
  });
  // move A to confirmed through the API itself (black-box seeding)
  const moved = await json(base, `/api/findings/${a.body.id}/status`, {
    method: 'PATCH',
    body: { to: 'confirmed' },
  });
  assert.equal(moved.status, 200);

  const idsOf = async (query) => (await json(base, `/api/findings${query}`)).body.map((f) => f.id);

  assert.deepEqual(await idsOf(''), [c.body.id, 'F-0002', a.body.id], 'default: newest first');
  assert.deepEqual(await idsOf('?category=ux'), [c.body.id, 'F-0002']);
  assert.deepEqual(await idsOf('?phase=drydock'), ['F-0002', a.body.id]);
  assert.deepEqual(await idsOf('?status=confirmed'), [a.body.id]);
  assert.deepEqual(await idsOf('?status=open&category=ux'), [c.body.id, 'F-0002']);
  assert.deepEqual(await idsOf('?status=open&category=ux&phase=execute'), [c.body.id]);
  assert.deepEqual(await idsOf('?status=open&phase=drydock'), ['F-0002']);
  assert.deepEqual(await idsOf('?category=missing'), [], 'no match → empty list, not an error');

  const badFilter = await json(base, '/api/findings?status=bogus');
  assertErrorShape(badFilter, 400, 'VALIDATION');

  // empty param values count as absent (friendlier than a 400 for `?status=`)
  const emptyParam = await json(base, '/api/findings?status=&category=ux');
  assert.deepEqual(emptyParam.body.map((f) => f.id), [c.body.id, 'F-0002']);
});

test('PATCH /api/findings/:id/status walks the happy path and bumps updatedAt', async (t) => {
  const { base } = await startServer(t);

  const created = await json(base, '/api/findings', { method: 'POST', body: VALID_FINDING });
  const id = created.body.id;
  const createdAt = created.body.createdAt;

  let previousUpdatedAt = createdAt;
  for (const to of ['confirmed', 'fixed', 'shipped']) {
    const res = await json(base, `/api/findings/${id}/status`, { method: 'PATCH', body: { to } });
    assert.equal(res.status, 200);
    assert.match(res.contentType ?? '', /application\/json/);
    assert.equal(res.body.id, id);
    assert.equal(res.body.status, to);
    assertFindingShape(res.body);
    assert.ok(res.body.updatedAt > previousUpdatedAt, 'updatedAt must strictly increase');
    assert.equal(res.body.createdAt, createdAt, 'createdAt must never change');
    previousUpdatedAt = res.body.updatedAt;
  }
});

test('PATCH rejects illegal transitions with 409 BAD_TRANSITION and leaves state intact', async (t) => {
  const { base } = await startServer(t);

  const created = await json(base, '/api/findings', { method: 'POST', body: VALID_FINDING });
  const id = created.body.id;

  for (const to of ['fixed', 'shipped', 'open']) {
    const res = await json(base, `/api/findings/${id}/status`, { method: 'PATCH', body: { to } });
    assertErrorShape(res, 409, 'BAD_TRANSITION');
  }
  // still open after every rejection → the 409s had no side effects
  const stillOpen = await json(base, `/api/findings/${id}/status`, {
    method: 'PATCH',
    body: { to: 'confirmed' },
  });
  assert.equal(stillOpen.status, 200);
  assert.equal(stillOpen.body.status, 'confirmed');

  // terminal states have no outgoing edges
  await assertErrorShape(
    await json(base, `/api/findings/${id}/status`, { method: 'PATCH', body: { to: 'confirmed' } }),
    409,
    'BAD_TRANSITION',
  );

  const wontfix = await json(base, '/api/findings', { method: 'POST', body: VALID_FINDING });
  await json(base, `/api/findings/${wontfix.body.id}/status`, {
    method: 'PATCH',
    body: { to: 'wontfix' },
  });
  await assertErrorShape(
    await json(base, `/api/findings/${wontfix.body.id}/status`, {
      method: 'PATCH',
      body: { to: 'open' },
    }),
    409,
    'BAD_TRANSITION',
  );
});

test('PATCH returns 404 NOT_FOUND for unknown ids', async (t) => {
  const { base } = await startServer(t);

  await assertErrorShape(
    await json(base, '/api/findings/F-9999/status', { method: 'PATCH', body: { to: 'confirmed' } }),
    404,
    'NOT_FOUND',
  );
  await assertErrorShape(
    await json(base, '/api/findings/no-such-id/status', {
      method: 'PATCH',
      body: { to: 'confirmed' },
    }),
    404,
    'NOT_FOUND',
  );
});

test('PATCH validates the transition target: bad enum or missing body → 400 VALIDATION', async (t) => {
  const { base } = await startServer(t);

  const created = await json(base, '/api/findings', { method: 'POST', body: VALID_FINDING });
  const url = `/api/findings/${created.body.id}/status`;

  await assertErrorShape(
    await json(base, url, { method: 'PATCH', body: { to: 'bogus' } }),
    400,
    'VALIDATION',
  );
  await assertErrorShape(await json(base, url, { method: 'PATCH', body: {} }), 400, 'VALIDATION');
  await assertErrorShape(
    await json(base, url, { method: 'PATCH', body: '{ not json' }),
    400,
    'VALIDATION',
  );
});

test('unknown paths and unsupported methods return a JSON 404 (static files are the T3 slice)', async (t) => {
  const { base } = await startServer(t);

  await assertErrorShape(await json(base, '/'), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/nope'), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/findings/F-0001'), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/findings', { method: 'DELETE' }), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/findings', { method: 'PATCH' }), 404, 'NOT_FOUND');
  await assertErrorShape(
    await json(base, '/api/findings/F-0001/status', { method: 'POST', body: { to: 'confirmed' } }),
    404,
    'NOT_FOUND',
  );
});

test('request bodies above the size limit are rejected with 400 VALIDATION', async (t) => {
  const { base } = await startServer(t);

  const oversized = JSON.stringify({ ...VALID_FINDING, title: 'x'.repeat(1_100_000) });
  const res = await json(base, '/api/findings', { method: 'POST', body: oversized });
  assertErrorShape(res, 400, 'VALIDATION');
  assert.match(res.body.error.message, /byte limit/);
});

test('state persists across a server restart on the same data file', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-server-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'findings.json');

  const first = await start({ port: 0, dataFile });
  const created = await json(`http://localhost:${first.port}`, '/api/findings', {
    method: 'POST',
    body: VALID_FINDING,
  });
  await json(`http://localhost:${first.port}`, `/api/findings/${created.body.id}/status`, {
    method: 'PATCH',
    body: { to: 'confirmed' },
  });
  await first.close();

  const second = await start({ port: 0, dataFile });
  t.after(() => second.close());
  const list = await json(`http://localhost:${second.port}`, '/api/findings?status=confirmed');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((f) => f.id), [created.body.id]);
  assert.equal(list.body[0].status, 'confirmed');
});
