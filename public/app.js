// Shipyard Log — 前端垂直切片（T3）
// 无构建 vanilla ES module。只依赖 spec 声明的 API 契约：
//   GET   /api/findings?status=&category=&phase=  → {findings:[...]} 或裸数组（两种都兼容）
//   POST  /api/findings            {title, category, phase, detail} → 201
//   PATCH /api/findings/:id/status {to} → 200；失败 409/404 {error:{code,message}}
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
  filters: { status: "", category: "", phase: "" },
  findings: [],
  loading: false,
  posting: false,
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

async function createFinding(payload) {
  state.posting = true;
  render();
  try {
    await request("/api/findings", { method: "POST", body: payload });
    state.error = null;
    document.getElementById("new-finding")?.reset(); // 清空的是当前挂载的表单
    await loadFindings();
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
    await loadFindings();
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
  return FILTER_KEYS.some((key) => state.filters[key]);
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
  return el(
    "div",
    { class: "toolbar" },
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

function renderFinding(finding) {
  const id = String(finding?.id ?? "?");
  const detail = String(finding?.detail ?? "").trim();
  const actions = statusActions(finding);
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

function render() {
  const root = document.getElementById("app");
  if (!root) return;
  const preserved = readFormValues();
  root.replaceChildren(
    state.error ? renderError() : null,
    renderToolbar(),
    renderNewForm(preserved),
    renderList(),
  );
}

/* ---------------- 启动 ---------------- */

render(); // module script 自带 defer，DOM 已就绪
loadFindings();
