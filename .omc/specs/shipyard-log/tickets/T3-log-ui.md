# T3 — log UI (list/create/status, tokens only)

blockedBy: T1 ｜ ready-for-agent

## Goal
交付前端垂直切片：列表+过滤、新建表单、状态操作按钮，静态服务可达（S3 冒烟的基础）。

## Acceptance criteria
1. `public/index.html` + `public/tokens.css` + `public/app.js`，无构建、无外部 CDN 依赖
2. tokens.css：design-system/tokens/README.md 清单中的全部 CSS custom properties；其余样式**只引用变量**
3. 功能：findings 列表（新在前）、status/category/phase 三个过滤下拉（调 GET API）、新建表单（title/category/phase/detail，POST 后刷新）、每条 finding 的状态操作按钮（合法迁移高亮，调 PATCH 后刷新）
4. 空状态：无 finding 时显示引导文案（"记录第一条 finding"）
5. 冒烟准备：index.html 内含 `id="app"` 挂载点与 `<link rel="stylesheet" href="/tokens.css">`（供 S3 断言）

## Notes
- 数据只经 HTTP API；错误响应展示 error.message
- 视觉从简：等宽字体日志风即可，令牌合规优先于美观
