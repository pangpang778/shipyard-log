# Shipyard Log Spec

> C2 approved (human stand-in, 2026-08-29): acceptance criteria + seam list below.

## Problem
Shipyard（drydock + launch）的摩擦点目前散落在对话历史和临时 markdown 里，反馈回路没有闭环：finding 无法被记录、分类、追踪到修复，shipyard 技能文件的修正没有证据链。

## Solution
本地单用户 Web 应用：JSON API + vanilla 前端。Finding 记录（标题/分类/阶段/详情）、状态流转（open→confirmed→fixed→shipped / wontfix）、按维度过滤、统计面板、Markdown 导出。零依赖 Node 实现。

## User Stories
- **US1 记录 finding**: 提交 title（必填 ≤120 字符）+ category（枚举）+ phase（枚举）+ detail（可选），返回分配的 `F-NNNN`。空 title / 非法枚举 → 400。
- **US2 列表与过滤**: 按状态、分类、阶段任意组合过滤；默认全量倒序（新在前）。
- **US3 状态流转**: 合法迁移 open→confirmed→fixed→shipped；任何未终态可 →wontfix。非法迁移 → 409。
- **US4 统计**: 按 status 与 category 的计数视图。
- **US5 导出**: 生成 Markdown 报告（统计表 + 全部 finding 明细），可直接贴进 shipyard 复盘。
- **US6 前端**: 列表视图（含过滤）、新建表单、状态操作按钮、统计面板——样式只引用 design tokens。

## Implementation Decisions
- 路由：`/api/findings`（POST/GET）、`/api/findings/:id/status`（PATCH）、`/api/stats`、`/api/export.md`；`public/` 静态服务
- 端口 `PORT` 环境变量，默认 4100
- 写入 = 临时文件 + rename 原子替换；ID 由 seq 计数器单调分配
- 存储层抛带 `code` 的 Error，handler 翻译为 HTTP 状态码（见 architecture.md 错误处理）

## Testing Decisions
只测外部行为，三个 seam（C2 approved）：
- **S1 存储模块**（单元）：CRUD、ID 分配、原子写、损坏文件恢复
- **S2 HTTP API**（集成）：临时端口起服务，全部路由 + 校验 + 状态机 409
- **S3 前端冒烟**（集成）：静态资源可达且含必需挂载点；深度 UI 测试 out of scope

## Out of Scope
auth / 多用户 / 数据库 / labels-assignees / CI（T5 评估）
