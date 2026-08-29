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

test('unknown paths and unsupported methods return a JSON 404 (static assets only under public/)', async (t) => {
  const { base } = await startServer(t);

  await assertErrorShape(await json(base, '/api/nope'), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/no-such-asset.js'), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/app.js/extra'), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/findings/F-0001'), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/findings', { method: 'DELETE' }), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/findings', { method: 'PATCH' }), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/stats', { method: 'POST' }), 404, 'NOT_FOUND');
  await assertErrorShape(await json(base, '/api/export.md', { method: 'POST' }), 404, 'NOT_FOUND');
  await assertErrorShape(
    await json(base, '/tokens.css', { method: 'POST' }),
    404,
    'NOT_FOUND',
  );
  await assertErrorShape(
    await json(base, '/api/findings/F-0001/status', { method: 'POST', body: { to: 'confirmed' } }),
    404,
    'NOT_FOUND',
  );
});

test('GET / serves the UI shell and public assets with correct content types', async (t) => {
  const { base } = await startServer(t);

  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type') ?? '', /^text\/html/);
  const html = await home.text();
  assert.match(html, /id="app"/);
  assert.match(html, /href="\/tokens\.css"/);

  const css = await fetch(base + '/tokens.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /^text\/css/);
  assert.ok((await css.text()).length > 0, 'tokens.css must not be empty');

  const js = await fetch(base + '/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') ?? '', /^text\/javascript/);
  assert.ok((await js.text()).length > 0, 'app.js must not be empty');
});

test('static serving never escapes public/: traversal attempts fall through to JSON 404', async (t) => {
  const { base } = await startServer(t);

  // fetch normalizes the first two into /package.json; the encoded one reaches
  // the server as-is and must be defused by the containment check itself.
  for (const target of ['/../package.json', '/../../package.json', '/%2e%2e/package.json']) {
    const res = await fetch(base + target);
    assert.equal(res.status, 404, `${target} must not be served`);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  }
  const listing = await json(base, '/..%2f..%2fpackage.json');
  assertErrorShape(listing, 404, 'NOT_FOUND');
  const body = await (await fetch(base + '/..%2f..%2fpackage.json')).text();
  assert.doesNotMatch(body, /"name"/, 'package.json contents must never leak');
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

test('GET /api/stats on an empty library returns zeroed counts for every status and category', async (t) => {
  const { base } = await startServer(t);

  const res = await json(base, '/api/stats');
  assert.equal(res.status, 200);
  assert.match(res.contentType ?? '', /application\/json/);
  assert.deepEqual(res.body, {
    byStatus: { open: 0, confirmed: 0, fixed: 0, shipped: 0, wontfix: 0 },
    byCategory: { protocol: 0, missing: 0, naming: 0, docs: 0, ux: 0 },
    total: 0,
  });
});

test('GET /api/stats reflects creates and transitions and always lists every enum value', async (t) => {
  const { base } = await startServer(t);

  const a = await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'A', category: 'protocol', phase: 'drydock' },
  });
  await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'B', category: 'ux', phase: 'execute' },
  });
  const c = await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'C', category: 'docs', phase: 'spec' },
  });
  // mutate through the API itself (black-box seeding)
  await json(base, `/api/findings/${a.body.id}/status`, { method: 'PATCH', body: { to: 'confirmed' } });
  await json(base, `/api/findings/${c.body.id}/status`, { method: 'PATCH', body: { to: 'wontfix' } });

  const res = await json(base, '/api/stats');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.byStatus, { open: 1, confirmed: 1, fixed: 0, shipped: 0, wontfix: 1 });
  assert.deepEqual(res.body.byCategory, { protocol: 1, missing: 0, naming: 0, docs: 1, ux: 1 });
  assert.equal(res.body.total, 3);
  const statusSum = Object.values(res.body.byStatus).reduce((sum, n) => sum + n, 0);
  assert.equal(statusSum, res.body.total, 'byStatus counts must sum to total');
});

test('GET /api/export.md returns a markdown report: header, stats tables, findings in id order', async (t) => {
  const { base } = await startServer(t);

  const a = await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'Checklist skips step X', category: 'protocol', phase: 'drydock' },
  });
  const b = await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'Confusing name', category: 'naming', phase: 'converge' },
  });
  await json(base, `/api/findings/${a.body.id}/status`, { method: 'PATCH', body: { to: 'confirmed' } });

  const res = await fetch(base + '/api/export.md');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/markdown/);
  const md = await res.text();

  // header: generation time (ISO-8601) + total
  const generated = /Generated at: (\S+)/.exec(md);
  assert.ok(generated, 'report must state its generation time');
  assert.ok(!Number.isNaN(Date.parse(generated[1])), 'generation time must be ISO-8601');
  assert.match(md, /Total findings: 2/);

  // stats tables enumerate every enum value, zeros included
  assert.match(md, /\| confirmed \| 1 \|/);
  assert.match(md, /\| open \| 1 \|/);
  assert.match(md, /\| shipped \| 0 \|/);
  assert.match(md, /\| wontfix \| 0 \|/);
  assert.match(md, /\| protocol \| 1 \|/);
  assert.match(md, /\| naming \| 1 \|/);
  assert.match(md, /\| ux \| 0 \|/);

  // findings detail table with the six contracted columns
  assert.match(md, /\| id \| title \| category \| phase \| status \| updatedAt \|/);
  assert.match(
    md,
    new RegExp(
      `\\| ${a.body.id} \\| Checklist skips step X \\| protocol \\| drydock \\| confirmed \\| \\S+ \\|`,
    ),
  );
  assert.match(
    md,
    new RegExp(`\\| ${b.body.id} \\| Confusing name \\| naming \\| converge \\| open \\| \\S+ \\|`),
  );
  assert.ok(md.indexOf(a.body.id) < md.indexOf(b.body.id), 'findings must be ordered by id ascending');
});

test('GET /api/export.md on an empty library renders zeroed stats and an empty findings table', async (t) => {
  const { base } = await startServer(t);

  const res = await fetch(base + '/api/export.md');
  assert.equal(res.status, 200);
  const md = await res.text();
  assert.match(md, /Total findings: 0/);
  assert.match(md, /\| id \| title \| category \| phase \| status \| updatedAt \|/);
  assert.doesNotMatch(md, /\| F-\d{4} /, 'no finding rows on an empty library');
});

test('GET /api/export.md escapes pipes and flattens newlines in titles so tables stay valid', async (t) => {
  const { base } = await startServer(t);

  await json(base, '/api/findings', {
    method: 'POST',
    body: { title: 'a | b\nc', category: 'docs', phase: 'spec' },
  });

  const res = await fetch(base + '/api/export.md');
  const md = await res.text();
  assert.ok(md.includes('a \\| b c'), `expected escaped/flattened title, got:\n${md}`);
});
