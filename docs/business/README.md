# Business Knowledge

决策背景与业务规则。格式建议：一篇文章回答一个业务问题，开头一段"为什么这事重要"。

## 为什么做 Shipyard Log
shipyard（drydock + launch）是一套刚诞生的 agent 工程治理工作流，其设计宣言是"人人能交付，但人人不随便做"。宣言是否成立，只有真实运行才能回答。本项目把每次运行中的摩擦点作为 finding 记录下来，驱动 shipyard 技能文件持续修正——**反馈回路是 shipyard 唯一的正确性来源**。

## 核心业务规则
- finding 必须在摩擦发生的当场记录（phase 字段标记来源），事后补记会丢上下文
- 每条 confirmed 的 finding 必须落到一个动作：修技能文件（fixed）或明确不修（wontfix + 理由）
