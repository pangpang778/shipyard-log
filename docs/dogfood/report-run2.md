# Shipyard Dogfood — Run 2 完成报告（C5，真实宿主）

- 运行日期: 2026-08-29 ｜ 宿主: **真实 Claude Code 2.1.233 + OMC 插件**（headless `-p` + `--continue` 检查点轮次）
- 人工角色: 20% —— C1 brief、C2/C3 批准、C5 验收（每轮一次简短审批，共 3 次人工介入）
- Mission: findings 可编辑 + 可搜索（`.omc/specs/findings-edit-search/`）

## Shipped scope
- `PATCH /api/findings/:id`（部分编辑，id/createdAt/status 不可变，保护字段 400 fail-fast）
- `GET /api/findings?q=`（title+detail 大小写不敏感子串，与三下拉 AND 叠加）
- 前端：逐卡 Edit（预填表单）+ 防抖搜索框（与过滤叠加，防竞态）
- 全部走 launch 协议：C2 spec 合成 → C3 票分解（2 票串行）→ 逐票 tdd + code-review → C5

## Verification
- `node --test` **53/53**（Run 1 基线 35 + 新增 18：S1×9 / S2×7 / S3×2），零回归
- 逐票 code-review 由宿主评审代理执行：双票 PASS
- 被中断恢复 1 次（orchestrator 超时），`--continue` + 磁盘 paper trail 恢复成本≈0（已记 F-0006）

## Run-1 修正在本运行中的验证（反馈回路闭环）
| ID | 修正 | Run 2 验证 |
|---|---|---|
| F-0004 | launch Phase 0 brief 三要素自检 | ✅ 实际行使（brief 合规，未触发磨尖对话）→ **shipped** |
| F-0005 | launch Phase 3 integration-wiring 规则 | ✅ 实际行使（C3 拆票时每票自带接线，并诚实推荐串行）→ **shipped** |
| F-0001 / F-0002 | drydock 种子修正 | 属 drydock 时点，本运行未铺新龙骨 → 保持 fixed，下次 drydock 运行转 shipped |

## 新 findings
- **F-0006**（ux/execute/confirmed）: headless 长跑被 orchestrator 超时截断时，text 模式零输出；恢复依赖 `--continue`+磁盘留痕。修正候选：launch 卫生节建议长跑用 `--output-format stream-json` 或周期性进度标记。

## 评测结论（真实宿主 Run）
1. **协议在真实宿主成立**：launch.md 被 Claude Code + OMC 忠实执行——Phase 0 判断、C2/C3 停点、串行委托、C5 报告全部按文字落地
2. **OMC 运行时痕迹出现**：`.omc/project-memory.json` 由宿主钩子写入、评审调用宿主 `ecc:code-reviewer`（opus）——宿主与协议在协同，而非各自为政
3. **检查点交互模型可行**：headless `--continue` 轮次 = 人工检查点的可执行形态；每轮人工介入 <1 分钟
4. **诚实推荐质量高**：C3 自荐串行（共享文件面），拒绝伪并行——F-0005 规则被正确应用
5. **限制**：team 文件协议运行时仍未真机行使（串行模式覆盖了本次全部需求）；GitHub 推送遇持续 SSL 瞬断（本地领先，恢复后推送）
