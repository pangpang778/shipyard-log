# Dogfood 运行日志

> 本文件是 finding 应用的前身（应用可用前，findings 先记在这里；T2 完成后回填进应用）。
> 格式：`[阶段] 观察 → 影响 → 候选修正`
> **回填（T5）**：Run#1 的 4 条 finding 已录入应用（F-0001–F-0004，`scripts/seed-findings.mjs`），
> 此后 finding 生命周期全部走应用本身（`npm start` → 记录/流转/导出）。

## Run #1（2026-08-29）

- [drydock] Windows 下 13 条 LF/CRLF git 警告 → 噪音污染输出 → 候选：drydock 种子加 `.gitattributes`（`* text=auto eol=lf`）
- [drydock] 龙骨铺设 12 文件一次成型，无返工 → **正面信号**：种子模板足够自解释
- [drydock] 种子要求"检测 OMC 安装"但 drydock 在非 OMC 会话中由普通 agent 执行 → 技能文件里 `omc doctor` 建议不可执行 → 候选：改为可选步骤
- [launch] solo 模式：本次运行 agent 同时扮演人机两角色，C1-C5 检查点被行使但无真人摩擦成本 → **评测局限**，需真人复跑
- [launch] 阶段1 在 brief 足够具体时退化为"假设标记"而非真实访谈 → 候选：launch 技能对 brief 质量给出更强的自检清单
