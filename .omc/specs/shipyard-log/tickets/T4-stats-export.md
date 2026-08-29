# T4 — stats + markdown export

blockedBy: T2, T3 ｜ ready-for-agent

## Goal
交付统计与导出（US4/US5），让反馈回路可复盘。

## Acceptance criteria
1. `GET /api/stats`：`{ byStatus: {...}, byCategory: {...}, total }`，集成测试覆盖（空库/有数据两态）
2. `GET /api/export.md`（`text/markdown`）：统计表 + 全部 finding 明细（id/title/category/phase/status/updatedAt），格式可直接贴进 shipyard 复盘文档
3. 前端：统计面板（调 /api/stats）+ "导出 Markdown" 按钮（下载或新窗口打开）
4. `npm test` 全绿（S1/S2/S3 不回归，新增 stats/export 测试）

## Notes
- 导出是 finding → 复盘文档的桥：文件头注明生成时间与总数
