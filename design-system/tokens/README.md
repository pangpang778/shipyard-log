# Design Tokens

定义于 `public/tokens.css`（`:root` 块的 CSS custom properties）。

## 令牌清单（随实现增长）
- `--color-bg` / `--color-surface` / `--color-ink` / `--color-accent` / `--color-danger`
- `--radius` / `--space-1..4` / `--font-mono` / `--font-sans`

新增令牌先改 tokens.css 再用，禁止反向（组件里先出现魔法值）。
