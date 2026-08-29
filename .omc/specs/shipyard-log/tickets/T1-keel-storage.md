# T1 — keel: storage module + test harness

blockedBy: (none) ｜ ready-for-agent

## Goal
交付数据层骨架：包配置、存储模块、其单元测试（seam S1）。完成后项目可 `node --test` 全绿。

## Acceptance criteria
1. `package.json`：`"type": "module"`，scripts 含 `test`（node --test）与 `start`（node src/server.js，本票可先留占位入口文件）
2. 存储模块（模块角色见 docs/standards/architecture.md「存储模块」）：`open(path)` 加载或安全初始化（文件缺失→空库；损坏 JSON→抛 `code:'CORRUPT'`）；`add({title,category,phase,detail})` 分配 `F-NNNN` 并持久化；`list(filter)` 支持 status/category/phase 任意组合；`transition(id,to)` 按 status 状态机校验（非法→`code:'BAD_TRANSITION'`；未知 id→`code:'NOT_FOUND'`）
3. 写入为原子替换（临时文件+rename）；ID 单调永不复用（wontfix 保留记录）
4. 单元测试覆盖：正常 add/list/transition、每类错误码、损坏文件、原子性（写后文件必为合法 JSON）

## Notes
- 全部零依赖；枚举与字段见 docs/standards/data.md
- 禁止在本票引入 HTTP 相关代码（那是 T2 的垂直切片）
