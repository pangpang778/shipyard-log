# Glossary

One entry per term: definition, boundaries, one resolved ambiguity. Agents write here the moment a term is settled. Vocabulary here is law for all specs, tickets, and code naming.

## finding（发现）
- 定义: 一次 dogfood 运行中记录的单条摩擦点/改进项，是本应用的唯一核心实体。
- 边界: 是"对 shipyard 流程的观察"，不是 issue tracker 的 issue（issue 是待办工作，finding 是对流程本身的证据）。
- 已解决的歧义: finding 与 ticket 的区别——ticket 是 shipyard 里待执行的交付单元；finding 是本应用记录的数据。

## category（分类）
- 定义: finding 的归类标签，枚举：protocol（协议缺陷）、missing（缺件）、naming（命名/隐喻）、docs（文档）、ux（检查点手感）。
- 边界: 一个 finding 恰好一个 category；跨类的拆成两条。
- 已解决的歧义: "protocol" 指技能文件里定义的流程规则本身的问题。

## status（状态）
- 定义: finding 的生命周期：`open` → `confirmed` → `fixed` → `shipped`；另有 `wontfix` 终态。
- 边界: `fixed` = shipyard 技能文件已改；`shipped` = 改动已验证进了下一次 dogfood 运行。
- 已解决的歧义: 不设 "in-progress"——那是工作状态不是数据状态。

## frontier（前沿）
- 定义: 所有 blockers 已完成的票的集合；launch 阶段 4 的推进单位。
- 边界: 是动态集合不是数据实体。
- 已解决的歧义: 继承自 OMC team 的 blockedBy 语义，与 Matt to-tickets 的 blocking edges 同义。
