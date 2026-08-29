# T2 — findings HTTP API

blockedBy: T1 ｜ ready-for-agent

## Goal
交付 HTTP API 垂直切片（seam S2）：路由、校验、状态机、错误翻译，全部集成测试覆盖。

## Acceptance criteria
1. HTTP 入口（见 architecture.md「HTTP 入口」）：`POST /api/findings`（US1 校验：空 title/非法枚举→400）、`GET /api/findings?status=&category=&phase=`（US2）、`PATCH /api/findings/:id/status`（US3，非法迁移→409，未知 id→404）
2. store 层 Error.code → HTTP 翻译：BAD_TRANSITION→409、NOT_FOUND→404、VALIDATION→400，其余→500
3. 错误响应统一 `{ "error": { "code", "message" } }`；成功响应返回 finding JSON
4. 集成测试（S2）：临时端口起真实服务，覆盖每条路由的成功/校验失败/非法迁移/404；测试结束清理临时数据文件
5. `npm test` 全绿（S1 既有测试不回归）

## Notes
- 静态文件服务属 T3 切片，本票不做
- 端口绑定接受 `PORT`，测试用 0（随机端口）
