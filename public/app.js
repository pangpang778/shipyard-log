// Shipyard Log — 前端垂直切片（T3）
// 无构建 vanilla ES module。只依赖 spec 声明的 API 契约：
//   GET   /api/findings?status=&category=&phase=  → {findings:[...]} 或裸数组（两种都兼容）
//   POST  /api/findings            {title, category, phase, detail} → 201
//   PATCH /api/findings/:id/status {to} → 200；失败 409/404 {error:{code,message}}
//   GET   /api/stats              → {byStatus, byCategory, total}（五种枚举值全出现，0 也列出）
//   GET   /api/export.md          → text/markdown 报告（生成时间 + 总数 + 统计表 + finding 明细）
// 所有用户内容一律经 textContent 渲染，无 innerHTML，无外部依赖。

const CATEGORIES = ["protocol", "missing", "naming", "docs", "ux"];
const PHASES = ["drydock", "converge", "spec", "tickets", "execute", "closeout"];

// 合法迁移（spec US3）：open→confirmed→fixed→shipped；任何非终态可 →wontfix。
// 只渲染这些目标，其余一律不给按钮。
const TRANSITIONS = {
  open: ["confirmed", "wontfix"],
  confirmed: ["fixed", "wontfix"],
  fixed: ["shipped", "wontfix"],
  shipped: [],
  wontfix: [],
};
const STATUSES = Object.keys(TRANSITIONS);
const FILTER_KEYS = ["status", "category", "phase"];
const EMPTY_HINT = "记录第一条 finding";

const state = {
  filters: { status: "", category: "", phase: "", q: "" },
  findings: [],
  stats: null, // { byStatus, byCategory, total }
  statsError: false,
  loading: false,
  posting: false,
  editingId: null, // 正在内联编辑的 finding id（null = 未编辑）
  error: null, // { message }
};

/* ---------------- API 层 ---------------- */

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseJson(res) {
  try {
    return await res.json();
  } catch {
    return null; // 空响应体 / 非 JSON：按 null 处理
  }
}

async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("网络请求失败：服务不可达", 0);
  }
  const payload = await parseJson(res);
  if (!res.ok) {
    const message = payload?.error?.message || `请求失败（HTTP ${res.status}）`;
    throw new ApiError(message, res.status);
  }
  return payload;
}

/** 防御：兼容 {findings:[...]} 与裸数组两种返回形态。 */
function extractFindings(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.findings)) return payload.findings;
  return [];
}

/* ---------------- 数据与动作 ---------------- */

let fetchSeq = 0;

async function loadFindings() {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    if (state.filters[key]) params.set(key, state.filters[key]);
  }
  if (state.filters.q && state.filters.q.trim()) params.set("q", state.filters.q.trim());
  const query = params.toString();
  const seq = ++fetchSeq; // 请求序号：快速切换过滤时丢弃过期响应
  state.loading = true;
  render();
  let list;
  try {
    list = extractFindings(await request(`/api/findings${query ? `?${query}` : ""}`));
  } catch (err) {
    if (seq !== fetchSeq) return;
    state.loading = false;
    state.error = { message: err.message };
    render();
    return;
  }
  if (seq !== fetchSeq) return;
  state.loading = false;
  state.findings = list;
  state.error = null; // 拉取成功即清除旧错误
  render();
}

function setFilter(key, value) {
  state.filters[key] = value;
  loadFindings();
}

let searchTimer = null;
/** 轻量 debounce：停止输入 250ms 后才发请求，避免逐键击发。 */
function scheduleSearch(value) {
  state.filters.q = value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadFindings, 250);
}

/** 统计失败不阻塞列表：面板降级为占位提示。 */
async function loadStats() {
  try {
    const payload = await request("/api/stats");
    state.stats = payload && typeof payload === "object" ? payload : null;
    state.statsError = state.stats === null;
  } catch {
    state.stats = null;
    state.statsError = true;
  }
  render();
}

async function createFinding(payload) {
  state.posting = true;
  render();
  try {
    await request("/api/findings", { method: "POST", body: payload });
    state.error = null;
    document.getElementById("new-finding")?.reset(); // 清空的是当前挂载的表单
    await Promise.all([loadFindings(), loadStats()]);
  } catch (err) {
    state.error = { message: err.message };
  } finally {
    state.posting = false;
    render(); // 保证提交按钮恢复可用（loadFindings 内部也会 render）
  }
}

async function transitionStatus(finding, to) {
  try {
    await request(`/api/findings/${encodeURIComponent(String(finding.id))}/status`, {
      method: "PATCH",
      body: { to },
    });
    state.error = null;
    await Promise.all([loadFindings(), loadStats()]);
  } catch (err) {
    state.error = { message: err.message };
    render();
  }
}

/** PATCH /api/findings/:id — 用表单里的全部可编辑字段更新一条 finding 的元数据。 */
async function updateFinding(finding, payload) {
  try {
    await request(`/api/findings/${encodeURIComponent(String(finding.id))}`, {
      method: "PATCH",
      body: payload,
    });
    state.error = null;
    state.editingId = null;
    await Promise.all([loadFindings(), loadStats()]);
  } catch (err) {
    state.error = { message: err.message };
    render();
  }
}

function onCreateSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const payload = {
    title: String(data.get("title") ?? "").trim(),
    category: String(data.get("category") ?? ""),
    phase: String(data.get("phase") ?? ""),
    detail: String(data.get("detail") ?? "").trim(),
  };
  if (!payload.title) {
    state.error = { message: "title 必填（非空，≤120 字符）" };
    render();
    return;
  }
  createFinding(payload);
}

function dismissError() {
  state.error = null;
  render();
}

/* ---------------- 渲染 ---------------- */

function idSeq(finding) {
  const match = /^F-(\d+)$/.exec(String(finding?.id ?? ""));
  return match ? Number(match[1]) : -1;
}

/** 新在前（防御性客户端排序：createdAt 倒序，ID 序号兜底）。 */
function sortedFindings() {
  return [...state.findings].sort(
    (a, b) =>
      String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? "")) ||
      idSeq(b) - idSeq(a),
  );
}

function hasActiveFilters() {
  return FILTER_KEYS.some((key) => state.filters[key]) || Boolean(state.filters.q.trim());
}

function fmtTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const s = date.toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}Z`;
}

function timeLine(finding) {
  const created = fmtTime(finding?.createdAt);
  const updated = fmtTime(finding?.updatedAt);
  if (updated && updated !== created) return `${created} · updated ${updated}`;
  return created;
}

/** 极简 DOM 构建器：属性经 setAttribute，内容经 textNode——天然防注入。 */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function renderError() {
  return el(
    "div",
    { class: "error-bar", role: "alert" },
    el("strong", {}, "错误："),
    el("span", {}, state.error.message),
    el("button", { type: "button", onclick: dismissError, "aria-label": "关闭错误提示" }, "×"),
  );
}

function renderToolbar() {
  const field = (key, label, options) => {
    const select = el(
      "select",
      { onchange: (event) => setFilter(key, event.target.value) },
      el("option", { value: "" }, "全部"),
      options.map((value) => el("option", { value }, value)),
    );
    select.value = state.filters[key];
    if (select.value !== state.filters[key]) select.value = "";
    return el(
      "label",
      { class: "field field--filter" },
      el("span", { class: "field-label" }, label),
      select,
    );
  };
  const search = el("input", {
    id: "search-findings",
    class: "field field--filter field--search",
    type: "search",
    placeholder: "搜索 title / detail…",
    "aria-label": "搜索 finding",
    oninput: (event) => scheduleSearch(event.target.value),
  });
  search.value = state.filters.q;
  return el(
    "div",
    { class: "toolbar" },
    search,
    field("status", "status", STATUSES),
    field("category", "category", CATEGORIES),
    field("phase", "phase", PHASES),
  );
}

function enumSelect(name, options, value) {
  const select = el(
    "select",
    { name, required: true },
    el("option", { value: "" }, `选择 ${name}…`),
    options.map((option) => el("option", { value: option }, option)),
  );
  select.value = value;
  if (select.value !== value) select.value = "";
  return select;
}

/** 渲染时保留用户已输入的表单值，避免无关动作（如状态迁移报错）清空输入。 */
function readFormValues() {
  const form = document.getElementById("new-finding");
  if (!form) return null;
  const data = new FormData(form);
  return {
    title: String(data.get("title") ?? ""),
    category: String(data.get("category") ?? ""),
    phase: String(data.get("phase") ?? ""),
    detail: String(data.get("detail") ?? ""),
  };
}

function renderNewForm(preserved) {
  const title = el("input", {
    id: "f-title",
    name: "title",
    type: "text",
    maxlength: "120",
    required: true,
    placeholder: "一句话描述摩擦点（必填，≤120 字符）",
  });
  title.value = preserved?.title ?? "";
  const detail = el("textarea", {
    id: "f-detail",
    name: "detail",
    rows: "3",
    placeholder: "细节补充（可选）：现象、预期、证据……",
  });
  detail.value = preserved?.detail ?? "";

  return el(
    "form",
    { id: "new-finding", class: "new-finding", autocomplete: "off", onsubmit: onCreateSubmit },
    el(
      "div",
      { class: "form-grid" },
      el(
        "div",
        { class: "field field--wide" },
        el("label", { class: "field-label", for: "f-title" }, "title"),
        title,
      ),
      el(
        "div",
        { class: "field" },
        el("label", { class: "field-label", for: "f-category" }, "category"),
        enumSelect("category", CATEGORIES, preserved?.category ?? ""),
      ),
      el(
        "div",
        { class: "field" },
        el("label", { class: "field-label", for: "f-phase" }, "phase"),
        enumSelect("phase", PHASES, preserved?.phase ?? ""),
      ),
      el(
        "div",
        { class: "field field--wide" },
        el("label", { class: "field-label", for: "f-detail" }, "detail"),
        detail,
      ),
    ),
    el(
      "div",
      { class: "form-actions" },
      el(
        "button",
        { type: "submit", class: "btn--primary", disabled: state.posting },
        state.posting ? "提交中…" : "+ 记录 finding",
      ),
    ),
  );
}

function statusBadge(status) {
  return el(
    "span",
    { class: "badge status", "data-status": String(status ?? "unknown") },
    String(status ?? "unknown"),
  );
}

function tag(kind, value) {
  return el("span", { class: "badge" }, `${kind}: ${String(value ?? "?")}`);
}

function statusActions(finding) {
  const targets = TRANSITIONS[finding?.status] ?? [];
  return targets.map((to) =>
    el(
      "button",
      {
        type: "button",
        class: to === "wontfix" ? "btn--danger" : undefined,
        title: `迁移到 ${to}`,
        onclick: () => transitionStatus(finding, to),
      },
      `→ ${to}`,
    ),
  );
}

function toggleEdit(id) {
  state.editingId = state.editingId === id ? null : id;
  render();
}

function cancelEdit(id) {
  if (state.editingId === id) state.editingId = null;
  render();
}

function onUpdateSubmit(event, finding) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const payload = {
    title: String(data.get("title") ?? "").trim(),
    category: String(data.get("category") ?? ""),
    phase: String(data.get("phase") ?? ""),
    detail: String(data.get("detail") ?? "").trim(),
  };
  updateFinding(finding, payload);
}

/** 内联编辑表单：预填 finding 当前的 title/detail/category/phase，保存走 PATCH。 */
function editForm(finding) {
  const id = String(finding?.id ?? "?");
  const titleInput = el("input", {
    name: "title",
    type: "text",
    maxlength: "120",
    required: true,
  });
  titleInput.value = String(finding?.title ?? "");
  const detailInput = el("textarea", { name: "detail", rows: "3" });
  detailInput.value = String(finding?.detail ?? "");
  return el(
    "form",
    { class: "finding-edit", autocomplete: "off", onsubmit: (event) => onUpdateSubmit(event, finding) },
    el(
      "div",
      { class: "form-grid" },
      el(
        "div",
        { class: "field field--wide" },
        el("label", { class: "field-label" }, "title"),
        titleInput,
      ),
      el(
        "div",
        { class: "field" },
        el("label", { class: "field-label" }, "category"),
        enumSelect("category", CATEGORIES, finding?.category ?? ""),
      ),
      el(
        "div",
        { class: "field" },
        el("label", { class: "field-label" }, "phase"),
        enumSelect("phase", PHASES, finding?.phase ?? ""),
      ),
      el(
        "div",
        { class: "field field--wide" },
        el("label", { class: "field-label" }, "detail"),
        detailInput,
      ),
    ),
    el(
      "div",
      { class: "form-actions" },
      el("button", { type: "submit", class: "btn--primary" }, "保存"),
      el("button", { type: "button", onclick: () => cancelEdit(id) }, "取消"),
    ),
  );
}

function renderFinding(finding) {
  const id = String(finding?.id ?? "?");
  const detail = String(finding?.detail ?? "").trim();
  const isEditing = state.editingId === finding.id;
  const actions = [
    el(
      "button",
      {
        type: "button",
        title: isEditing ? "取消编辑" : "编辑 title / detail / category / phase",
        "aria-expanded": isEditing ? "true" : "false",
        onclick: () => toggleEdit(id),
      },
      isEditing ? "取消编辑" : "编辑",
    ),
    ...statusActions(finding),
  ];
  return el(
    "article",
    { class: "finding", "data-id": id, "data-status": String(finding?.status ?? "") },
    el("h2", { class: "finding-title" }, el("span", { class: "finding-id" }, id), " ", String(finding?.title ?? "(无标题)")),
    el(
      "p",
      { class: "finding-meta" },
      statusBadge(finding?.status),
      tag("category", finding?.category),
      tag("phase", finding?.phase),
      el("span", { class: "finding-time" }, timeLine(finding)),
    ),
    detail ? el("p", { class: "finding-detail" }, detail) : null,
    actions.length ? el("div", { class: "finding-actions" }, actions) : null,
    isEditing ? editForm(finding) : null,
  );
}

function renderList() {
  const findings = sortedFindings();
  if (state.loading && findings.length === 0) {
    return el("p", { class: "loading" }, "loading…");
  }
  if (findings.length === 0) {
    // 空状态：无过滤时显示引导文案；有过滤时提示调整条件
    return hasActiveFilters()
      ? el("p", { class: "empty" }, "当前过滤条件下没有 finding——调整上方过滤条件试试。")
      : el("p", { class: "empty" }, EMPTY_HINT);
  }
  return el("div", { class: "finding-list" }, findings.map(renderFinding));
}

function openExport() {
  window.open("/api/export.md", "_blank", "noopener");
}

function statsGroup(label, values, field, statusColored) {
  const by = state.stats?.[field] ?? {};
  const chips = values.map((value) => {
    const attrs = statusColored
      ? { class: "badge status", "data-status": value }
      : { class: "badge" };
    return el("span", attrs, `${value} ${by[value] ?? 0}`);
  });
  return el(
    "div",
    { class: "stats-group" },
    el("span", { class: "field-label" }, label),
    el("div", { class: "stats-chips" }, chips),
  );
}

/** 页面顶部统计面板（US4）+ Export Markdown 按钮（US5）。 */
function renderStats() {
  const head = el(
    "div",
    { class: "stats-head" },
    el("h2", { class: "stats-title" }, "统计"),
    state.stats ? el("span", { class: "stats-total" }, `共 ${state.stats.total ?? 0} 条`) : null,
    el(
      "button",
      {
        type: "button",
        onclick: openExport,
        title: "在新窗口打开 Markdown 报告（生成时间 + 统计表 + 全部 finding）",
      },
      "Export Markdown",
    ),
  );
  const body = state.statsError
    ? el("p", { class: "stats-hint" }, "统计暂不可用——稍后操作列表时会自动重试。")
    : state.stats
      ? el(
          "div",
          {},
          statsGroup("status", STATUSES, "byStatus", true),
          statsGroup("category", CATEGORIES, "byCategory", false),
        )
      : el("p", { class: "stats-hint" }, "loading…");
  return el("section", { class: "stats-panel", "aria-label": "统计面板" }, head, body);
}

function render() {
  const root = document.getElementById("app");
  if (!root) return;
  const preserved = readFormValues();
  root.replaceChildren(
    state.error ? renderError() : null,
    renderStats(),
    renderToolbar(),
    renderNewForm(preserved),
    renderList(),
  );
}

/* ---------------- 启动 ---------------- */

render(); // module script 自带 defer，DOM 已就绪
loadFindings();
loadStats();
