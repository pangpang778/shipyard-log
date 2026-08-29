# Shipyard Log — Agent & Human Shipyard

## 项目约定
- Node.js ≥ 24，原生 ESM（`"type": "module"`），零运行时依赖
- 测试用内置 `node:test`（`node --test`），HTTP 用 `node:http`，存储用 JSON 文件
- 命名：文件 kebab-case，导出 camelCase，测试文件 `*.test.js` 与被测文件同目录
- 提交：conventional commits（feat/fix/docs/chore）

## 架构原则
- 可验收性边界：能被测试/评审验收的工作交给 agent 持续运行；无唯一答案或高代价错误的决策归人（记录在 ADR）
- 纸面留痕：术语进 CONTEXT.md，决策进 docs/adr/，业务知识进 docs/business/——当场落盘
- 文档写契约不写坐标：spec/票内禁止文件路径与行号

## 规范索引（全文在 docs/standards/）
- 架构规范: docs/standards/architecture.md
- 数据规范: docs/standards/data.md
- 流程规范: docs/standards/process.md

## 决策记录（全文在 docs/adr/，此处只列 load-bearing 的）
- ADR-0001: adopt shipyard harness

## 共享背景
- 术语: CONTEXT.md ｜ 业务知识: docs/business/ ｜ 决策背景: docs/adr/

## Agent 指南
- 交付走 /oh-my-claudecode:launch（spec → tickets → frontier 执行）
- 术语冲突以 CONTEXT.md 为准；新术语当场补录
- 可复用能力沉淀到 .omc/skills/；UI 模式沉淀到 design-system/
