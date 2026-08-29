# shipyard-log

Shipyard 工作流的 dogfood 反馈回路追踪器：把 drydock / launch 各阶段记录的摩擦点
（finding）变成可分类、可追踪到修复闭环的数据，而不是散落在对话历史和临时 markdown 里。

零依赖 Node.js（≥24，原生 ESM）单用户本地 Web 应用：JSON API + vanilla 前端，
存储为单个 JSON 文件（`data/findings.json`，原子写）。

## 启动

```bash
npm start    # http://localhost:4100 （PORT 环境变量可覆盖）
npm test     # node --test —— 存储单元 + HTTP 集成 + S3 冒烟，全部门禁测试
```

## Shipyard 反馈回路

本应用是 shipyard 工作流"发现问题 → 修正技能文件 → 验证生效"的留痕环节：

1. 每次 shipyard 运行（drydock / launch 各阶段）中，摩擦点当场记为 finding（`phase` 标记来源阶段）
2. 运行结束 → review findings → `confirmed`
3. 修 shipyard 技能文件 → `fixed`
4. 下一次运行验证修复生效 → `shipped`
5. 不修的 → `wontfix` 并写明理由

- 流程规范全文：[docs/standards/process.md](docs/standards/process.md)
- dogfood 运行日志（finding 的第一手来源）：[docs/dogfood/log.md](docs/dogfood/log.md)
- 首批真实数据由 `node scripts/seed-findings.mjs` 经 HTTP API 幂等回填（Run#1）

## API

| Method | Path | 作用 |
| --- | --- | --- |
| POST | `/api/findings` | 记录 finding（title ≤120 必填、category/phase 枚举、detail 可选）→ 201 + `F-NNNN` |
| GET | `/api/findings` | 列表，新在前；`?status=&category=&phase=` 任意组合过滤 |
| PATCH | `/api/findings/:id/status` | 状态流转（body `{"to": "confirmed"}` 等）；非法迁移 → 409 |
| GET | `/api/stats` | 按 status / category 计数（零值也列出） |
| GET | `/api/export.md` | Markdown 报告（统计 + 全部明细），可直接贴进 shipyard 复盘 |

静态前端（`/`、`/tokens.css`、`/app.js`）由同一服务托管；前端只经 HTTP API 访问数据。
错误响应统一 JSON `{ "error": { "code", "message" } }`（400/404/409/500）。

## 数据

- `data/findings.json` 是提交在仓库里的真实 dogfood 数据（`.gitignore` 只忽略 `*.local.json`）
- 状态机：`open → confirmed → fixed → shipped`；任何非终态可 → `wontfix`；`shipped`/`wontfix` 为终态

架构与规范：[docs/standards/architecture.md](docs/standards/architecture.md) ｜ 术语：[CONTEXT.md](CONTEXT.md) ｜ 决策：[docs/adr/](docs/adr/)
