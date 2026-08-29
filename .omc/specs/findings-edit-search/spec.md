# Findings Edit & Search Spec

> C2 draft (launch Phase 2) — 待人类批准。类目/状态/阶段词表沿用 CONTEXT.md；记录形态沿 docs/standards/data.md。

## Problem

Finding 一经创建即不可更正：标题打错、分类归类不当、阶段记错都无法修正，只能立一条新 finding 制造噪音。列表也只在 status/category/phase 三个下拉间过滤，无法按自由文本（标题或详情里的关键词）检索——录入错误隐患与检索盲区共同损害反馈闭环的证据质量。

## Solution

在既有零依赖栈上新增两个能力：
- **编辑（PATCH）**：`PATCH /api/findings/:id` 部分更新一条 finding 的 title / detail / category / phase；id 与 createdAt 不可变；status 不进此端点（仍走既有 `/api/findings/:id/status` 状态机）。
- **搜索（GET q）**：`GET /api/findings?q=<text>` 对 title 与 detail 做大小写不敏感子串匹配，与既有 status/category/phase 过滤按 AND 叠加。
- **UI**：每条 finding 卡片加 Edit 入口（表单预填、保存调 PATCH）；顶部搜索框（q 参数，与下拉联合生效）。

无新增依赖、无数据库、无构建。

## User Stories

**E1 编辑 finding** — 调用方能在创建后修正一条 finding 的 title/detail/category/phase。
- AC-01: `PATCH /api/findings/:id` 只提交部分可编辑字段 → 200 + 更新后的 finding；仅被提交字段（外加 updatedAt）发生改变。
- AC-02: PATCH 提交空对象 `{}`（无可编辑字段）→ 400 VALIDATION，不改动、不落盘副作用。
- AC-03: PATCH 提交非法值（空/超长 title、非枚举 category/phase、非字符串 detail）→ 400 VALIDATION，原记录与磁盘文件均不变。
- AC-04: PATCH 未知 id → 404 NOT_FOUND。
- AC-05: PATCH 请求体中出现受保护字段（id / createdAt / status）→ 400 VALIDATION（fail-fast 拒绝，而非静默忽略）。
- AC-06: 编辑后 updatedAt 严格新于原值；createdAt 与 status 恒不变，与编辑行为无关。
- AC-07: 任何状态下均可编辑元数据（含 shipped / wontfix 终态）；status 迁移仍只经既有权端点。

**E2 搜索 finding** — 调用方能按自由文本过滤列表。
- AC-08: `GET /api/findings?q=<t>` 返回 title **或** detail 含子串 t（大小写不敏感）的 finding。
- AC-09: 匹配大小写不敏感（`q=crlf` 命中 `CRLF`）。
- AC-10: q 与 status/category/phase 过滤按 AND 叠加（三下拉 + q 全同时生效）。
- AC-11: 无命中 → 空数组（200，非错误）。
- AC-12: 空串/纯空白 q 视同未提供（返回全量，非 400）。
- AC-13: 即便带 q，非法 status/category/phase 仍 → 400 VALIDATION。
- AC-14: 结果保持既有序（新在前 / createdAt 倒序）。

**E3 前端编辑 + 搜索**（样式只引用 design tokens）
- AC-15: 每条 finding 卡片有 Edit 入口，点开为预填当前 title/detail/category/phase 的表单。
- AC-16: 保存调 `PATCH /api/findings/:id`，成功后列表/统计即时反映修改。
- AC-17: 顶部搜索框输入 q，与三个下拉过滤联合即时刷新列表（带轻量 debounce）。
- AC-18: 服务器错误（400/404/网络）经既有 error-bar 呈现，不静默吞掉。
- AC-19: 所有用户内容仍经 textContent 渲染，无 innerHTML，防注入不回退。

## Implementation Decisions

- **store 新增 `update(id, changes)`**：复用既有 `validateTitle`/`validateEnum`/`validateDetail`；走既有 `#enqueue` 串行化 + `#persist` 原子写，保证与 add/transition 并发安全（读-改-写都在队列内）。
- **PATCH 部分更新语义**：只读取并校验请求体内出现的可编辑键；受保护键（id/createdAt/status）显式 400（见 AC-05）——理由：防止"改 status 静默不生效"让调用方误以为成功；状态修改必须走专用端点。
- **路由 `PATCH /api/findings/:id`**：server.js 的 `matchRoute` 新增模式，与既有 `/status` 子路径无关；`GET /api/findings/:id` 维持 404（既有测试断言不变）。
- **q 的传递**：`filterFromQuery` 增补 `q`，透传进 `store.list`；q 为空/空白视为缺省（沿用既有"空过滤值当缺省"语义）；多 q 参数 last-wins（沿用 `Object.fromEntries` 既有行为）。
- **搜索实现**：`title`/`detail` 各自 `toLowerCase()` 后与 `q.toLowerCase()` 做 `includes` 子串匹配；无全文索引、无分词（见 Non-goals）。
- **updatedAt 打点**：任何成功的编辑推进 `updatedAt`；createdAt/id 恒不变。
- **编辑不设状态门禁**：元数据纠错独立于状态生命周期，shipped/wontfix 也可改 title/detail/category/phase；status 机器只管 status（待确认，见 Open Assumptions）。
- **UI 形态**：Edit 以卡片内联编辑模式实现（复用新建表单的枚举区字段容器）；搜索框复用现有 toolbar 的过滤模式与 fetclh 序号防过期机制；debounce 用轻量 setTimeout（无第三方库）。

## Testing Decisions

只测外部行为（承继 run-1 三 seam 约定；新增覆盖落在既有 seam）：
- **S1 存储模块（单元）**：`store.update`（部分更新/校验/不可变字段/未找到/磁盘副作用为零）+ `store.list({q})`（title 命中 / detail 命中 / 大小写 / 与三过滤 AND / 空 q / 非法枚举仍 400）。
- **S2 HTTP API（集成）**：`PATCH /api/findings/:id`（200 成功 / 400 校验 / 400 受保护字段 / 404 未知 id）+ `GET /api/findings?q=`（命中 / 大小写 / 叠加 / 空 q / 非法过滤 400）；既有状态机端点 `/status` 行为不变。
- **S3 前端冒烟（集成）**：静态壳仍可达；Edit 入口与搜索框挂载点存在；深度 UI 交互 out of scope（承继 run-1 S3 边界）。
- 既有 **35 个测试零回归**（`node --test` 全绿）。

## Out of Scope

删除 finding、auth、数据库、分页、全文索引引擎（子串匹配已够用，见 brief Non-goals）、编辑 status（由既有状态机端点负责）、对既有 `GET /api/findings/:id` 返回体形态的改动。

## Run-2 附注（本 spec 之外）

brief 末尾的"验证 F-0001/0002/0004 修复并标记 shipped"是 shipyard 载体（drydock.md/launch.md）的 dogfood 收尾动作：确认修复已在 `~/.claude` 技能文件生效后，经应用既有 status API 将 data/findings.json 中对应 finding 由 `fixed` → `shipped`。该动作不改本应用任何代码，故不在本 feature 垂直切片内，由 orchestrator 在 closeout 统一执行。