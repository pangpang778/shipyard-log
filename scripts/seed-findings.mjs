#!/usr/bin/env node
// scripts/seed-findings.mjs — dogfood round-1 backfill (T5 closeout).
//
// 用途：把 docs/dogfood/log.md Run#1 的 4 条 finding 经应用自身的 HTTP API 录入
//       仓库真实数据文件 data/findings.json —— 本应用管理自身反馈的转折点。
// 用法：node scripts/seed-findings.mjs
// 幂等：先 GET 全量列表按 title 精确去重；已存在则只在状态落后时补一次 PATCH，
//       不会重复创建、不会改写已有状态。
// 副作用：经 store 的原子写创建/更新 data/findings.json；临时占用一个随机端口。

import { fileURLToPath } from 'node:url';
import { start } from '../src/server.js';

const DATA_FILE = fileURLToPath(new URL('../data/findings.json', import.meta.url));

// Source: docs/dogfood/log.md Run#1（statuses per T5 ticket — dogfood round-1 closeout）
const SEED = Object.freeze([
  {
    title: 'Windows git CRLF warnings pollute drydock output (13 lines)',
    category: 'missing',
    phase: 'drydock',
    detail:
      'Fix candidate: add .gitattributes (* text=auto eol=lf) to drydock seed. Source: docs/dogfood/log.md Run#1',
    status: 'confirmed',
  },
  {
    title: 'drydock suggests `omc doctor` but is not executable outside an OMC session',
    category: 'protocol',
    phase: 'drydock',
    detail: 'Fix candidate: make OMC detection optional. Source: docs/dogfood/log.md Run#1',
    status: 'confirmed',
  },
  {
    title:
      'Solo dogfood: agent plays both human and agent roles, C1-C5 exercised with zero real-user friction cost',
    category: 'ux',
    phase: 'execute',
    detail:
      'Evaluation limitation, not a skill defect — needs a real human rerun. Source: docs/dogfood/log.md Run#1',
    status: 'wontfix',
  },
  {
    title: 'launch lacks a brief-quality self-check list before Phase 1',
    category: 'protocol',
    phase: 'converge',
    detail:
      'Fix candidate: add brief self-check (objective named? scope boundary named? non-goals?) to launch skill. Source: docs/dogfood/log.md Run#1',
    status: 'confirmed',
  },
]);

async function requestJson(base, requestPath, { method = 'GET', body } = {}) {
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
  return { status: res.status, body: parsed, raw: text };
}

async function main() {
  const app = await start({ port: 0, dataFile: DATA_FILE }); // random port, real data file
  const base = `http://localhost:${app.port}`;
  console.log(`seeding ${DATA_FILE} via http://localhost:${app.port}`);
  try {
    const list = await requestJson(base, '/api/findings');
    if (list.status !== 200) {
      throw new Error(`GET /api/findings failed with ${list.status}: ${list.raw}`);
    }
    const existingByTitle = new Map(list.body.map((f) => [f.title, f]));

    for (const seed of SEED) {
      let finding = existingByTitle.get(seed.title);
      if (finding) {
        console.log(`= present  ${finding.id} [${finding.status}] ${seed.title}`);
      } else {
        const created = await requestJson(base, '/api/findings', {
          method: 'POST',
          body: {
            title: seed.title,
            category: seed.category,
            phase: seed.phase,
            detail: seed.detail,
          },
        });
        if (created.status !== 201) {
          throw new Error(`POST failed for ${JSON.stringify(seed.title)}: ${created.raw}`);
        }
        finding = created.body;
        console.log(`+ created  ${finding.id} [${finding.status}] ${seed.title}`);
      }

      if (finding.status !== seed.status) {
        const moved = await requestJson(base, `/api/findings/${finding.id}/status`, {
          method: 'PATCH',
          body: { to: seed.status },
        });
        if (moved.status !== 200) {
          throw new Error(
            `cannot move ${finding.id} from ${finding.status} to ${seed.status}: ${moved.raw}`,
          );
        }
        finding = moved.body;
        console.log(`> moved    ${finding.id} → [${finding.status}]`);
      }
    }

    // verify through the API, not by trusting local variables
    const after = await requestJson(base, '/api/findings');
    if (after.status !== 200) {
      throw new Error(`verification GET failed with ${after.status}: ${after.raw}`);
    }
    const byTitle = new Map(after.body.map((f) => [f.title, f]));
    for (const seed of SEED) {
      const finding = byTitle.get(seed.title);
      if (!finding) throw new Error(`verification: missing finding ${JSON.stringify(seed.title)}`);
      if (finding.status !== seed.status) {
        throw new Error(
          `verification: ${finding.id} is [${finding.status}], expected [${seed.status}]`,
        );
      }
      console.log(`✓ ${finding.id} [${finding.status}] (${finding.category}/${finding.phase})`);
    }
    console.log(`done: ${after.body.length} findings in the library`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('seed failed:', err.message);
  process.exitCode = 1;
});
