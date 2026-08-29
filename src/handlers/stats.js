// src/handlers/stats.js — handlers for US4 (stats) and US5 (markdown export).
// Per docs/standards/architecture.md: handlers own the business logic and translate
// store-layer coded errors into HTTP responses; server.js only dispatches routes.
// Dependency direction: handlers → store, one-way.

import { CATEGORIES, STATUSES } from '../store.js';
import { toErrorResponse } from './findings.js';

/** Count findings per enum value; every enum value appears even when zero. */
function tally(findings, field, values) {
  const counts = Object.fromEntries(values.map((value) => [value, 0]));
  for (const finding of findings) {
    const value = finding[field];
    if (Object.hasOwn(counts, value)) counts[value] += 1;
  }
  return counts;
}

function formatStats(findings) {
  return {
    byStatus: tally(findings, 'status', STATUSES),
    byCategory: tally(findings, 'category', CATEGORIES),
    total: findings.length,
  };
}

/** Markdown table cell: pipes escaped, newlines flattened (titles are free-form). */
function cell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll(/\r\n?|\n/g, ' ');
}

function countTable(dimension, counts) {
  const lines = [`| ${dimension} | count |`, '| --- | ---: |'];
  for (const [value, count] of Object.entries(counts)) {
    lines.push(`| ${value} | ${count} |`);
  }
  return lines.join('\n');
}

function findingsTable(findings) {
  const header = '| id | title | category | phase | status | updatedAt |';
  const divider = '| --- | --- | --- | --- | --- | --- |';
  const rows = findings.map((f) =>
    `| ${[
      cell(f.id),
      cell(f.title),
      cell(f.category),
      cell(f.phase),
      cell(f.status),
      cell(f.updatedAt),
    ].join(' | ')} |`,
  );
  return [header, divider, ...rows].join('\n');
}

/** The US5 report: header (generation time + total) → stats tables → all findings. */
function renderMarkdown(findings) {
  const stats = formatStats(findings);
  return [
    '# Shipyard Log — Findings Export',
    '',
    `- Generated at: ${new Date().toISOString()}`,
    `- Total findings: ${stats.total}`,
    '',
    '## Statistics',
    '',
    countTable('status', stats.byStatus),
    '',
    countTable('category', stats.byCategory),
    '',
    '## Findings',
    '',
    findingsTable(findings),
    '',
  ].join('\n');
}

/**
 * Factory: binds handlers to a store instance. Each handler receives a request
 * context `{ query, params, body }` and resolves to `{ status, body, headers? }`;
 * `headers` marks a non-JSON raw response (the markdown export).
 */
export function createStatsHandlers(store) {
  return {
    /** GET /api/stats — counts by status and category, zero-inclusive (US4). */
    async stats() {
      try {
        const findings = await store.all();
        return { status: 200, body: formatStats(findings) };
      } catch (err) {
        return toErrorResponse(err);
      }
    },

    /** GET /api/export.md — full markdown report for shipyard retros (US5). */
    async exportMarkdown() {
      try {
        const findings = await store.all();
        return {
          status: 200,
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
          body: renderMarkdown(findings),
        };
      } catch (err) {
        return toErrorResponse(err);
      }
    },
  };
}
