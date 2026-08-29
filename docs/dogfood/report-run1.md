# Shipyard Dogfood — Run 1 完成报告（C5）

- 运行日期: 2026-08-29 ｜ 运行者: agent（solo，人机两角色由 agent 扮演，见 F-0003）
- 载体: 本仓库（Shipyard Log），GitHub: pangpang778/shipyard-log
- 流程: drydock（12 文件龙骨）→ launch C1-C5 全检查点 → 5 票全部 reviewer 放行

## Shipped scope
- Shipyard Log 应用全量：存储模块（原子写/状态机/ID 单调）、HTTP API（5 端点）、vanilla 前端（tokens-only 样式）、统计 + Markdown 导出、S3 e2e 冒烟、GitHub Actions CI、README
- Shipyard harness 本体：5 载体全部就位并已投入使用（CONTEXT.md 4 术语、ADR-0001/0002、standards 3 篇、dogfood 日志与报告）

## Verification
- `node --test`：**35/35 绿**（S1 单元 14 + S2 集成 16 + S3 冒烟 3 + 静态 2）
- 完整状态机经 e2e 验证（open→confirmed→fixed→shipped + 409 非法迁移）
- 反馈回路自身经应用 API 闭环：5 条 finding 录入、流转、终态（见 data/findings.json）

## Findings 台账（最终）
| ID | 阶段 | 分类 | 状态 | 修正落点 |
|---|---|---|---|---|
| F-0001 | drydock | missing | **fixed** | drydock.md 种子新增 `.gitattributes` |
| F-0002 | drydock | protocol | **fixed** | drydock.md：OMC 检测改为可选（会话外静默跳过） |
| F-0003 | execute | ux | wontfix | solo 运行固有局限，需真人复跑（非技能缺陷） |
| F-0004 | converge | protocol | **fixed** | launch.md Phase 0 新增 brief 三要素自检 |
| F-0005 | execute | protocol | **fixed** | launch.md Phase 3 新增 integration-wiring 规则 |

## Shipyard 评测结论（Run 1）
**成立的部分**：
- 五票流水线全程零冲突并行（T2∥T3 文件面不相交），reviewer 门禁拦到 1 次假警报并识别为脚本问题
- 纸面留痕当场落盘执行良好：术语/ADR/业务知识在收敛时即写入，后续 agent 无需追问
- 耐久门禁有效：票面全程无文件路径坐标，实现仍精确落地

**Run 1 暴露并已修的**：见台账 F-0001/0002/0004/0005

**遗留到 Run 2 的**：
1. F-0003：需要真人复跑 C1-C5，验证检查点手感
2. launch 的 team 集成本次以"并行独立子代理"模拟（文件面互斥即安全）——OMC team 运行时（文件锁/心跳）未真实验证
3. CI 待 GitHub Actions 首次触发验证

## Open Assumptions（按需要人类否决的程度排序）
1. JSON 文件存储在本项目规模下够用（并发写竞态未处理，见 ADR-0002）
2. 公开仓库记录全部 dogfood 过程（含中文内部笔记）无隐私顾虑
3. shipyard 技能文件在本机 `~/.claude/skills/omc-learned/` 演进，上游化（issue → OMC）待 Run 2 后评估
