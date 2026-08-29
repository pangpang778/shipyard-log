// src/smoke.test.js — S3 end-to-end smoke (T5).
// Boots the real server (random port + tmpdir data file) and walks the whole product
// surface black-box style: static shell → full finding lifecycle → markdown export.
// Deep UI testing stays out of scope (spec.md, seam S3).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { start } from './server.js';

/** Real server on a random port backed by a tmpdir data file; both cleaned up. */
async function startSmokeServer(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-smoke-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await start({ port: 0, dataFile: path.join(dir, 'findings.json') });
  t.after(() => app.close());
  return `http://localhost:${app.port}`;
}

/** JSON request helper: returns {status, contentType, body} (body parsed when JSON). */
async function request(base, requestPath, { method = 'GET', body } = {}) {
  const res = await fetch(base + requestPath, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
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

test('smoke: static shell serves /, /tokens.css and /app.js with the UI mount points', async (t) => {
  const base = await startSmokeServer(t);

  const home = await request(base, '/');
  assert.equal(home.status, 200, 'GET / must be 200');
  assert.match(home.contentType ?? '', /^text\/html/);
  assert.ok(home.raw.includes('id="app"'), 'index.html must carry the #app mount point');
  assert.ok(home.raw.includes('href="/tokens.css"'), 'index.html must link the design tokens');

  for (const asset of ['/tokens.css', '/app.js']) {
    const res = await request(base, asset);
    assert.equal(res.status, 200, `GET ${asset} must be 200`);
    assert.ok(res.raw.length > 0, `${asset} must not be empty`);
  }
});

test('smoke: a finding walks open → confirmed → fixed → shipped, and shipped is terminal', async (t) => {
  const base = await startSmokeServer(t);

  const created = await request(base, '/api/findings', {
    method: 'POST',
    body: {
      title: 'Smoke finding: full lifecycle reaches shipped',
      category: 'protocol',
      phase: 'drydock',
      detail: 'Recorded by the S3 smoke test to prove the whole state machine end to end.',
    },
  });
  assert.equal(created.status, 201);
  assert.match(created.contentType ?? '', /application\/json/);
  const id = created.body.id;
  assert.match(id, /^F-\d{4}$/);
  assert.equal(created.body.status, 'open');

  let previousUpdatedAt = created.body.updatedAt;
  for (const to of ['confirmed', 'fixed', 'shipped']) {
    const res = await request(base, `/api/findings/${id}/status`, { method: 'PATCH', body: { to } });
    assert.equal(res.status, 200, `transition to ${to} must succeed`);
    assert.equal(res.body.id, id);
    assert.equal(res.body.status, to);
    assert.ok(res.body.updatedAt > previousUpdatedAt, `updatedAt must change on ${to}`);
    previousUpdatedAt = res.body.updatedAt;
  }

  // shipped is terminal: an illegal backwards move is a 409, not a silent rewrite
  const illegal = await request(base, `/api/findings/${id}/status`, {
    method: 'PATCH',
    body: { to: 'confirmed' },
  });
  assert.equal(illegal.status, 409);
  assert.match(illegal.contentType ?? '', /application\/json/);
  assert.equal(illegal.body.error.code, 'BAD_TRANSITION');
  const still = await request(base, `/api/findings?status=shipped`);
  assert.deepEqual(
    still.body.map((f) => f.id),
    [id],
    'the 409 must have left the finding shipped',
  );
});

test('smoke: GET /api/export.md returns the markdown report including the finding', async (t) => {
  const base = await startSmokeServer(t);

  const title = 'Smoke export: report must quote this exact finding title';
  const created = await request(base, '/api/findings', {
    method: 'POST',
    body: { title, category: 'missing', phase: 'execute' },
  });
  assert.equal(created.status, 201);

  const res = await request(base, '/api/export.md');
  assert.equal(res.status, 200);
  assert.match(res.contentType ?? '', /^text\/markdown/);
  assert.ok(res.raw.includes(title), `export must contain the finding title:\n${res.raw}`);
  assert.ok(res.raw.includes(created.body.id), 'export must contain the finding id');
});
