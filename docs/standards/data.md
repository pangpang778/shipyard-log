# Data Standards

## Finding 记录形态
```json
{
  "id": "F-0001",
  "title": "string, 非空, ≤120 字符",
  "category": "protocol | missing | naming | docs | ux",
  "status": "open | confirmed | fixed | shipped | wontfix",
  "detail": "string, 可空",
  "phase": "drydock | converge | spec | tickets | execute | closeout",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

## 存储规则
- 单文件 `data/findings.json`：`{ "seq": 12, "findings": [...] }`，seq 是 ID 分配计数器
- 写入 = 原子替换（写临时文件后 rename）
- ID 分配单调递增，永不复用（删除是 wontfix，不是物理删）
