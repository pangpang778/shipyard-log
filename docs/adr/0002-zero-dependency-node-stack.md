# ADR-0002: Zero-dependency Node stack

- 状态: accepted
- 日期: 2026-08-29
- 置信度: high

## 背景
Shipyard Log 需要后端 + 前端 + 测试。可选：Express+vitest+SQLite 全家桶，或零依赖原生方案。

## 决策
零依赖：`node:http` 起服务、`node:test` 做测试、JSON 文件存储、前端 vanilla。Node ≥ 24。

## 理由
- 本项目是 dogfood 载体，评测对象是 shipyard 工作流而非技术栈——依赖安装/配置越少，评测信号越纯
- 零依赖 = `npm ci` 为 0 秒，每个 agent worker 冷启动成本极低
- node:test 已覆盖单元/集成需求

## 后果
- 路由、校验等手写（可接受，API 面小）
- JSON 文件存储在并发写下有竞态——单用户场景可接受；ADR-0003 若引入并发再升级
