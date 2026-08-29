# 01 — Edit Finding (vertical slice: store → handler → route → UI)

**blockedBy: []**

## Goal
支持 `PATCH /api/findings/:id` 对一条 finding 的 title/detail/category/phase 做部分编辑；前端每条卡片提供预填当前值的编辑表单，保存调 PATCH。id 与 createdAt 恒不可变；status 不进此端点。

## Acceptance Criteria
- E1 AC-01..AC-07（见 spec）：
  - 部分更新：只提交出现的可编辑字段被改，外加 updatedAt 推进；其余不变。
  - `{}` 空体 → 400 VALIDATION，无副作用。
  - 非法值（空/超长 title、非枚举 category/phase、非字符串 detail）→ 400 VALIDATION，记录与磁盘文件均不变。
  - 未知 id → 404 NOT_FOUND。
  - 请求体出现受保护字段（id/createdAt/status）→ 400 VALIDATION（fail-fast，C2 确认）。
  - 编辑后 updatedAt 严格新于原值；createdAt 与 status 恒不变。
  - 任意状态（含 shipped/wontfix 终态）均可编辑元数据（C2 确认）。

## Layer touchpoints（按模块角色，非坐标）
- **存储模块**：新增 `update(id, changes)`。复用既有字段校验（title 非空 ≤120、category/phase 枚举、detail 可为空字符串）；只取请求体内出现的可编辑键；受保护键显式抛 VALIDATION。走既有串行化队列 + 原子写，与 add/transition 并发安全；成功才推进 updatedAt，createdAt/id/status 不变。
- **findings handler**：新增 update 处理器，把存储层 coded-error 翻译为 HTTP 状态码（沿用既有映射：VALIDATION→400、NOT_FOUND→404）。
- **server 路由表**：注册 `PATCH /api/findings/:id`。不得触碰既有 `/status` 迁移路径；`GET /api/findings/:id` 维持 404（既有行为不变）。
- **前端**：每条 finding 卡片加 Edit 入口，点开为 inline 编辑表单（预填当前 title/detail/category/phase，复用小表单的枚举容器）；保存调 PATCH，成功后刷新列表与统计；失败走既有 error-bar（AC-18）；内容一律 textContent 渲染（AC-19）。

## Test seams
- **S1 存储（单元）**：`update` 部分更新 / 校验 / 受保护字段拒绝 / 未找到 404 / 成功与失败都不污染磁盘、不推进无关字段。
- **S2 HTTP（集成）**：`PATCH /api/findings/:id` 200 成功、400 非法值、400 受保护字段、404 未知 id；既有 `/status` 端点行为不变。
- **S3 前端（集成）**：静态壳可达，含 Edit 入口挂载点；深度 UI out of scope。

## Demonstrable
起服后经 HTTP 对一条 finding PATCH 一个字段 → 返回体只该字段 + updatedAt 变化，再经 GET 可见；前端 Edit 点开为预填表单且可保存生效。