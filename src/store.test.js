// src/store.test.js — unit tests for the storage module (node:test + assert, zero deps).
// Data files live in os.tmpdir()-based temp dirs; the repo's real data/ is never touched.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore } from './store.js';

/** New store backed by a unique temp file, cleaned up when the test ends. */
async function tempStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return createStore(path.join(dir, 'findings.json'));
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected error code ${code}, got ${err.code}: ${err.message}`);
    return true;
  });
}

test('open on a missing file starts an empty library', async (t) => {
  const store = await tempStore(t);
  assert.deepEqual(await store.list(), []);
});

test('add allocates F-NNNN ids, defaults status to open, and stamps ISO-8601 times', async (t) => {
  const store = await tempStore(t);

  const a = await store.add({
    title: 'Protocol step missing a checkpoint',
    category: 'protocol',
    phase: 'drydock',
    detail: 'The launch checklist never verifies X.',
  });
  assert.equal(a.id, 'F-0001');
  assert.equal(a.status, 'open');
  assert.equal(a.title, 'Protocol step missing a checkpoint');
  assert.equal(a.category, 'protocol');
  assert.equal(a.phase, 'drydock');
  assert.equal(a.detail, 'The launch checklist never verifies X.');
  assert.equal(a.createdAt, a.updatedAt);
  assert.ok(!Number.isNaN(Date.parse(a.createdAt)), 'createdAt must be ISO-8601');
  assert.ok(!Number.isNaN(Date.parse(a.updatedAt)), 'updatedAt must be ISO-8601');

  const b = await store.add({ title: 'Second', category: 'ux', phase: 'execute' });
  assert.equal(b.id, 'F-0002', 'ids increment with 4-digit zero padding');
  assert.equal(b.detail, '', 'detail defaults to empty string');
});

test('add rejects invalid input with VALIDATION and consumes no id', async (t) => {
  const store = await tempStore(t);

  const bad = [
    { category: 'protocol', phase: 'spec' }, // title missing
    { title: '', category: 'protocol', phase: 'spec' }, // title empty
    { title: '   ', category: 'protocol', phase: 'spec' }, // title whitespace only
    { title: 'x'.repeat(121), category: 'protocol', phase: 'spec' }, // title too long
    { title: 'ok', phase: 'spec' }, // category missing
    { title: 'ok', category: 'bug', phase: 'spec' }, // category not in enum
    { title: 'ok', category: 'docs' }, // phase missing
    { title: 'ok', category: 'docs', phase: 'qa' }, // phase not in enum
    { title: 'ok', category: 'docs', phase: 'spec', detail: 42 }, // detail not a string
  ];
  for (const input of bad) {
    await rejectsWith(store.add(input), 'VALIDATION');
  }

  // none of the failures may burn an id or leave partial records
  const first = await store.add({ title: 'First good', category: 'docs', phase: 'spec' });
  assert.equal(first.id, 'F-0001');
  assert.equal((await store.list()).length, 1);
});

test('add accepts a title of exactly 120 characters', async (t) => {
  const store = await tempStore(t);
  const f = await store.add({
    title: 'y'.repeat(120),
    category: 'naming',
    phase: 'tickets',
  });
  assert.equal(f.title.length, 120);
});

test('list returns newest first and honors any filter combination', async (t) => {
  const store = await tempStore(t);

  await store.add({ title: 'A', category: 'protocol', phase: 'drydock' }); // F-0001
  await store.add({ title: 'B', category: 'ux', phase: 'drydock' }); // F-0002
  await store.add({ title: 'C', category: 'ux', phase: 'execute' }); // F-0003
  await store.transition('F-0001', 'confirmed');

  // no filter / empty filter → all, newest first
  assert.deepEqual((await store.list()).map((f) => f.id), ['F-0003', 'F-0002', 'F-0001']);
  assert.deepEqual((await store.list({})).map((f) => f.id), ['F-0003', 'F-0002', 'F-0001']);

  // single-key filters
  assert.deepEqual((await store.list({ category: 'ux' })).map((f) => f.id), ['F-0003', 'F-0002']);
  assert.deepEqual((await store.list({ phase: 'drydock' })).map((f) => f.id), ['F-0002', 'F-0001']);
  assert.deepEqual((await store.list({ status: 'confirmed' })).map((f) => f.id), ['F-0001']);

  // combined filters
  assert.deepEqual(
    (await store.list({ status: 'open', category: 'ux', phase: 'execute' })).map((f) => f.id),
    ['F-0003'],
  );
  assert.deepEqual(
    (await store.list({ status: 'open', phase: 'drydock' })).map((f) => f.id),
    ['F-0002'],
  );

  // no match → empty list
  assert.deepEqual(await store.list({ category: 'missing' }), []);

  // list must not leak internal references: mutating a result is safe
  const copy = await store.list();
  copy[0].title = 'mutated';
  assert.equal((await store.list())[0].title, 'C');
});

test('list rejects invalid filter values with VALIDATION', async (t) => {
  const store = await tempStore(t);
  await rejectsWith(store.list({ status: 'bogus' }), 'VALIDATION');
  await rejectsWith(store.list({ category: 'nope' }), 'VALIDATION');
  await rejectsWith(store.list({ phase: 'neverland' }), 'VALIDATION');
  await rejectsWith(store.list(null), 'VALIDATION');
});

test('all returns every finding in insertion order (id ascending) and never leaks references', async (t) => {
  const store = await tempStore(t);
  assert.deepEqual(await store.all(), [], 'empty store → empty list');

  await store.add({ title: 'A', category: 'protocol', phase: 'drydock' }); // F-0001
  await store.add({ title: 'B', category: 'ux', phase: 'execute' }); // F-0002
  await store.transition('F-0001', 'confirmed');

  const all = await store.all();
  assert.deepEqual(
    all.map((f) => f.id),
    ['F-0001', 'F-0002'],
    'insertion order — unlike list(), which is newest first',
  );
  assert.equal(all[0].status, 'confirmed');

  all[0].title = 'mutated';
  assert.equal((await store.get('F-0001')).title, 'A', 'mutating a result must not touch the store');
});

test('transition walks the full happy path open → confirmed → fixed → shipped', async (t) => {
  const store = await tempStore(t);

  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.setTime(1_700_000_000_000);
  await store.add({ title: 'Track me', category: 'missing', phase: 'converge' });
  const createdAt = (await store.get('F-0001')).createdAt;

  const steps = [
    ['confirmed', 1_700_000_060_000],
    ['fixed', 1_700_000_120_000],
    ['shipped', 1_700_000_180_000],
  ];
  let prevUpdatedAt = createdAt;
  for (const [status, ms] of steps) {
    t.mock.timers.setTime(ms);
    const f = await store.transition('F-0001', status);
    assert.equal(f.status, status);
    assert.equal(new Date(f.updatedAt).getTime(), ms, 'updatedAt must reflect the transition time');
    assert.ok(f.updatedAt > prevUpdatedAt, 'updatedAt must strictly increase');
    prevUpdatedAt = f.updatedAt;
  }
  // createdAt is immutable across transitions
  assert.equal((await store.get('F-0001')).createdAt, createdAt);
});

test('transition to wontfix is allowed from every non-terminal state', async (t) => {
  const store = await tempStore(t);

  await store.add({ title: 'A', category: 'docs', phase: 'spec' }); // F-0001 open
  await store.add({ title: 'B', category: 'docs', phase: 'spec' }); // F-0002 open
  await store.add({ title: 'C', category: 'docs', phase: 'spec' }); // F-0003 open
  await store.transition('F-0002', 'confirmed');
  await store.transition('F-0003', 'confirmed');
  await store.transition('F-0003', 'fixed');

  for (const [id, from] of [['F-0001', 'open'], ['F-0002', 'confirmed'], ['F-0003', 'fixed']]) {
    const f = await store.transition(id, 'wontfix');
    assert.equal(f.status, 'wontfix', `${from} → wontfix must be allowed`);
  }
});

test('transition errors: NOT_FOUND, VALIDATION for bad enum, BAD_TRANSITION for illegal moves', async (t) => {
  const store = await tempStore(t);
  await store.add({ title: 'A', category: 'protocol', phase: 'drydock' }); // F-0001 open

  await rejectsWith(store.transition('F-9999', 'confirmed'), 'NOT_FOUND');
  await rejectsWith(store.transition('no-such-id', 'confirmed'), 'NOT_FOUND');
  await rejectsWith(store.transition('F-0001', 'bogus'), 'VALIDATION');
  await rejectsWith(store.transition('F-0001', 'fixed'), 'BAD_TRANSITION'); // open → fixed skips confirmed
  await rejectsWith(store.transition('F-0001', 'open'), 'BAD_TRANSITION'); // no self-transition
  await rejectsWith(store.transition('F-0001', 'shipped'), 'BAD_TRANSITION'); // open → shipped skips ahead

  await store.transition('F-0001', 'confirmed');
  await store.transition('F-0001', 'fixed');
  await store.transition('F-0001', 'shipped');
  await rejectsWith(store.transition('F-0001', 'confirmed'), 'BAD_TRANSITION'); // shipped is terminal

  await store.add({ title: 'B', category: 'protocol', phase: 'drydock' }); // F-0002
  await store.transition('F-0002', 'wontfix');
  await rejectsWith(store.transition('F-0002', 'confirmed'), 'BAD_TRANSITION'); // wontfix is terminal
});

test('failed transition leaves the record and the persisted file untouched', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'findings.json');
  const store = await createStore(file);
  await store.add({ title: 'A', category: 'protocol', phase: 'drydock' });

  await rejectsWith(store.transition('F-0001', 'fixed'), 'BAD_TRANSITION');
  await rejectsWith(store.transition('F-0001', 'open'), 'BAD_TRANSITION');

  const f = await store.get('F-0001');
  assert.equal(f.status, 'open');
  assert.equal(f.updatedAt, f.createdAt, 'failed transition must not bump updatedAt');

  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(onDisk.findings[0].status, 'open');
});

test('state survives reopen: reload loads findings and the seq counter continues', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'findings.json');

  const first = await createStore(file);
  await first.add({ title: 'A', category: 'ux', phase: 'drydock' });
  await first.transition('F-0001', 'confirmed');

  const second = await createStore(file);
  const loaded = await second.list();
  assert.deepEqual(loaded.map((f) => f.id), ['F-0001']);
  assert.equal(loaded[0].status, 'confirmed');

  const next = await second.add({ title: 'B', category: 'ux', phase: 'drydock' });
  assert.equal(next.id, 'F-0002', 'seq counter must continue after reopen, never reuse ids');
});

test('corrupt file: unparseable JSON and wrong shape both throw CORRUPT', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'findings.json');

  await writeFile(file, '{ not json at all', 'utf8');
  await rejectsWith(createStore(file), 'CORRUPT');

  await writeFile(file, '[]', 'utf8'); // valid JSON, wrong container
  await rejectsWith(createStore(file), 'CORRUPT');

  await writeFile(file, JSON.stringify({ seq: 'one', findings: [] }), 'utf8'); // wrong seq type
  await rejectsWith(createStore(file), 'CORRUPT');

  await writeFile(file, JSON.stringify({ seq: 1 }), 'utf8'); // findings missing
  await rejectsWith(createStore(file), 'CORRUPT');
});

test('writes are atomic: the data file is always valid JSON and no .tmp residue remains', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'findings.json');
  const store = await createStore(file);

  await store.add({ title: 'A', category: 'protocol', phase: 'drydock' });
  await store.add({ title: 'B', category: 'ux', phase: 'execute' });
  await store.transition('F-0002', 'wontfix');

  const onDisk = JSON.parse(await readFile(file, 'utf8')); // must parse cleanly
  assert.deepEqual(
    { seq: onDisk.seq, count: onDisk.findings.length },
    { seq: 2, count: 2 },
  );
  assert.equal(onDisk.findings[0].id, 'F-0001');
  assert.equal(onDisk.findings[0].status, 'open');
  assert.equal(onDisk.findings[1].id, 'F-0002');
  assert.equal(onDisk.findings[1].status, 'wontfix');

  const files = await readdir(dir);
  assert.deepEqual(files, ['findings.json'], 'atomic replace must leave no .tmp file behind');
});

test('ids are monotonic and never reused after wontfix (no physical delete)', async (t) => {
  const store = await tempStore(t);

  const a = await store.add({ title: 'A', category: 'naming', phase: 'tickets' });
  assert.equal(a.id, 'F-0001');
  await store.transition('F-0001', 'wontfix');

  const b = await store.add({ title: 'B', category: 'naming', phase: 'tickets' });
  assert.equal(b.id, 'F-0002', 'wontfix must not release the id for reuse');

  // wontfix keeps the record around — no physical delete API
  const all = await store.list();
  assert.deepEqual(all.map((f) => f.id), ['F-0002', 'F-0001']);
  assert.equal(all[1].status, 'wontfix');

  const c = await store.add({ title: 'C', category: 'naming', phase: 'tickets' });
  assert.equal(c.id, 'F-0003');
});

// ---- TICKET 01 (S1): edit finding via store.update(id, changes) ----

test('update partially edits only provided fields, bumps updatedAt, keeps id/createdAt/status, persists', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'findings.json');
  const store = await createStore(file);

  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.setTime(1_700_000_000_000);
  const created = await store.add({
    title: 'Original',
    category: 'protocol',
    phase: 'drydock',
    detail: 'old detail',
  });
  await store.transition('F-0001', 'confirmed'); // metadata edit off a non-open status is allowed

  t.mock.timers.setTime(1_700_000_060_000);
  const updated = await store.update('F-0001', { title: 'Renamed', phase: 'execute' });

  assert.equal(updated.id, 'F-0001');
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.phase, 'execute');
  assert.equal(updated.category, 'protocol', 'absent field stays untouched');
  assert.equal(updated.detail, 'old detail', 'absent field stays untouched');
  assert.equal(updated.status, 'confirmed', 'status is immutable through a metadata edit');
  assert.equal(updated.createdAt, created.createdAt, 'createdAt is immutable');
  assert.equal(new Date(updated.updatedAt).getTime(), 1_700_000_060_000, 'updatedAt advances to now');
  assert.ok(updated.updatedAt > created.updatedAt, 'updatedAt must strictly advance');

  // persisted state reflects the edit; nothing else changed (incl. the seq counter)
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(onDisk.seq, 1, 'an edit must not consume a seq / burn an id');
  const record = onDisk.findings.find((f) => f.id === 'F-0001');
  assert.deepEqual(
    {
      title: record.title,
      phase: record.phase,
      category: record.category,
      detail: record.detail,
      status: record.status,
    },
    {
      title: 'Renamed',
      phase: 'execute',
      category: 'protocol',
      detail: 'old detail',
      status: 'confirmed',
    },
  );
});

test('update allows a single editable field (partial-only) and empty detail to be cleared', async (t) => {
  const store = await tempStore(t);
  const created = await store.add({
    title: 'A',
    category: 'docs',
    phase: 'spec',
    detail: 'some original detail',
  });

  const detailOnly = await store.update('F-0001', { detail: '' });
  assert.equal(detailOnly.title, 'A', 'title untouched when only detail is edited');
  assert.equal(detailOnly.detail, '', 'detail can be cleared');
  assert.equal(detailOnly.category, 'docs');
  assert.equal(detailOnly.phase, 'spec');
  assert.ok(detailOnly.updatedAt > created.updatedAt, 'updatedAt advances on a single-field edit');
});

test('update rejects invalid values with VALIDATION and leaves disk + unrelated fields untouched', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shipyard-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'findings.json');
  const store = await createStore(file);
  await store.add({ title: 'A', category: 'protocol', phase: 'drydock', detail: 'keep' });
  const before = await store.get('F-0001');

  const bad = [
    {}, // nothing to edit
    { title: '' }, // empty title
    { title: '   ' }, // whitespace-only title
    { title: 'x'.repeat(121) }, // oversized title
    { title: 42 }, // title not a string
    { category: 'bug' }, // category not in enum
    { phase: 'qa' }, // phase not in enum
    { detail: 7 }, // detail not a string
    null, // not an object
    42, // not an object
  ];
  for (const changes of bad) {
    await rejectsWith(store.update('F-0001', changes), 'VALIDATION');
  }

  const after = await store.get('F-0001');
  assert.deepEqual(
    {
      title: after.title,
      category: after.category,
      phase: after.phase,
      detail: after.detail,
      updatedAt: after.updatedAt,
    },
    {
      title: before.title,
      category: before.category,
      phase: before.phase,
      detail: before.detail,
      updatedAt: before.updatedAt,
    },
    'rejected edits must not change the record or bump updatedAt',
  );

  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    { title: onDisk.findings[0].title, category: onDisk.findings[0].category },
    { title: 'A', category: 'protocol' },
    'disk must be untouched by rejected edits',
  );
});

test('update rejects protected fields (id/createdAt/status) fail-fast and reports NOT_FOUND for unknown ids', async (t) => {
  const store = await tempStore(t);
  await store.add({ title: 'A', category: 'protocol', phase: 'drydock' });

  for (const changes of [{ id: 'F-9999' }, { createdAt: 'x' }, { status: 'shipped' }]) {
    await rejectsWith(store.update('F-0001', changes), 'VALIDATION');
  }
  // fail-fast: a protected key is rejected even alongside a valid editable field
  await rejectsWith(store.update('F-0001', { title: 'ok', status: 'shipped' }), 'VALIDATION');
  await rejectsWith(store.update('F-0001', { title: 'ok', id: 'F-0001' }), 'VALIDATION');

  await rejectsWith(store.update('F-9999', { title: 'ok' }), 'NOT_FOUND');
  await rejectsWith(store.update('no-such-id', { title: 'ok' }), 'NOT_FOUND');

  const f = await store.get('F-0001');
  assert.equal(f.title, 'A', 'rejected edits must not change the record');
  assert.equal(f.status, 'open');
  assert.equal(f.updatedAt, f.createdAt, 'rejected edits must not bump updatedAt');
});

test('update allows metadata edits on every status, including terminal shipped and wontfix', async (t) => {
  const store = await tempStore(t);

  const fixed = await store.add({ title: 'F', category: 'ux', phase: 'execute' });
  await store.transition('F-0001', 'confirmed');
  await store.transition('F-0001', 'fixed');
  await store.transition('F-0001', 'shipped');
  const shippedEdited = await store.update('F-0001', { title: 'edited shipped' });
  assert.equal(shippedEdited.status, 'shipped');
  assert.equal(shippedEdited.title, 'edited shipped');

  await store.add({ title: 'W', category: 'ux', phase: 'execute' }); // F-0002
  await store.transition('F-0002', 'wontfix');
  const wontfixEdited = await store.update('F-0002', { title: 'edited wontfix' });
  assert.equal(wontfixEdited.status, 'wontfix');
  assert.equal(wontfixEdited.title, 'edited wontfix');
});

// ---- TICKET 02 (S1): full-text search via list({q}) ----

test('list({q}) matches a case-insensitive substring of title or detail, newest first', async (t) => {
  const store = await tempStore(t);
  await store.add({
    title: 'CRLF injection in logs',
    category: 'protocol',
    phase: 'drydock',
    detail: 'echo CRLF into the log line',
  }); // F-0001
  await store.add({
    title: 'Pyramid',
    category: 'ux',
    phase: 'execute',
    detail: 'CRLF flows into detail only',
  }); // F-0002
  await store.add({ title: 'Raft', category: 'docs', phase: 'spec', detail: 'unrelated detail' }); // F-0003

  // title hit
  assert.deepEqual((await store.list({ q: 'CRLF injection' })).map((f) => f.id), ['F-0001']);
  // detail hit
  assert.deepEqual((await store.list({ q: 'flows into detail' })).map((f) => f.id), ['F-0002']);
  // case-insensitive: lowercase q matches uppercase CRLF in both title and detail
  assert.deepEqual((await store.list({ q: 'crlf' })).map((f) => f.id), ['F-0002', 'F-0001']);
  // no match → empty list
  assert.deepEqual(await store.list({ q: 'zzz-no-hits' }), []);

  // search results must not leak internal references (snapshots)
  const copy = await store.list({ q: 'crlf' });
  copy[0].title = 'mutated';
  assert.equal((await store.list({ q: 'crlf' }))[0].title, 'Pyramid', 'mutating a result must not touch the store');
});

test('list({q}) AND-combines with status/category/phase filters and preserves order', async (t) => {
  const store = await tempStore(t);
  await store.add({ title: 'Bug in drydock phase', category: 'protocol', phase: 'drydock' }); // F-0001
  await store.add({ title: 'Bug in execute', category: 'ux', phase: 'execute' }); // F-0002
  await store.add({ title: 'bug hunt drydock', category: 'ux', phase: 'drydock' }); // F-0003
  // a ux/drydock finding whose title/detail lack 'bug' — proves q truly filters
  await store.add({ title: 'Raft review', category: 'ux', phase: 'drydock' }); // F-0004
  await store.transition('F-0002', 'confirmed');

  // q alone (F-0004 lacks the term and must be excluded)
  assert.deepEqual((await store.list({ q: 'bug' })).map((f) => f.id), ['F-0003', 'F-0002', 'F-0001']);
  // q AND category (F-0004 is ux but lacks 'bug')
  assert.deepEqual((await store.list({ q: 'bug', category: 'ux' })).map((f) => f.id), ['F-0003', 'F-0002']);
  // q AND phase (F-0004 is drydock but lacks 'bug')
  assert.deepEqual((await store.list({ q: 'bug', phase: 'drydock' })).map((f) => f.id), ['F-0003', 'F-0001']);
  // q AND status
  assert.deepEqual((await store.list({ q: 'bug', status: 'confirmed' })).map((f) => f.id), ['F-0002']);
  // q AND multiple filters, newest-first preserved
  assert.deepEqual(
    (await store.list({ q: 'bug', category: 'ux', phase: 'execute' })).map((f) => f.id),
    ['F-0002'],
  );
});

test('list ignores an empty or whitespace-only q and piles onto the other filters like a no-op', async (t) => {
  const store = await tempStore(t);
  await store.add({ title: 'Alpha', category: 'protocol', phase: 'drydock' }); // F-0001
  await store.add({ title: 'Beta', category: 'ux', phase: 'drydock' }); // F-0002

  for (const q of [undefined, '', '   ']) {
    assert.deepEqual(
      (await store.list({ q })).map((f) => f.id),
      ['F-0002', 'F-0001'],
      `q=${JSON.stringify(q)} must be treated as absent`,
    );
  }
  // whitespace-only q next to a real filter behaves as if q were absent
  assert.deepEqual((await store.list({ q: '  ', category: 'ux' })).map((f) => f.id), ['F-0002']);
});

test('list({q}) still validates enum filters and rejects a non-string q at the store boundary', async (t) => {
  const store = await tempStore(t);
  await store.add({ title: 'A', category: 'protocol', phase: 'drydock' });

  // an invalid enum filter alongside a valid q is still a VALIDATION error
  await rejectsWith(store.list({ q: 'a', category: 'bug' }), 'VALIDATION');
  await rejectsWith(store.list({ q: 'a', status: 'nope' }), 'VALIDATION');
  await rejectsWith(store.list({ q: 'a', phase: 'qa' }), 'VALIDATION');

  // q is free text (no enum), but a non-string q is rejected at the store boundary
  await rejectsWith(store.list({ q: 42 }), 'VALIDATION');
  await rejectsWith(store.list({ q: null }), 'VALIDATION');
  await rejectsWith(store.list({ q: ['x'] }), 'VALIDATION');
  await rejectsWith(store.list({ q: {} }), 'VALIDATION');
});
