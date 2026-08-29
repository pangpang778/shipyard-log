# Mission Brief — Run 2 (C1)

## Objective
Make findings **editable and searchable** in Shipyard Log: a finding's title/detail/category/phase can be corrected after creation, and the list can be filtered by free-text search across title+detail.

## Scope boundary
- API: `PATCH /api/findings/:id` (edit title/detail/category/phase; id 与 createdAt 不可变；status 仍走既有状态机端点) + `GET /api/findings?q=<text>`（title+detail 大小写不敏感子串匹配，与现有 status/category/phase 过滤可叠加）
- UI: 列表内每条 finding 的 Edit 入口（表单预填、保存调 PATCH）+ 顶部搜索框（q 参数，与下拉过滤叠加）
- Tests: S2 集成（edit 成功/校验/404）+ S1 存储层（edit、q 过滤）+ 既有 35 个测试零回归

## Non-goals
- 删除 finding、auth、数据库、分页、全文索引引擎（子串匹配够用）

## Run-2 特殊说明（本次同时是 shipyard 评测）
- 上次运行的 F-0001/0002/0004 修复在本运行中验证（gitattributes/可选 OMC 检查/brief 自检），验证通过后应标记 shipped
- 执行 agent 不得 git commit/push——orchestrator 在检查点之间统一提交
