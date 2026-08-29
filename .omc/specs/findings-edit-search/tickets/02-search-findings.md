# 02 — Search Findings (vertical slice: store → handler → UI)

**blockedBy: [01]**

> 依赖理由：非语义依赖，而是**共享文件面冲突**。01 与 02 都改 findings handler 与 store 列表/编辑路径及前端同一文件，并发落地必冲突。故 02 排在 01 之后，串行落地从干净基线上改。若希望真正并行，唯一出路是 worktree 隔离或按关注点拆分模块文件——都因破坏内聚不建议（见 C3 说明）。

## Goal
`GET /api/findings?q=<text>` 对 finding 的 title+detail 做大小写不敏感子串匹配，与既有 status/category/phase 过滤按 AND 叠加；前端顶部加搜索框（轻量 debounce），与三下拉联合实时过滤列表。

## Acceptance Criteria
- E2 AC-08..AC-14 + E3 AC-17（见 spec）：
  - q 命中 title **或** detail 的子串（大小写不敏感）即返回。
  - 大小写不敏感（`q=crlf` 命中 `CRLF`）。
  - 无命中 → 空数组（200，非错误）。
  - 空串/纯空白 q 视同未提供（返回全量）。
  - 即便带 q，非法 status/category/phase 仍 → 400 VALIDATION。
  - 结果保持新在前（createdAt 倒序、ID 序号兜底，沿用既有列表序）。
  - 前端：q 与三个下拉过滤按 AND 叠加，输入即即时刷新（轻量 debounce，无第三方库）。

## Layer touchpoints（按模块角色，非坐标）
- **存储模块**：既有 `list` 增补 `q` 过滤。语义：对每条 finding，取 title 与 detail 各自 `toLowerCase()` 后与 `q` 的 `toLowerCase()` 做 `includes` 子串匹配，任一命中即计入；与 status/category/phase 过滤按 AND；q 为空/空白视为缺省；既有非法枚举的 VALIDATION 行为不变。无全文索引、无分词。
- **findings handler**：列表路径把查询串里的 `q` 透传进存储过滤（沿用"空过滤值当缺省"语义、多 q last-wins）；非法枚举过滤仍交存储层报 400。
- **server 路由表**：本票无新路由（`q` 走既有 `GET /api/findings` 查询串即可）。
- **前端**：顶部搜索框，输入经轻量 debounce 后触发列表刷新；与现有 status/category/phase 三个下拉同源叠加在同一个请求的查询串里；沿用现有请求序号防过期机制（快速切换时丢弃过期响应）；错误走既有 error-bar（AC-18）。

## Test seams
- **S1 存储（单元）**：`list({q})` title 命中 / detail 命中 / 大小写不敏感 / 与三过滤 AND / 空白 q 视为缺省 / 非法枚举仍 400 / 结果保序。
- **S2 HTTP（集成）**：`GET /api/findings?q=` 命中与叠加 / 空 q / 非法过滤 400；既有列表端点行为不变。
- **S3 前端（集成）**：静态壳可达，含搜索框挂载点；深度 UI out of scope。

## Demonstrable
起服后经 API `GET /api/findings?q=<词>` 返回 title 或 detail 命中且与下拉过滤叠加的列表；前端顶部输入即联合过滤刷新。