# Design System

## tokens/    设计令牌（颜色/字号/间距，CSS custom properties，tokens.css 单文件）
## components/ 组件约定（每个组件：用途、变体、禁用场景）
## patterns/  交互模式（表单、反馈、加载、空状态——沉淀复用过的模式）

本应用前端为无构建 vanilla HTML/CSS/JS；design tokens 以 CSS custom properties
定义于 `public/tokens.css`，是唯一样式真源，组件样式只允许引用变量不得硬编码色值/字号。
