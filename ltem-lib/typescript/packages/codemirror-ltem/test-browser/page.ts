/** The page the browser tests drive: an editor with LTEM support, exposed on `window`. */

import { syntaxTree } from "@codemirror/language";
import { diagnosticCount, openLintPanel } from "@codemirror/lint";
import { undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorSelection } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";

import { ltem, ltemContextMenuConfig, ltemTableWidgets, NODE, nextCell, setLtemCellMarks, tableAt, type LtemCellMark, type LtemCellRef } from "../dist/index.js";

const widgets = new Compartment();
const menu = new Compartment();

// "#baseline": CodeMirror's own Markdown support with GFM tables and no LTEM, for comparison.
const baseline = location.hash === "#baseline";
// page-shadow.html: the editor in a Shadow DOM, under a policy that allows no inline styles.
const host = document.getElementById("editor")!;
const shadow = /page-shadow/.test(location.pathname);
const root: Document | ShadowRoot = shadow ? host.attachShadow({ mode: "open" }) : document;
/** Policy violations (inline styles refused), for the tests to check. */
const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (e) => violations.push(`${e.violatedDirective} ${e.sourceFile}:${e.lineNumber}`));

const view = new EditorView({
  doc: "",
  extensions: baseline
    ? [basicSetup, markdown({ base: markdownLanguage }), EditorView.lineWrapping, widgets.of([])]
    : [
      basicSetup,
      // Images of pasted cells: embedded ones saved (here only named) as files next to the document.
      ltem({ lint: { delay: 100 }, paste: { images: (src, alt) => (src.startsWith("data:") ? `img/${alt || "image"}.png` : src) } }),
      EditorView.lineWrapping, widgets.of([]), menu.of([]),
    ],
  parent: shadow ? (root as ShadowRoot) : host,
});

function setDoc(doc: string, cursor: number): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: EditorSelection.cursor(cursor) });
  view.focus();
}

/** Number of tables, and the shape of the one at `pos`. */
function tables(pos: number): { count: number; rows: number; cols: number; headerRows: number } | null {
  let count = 0;
  syntaxTree(view.state).iterate({ enter: (n) => { if (n.name === NODE.table) { count++; return false; } return true; } });
  const t = tableAt(view.state, pos);
  return t ? { count, rows: t.analysis.table.rows, cols: t.analysis.table.cols, headerRows: t.analysis.table.header_rows } : { count, rows: 0, cols: 0, headerRows: 0 } as never;
}

function lineClasses(): string[] {
  return Array.from(root.querySelectorAll(".cm-line")).map((e) => e.className);
}

/** Time from a change to the next painted frame, for `n` single-character insertions at `pos`. */
async function keyToFrame(pos: number, n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    view.dispatch({ changes: { from: pos + i, insert: "가" }, selection: EditorSelection.cursor(pos + i + 1), userEvent: "input.type" });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    out.push(performance.now() - t);
  }
  return out;
}

/** Copy (or cut) the range through a clipboard event, as the browser sends it; the data put on the clipboard. */
function clipboard(from: number, to: number, type: "copy" | "cut"): { plain: string; html: string; handled: boolean } {
  view.dispatch({ selection: EditorSelection.range(from, to) });
  const data = new DataTransfer();
  const event = new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return { plain: data.getData("text/plain"), html: data.getData("text/html"), handled: event.defaultPrevented };
}

/**
 * Main-thread work per action, in milliseconds: the transaction, the editor's DOM update
 * and the browser's layout (forced at once), and the editor's measuring on the next frame.
 * "type" inserts a character at `pos`, "move" moves the cursor down a line from `pos`,
 * "tab" runs Tab (next cell, lining up the columns) at `pos`.
 */
async function work(kind: "type" | "move" | "tab", pos: number, n: number): Promise<number[]> {
  const frame = (): Promise<unknown> => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  const out: number[] = [];
  view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
  await frame();
  for (let i = 0; i < n; i++) {
    const head = view.state.selection.main.head;
    if (kind === "tab") {
      // A character typed first, so that the columns need lining up again; Tab is timed.
      view.dispatch({ changes: { from: head, insert: "가" }, selection: EditorSelection.cursor(head + 1), userEvent: "input.type" });
      await frame();
    }
    const t = performance.now();
    if (kind === "type") {
      view.dispatch({ changes: { from: head, insert: "가" }, selection: EditorSelection.cursor(head + 1), userEvent: "input.type" });
    } else if (kind === "move") {
      const line = view.state.doc.lineAt(head);
      const next = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : view.state.doc.line(1);
      view.dispatch({ selection: EditorSelection.cursor(next.from + Math.min(3, next.length)), scrollIntoView: true, userEvent: "select" });
    } else {
      nextCell(view);
      // Back to where the character goes, for the next round.
      view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.from) });
    }
    void document.body.offsetHeight;
    const sync = performance.now() - t;
    await frame();
    // The editor measures in a frame callback; time it apart from the wait for the frame.
    const t1 = performance.now();
    void document.body.offsetHeight;
    out.push(sync + (performance.now() - t1));
  }
  return out;
}

function setWidgets(on: boolean, options: Parameters<typeof ltemTableWidgets>[0] = {}): void {
  view.dispatch({ effects: widgets.reconfigure(on ? ltemTableWidgets(options) : []) });
}

/** The data the last copy or cut put on the clipboard (read after the component set it). */
let lastCopy: { plain: string; html: string } | null = null;
document.addEventListener("copy", (e) => {
  lastCopy = { plain: e.clipboardData?.getData("text/plain") ?? "", html: e.clipboardData?.getData("text/html") ?? "" };
});
document.addEventListener("cut", (e) => {
  lastCopy = { plain: e.clipboardData?.getData("text/plain") ?? "", html: e.clipboardData?.getData("text/html") ?? "" };
});

/** Paste data into the focused element (or the editor) through a paste event. */
function paste(text: string, html = ""): void {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  if (html) data.setData("text/html", html);
  const active = root.activeElement;
  const target = active && active !== document.body ? active : view.contentDOM;
  target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}

/** Select text from `from` to `to` in the editor. */
function selectText(from: number, to: number): void {
  view.focus();
  view.dispatch({ selection: EditorSelection.range(from, to) });
}

/** The cell being edited in place: the text in its edit box, and its grid position in its table. */
function editing(): { text: string; row: number; col: number } | null {
  const box = root.activeElement;
  if (!(box instanceof HTMLElement) || !box.classList.contains("cm-ltem-editing")) return null;
  const cell = box.parentElement?.querySelector(".cm-ltem-editing-cell");
  if (!(cell instanceof HTMLTableCellElement)) return null;
  const tr = cell.parentElement as HTMLTableRowElement;
  const rows = Array.from(cell.closest("table")!.rows);
  return { text: box.textContent ?? "", row: rows.indexOf(tr), col: Array.from(tr.cells).indexOf(cell) };
}

/** Cell events the widgets reported (see `withCellEvents`). */
const cellEvents: string[] = [];
const describe = (cell: LtemCellRef | null): string => (cell ? `${cell.row},${cell.col}@${cell.table}` : "none");

Object.assign(window, {
  ltemTest: {
    setMarks: (marks: LtemCellMark[]) => view.dispatch({ effects: setLtemCellMarks.of(marks) }),
    /** Tables shown as tables, reporting hovers and clicks on cells. */
    withCellEvents: () => {
      cellEvents.length = 0;
      setWidgets(true, {
        onCellHover: (cell) => cellEvents.push(`hover ${describe(cell)}`),
        onCellClick: (cell) => cellEvents.push(`click ${describe(cell)}`),
      });
    },
    cellEvents: () => cellEvents,
    /** The menu with an application's action after the component's. */
    setMenuExtra: () => view.dispatch({
      effects: menu.reconfigure(ltemContextMenuConfig.of({
        extraActions: (target) => [{ id: "appCheck", group: "app", label: `Check ${target.cell.row},${target.cell.col}`, enabled: true, run: () => { cellEvents.push("appCheck"); return true; } }],
      })),
    }),
    markWidget: () => { const w = root.querySelector<HTMLElement>(".cm-ltem-widget"); if (w) w.dataset.marked = "yes"; },
    widgetMarked: () => root.querySelector<HTMLElement>(".cm-ltem-widget")?.dataset.marked === "yes",
    view, setDoc, tables, lineClasses, keyToFrame, setWidgets, clipboard, work, editing, paste, selectText,
    lastCopy: () => lastCopy,
    /** Give the editor a fixed height, so that it scrolls itself (null: as tall as its content). */
    setHeight: (px: number | null) => {
      view.dom.style.height = px === null ? "" : `${px}px`;
      view.requestMeasure();
    },
    setMenu: (options: object | null) => view.dispatch({ effects: menu.reconfigure(options ? ltemContextMenuConfig.of(options) : []) }),
    /** The menu's Paste reads this instead of the system clipboard. */
    setMenuClipboard: (text: string, html = "") => view.dispatch({
      effects: menu.reconfigure(ltemContextMenuConfig.of({ readClipboard: async () => ({ text, html }) })),
    }),
    /** Write the system clipboard (needs the clipboard permissions). */
    writeClipboard: async (text: string, html = "") => {
      const items: Record<string, Blob> = { "text/plain": new Blob([text], { type: "text/plain" }) };
      if (html) items["text/html"] = new Blob([html], { type: "text/html" });
      await navigator.clipboard.write([new ClipboardItem(items)]);
    },
    selectedCells: () => root.querySelectorAll(".cm-ltem-selectedCell").length,
    widgetSelected: () => Array.from(root.querySelectorAll(".cm-ltem-widget .cm-ltem-selected")).map((c) => c.textContent),
    menuItems: () => Array.from(root.querySelectorAll(".cm-ltem-menu .cm-ltem-menu-item")).map((b) =>
      `${b.getAttribute("aria-disabled") === "true" ? "-" : ""}${b.firstChild?.textContent ?? ""}`),
    focusClass: () => (root.activeElement as HTMLElement | null)?.className ?? "",
    focusText: () => root.activeElement?.textContent ?? "",
    violations: () => violations,
    /** Elements matching a selector, in the editor's document or shadow root. */
    count: (selector: string) => root.querySelectorAll(selector).length,
    texts: (selector: string) => Array.from(root.querySelectorAll(selector)).map((e) => e.textContent ?? ""),
    rowSpanOf: (text: string) => Array.from(root.querySelectorAll("td")).find((c) => c.textContent === text)?.rowSpan,
    editingNow: () => root.activeElement?.classList.contains("cm-ltem-editing") ?? false,
    root,
    widgetHtml: () => root.querySelector(".cm-ltem-widget table")?.outerHTML ?? "",
    undo: () => undo(view),
    diagnostics: () => diagnosticCount(view.state),
    openLint: () => openLintPanel(view),
    widgetCount: () => root.querySelectorAll(".cm-ltem-widget").length,
    doc: () => view.state.doc.toString(),
    head: () => view.state.selection.main.head,
    composing: () => view.composing,
  },
});
