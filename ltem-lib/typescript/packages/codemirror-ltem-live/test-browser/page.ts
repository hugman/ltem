/** The page the browser tests drive: an editor with Live Preview, exposed on `window`. */

import { defaultKeymap, redo, undo } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { LanguageDescription, syntaxTree } from "@codemirror/language";
import { Annotation, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";

import {
  applyLiveSettings, currentLiveSettings, liveMarkdown, livePreviewEnabled, setLiveMessages, setLivePreview, toggleLivePreview,
  type LiveSettings,
} from "../dist/index.js";
import { setLtemCellMarks, type LtemCellMark } from "codemirror-ltem";

const host = document.getElementById("editor")!;
// page-shadow.html: the editor in a Shadow DOM, under a policy that allows no inline styles.
const shadow = /page-shadow/.test(location.pathname);
const root: Document | ShadowRoot = shadow ? host.attachShadow({ mode: "open" }) : document;
const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (e) => violations.push(`${e.violatedDirective} ${e.sourceFile}:${e.lineNumber}`));

const opened: string[] = [];
// A 1x1 PNG, standing in for an image file the application would serve.
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// A split view (see split()): the source beside Live Preview, on one document, as in
// CodeMirror's split view example. Changes go to the other view with this annotation; the
// history is this view's, and the other view's undo and redo run here.
const synced = Annotation.define<boolean>();
let source: EditorView | null = null;
function mirror(tr: Transaction, to: EditorView | null): void {
  if (!to || tr.changes.empty || tr.annotation(synced)) return;
  const annotations = [synced.of(true)];
  const userEvent = tr.annotation(Transaction.userEvent);
  if (userEvent) annotations.push(Transaction.userEvent.of(userEvent));
  to.dispatch({ changes: tr.changes, annotations });
}

const view = new EditorView({
  doc: "",
  dispatchTransactions: (trs, v) => {
    v.update(trs);
    for (const tr of trs) mirror(tr, source);
  },
  extensions: [
    basicSetup,
    liveMarkdown({
      ltem: { lint: { delay: 100 } },
      // ?nested: the nested parse of code blocks and HTML, for measuring it.
      language: { nestedLanguages: new URLSearchParams(location.search).has("nested") },
      // Math, front matter, footnotes and highlights are on by default.
      live: {
        openLink: (url) => opened.push(url),
        resolveImage: (src) => (src === "local.png" ? PIXEL : src === "remote-after.png" ? "https://example.com/x.png" : null),
        // Stand-ins for KaTeX, Mermaid and a front matter view.
        renderMath: (tex, display, el) => { el.textContent = `${display ? "display" : "inline"}:${tex}`; },
        renderMermaid: (code, el) => new Promise<void>((resolve) => setTimeout(() => { el.textContent = `diagram:${code}`; resolve(); }, 10)),
        renderFrontMatter: (yaml, el) => { el.textContent = `properties:${yaml.split("\n").length}`; },
      },
    }),
    EditorView.lineWrapping,
  ],
  parent: shadow ? (root as ShadowRoot) : host,
});

/** The data the last copy or cut put on the clipboard (read after the component set it). */
let lastCopy: { plain: string; html: string } | null = null;
for (const type of ["copy", "cut"] as const) {
  document.addEventListener(type, (e) => {
    lastCopy = { plain: e.clipboardData?.getData("text/plain") ?? "", html: e.clipboardData?.getData("text/html") ?? "" };
  });
}

/** Paste data into the editor through a paste event. */
function paste(text: string, html = ""): void {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  if (html) data.setData("text/html", html);
  view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}

/** Open the source of the document in a second editor beside this one, or close it. */
function split(on: boolean): void {
  if (!on) {
    source?.destroy();
    source = null;
    document.getElementById("editor2")?.remove();
    return;
  }
  const host2 = document.createElement("div");
  host2.id = "editor2";
  document.body.appendChild(host2);
  source = new EditorView({
    state: EditorState.create({
      doc: view.state.doc,
      extensions: [
        lineNumbers(), drawSelection(),
        keymap.of([{ key: "Mod-z", run: () => undo(view) }, { key: "Mod-y", mac: "Mod-Shift-z", run: () => redo(view) }, ...defaultKeymap]),
        liveMarkdown({ ltem: { lint: { delay: 100 } }, live: { enabled: false } }),
      ],
    }),
    parent: shadow ? host2.attachShadow({ mode: "open" }) : host2,
    dispatchTransactions: (trs, v) => {
      v.update(trs);
      for (const tr of trs) mirror(tr, view);
    },
  });
}

function setDoc(doc: string, cursor: number): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: EditorSelection.cursor(cursor) });
  view.focus();
}

/** The editor's lines as shown: their classes and their visible text. */
function lines(): { cls: string; text: string }[] {
  return Array.from(root.querySelectorAll(".cm-line")).map((l) => ({
    cls: l.className.split(" ").filter((c) => c.startsWith("cm-live")).join(" "),
    text: l.textContent ?? "",
  }));
}

/** Main-thread work for `n` characters typed at `pos` (see codemirror-ltem's test page). */
async function work(pos: number, n: number): Promise<number[]> {
  const frame = (): Promise<unknown> => new Promise((r) => requestAnimationFrame(() => r(null)));
  const out: number[] = [];
  view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
  await frame();
  for (let i = 0; i < n; i++) {
    const head = view.state.selection.main.head;
    const t = performance.now();
    view.dispatch({ changes: { from: head, insert: "가" }, selection: EditorSelection.cursor(head + 1), userEvent: "input.type" });
    void document.body.offsetHeight;
    const sync = performance.now() - t;
    await frame();
    const t1 = performance.now();
    void document.body.offsetHeight;
    out.push(sync + (performance.now() - t1));
  }
  return out;
}

/** Code block languages, loaded when first needed as `@codemirror/language-data` does. */
const codeLanguages = [LanguageDescription.of({ name: "JavaScript", alias: ["js"], load: async () => javascript() })];

/**
 * A document's highlighting in a new editor, with or without the nested parse: for each
 * line, runs of text with the highlight classes on them, once they stop changing.
 */
async function highlighting(doc: string, nested: boolean): Promise<string[]> {
  const parent = document.createElement("div");
  (shadow ? root : document.body).appendChild(parent);
  const v = new EditorView({
    doc,
    // The source (Live Preview off), with HTML read, so that code and HTML are highlighted.
    extensions: [basicSetup, liveMarkdown({ language: { codeLanguages, nestedLanguages: nested }, ltem: { lint: false }, settings: { livePreview: false, html: true } })],
    parent,
  });
  const read = (): string[] => Array.from(v.contentDOM.querySelectorAll(".cm-line")).map((line) => {
    const runs: string[] = [];
    let last = "";
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const classes = new Set<string>();
      for (let el = node.parentElement; el && el !== line; el = el.parentElement) {
        for (const c of Array.from(el.classList)) if (!c.startsWith("cm-")) classes.add(c);
      }
      const key = [...classes].sort().join(" ");
      if (key === last && runs.length) runs[runs.length - 1] = runs[runs.length - 1]!.replace(/^(.*)\|/, (_, t: string) => `${t}${node!.textContent}|`);
      else runs.push(`${node.textContent}|${key}`);
      last = key;
    }
    return runs.join("  ");
  });
  let out = read();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const now = read();
    if (i > 4 && now.join("\n") === out.join("\n")) break;
    out = now;
  }
  v.destroy();
  parent.remove();
  return out;
}

Object.assign(window, {
  ltemTest: {
    highlighting,
    /** The settings of the editor, and changing them (as a settings page does). */
    settings: () => currentLiveSettings(view.state),
    applySettings: (settings: Partial<LiveSettings>) => applyLiveSettings(view, settings),
    setMessages: (messages: "en" | "ko") => setLiveMessages(view, messages),
    lastCopy: () => lastCopy,
    paste,
    setMarks: (marks: LtemCellMark[]) => view.dispatch({ effects: setLtemCellMarks.of(marks) }),
    select: (from: number, to: number) => {
      view.focus();
      view.dispatch({ selection: EditorSelection.range(from, to) });
    },
    view, setDoc, lines, work, root,
    doc: () => view.state.doc.toString(),
    split,
    sourceDoc: () => source?.state.doc.toString() ?? null,
    /** Type into the source view's document at `pos` (a change made in that view). */
    sourceInsert: (pos: number, text: string) => source?.dispatch({ changes: { from: pos, insert: text }, userEvent: "input.type" }),
    sourceFocus: (pos: number) => {
      source?.focus();
      source?.dispatch({ selection: { anchor: pos } });
    },
    sourceCount: (selector: string) => source?.dom.querySelectorAll(selector).length ?? 0,
    parsedTo: () => syntaxTree(view.state).length,
    viewportTo: () => view.viewport.to,
    head: () => view.state.selection.main.head,
    composing: () => view.composing,
    opened: () => opened,
    violations: () => violations,
    live: () => livePreviewEnabled(view.state),
    setLive: (on: boolean) => setLivePreview(view, on),
    toggle: () => toggleLivePreview(view),
    count: (selector: string) => root.querySelectorAll(selector).length,
    texts: (selector: string) => Array.from(root.querySelectorAll(selector)).map((e) => e.textContent ?? ""),
    styles: (selector: string, property: string) => Array.from(root.querySelectorAll(selector)).map((e) => getComputedStyle(e).getPropertyValue(property)),
    style: (selector: string, property: string) => {
      const el = root.querySelector(selector);
      return el ? getComputedStyle(el).getPropertyValue(property) : null;
    },
    setHostVariable: (name: string, value: string) => host.style.setProperty(name, value),
    setHeight: (px: number | null) => {
      view.dom.style.height = px === null ? "" : `${px}px`;
      view.requestMeasure();
    },
  },
});
