/* 기도수첩 (prayer-notebook) v0.1.0 — 목회자 PKM 연구소
 * 기도제목 한 건 = 마크다운 노트 한 장 (frontmatter가 단일 원천)
 */
"use strict";
const obsidian = require("obsidian");
const { Plugin, ItemView, Modal, Notice, PluginSettingTab, Setting, TFile, TFolder, normalizePath, Platform } = obsidian;

const VIEW_TYPE = "prayer-notebook-view";

const DEFAULT_SETTINGS = {
  folder: "20-29 Ministry Actions/24 목회/기도수첩",
  memberFolder: "교인CRM/교인카드",
  categories: "성도, 가정, 교회, 전도, 나라와 민족, 선교, 개인",
  answerLogName: "응답 기록 모음",
  openOnStart: false,
};

const STATUS_PRAYING = "기도중";
const STATUS_ANSWERED = "응답";

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function safeFileName(s) {
  return String(s || "").replace(/[\\/:*?"<>|#^\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "기도제목";
}

function stripLink(v) {
  if (!v) return "";
  const s = Array.isArray(v) ? v.join(", ") : String(v);
  return s.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a);
}

function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  if (isNaN(da) || isNaN(db)) return null;
  return Math.round((db - da) / 86400000);
}

class PrayerNotebookPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new PrayerView(leaf, this));

    this.addRibbonIcon("heart-handshake", "기도수첩 열기", () => this.activateView());

    this.addCommand({ id: "open", name: "기도수첩 열기", callback: () => this.activateView() });
    this.addCommand({ id: "new-item", name: "새 기도제목", callback: () => new NewPrayerModal(this).open() });
    this.addCommand({ id: "prayer-mode", name: "기도 모드 (한 장씩 넘기며 기도)", callback: () => this.openPrayerMode() });
    this.addCommand({
      id: "insert-intercession",
      name: "중보기도 목록 넣기 (커서 위치)",
      editorCallback: (editor) => new InsertListModal(this, editor).open(),
    });
    this.addCommand({
      id: "answer-current",
      name: "지금 노트의 기도제목에 응답 기록",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        const ok = f && this.isPrayerFile(f);
        if (ok && !checking) new AnswerModal(this, f).open();
        return !!ok;
      },
    });

    this.addSettingTab(new PrayerSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => { if (this.settings.openOnStart) this.activateView(); });

    this.registerEvent(this.app.metadataCache.on("changed", (file) => { if (this.isPrayerFile(file)) this.refreshViews(); }));
    this.registerEvent(this.app.vault.on("delete", () => this.refreshViews()));
    this.registerEvent(this.app.vault.on("rename", () => this.refreshViews()));
  }

  onunload() {}

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); this.refreshViews(); }

  get categoryList() {
    return this.settings.categories.split(",").map((s) => s.trim()).filter(Boolean);
  }

  folderPath() { return normalizePath(this.settings.folder); }

  isPrayerFile(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return false;
    if (!file.path.startsWith(this.folderPath() + "/")) return false;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return fm && fm.type === "기도제목";
  }

  getItems() {
    const items = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!this.isPrayerFile(f)) continue;
      const fm = this.app.metadataCache.getFileCache(f).frontmatter;
      items.push({
        file: f,
        title: fm["제목"] || f.basename,
        target: stripLink(fm["대상"]),
        category: fm["분류"] || "",
        evangelism: fm["전도대상"] === true || fm["전도대상"] === "true",
        status: fm["상태"] || STATUS_PRAYING,
        start: fm["시작일"] ? String(fm["시작일"]) : "",
        count: Number(fm["기도횟수"] || 0),
        last: fm["마지막기도일"] ? String(fm["마지막기도일"]) : "",
        answeredOn: fm["응답일"] ? String(fm["응답일"]) : "",
        answer: fm["응답내용"] || "",
      });
    }
    items.sort((a, b) => (b.start || "").localeCompare(a.start || "") || a.title.localeCompare(b.title, "ko"));
    return items;
  }

  memberNames() {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.memberFolder));
    if (!(folder instanceof TFolder)) return [];
    const out = [];
    const walk = (fd) => {
      for (const c of fd.children) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === "md" && !c.basename.startsWith("_")) out.push(c.basename);
      }
    };
    walk(folder);
    return out.sort((a, b) => a.localeCompare(b, "ko"));
  }

  async ensureFolder(path) {
    const parts = normalizePath(path).split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) await this.app.vault.createFolder(cur);
    }
  }

  async createItem({ title, target, category, evangelism, content }) {
    await this.ensureFolder(this.folderPath());
    const base = `${today()} ${safeFileName(title)}`;
    let path = normalizePath(`${this.folderPath()}/${base}.md`);
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${this.folderPath()}/${base} (${i++}).md`);
    const yq = (s) => JSON.stringify(String(s || ""));
    const targetVal = target ? yq(this.memberNames().includes(target) ? `[[${target}]]` : target) : '""';
    const body = [
      "---",
      "type: 기도제목",
      `제목: ${yq(title)}`,
      `대상: ${targetVal}`,
      `분류: ${yq(category)}`,
      `전도대상: ${evangelism ? "true" : "false"}`,
      `상태: ${STATUS_PRAYING}`,
      `시작일: ${today()}`,
      "기도횟수: 0",
      '마지막기도일: ""',
      'tags: [기도수첩]',
      "---",
      "",
      "## 기도 내용",
      "",
      content || "",
      "",
      "## 기도하며 받은 마음",
      "",
      "",
    ].join("\n");
    const f = await this.app.vault.create(path, body);
    new Notice(`기도제목을 만들었습니다: ${title}`);
    return f;
  }

  async markPrayed(file) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm["기도횟수"] = Number(fm["기도횟수"] || 0) + 1;
      fm["마지막기도일"] = today();
    });
  }

  async recordAnswer(file, date, text) {
    let title = file.basename, target = "";
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm["상태"] = STATUS_ANSWERED;
      fm["응답일"] = date;
      fm["응답내용"] = text;
      title = fm["제목"] || title;
      target = stripLink(fm["대상"]);
    });
    await this.appendAnswerLog({ file, title, target, date, text });
    new Notice("응답을 기록했습니다. 응답 기록 모음에도 넣었습니다.");
  }

  async appendAnswerLog({ file, title, target, date, text }) {
    await this.ensureFolder(this.folderPath());
    const path = normalizePath(`${this.folderPath()}/${safeFileName(this.settings.answerLogName)}.md`);
    let log = this.app.vault.getAbstractFileByPath(path);
    if (!(log instanceof TFile)) {
      log = await this.app.vault.create(path, [
        "---", "type: 기도응답모음", "tags: [기도수첩, 간증, 예화]", "---", "",
        "# 🙏 기도 응답 기록 모음", "",
        "> 응답받은 기도가 날짜순으로 쌓입니다. 간증과 설교 예화 자료로 쓰십시오.", "",
        "※ 성도의 실명과 민감한 내용을 설교에 쓸 때는 반드시 본인 동의를 받으십시오.", "", "",
      ].join("\n"));
    }
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const start = fm["시작일"] ? String(fm["시작일"]) : "";
    const days = start ? daysBetween(start, date) : null;
    const entry = [
      `### ${date} — ${title}`,
      `- 기도제목: [[${file.basename}]]${target ? ` · 대상: ${target}` : ""}`,
      start ? `- 기도 기간: ${start} ~ ${date}${days !== null ? ` (${days}일)` : ""} · 기도 ${Number(fm["기도횟수"] || 0)}번` : "",
      `- 응답: ${text || "(내용 없음)"}`,
      "", "",
    ].filter((l) => l !== "").join("\n") + "\n\n";
    await this.app.vault.append(log, entry);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      // 휴대폰에서는 옆 서랍이 아니라 본 화면에 엽니다
      leaf = Platform.isMobile ? workspace.getLeaf(false) : (workspace.getRightLeaf(false) || workspace.getLeaf(true));
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  refreshViews() {
    if (this._refreshTimer) window.clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view.render && leaf.view.render();
    }, 150);
  }

  openPrayerMode(category) {
    const list = this.getItems().filter((i) => i.status === STATUS_PRAYING && (!category || i.category === category));
    if (!list.length) { new Notice("기도 중인 제목이 없습니다. 먼저 새 기도제목을 만들어 주십시오."); return; }
    new PrayerModeModal(this, list).open();
  }
}

/* ---------- 메인 화면 ---------- */
class PrayerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tab = STATUS_PRAYING;
    this.category = "";
    this.query = "";
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "기도수첩"; }
  getIcon() { return "heart-handshake"; }
  async onOpen() { this.render(); }

  render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("pn-view");
    const all = this.plugin.getItems();
    const praying = all.filter((i) => i.status === STATUS_PRAYING);
    const answered = all.filter((i) => i.status === STATUS_ANSWERED);

    const head = el.createDiv("pn-head");
    head.createEl("h3", { text: "🙏 기도수첩" });
    const btns = head.createDiv("pn-head-btns");
    const addBtn = btns.createEl("button", { text: "＋ 새 기도제목", cls: "mod-cta" });
    addBtn.onclick = () => new NewPrayerModal(this.plugin).open();
    const modeBtn = btns.createEl("button", { text: "기도 모드" });
    modeBtn.onclick = () => this.plugin.openPrayerMode(this.category || undefined);

    const tabs = el.createDiv("pn-tabs");
    const mk = (key, label, n) => {
      const t = tabs.createEl("button", { text: `${label} ${n}`, cls: "pn-tab" + (this.tab === key ? " is-active" : "") });
      t.onclick = () => { this.tab = key; this.render(); };
    };
    mk(STATUS_PRAYING, "기도 중", praying.length);
    mk(STATUS_ANSWERED, "응답", answered.length);
    mk("전체", "전체", all.length);

    const filters = el.createDiv("pn-filters");
    const sel = filters.createEl("select", { cls: "dropdown" });
    sel.createEl("option", { text: "모든 분류", value: "" });
    for (const c of this.plugin.categoryList) sel.createEl("option", { text: c, value: c });
    sel.value = this.category;
    sel.onchange = () => { this.category = sel.value; this.render(); };
    const search = filters.createEl("input", { type: "search", placeholder: "검색 (제목·대상·응답)" });
    search.value = this.query;
    search.oninput = () => { this.query = search.value; this.renderList(listEl, all); };

    const listEl = el.createDiv("pn-list");
    this.renderList(listEl, all);
  }

  renderList(listEl, all) {
    listEl.empty();
    const q = this.query.trim().toLowerCase();
    const items = all.filter((i) =>
      (this.tab === "전체" || i.status === this.tab) &&
      (!this.category || i.category === this.category) &&
      (!q || [i.title, i.target, i.answer, i.category].join(" ").toLowerCase().includes(q))
    );
    if (!items.length) {
      listEl.createDiv({ cls: "pn-empty", text: this.tab === STATUS_PRAYING ? "기도 중인 제목이 없습니다. ＋ 새 기도제목으로 시작하십시오." : "해당하는 기도제목이 없습니다." });
      return;
    }
    for (const it of items) {
      const card = listEl.createDiv("pn-card" + (it.status === STATUS_ANSWERED ? " is-answered" : ""));
      const top = card.createDiv("pn-card-top");
      const t = top.createEl("a", { text: it.title, cls: "pn-title" });
      t.onclick = (e) => { e.preventDefault(); this.app.workspace.getLeaf(false).openFile(it.file); };
      if (it.evangelism) top.createSpan({ cls: "pn-badge pn-evan", text: "전도" });
      if (it.category) top.createSpan({ cls: "pn-badge", text: it.category });
      const meta = card.createDiv("pn-meta");
      const parts = [];
      if (it.target) parts.push(`대상 ${it.target}`);
      if (it.start) parts.push(`시작 ${it.start}`);
      parts.push(`기도 ${it.count}번`);
      if (it.last) parts.push(`마지막 ${it.last}`);
      meta.setText(parts.join(" · "));
      if (it.status === STATUS_ANSWERED) {
        card.createDiv({ cls: "pn-answer", text: `✔ ${it.answeredOn} 응답 — ${it.answer || ""}` });
      } else {
        const act = card.createDiv("pn-actions");
        const pb = act.createEl("button", { text: "🙏 기도했습니다" });
        pb.onclick = async () => { await this.plugin.markPrayed(it.file); new Notice(`기도했습니다 — ${it.title}`); };
        const ab = act.createEl("button", { text: "응답 기록" });
        ab.onclick = () => new AnswerModal(this.plugin, it.file).open();
      }
    }
  }
}

/* ---------- 새 기도제목 ---------- */
class NewPrayerModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("pn-modal");
    contentEl.createEl("h3", { text: "새 기도제목" });
    const v = { title: "", target: "", category: this.plugin.categoryList[0] || "", evangelism: false, content: "" };

    new Setting(contentEl).setName("기도제목").addText((t) => { t.setPlaceholder("예: 김○○ 집사 수술 회복"); t.onChange((x) => (v.title = x)); setTimeout(() => t.inputEl.focus(), 50); });

    const names = this.plugin.memberNames();
    new Setting(contentEl).setName("대상").setDesc(names.length ? "교인카드 이름이면 교인카드로 연결됩니다" : "사람·가정·기관 이름 (비워 두어도 됩니다)")
      .addText((t) => {
        t.setPlaceholder("이름");
        if (names.length) {
          const id = "pn-members-" + Date.now();
          const dl = contentEl.createEl("datalist", { attr: { id } });
          for (const n of names) dl.createEl("option", { value: n });
          t.inputEl.setAttr("list", id);
        }
        t.onChange((x) => (v.target = x.trim()));
      });

    new Setting(contentEl).setName("분류").addDropdown((d) => {
      for (const c of this.plugin.categoryList) d.addOption(c, c);
      d.setValue(v.category);
      d.onChange((x) => { v.category = x; if (x === "전도") { v.evangelism = true; evanToggle && evanToggle.setValue(true); } });
    });
    let evanToggle;
    new Setting(contentEl).setName("전도대상").setDesc("태신자·전도대상자를 위한 기도이면 켜 주십시오")
      .addToggle((tg) => { evanToggle = tg; tg.setValue(false); tg.onChange((x) => (v.evangelism = x)); });

    const ta = contentEl.createEl("textarea", { cls: "pn-textarea", attr: { placeholder: "기도 내용 (자세히 적지 않아도 됩니다)", rows: "4" } });
    ta.oninput = () => (v.content = ta.value);

    contentEl.createDiv({ cls: "pn-note", text: "※ 상담 내용이나 민감한 개인 정보는 적지 마십시오." });

    new Setting(contentEl).addButton((b) => b.setButtonText("만들기").setCta().onClick(async () => {
      if (!v.title.trim()) { new Notice("기도제목을 적어 주십시오."); return; }
      await this.plugin.createItem(v);
      this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- 응답 기록 ---------- */
class AnswerModal extends Modal {
  constructor(plugin, file) { super(plugin.app); this.plugin = plugin; this.file = file; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("pn-modal");
    const fm = this.app.metadataCache.getFileCache(this.file)?.frontmatter || {};
    contentEl.createEl("h3", { text: "응답 기록" });
    contentEl.createDiv({ cls: "pn-sub", text: fm["제목"] || this.file.basename });
    let date = today(), text = "";
    new Setting(contentEl).setName("응답일").addText((t) => { t.inputEl.type = "date"; t.setValue(date); t.onChange((x) => (date = x)); });
    const ta = contentEl.createEl("textarea", { cls: "pn-textarea", attr: { placeholder: "하나님께서 어떻게 응답하셨습니까?", rows: "4" } });
    ta.oninput = () => (text = ta.value);
    setTimeout(() => ta.focus(), 50);
    new Setting(contentEl).addButton((b) => b.setButtonText("응답으로 옮기기").setCta().onClick(async () => {
      await this.plugin.recordAnswer(this.file, date || today(), text.trim());
      this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- 기도 모드 ---------- */
class PrayerModeModal extends Modal {
  constructor(plugin, list) { super(plugin.app); this.plugin = plugin; this.list = list; this.idx = 0; this.done = new Set(); }
  onOpen() {
    this.modalEl.addClass("pn-mode");
    this.scope.register([], "ArrowRight", () => { this.go(1); return false; });
    this.scope.register([], "ArrowLeft", () => { this.go(-1); return false; });
    let sx = null;
    this.contentEl.addEventListener("touchstart", (e) => { sx = e.changedTouches[0].clientX; }, { passive: true });
    this.contentEl.addEventListener("touchend", (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 60) this.go(dx < 0 ? 1 : -1);
    }, { passive: true });
    this.render();
  }
  go(d) { this.idx = Math.min(Math.max(this.idx + d, 0), this.list.length - 1); this.render(); }
  async render() {
    const { contentEl } = this;
    contentEl.empty();
    const it = this.list[this.idx];
    const fm = this.app.metadataCache.getFileCache(it.file)?.frontmatter || {};
    let body = "";
    try {
      const raw = await this.app.vault.cachedRead(it.file);
      const m = raw.replace(/^---[\s\S]*?---\s*/, "").match(/## 기도 내용\s*([\s\S]*?)(\n## |$)/);
      body = m ? m[1].trim() : "";
    } catch (e) {}
    contentEl.createDiv({ cls: "pn-mode-count", text: `${this.idx + 1} / ${this.list.length}` });
    const card = contentEl.createDiv("pn-mode-card");
    if (it.category || it.evangelism) {
      const b = card.createDiv("pn-mode-badges");
      if (it.category) b.createSpan({ cls: "pn-badge", text: it.category });
      if (it.evangelism) b.createSpan({ cls: "pn-badge pn-evan", text: "전도" });
    }
    card.createEl("h2", { text: fm["제목"] || it.title });
    if (it.target) card.createDiv({ cls: "pn-mode-target", text: it.target });
    if (body) card.createDiv({ cls: "pn-mode-body", text: body });
    card.createDiv({ cls: "pn-mode-meta", text: `${it.start ? it.start + "부터 " : ""}기도 ${Number(fm["기도횟수"] || 0)}번` });

    const nav = contentEl.createDiv("pn-mode-nav");
    const prev = nav.createEl("button", { text: "◀ 이전" });
    prev.disabled = this.idx === 0;
    prev.onclick = () => this.go(-1);
    const pray = nav.createEl("button", { text: this.done.has(it.file.path) ? "✔ 기도했습니다" : "🙏 기도했습니다", cls: "mod-cta" });
    pray.disabled = this.done.has(it.file.path);
    pray.onclick = async () => {
      await this.plugin.markPrayed(it.file);
      this.done.add(it.file.path);
      if (this.idx < this.list.length - 1) { this.idx++; setTimeout(() => this.render(), 200); }
      else { this.render(); new Notice(`오늘 ${this.done.size}개의 제목으로 기도하셨습니다.`); }
    };
    const next = nav.createEl("button", { text: "다음 ▶" });
    next.disabled = this.idx === this.list.length - 1;
    next.onclick = () => this.go(1);
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- 중보기도 목록 넣기 ---------- */
class InsertListModal extends Modal {
  constructor(plugin, editor) { super(plugin.app); this.plugin = plugin; this.editor = editor; }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("pn-modal");
    contentEl.createEl("h3", { text: "중보기도 목록 넣기" });
    contentEl.createDiv({ cls: "pn-sub", text: "기도 중인 제목을 커서 위치에 목록으로 넣습니다 (주보·기도회용)." });
    let cat = "", showTarget = true;
    new Setting(contentEl).setName("분류").addDropdown((d) => {
      d.addOption("", "모든 분류");
      for (const c of this.plugin.categoryList) d.addOption(c, c);
      d.onChange((x) => (cat = x));
    });
    new Setting(contentEl).setName("대상 이름 넣기").setDesc("주보에 실명을 싣지 않으려면 끄십시오")
      .addToggle((t) => { t.setValue(true); t.onChange((x) => (showTarget = x)); });
    new Setting(contentEl).addButton((b) => b.setButtonText("넣기").setCta().onClick(() => {
      const items = this.plugin.getItems().filter((i) => i.status === STATUS_PRAYING && (!cat || i.category === cat));
      if (!items.length) { new Notice("해당하는 기도 중 제목이 없습니다."); return; }
      const groups = {};
      for (const i of items) (groups[i.category || "기타"] = groups[i.category || "기타"] || []).push(i);
      const lines = [];
      for (const c of this.plugin.categoryList.concat(["기타"])) {
        if (!groups[c]) continue;
        if (!cat) lines.push(`**${c}**`);
        for (const i of groups[c]) lines.push(`- ${showTarget && i.target ? i.target + ": " : ""}${i.title}`);
        lines.push("");
      }
      this.editor.replaceSelection(lines.join("\n").trimEnd() + "\n");
      this.close();
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- 설정 ---------- */
class PrayerSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    new Setting(containerEl).setName("앱을 열면 기도수첩 화면부터").setDesc("휴대폰에서 기도수첩을 주로 쓰신다면 켜 두십시오")
      .addToggle((t) => t.setValue(!!s.openOnStart).onChange(async (v) => { s.openOnStart = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("기도제목 폴더").setDesc("기도제목 노트와 응답 기록 모음이 저장되는 곳")
      .addText((t) => t.setValue(s.folder).onChange(async (v) => { s.folder = v.trim() || DEFAULT_SETTINGS.folder; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("교인카드 폴더").setDesc("대상 이름을 교인카드로 연결할 때 찾는 곳 (교인CRM)")
      .addText((t) => t.setValue(s.memberFolder).onChange(async (v) => { s.memberFolder = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("분류").setDesc("쉼표로 구분")
      .addText((t) => t.setValue(s.categories).onChange(async (v) => { s.categories = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("응답 기록 모음 노트 이름")
      .addText((t) => t.setValue(s.answerLogName).onChange(async (v) => { s.answerLogName = v.trim() || DEFAULT_SETTINGS.answerLogName; await this.plugin.saveSettings(); }));
  }
}

module.exports = PrayerNotebookPlugin;
