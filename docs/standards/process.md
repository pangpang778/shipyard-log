# Process Standards

## Dogfood 反馈回路
1. 每次 shipyard 运行（drydock / launch 各阶段）中，摩擦点当场记为 finding（phase 字段标记来源阶段）
2. 运行结束 → review findings → `confirmed`
3. 修 shipyard 技能文件（~/.claude/skills/omc-learned/）→ `fixed`
4. 下一次运行验证修复生效 → `shipped`
5. 不修的 → `wontfix` 并写明理由

## 提交流程
- conventional commit；每个票一个分支合并（或直接 main 顺序提交，dogfood 期允许）
- CI：GitHub Actions（`.github/workflows/ci.yml`）——push/PR 触发，Node 24 跑 `node --test`（零依赖项目，无安装步骤）
