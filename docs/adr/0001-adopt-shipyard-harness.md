# ADR-0001: Adopt the shipyard harness

- 状态: accepted
- 日期: 2026-08-29
- 置信度: high

## 背景
本项目是 shipyard 工作流（drydock + launch）的 dogfood 载体。项目本身的目的：记录、分类、关闭 dogfood 过程中的 finding，形成反馈回路。

## 决策
采用 shipyard harness 的 5 载体结构（CLAUDE.md 薄入口 / CONTEXT.md / docs/{adr,standards,business} / design-system / .omc/skills + .mcp.json + scripts）。

## 理由
- 项目本体就是"对 shipyard 的反馈"，用 shipyard 建造它 = 自指验证（eat your own dog food 的强形式）
- 所有人（和 agent）继承同一套设计语言，消除"流程知识在人脑里"的问题

## 后果
- 任何 finding 的落盘位置必须能指到 harness 的一个格子
- 本 ADR 由 drydock 技能自动生成
