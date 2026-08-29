// src/store.js — storage module.
// Per docs/standards/architecture.md this is the ONLY module allowed to read/write data/.
// Data shape per docs/standards/data.md: single JSON file `{ "seq": N, "findings": [...] }`,
// atomic replacement on write (tmp file + rename), monotonically increasing IDs, never reused.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CATEGORIES = Object.freeze(['protocol', 'missing', 'naming', 'docs', 'ux']);
export const STATUSES = Object.freeze(['open', 'confirmed', 'fixed', 'shipped', 'wontfix']);
export const PHASES = Object.freeze(['drydock', 'converge', 'spec', 'tickets', 'execute', 'closeout']);

// Lifecycle per CONTEXT.md: open → confirmed → fixed → shipped; any non-terminal state
// may go to wontfix. shipped and wontfix are terminal (no outgoing edges).
const TRANSITIONS = Object.freeze({
  open: Object.freeze(['confirmed', 'wontfix']),
  confirmed: Object.freeze(['fixed', 'wontfix']),
  fixed: Object.freeze(['shipped', 'wontfix']),
  shipped: Object.freeze([]),
  wontfix: Object.freeze([]),
});

const TITLE_MAX_LENGTH = 120;

/** Error with a machine-readable `code`, translated to HTTP by the handler layer (T2). */
export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

function formatId(seq) {
  return `F-${String(seq).padStart(4, '0')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function snapshot(finding) {
  return { ...finding };
}

function validateTitle(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StoreError('VALIDATION', 'title is required and must be a non-empty string');
  }
  const title = value.trim();
  if (title.length > TITLE_MAX_LENGTH) {
    throw new StoreError('VALIDATION', `title must be at most ${TITLE_MAX_LENGTH} characters`);
  }
  return title;
}

function validateEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new StoreError('VALIDATION', `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function validateDetail(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new StoreError('VALIDATION', 'detail must be a string when provided');
  }
  return value;
}

/** Parse persisted contents; any structural damage is reported as CORRUPT. */
function parseDb(raw, filePath) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StoreError('CORRUPT', `findings file is not valid JSON: ${filePath} (${err.message})`);
  }
  const seq = parsed?.seq;
  const findings = parsed?.findings;
  if (
    typeof seq !== 'number' ||
    !Number.isInteger(seq) ||
    seq < 0 ||
    !Array.isArray(findings)
  ) {
    throw new StoreError('CORRUPT', `findings file has unexpected shape: ${filePath}`);
  }
  return { seq, findings };
}

/**
 * Factory: opens (loads or safely initializes) the store and resolves once ready.
 * - file missing  → empty library (created on first write)
 * - corrupt JSON  → rejects with an Error whose `code` is 'CORRUPT'
 */
export async function createStore(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new StoreError('VALIDATION', 'filePath must be a non-empty string');
  }
  const store = new Store(filePath);
  await store.open();
  return store;
}

class Store {
  #filePath;
  #db = { seq: 0, findings: [] };
  // Serializes mutations so concurrent add/transition calls cannot interleave
  // and assign the same seq before either persists.
  #queue = Promise.resolve();

  constructor(filePath) {
    this.#filePath = filePath;
  }

  /** Load the data file; missing file → empty library. Re-callable to reload from disk. */
  async open() {
    let raw;
    try {
      raw = await readFile(this.#filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.#db = { seq: 0, findings: [] };
        return;
      }
      throw err;
    }
    this.#db = parseDb(raw, this.#filePath);
  }

  /** Create a finding: allocates the next F-NNNN id, persists atomically, returns it. */
  add(input) {
    return this.#enqueue(() => this.#add(input));
  }

  /**
   * List findings, newest first. `filter` accepts any combination of
   * {status, category, phase}; omitted/empty filter returns everything.
   */
  async list(filter = {}) {
    if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new StoreError('VALIDATION', 'filter must be an object when provided');
    }
    validateEnumIfPresent(filter.status, STATUSES, 'status');
    validateEnumIfPresent(filter.category, CATEGORIES, 'category');
    validateEnumIfPresent(filter.phase, PHASES, 'phase');
    const keys = ['status', 'category', 'phase'].filter((k) => filter[k] !== undefined);
    const matches = this.#db.findings.filter((f) => keys.every((k) => f[k] === filter[k]));
    // Findings are append-only, so reverse insertion order === newest first
    // (avoids fragile lexicographic id comparison past F-9999).
    return matches.slice().reverse().map(snapshot);
  }

  /**
   * All findings in insertion order (id ascending) — the full-export view.
   * Unlike list(), no filtering and no newest-first reversal; returns snapshots.
   */
  async all() {
    return this.#db.findings.map(snapshot);
  }

  /** Single finding by id, or NOT_FOUND. */
  async get(id) {
    const finding = this.#db.findings.find((f) => f.id === id);
    if (!finding) {
      throw new StoreError('NOT_FOUND', `no finding with id ${JSON.stringify(id)}`);
    }
    return snapshot(finding);
  }

  /** Move a finding along the status machine; persists the update. */
  transition(id, to) {
    return this.#enqueue(() => this.#transition(id, to));
  }

  #enqueue(operation) {
    const run = this.#queue.then(operation);
    this.#queue = run.then(
      () => {},
      () => {}, // keep the chain alive after failures
    );
    return run;
  }

  async #add(input) {
    const record = input ?? {};
    const title = validateTitle(record.title);
    const category = validateEnum(record.category, CATEGORIES, 'category');
    const phase = validateEnum(record.phase, PHASES, 'phase');
    const detail = validateDetail(record.detail);

    const seq = this.#db.seq + 1;
    const timestamp = nowIso();
    const finding = {
      id: formatId(seq),
      title,
      category,
      status: 'open',
      detail,
      phase,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#db = { seq, findings: [...this.#db.findings, finding] };
    await this.#persist();
    return snapshot(finding);
  }

  async #transition(id, to) {
    const finding = this.#db.findings.find((f) => f.id === id);
    if (!finding) {
      throw new StoreError('NOT_FOUND', `no finding with id ${JSON.stringify(id)}`);
    }
    validateEnum(to, STATUSES, 'status');
    if (!TRANSITIONS[finding.status].includes(to)) {
      throw new StoreError(
        'BAD_TRANSITION',
        `cannot transition from ${finding.status} to ${to}`,
      );
    }
    finding.status = to;
    finding.updatedAt = nowIso();
    await this.#persist();
    return snapshot(finding);
  }

  /** Atomic replace: write `path + '.tmp'`, then rename over the target. */
  async #persist() {
    const tmpPath = this.#filePath + '.tmp';
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(this.#db, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.#filePath);
  }
}

function validateEnumIfPresent(value, allowed, field) {
  if (value === undefined) return;
  validateEnum(value, allowed, field);
}
