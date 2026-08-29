# T5 — e2e smoke + CI + dogfood round-1 closeout

blockedBy: T2, T3, T4 ｜ ready-for-agent

## Goal
交付收官切片：端到端冒烟（S3）、GitHub Actions CI、README，并把 dogfood 回填闭环。

## Acceptance criteria
1. S3 冒烟测试：起真实服务（随机端口）→ 断言 `/`、`/tokens.css`、`/app.js` 200 且 index.html 含 `id="app"` → 用 API 走一遍"记录→确认→修复→下水"完整状态机 → 导出 markdown 非空
2. `.github/workflows/ci.yml`：push/PR 触发，Node 24，`node --test`
3. 根 `README.md`：项目是什么、如何启动（npm start / node --test）、shipyard 反馈回路说明（指向 docs/process.md）
4. **Dogfood 回填**：docs/dogfood/log.md 中的全部 findings 经 API 录入应用（它们成为应用的第一批真实数据），并在每条 finding 的 detail 里回链 dogfood 日志原文
5. `npm test` 全绿；提交并推送

## Notes
- 本票是"用应用管理应用反馈"的转折点：完成后 finding 生命周期全部走应用本身
