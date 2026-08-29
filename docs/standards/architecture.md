# Architecture Standards

规则化、可检查的写；每条带一个"为什么"。空节是合法的——沉淀是渐进的。

## 模块边界
- `src/server.js`：HTTP 入口（node:http），只做路由分发，不含业务逻辑——为什么：保持 seam 清晰，API 测试不打进内部
- `src/store.js`：存储模块，唯一允许读写 `data/` 的地方——为什么：存储可替换的 seam
- `src/handlers/`：按资源分文件的请求处理器（findings.js）
- `public/`：静态前端（index.html + tokens.css + app.js），无构建步骤

## 错误处理
- API 错误统一 JSON `{ "error": { "code", "message" } }`，状态码 400/404/409/500
- store 层抛带 `code` 属性的 Error，handler 层翻译成 HTTP 状态码

## 依赖方向
- handlers → store，单向；store 不得 import handlers
- 前端只经 HTTP API 访问数据，禁止绕过 API 直读文件
