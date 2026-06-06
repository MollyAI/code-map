// --------------------------------------------------------------------
// i18n — the UI string dictionary and lookup helpers extracted from
// viewer/index.html. Top-level is DOM-free so this module is importable
// under node (tests, tsc). DOM access happens only inside
// applyI18nStatic, i.e. at call time.
// --------------------------------------------------------------------

/**
 * A flat key→string dictionary for a single language.
 * @typedef {Record<string, string>} LangDict
 */

/**
 * The UI string dictionary, keyed by language code. Each language carries
 * the same set of keys (some are plural variants, e.g. `class_one` /
 * `class_other`).
 * @type {{ en: LangDict, zh: LangDict }}
 */
export const I18N = {
  en: {
    core: "core",
    all: "all",
    group_layers: "layers",
    group_flows: "flows",
    flow_empty: "no flows — pick a flow or double-click any node to trace from it",
    flow_pick: "select a flow",
    trace_from_here: "trace from here",
    font_small: "small",
    font_medium: "medium (default)",
    font_large: "large",
    toggle_theme: "toggle light / dark",
    export_image: "export as image",
    zoom_out: "zoom out",
    zoom_reset: "reset to 100%",
    zoom_in: "zoom in",
    nothing_selected: "nothing selected.",
    click_node: "click a node in the map",
    error_load: "failed to load code map.",
    error_hint: "run /code-map:build in this project first.",
    class_one: "class",
    class_other: "classes",
    no_package: "(no package)",
    no_desc: "no description — run /code-map:build to let Claude annotate this class.",
    no_desc_core: "no description — only core classes / methods are annotated.",
    label_in: "in",
    label_out: "out",
    label_weight: "weight",
    label_core: "core",
    label_file: "file",
    label_loc: "lines",
    label_calls: "calls",
    label_methods: "methods",
    label_refs: "referenced by",
    yes: "yes",
    no: "no",
    depends_on: "depends on",
    depended_on_by: "depended on by",
    no_edges: "no edges to other classes in the map.",
    copy: "copy",
    copied: "copied",
    failed: "failed",
    uses: "uses",
    built: "Built",
    branch: "Branch",
    commit: "Commit",
    dirty_note: "Built with uncommitted changes",
  },
  zh: {
    core: "核心",
    all: "全部",
    group_layers: "分层",
    group_flows: "流程",
    flow_empty: "暂无流程 — 选择一条流程，或双击任意节点从它开始追踪",
    flow_pick: "选择流程",
    trace_from_here: "从此处追踪",
    font_small: "小",
    font_medium: "中（默认）",
    font_large: "大",
    toggle_theme: "切换亮色 / 暗色主题",
    export_image: "导出为图片",
    zoom_out: "缩小",
    zoom_reset: "重置为 100%",
    zoom_in: "放大",
    nothing_selected: "未选中任何节点",
    click_node: "点击地图中的节点查看详情",
    error_load: "无法加载代码地图",
    error_hint: "请先在项目中运行 /code-map:build。",
    class_one: "个类",
    class_other: "个类",
    no_package: "（无包名）",
    no_desc: "暂无描述 — 运行 /code-map:build 让 Claude 添加注释。",
    no_desc_core: "暂无描述 — 仅对核心类 / 方法生成解释。",
    label_in: "入度",
    label_out: "出度",
    label_weight: "权重",
    label_core: "核心",
    label_file: "文件名",
    label_loc: "代码行数",
    label_calls: "调用次数",
    label_methods: "方法数",
    label_refs: "被引用次数",
    yes: "是",
    no: "否",
    depends_on: "依赖",
    depended_on_by: "被依赖",
    no_edges: "与地图中其他类无连接关系",
    copy: "复制",
    copied: "已复制",
    failed: "失败",
    uses: "使用",
    built: "构建于",
    branch: "分支",
    commit: "提交",
    dirty_note: "构建时工作区有未提交改动",
  },
};

/**
 * Look up a UI string by key for the given language. Falls back to the
 * English string when the requested language lacks the key, and to the
 * key itself when neither language defines it. Faithful to the original
 * `t` in index.html, but with `lang` passed explicitly instead of read
 * from a module-global.
 * @param {string} key
 * @param {string} lang
 * @returns {string}
 */
export function t(key, lang) {
  const dict = /** @type {Record<string, LangDict>} */ (I18N)[lang];
  return (dict && dict[key]) || I18N.en[key] || key;
}

/**
 * Translate all `[data-i18n]` text and `[data-i18n-title]` titles under
 * `root` into `lang`, and set the language on the `#html-root` element.
 * @param {ParentNode} root
 * @param {string} lang
 * @returns {void}
 */
export function applyI18nStatic(root, lang) {
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(/** @type {string} */ (el.getAttribute("data-i18n")), lang);
  });
  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    /** @type {HTMLElement} */ (el).title = t(/** @type {string} */ (el.getAttribute("data-i18n-title")), lang);
  });
  const htmlRoot = document.getElementById("html-root");
  if (htmlRoot) htmlRoot.lang = lang === "zh" ? "zh-CN" : "en";
}
