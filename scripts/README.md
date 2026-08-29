# Scripts

自动化脚本/CLI 工具链。每个脚本头部注释写清：用途、用法、副作用。

## 已有
- seed-findings.mjs — dogfood 回填：经 HTTP API 把 docs/dogfood/log.md 的 findings 幂等录入 data/findings.json（`node scripts/seed-findings.mjs`）
