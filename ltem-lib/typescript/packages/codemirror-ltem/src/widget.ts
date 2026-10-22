/**
 * Tables shown as tables (Live Preview), and edited there.
 *
 * A table that the selection is not in is replaced by its rendered HTML. On it:
 *
 * - A click on a cell edits its text in place (Markdown source); Enter, Tab and Shift-Tab
 *   keep the text and go on to the cell below, the next or the previous cell; Shift-Enter
 *   starts a new line; Escape drops the edit; a click elsewhere keeps it.
 * - A drag over cells, or a Shift-click, selects a range of cells, as do Shift and the
 *   arrow keys; a drag does also while a cell is edited, and from the cell being edited (the
 *   edit is kept). On a range: Delete empties the cells, Ctrl-C and Ctrl-X copy and cut them
 *   (tab-separated text and an HTML table), Ctrl-V pastes cells from the top left cell,
 *   Enter or typing edits the active cell.
 * - A right click opens the table menu (see menu.ts): rows, columns, merging, splitting,
 *   alignment, clipboard; also on the cell being edited. The table stays shown as a table.
 * - Moving the cursor into the table, or an Alt- or Ctrl-click, shows its LTEM source (with
 *   `revealSource: "altClick"`, only the click).
 * - A change of cell texts only updates the table in place (`TableWidget.updateDOM`); an edit
 *   or a range in it stays. An edit going on to another cell starts there at once, in the
 *   same task, so that no key goes to the source in between.
 * - The application's marks on cells (marks.ts) are put on the cells whenever they are drawn.
 *
 * With `editInPlace: false`, a click on a cell shows the source with the cursor in that
 * cell instead. While the cursor is in a table, including during an IME composition, its
 * source is shown.
 *
 * A large table (more than 200 body rows) is drawn in parts: its rows are grouped into
 * blocks, and only the blocks near the screen are drawn; the others keep their height.
 * Editing, ranges and the menu work the same: a block is drawn when the cursor of an edit
 * or a range goes into it, and the block being edited stays drawn.
 */

import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { StateField, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, layer, type DecorationSet, type LayerMarker, type ViewUpdate } from "@codemirror/view";
import { ownerGrid, plainInline, renderHtml, type InlineRenderer, type Table } from "ltem-core";

import { elementAt, selectionOf } from "./dom.js";
import { displayWidth } from "./format.js";

import type { LtemCellTarget } from "./actions.js";
import { sourceCellAt } from "./analysis.js";
import { TextCache } from "./cache.js";
import { rangeHtml, rangeTsv } from "./clipboard.js";
import { editCellText, editCellTexts } from "./commands.js";
import { ltemCellMarks } from "./marks.js";
import { ltemContextMenuConfig, openTableMenu } from "./menu.js";
import { cellRange, cellsIn, hasEmptyHeader, rangeTable, type CellRange, type GridPosition } from "./model.js";
import { ltemPasteOptions, pasteTables } from "./paste.js";
import { NODE, holdsTables } from "./syntax.js";
import { tableFromNode, tablesIn, type LtemTableInfo } from "./query.js";
import { concealTableSource, isRevealed, revealTableSource, revealedTables } from "./reveal.js";

export interface LtemWidgetOptions {
  /** Renders one line of cell text as HTML. Default: the text, escaped (no inline Markdown). */
  renderInline?: InlineRenderer;
  /**
   * Edit tables where they are shown (default true): cells in place, ranges of cells, the
   * table menu. With false, a click on a cell shows the source with the cursor in that cell.
   */
  editInPlace?: boolean;
  /**
   * Opens a link of a cell on Ctrl-click (Cmd-click on macOS), with the link's address as
   * written. Without it, Ctrl-click shows the table's source.
   */
  openLink?: (url: string, event: MouseEvent) => void;
  /**
   * When a table's source is shown (default "cursor"): "cursor" when the cursor is in the
   * table; "altClick" only on an Alt- or Ctrl-click (or the table menu's Edit source), the
   * table staying shown as a table with the cursor in it, until the cursor leaves it.
   */
  revealSource?: "cursor" | "altClick";
  /** Called when the mouse goes over a cell of a shown table, or off the table (null). */
  onCellHover?: (cell: LtemCellRef | null, event: MouseEvent) => void;
  /** Called on a click on a cell of a shown table. */
  onCellClick?: (cell: LtemCellRef, event: MouseEvent) => void;
  /**
   * A button to the table's source on a shown table, at its top right while the mouse is
   * over it, and a button back to the table at the end of its first line while its source is
   * shown (default true).
   */
  sourceButton?: boolean;
  /** Language of the buttons' labels and hints (default "en"), or a function giving each. */
  messages?: "en" | "ko" | ((id: LtemWidgetMessage) => string);
}

/** A small line icon (SVG, no style attributes): the source `</>` or a table. */
function icon(kind: "source" | "table"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", kind === "source" ? "M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4" : "M2 3h12v10H2zM2 6.5h12M2 10h12M6.5 3v10");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

/** A handle button at the left of a table: to its source, or back to the table. */
function handle(kind: "source" | "table", ctx: BuildContext): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = kind === "source" ? "cm-ltem-handle cm-ltem-source-button" : "cm-ltem-handle cm-ltem-table-button";
  const hint = ctx.label(kind === "source" ? "sourceHint" : "tableHint");
  button.title = hint;
  button.setAttribute("aria-label", `${ctx.label(kind === "source" ? "sourceButton" : "tableButton")}: ${hint}`);
  button.appendChild(icon(kind));
  return button;
}

/** The texts of the table widgets: the source button and its hint, the table button and its hint. */
export type LtemWidgetMessage = "sourceButton" | "sourceHint" | "tableButton" | "tableHint";

const WIDGET_LABELS: Record<"en" | "ko", Record<LtemWidgetMessage, string>> = {
  en: {
    sourceButton: "Source",
    sourceHint: "Click a cell to edit it · Alt-click or this button: source",
    tableButton: "Table",
    tableHint: "Show as a table",
  },
  ko: {
    sourceButton: "원문",
    sourceHint: "칸을 눌러 고치기 · Alt+클릭이나 이 단추: 원문",
    tableButton: "표로",
    tableHint: "표로 보기",
  },
};

/**
 * A cell of a shown table: the table's start in the document (`LtemTableInfo.from`), and the
 * grid row and column of the cell's origin. Rows count header rows from 0; they are the cells'
 * `data-row` and `data-col` in the widget, and markdown-it-ltem's `meta.ltem.row` and `.col`.
 */
export interface LtemCellRef {
  table: number;
  row: number;
  col: number;
}

// -- cells of the drawn table ---------------------------------------------------------------

/** The grid position of a drawn cell, which its drawing marked on it (see `annotate`). */
export function gridPosition(cell: HTMLTableCellElement): GridPosition | null {
  const { row, col } = cell.dataset;
  return row === undefined || col === undefined ? null : { row: Number(row), col: Number(col) };
}

/** The drawn cell whose origin is at (row, col), if it is drawn. */
function cellElementAt(table: HTMLElement, row: number, col: number): HTMLTableCellElement | null {
  return table.querySelector(`[data-row="${row}"][data-col="${col}"]`);
}

/** Mark each cell of a drawn part of a table with its grid position; the part starts `top` rows down. */
function annotate(part: HTMLTableElement | HTMLTableSectionElement, top: number): void {
  const taken: boolean[][] = [];
  const rows = Array.from(part.rows);
  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    for (const cell of Array.from(rows[r].cells)) {
      while (taken[r]?.[c]) c++;
      cell.dataset.row = String(top + r);
      cell.dataset.col = String(c);
      for (let dr = 0; dr < Math.max(cell.rowSpan, 1); dr++) {
        const line = (taken[r + dr] ??= []);
        for (let dc = 0; dc < cell.colSpan; dc++) line[c + dc] = true;
      }
      c += cell.colSpan;
    }
  }
}

/** The HTML of a cell's text, as `renderHtml` draws it: its lines rendered, joined by line breaks. */
function cellContent(text: string, render: InlineRenderer): string {
  return text.split("\n").map((line) => render(line)).join("<br />");
}

/** Whether two tables have the same rows, columns, header rows, alignment and cells, their texts aside. */
function sameShape(a: Table, b: Table): boolean {
  if (a.rows !== b.rows || a.cols !== b.cols || a.header_rows !== b.header_rows || a.cells.length !== b.cells.length) return false;
  if (a.align.some((x, i) => x !== b.align[i])) return false;
  return a.cells.every((c, i) => {
    const d = b.cells[i]!;
    return c.row === d.row && c.col === d.col && c.rowspan === d.rowspan && c.colspan === d.colspan;
  });
}

// -- drawing a large table in parts ----------------------------------------------------------

/** Tables with more body rows than this are drawn in parts. */
const VIRTUAL_ROWS = 200;
/** About this many rows to a block. */
const BLOCK_ROWS = 40;

/**
 * The rows of a large table drawn last and the heights of its blocks, by the table's place:
 * a table drawn again (after a change) draws those rows at once and gives the other blocks
 * their heights, so that what was on the screen stays drawn and in its place.
 */
const lastDrawn = new WeakMap<EditorView, { from: number; first: number; last: number; rowHeight: number; heights: Map<string, number> }>();

interface Block {
  from: number;
  to: number;
  body: HTMLTableSectionElement;
  drawn: boolean;
  /** Its height when last drawn, for the space it keeps while not drawn. */
  height: number | null;
}

/**
 * A large table drawn in blocks of rows: the header rows always, and the blocks near the
 * screen. A block never cuts a merged cell. Columns get fixed widths from the cell texts,
 * so that they do not change as blocks are drawn.
 */
class PartialTable {
  readonly element: HTMLTableElement;
  private readonly blocks: Block[] = [];
  private rowHeight = 26;
  private frame = 0;
  private readonly onScroll = (): void => this.schedule();

  constructor(
    private readonly view: EditorView,
    /** The table; replaced when the table is updated in place (see `setModel`). */
    private model: Table,
    private readonly render: InlineRenderer,
    /** Rows that must stay drawn (a cell being edited, a range's ends). */
    private readonly keep: () => number[],
    /** Called after blocks were drawn. */
    private readonly drawn: () => void,
    /** Where the table is in the document, when the widget is made. */
    from: number,
  ) {
    const doc = view.dom.ownerDocument;
    const t = model;
    const table = doc.createElement("table");
    table.className = "cm-ltem-partial";
    const group = doc.createElement("colgroup");
    const widths = columnWidths(t);
    for (const width of widths) {
      const col = doc.createElement("col");
      col.style.width = `${width}ch`;
      group.appendChild(col);
    }
    table.style.width = `${widths.reduce((a, b) => a + b, 0)}ch`;
    table.appendChild(group);
    // A table with no header (an empty header row): its header row is not drawn.
    const head = hasEmptyHeader(t) ? null : this.part(0, t.header_rows);
    if (head) table.appendChild(head);
    // Blocks of body rows, ending where no merged cell goes on into the next row.
    const crossing = new Uint8Array(t.rows + 1);
    for (const c of t.cells) for (let r = c.row + 1; r < c.row + c.rowspan; r++) crossing[r] = 1;
    for (let from = t.header_rows; from < t.rows;) {
      let to = Math.min(t.rows, from + BLOCK_ROWS);
      while (to < t.rows && crossing[to]) to++;
      const body = doc.createElement("tbody");
      const block: Block = { from, to, body, drawn: false, height: null };
      this.blocks.push(block);
      this.gap(block);
      table.appendChild(body);
      from = to;
    }
    this.element = table;
    // At once: the rows drawn last time if this is the same table drawn again, else the first blocks.
    const last = lastDrawn.get(view);
    const again = last !== undefined && last.from === from;
    if (again) {
      this.rowHeight = last.rowHeight;
      for (const block of this.blocks) {
        block.height = last.heights.get(`${block.from}-${block.to}`) ?? null;
        this.gap(block);
      }
    }
    const [first, end] = again ? [last.first, last.last] : [t.header_rows, t.header_rows + 2 * BLOCK_ROWS];
    for (const block of this.blocks) if (block.to > first && block.from < end) this.draw(block);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    view.dom.ownerDocument.defaultView?.addEventListener("scroll", this.onScroll, { passive: true });
  }

  /**
   * The table changed in the texts of its cells only, updated in place (see
   * `TableWidget.updateDOM`): blocks drawn later draw the new texts, and the columns get the
   * widths of the new texts.
   */
  setModel(model: Table): void {
    this.model = model;
    const widths = columnWidths(model);
    const cols = Array.from(this.element.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col"));
    widths.forEach((width, i) => {
      if (cols[i] && cols[i]!.style.width !== `${width}ch`) cols[i]!.style.width = `${width}ch`;
    });
    this.element.style.width = `${widths.reduce((a, b) => a + b, 0)}ch`;
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.view.dom.ownerDocument.defaultView?.removeEventListener("scroll", this.onScroll);
    if (this.frame) cancelAnimationFrame(this.frame);
  }

  /** Rows [from, to) drawn as a table section, its cells marked with their positions. */
  private part(from: number, to: number): HTMLTableSectionElement | null {
    if (to <= from) return null;
    const range = { top: from, left: 0, bottom: to - 1, right: this.model.cols - 1 };
    const template = this.view.dom.ownerDocument.createElement("template");
    template.innerHTML = renderHtml(rangeTable(this.model, range), this.render);
    const section = template.content.querySelector(from < this.model.header_rows ? "thead" : "tbody") as HTMLTableSectionElement | null;
    if (section) annotate(section, from);
    return section;
  }

  private gap(block: Block): void {
    const doc = this.view.dom.ownerDocument;
    const row = doc.createElement("tr");
    row.className = "cm-ltem-gap";
    const cell = doc.createElement("td");
    cell.colSpan = this.model.cols;
    cell.style.height = `${block.height ?? (block.to - block.from) * this.rowHeight}px`;
    row.appendChild(cell);
    block.body.replaceChildren(row);
    block.drawn = false;
  }

  private draw(block: Block): void {
    const part = this.part(block.from, block.to);
    if (!part) return;
    block.body.replaceChildren(...Array.from(part.rows));
    block.drawn = true;
  }

  /** Draw the block that holds `row`, if it is not drawn. */
  ensure(row: number): void {
    const block = this.blocks.find((b) => row >= b.from && row < b.to);
    if (block && !block.drawn) {
      this.draw(block);
      this.drawn();
    }
  }

  schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  /** Draw the blocks near the screen, and let go of those far from it. */
  update(): void {
    if (!this.element.isConnected) return;
    // What is on the screen: the editor's scroller, within the window (the page may scroll too).
    const scroller = this.view.scrollDOM.getBoundingClientRect();
    const win = this.view.dom.ownerDocument.defaultView!;
    const screen = { top: Math.max(scroller.top, 0), bottom: Math.min(scroller.bottom, win.innerHeight) };
    const margin = Math.max(200, screen.bottom - screen.top);
    const keep = this.keep();
    let changed = false;
    let shift = 0;
    for (const block of this.blocks) {
      const box = block.body.getBoundingClientRect();
      const near = box.bottom >= screen.top - margin && box.top <= screen.bottom + margin;
      if (near && !block.drawn) {
        const before = box.height;
        this.draw(block);
        // A block above the screen that grew or shrank would move what is on the screen.
        if (box.top < screen.top) shift += block.body.getBoundingClientRect().height - before;
        changed = true;
      } else if (!near && block.drawn && !keep.some((r) => r >= block.from && r < block.to)) {
        block.height = box.height;
        this.gap(block);
        changed = true;
      }
    }
    if (changed) {
      const drawn = this.blocks.filter((b) => b.drawn);
      const rows = drawn.reduce((n, b) => n + b.to - b.from, 0);
      if (rows) {
        const height = drawn.reduce((h, b) => h + b.body.getBoundingClientRect().height, 0) / rows;
        if (Math.abs(height - this.rowHeight) > 1) {
          this.rowHeight = height;
          for (const b of this.blocks) if (!b.drawn && b.height === null) this.gap(b);
        }
      }
      if (shift) this.view.scrollDOM.scrollTop += shift;
      this.drawn();
      this.view.requestMeasure();
    }
    this.remember();
  }

  /** Note what is drawn and the blocks' heights, for this table drawn again after a change. */
  remember(): void {
    if (!this.element.isConnected) return;
    const drawn = this.blocks.filter((b) => b.drawn);
    if (!drawn.length) return;
    const heights = new Map<string, number>();
    for (const b of this.blocks) heights.set(`${b.from}-${b.to}`, b.drawn ? b.body.getBoundingClientRect().height : b.height ?? (b.to - b.from) * this.rowHeight);
    lastDrawn.set(this.view, {
      from: this.view.posAtDOM(this.element), first: drawn[0].from, last: drawn[drawn.length - 1].to, rowHeight: this.rowHeight, heights,
    });
  }
}

/** The columns' widths in `ch`, from the widest text in each (merged cells left out), within limits. */
function columnWidths(table: Table): number[] {
  const widths = new Array<number>(table.cols).fill(3);
  for (const c of table.cells) {
    if (c.colspan > 1 || widths[c.col] >= 40) continue;
    for (const line of c.text.split("\n")) widths[c.col] = Math.max(widths[c.col], displayWidth(line));
  }
  return widths.map((w) => Math.min(w, 40) + 2);
}

function cellOf(target: EventTarget | null, wrap: HTMLElement): HTMLTableCellElement | null {
  const cell = target instanceof Element ? target.closest("td, th") : null;
  return cell instanceof HTMLTableCellElement && wrap.contains(cell) ? cell : null;
}

/** The table whose first line starts at `from` (a widget's position), also in a block quote or a list. */
function tableOnLine(state: EditorState, from: number): LtemTableInfo | null {
  return tablesIn(state, from, state.doc.lineAt(from).to)[0] ?? null;
}

/** Document position for showing the source at a cell: the end of its text, or the table's start. */
function sourcePosition(info: LtemTableInfo, at: GridPosition | null): number {
  if (!at) return info.from;
  const found = sourceCellAt(info.analysis, at.row, at.col);
  if (found) return info.lineStarts[found.row.line] + found.cell.end;
  // A cell added by padding (rule V14) is not written: the end of its row.
  const row = info.analysis.rows.find((r) => r.row === at.row);
  return row ? info.lineStarts[row.line] + info.analysis.lines[row.line].length : info.from;
}

type Span = { anchor: GridPosition; head: GridPosition };

/** Where editing goes on after a cell: the cell below, the next or previous one, a given cell, or a range. */
type Move = "down" | "next" | "previous" | GridPosition | Span;

function isSpan(move: Move): move is Span {
  return typeof move === "object" && "anchor" in move;
}

/** The first row drawn: the empty header row of a table with no header is not drawn. */
function firstShownRow(table: Table): number {
  return hasEmptyHeader(table) ? table.header_rows : 0;
}

/** The cell to go to from (row, col): below it, or the next or previous one in reading order. */
function neighbour(table: Table, row: number, col: number, move: "down" | "next" | "previous" | GridPosition): GridPosition | null {
  if (typeof move === "object") return move;
  const grid = ownerGrid(table);
  const owner = grid[row][col]!;
  if (move === "down") {
    const below = grid[owner.row + owner.rowspan]?.[col];
    return below ? { row: below.row, col: below.col } : null;
  }
  const order = [...table.cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const next = order[order.indexOf(owner) + (move === "next" ? 1 : -1)];
  return next ? { row: next.row, col: next.col } : null;
}

/** The text typed into an editable cell; line breaks may be newlines or `<br>` elements. */
function typedText(cell: HTMLElement): string {
  let out = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
    else if (node.nodeName === "BR") out += "\n";
    else {
      if ((node.nodeName === "DIV" || node.nodeName === "P") && out && !out.endsWith("\n")) out += "\n";
      node.childNodes.forEach(walk);
    }
  };
  cell.childNodes.forEach(walk);
  return out.replace(/\n$/, "");
}

/** Whether a computed color is fully transparent. */
function transparent(color: string): boolean {
  return color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);
}

/** The first opaque background color around an element (across shadow roots), or null. */
function opaqueBackground(element: Element): string | null {
  const view = element.ownerDocument.defaultView;
  for (let node: Node | null = element; node && view; ) {
    if (node instanceof Element) {
      const color = view.getComputedStyle(node).backgroundColor;
      if (/^rgb\(/.test(color) || /^rgba\(.*,\s*1\)$/.test(color)) return color;
    }
    node = node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode;
  }
  return null;
}

// -- editing a drawn table ------------------------------------------------------------------

/** What to bring back after a change: a cell to edit, or a range of cells to select. */
interface Then {
  edit?: GridPosition;
  /** Select the text of the cell to edit, as Tab does (else the caret goes to its end). */
  select?: boolean;
  range?: Span;
}

/** What to bring back when a table is drawn again after a change made on it, with the table's start. */
const pending = new WeakMap<EditorView, Then & { from: number }>();

/** The interaction with one drawn table: the cell being edited, the selected range of cells. */
class TableInteraction {
  /** Ends the edit of a cell, keeping the text, and goes on as `move` says. */
  editing: ((move: Move | null) => void) | null = null;
  anchor: GridPosition | null = null;
  head: GridPosition | null = null;
  private keys: HTMLTextAreaElement | null = null;
  private menuOpen = false;
  /** The cell being edited, and the box over it in which it is edited. */
  private editingAt: GridPosition | null = null;
  private box: HTMLElement | null = null;
  /** For a large table, its drawing in parts. */
  partial: PartialTable | null = null;

  constructor(readonly view: EditorView, readonly wrap: HTMLElement, readonly render: InlineRenderer) {}

  /** The drawn cell at (row, col); in a large table its block is drawn first. */
  cellEl(row: number, col: number): HTMLTableCellElement | null {
    this.partial?.ensure(row);
    return cellElementAt(this.wrap, row, col);
  }

  /** Rows a large table must keep drawn: the cell being edited, the ends of the range. */
  keepRows(): number[] {
    return [this.editingAt?.row, this.anchor?.row, this.head?.row].filter((r): r is number => r !== undefined);
  }

  /** After blocks of a large table were drawn: mark the range in them again, and put the edit box back over its cell. */
  redrawn(): void {
    if (this.anchor) this.highlight();
    this.placeBox();
    applyMarks(this.view, this.wrap);
  }

  get table(): HTMLTableElement | null {
    return this.wrap.querySelector("table");
  }

  /** The table in the document; read when needed, as the document changes. */
  info(): LtemTableInfo | null {
    return this.wrap.isConnected ? tableOnLine(this.view.state, this.view.posAtDOM(this.wrap)) : null;
  }

  /** Dispatch a change made on this table; when it is drawn again, `then` is brought back. */
  dispatch(spec: Parameters<EditorView["dispatch"]>[0], then: Then = {}): void {
    this.partial?.remember();
    if (then.edit || then.range) pending.set(this.view, { from: this.view.posAtDOM(this.wrap), ...then });
    this.view.dispatch(spec);
    if (this.wrap.isConnected && pending.has(this.view)) {
      // The table was not drawn again: bring it back in this drawing.
      pending.delete(this.view);
      this.restore(then);
    }
  }

  restore(then: Then): void {
    if (!this.table) return;
    if (then.edit) {
      const cell = this.cellEl(then.edit.row, then.edit.col);
      if (cell) this.edit(cell, "", then.select);
    } else if (then.range) {
      this.select(then.range.anchor, then.range.head);
    }
  }

  // -- ranges of cells

  range(): CellRange | null {
    const info = this.anchor && this.head ? this.info() : null;
    return info ? cellRange(info.analysis.table, this.anchor!, this.head!) : null;
  }

  select(anchor: GridPosition, head: GridPosition): void {
    this.anchor = anchor;
    this.head = head;
    this.highlight();
    this.focusKeys();
  }

  clear(): void {
    this.anchor = null;
    this.head = null;
    this.highlight();
  }

  private highlight(): void {
    const r = this.range();
    for (const cell of Array.from(this.wrap.querySelectorAll<HTMLTableCellElement>("td[data-row], th[data-row]"))) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      cell.classList.toggle("cm-ltem-selected", r !== null && row >= r.top && row <= r.bottom && col >= r.left && col <= r.right);
    }
  }

  /** The target of table actions at cell `at`: the selected range if `at` is in it, or that cell. */
  target(at: GridPosition): LtemCellTarget | null {
    const info = this.info();
    if (!info) return null;
    const r = this.range();
    const inside = r !== null && at.row >= r.top && at.row <= r.bottom && at.col >= r.left && at.col <= r.right;
    const from = this.view.posAtDOM(this.wrap);
    return {
      table: info,
      range: inside ? r! : cellRange(info.analysis.table, at, at),
      cell: inside ? this.head! : at,
      widget: true,
      focusAfter: (cell: GridPosition) => {
        this.partial?.remember();
        pending.set(this.view, { from, range: { anchor: cell, head: cell } });
      },
    };
  }

  /** Move the active cell by one cell, keeping the anchor if `extend`. */
  private step(key: string, extend: boolean): void {
    const info = this.info();
    if (!info || !this.head) return;
    const t = info.analysis.table;
    const owner = ownerGrid(t)[this.head.row][this.head.col]!;
    let { row, col } = this.head;
    if (key === "ArrowRight") col = owner.col + owner.colspan;
    else if (key === "ArrowLeft") col = owner.col - 1;
    else if (key === "ArrowDown") row = owner.row + owner.rowspan;
    else if (key === "ArrowUp") row = owner.row - 1;
    if (row < firstShownRow(t) || col < 0 || row >= t.rows || col >= t.cols) return;
    const head = { row, col };
    this.select(extend ? this.anchor! : head, head);
  }

  /** The origin of the cell at the active position. */
  private headOrigin(): GridPosition | null {
    if (!this.head) return null;
    const info = this.info();
    const owner = info ? ownerGrid(info.analysis.table)[this.head.row]?.[this.head.col] : null;
    return owner ? { row: owner.row, col: owner.col } : this.head;
  }

  /** The text area that takes keys, the clipboard and IME input while a range is selected. */
  private focusKeys(): void {
    const doc = this.wrap.ownerDocument;
    if (!this.keys) {
      const keys = doc.createElement("textarea");
      keys.className = "cm-ltem-keys";
      keys.setAttribute("aria-label", "Table cells");
      keys.spellcheck = false;
      keys.addEventListener("keydown", (e) => this.onKey(e));
      keys.addEventListener("input", (e) => {
        if (!(e as InputEvent).isComposing) this.typed();
      });
      keys.addEventListener("compositionstart", () => keys.classList.add("cm-ltem-keys-composing"));
      keys.addEventListener("compositionend", () => {
        keys.classList.remove("cm-ltem-keys-composing");
        this.typed();
      });
      keys.addEventListener("copy", (e) => this.onCopy(e, false));
      keys.addEventListener("cut", (e) => this.onCopy(e, true));
      keys.addEventListener("paste", (e) => this.onPaste(e));
      keys.addEventListener("blur", () => {
        if (!this.menuOpen && !keys.classList.contains("cm-ltem-keys-composing")) this.clear();
      });
      this.wrap.appendChild(keys);
      this.keys = keys;
    }
    // Over the active cell, so that the IME window opens there; the cell is scrolled into view.
    const at = this.headOrigin();
    const cell = at ? this.cellEl(at.row, at.col) : null;
    if (cell) {
      const box = cell.getBoundingClientRect();
      const wrap = this.wrap.getBoundingClientRect();
      this.keys.style.left = `${box.left - wrap.left + this.wrap.scrollLeft}px`;
      this.keys.style.top = `${box.top - wrap.top}px`;
      this.keys.style.width = `${Math.max(box.width, 40)}px`;
      this.keys.style.height = `${box.height}px`;
    }
    this.keys.value = "";
    this.keys.focus({ preventScroll: true });
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Typing (or an IME composition) on a range edits the active cell, the typed text added. */
  private typed(): void {
    const text = this.keys?.value ?? "";
    const at = this.headOrigin();
    if (!text || !at || !this.table) return;
    this.keys!.value = "";
    const cell = this.cellEl(at.row, at.col);
    this.clear();
    if (cell) this.edit(cell, text);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      this.clear();
      this.view.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      this.emptyCells();
    } else if ((e.key === "Enter" || e.key === "F2") && !mod) {
      const at = this.headOrigin();
      const cell = at ? this.cellEl(at.row, at.col) : null;
      this.clear();
      if (cell) this.edit(cell);
    } else if (e.key.startsWith("Arrow") && !mod && !e.altKey) {
      this.step(e.key, e.shiftKey);
    } else if (mod && e.key.toLowerCase() === "a") {
      const info = this.info();
      if (info) this.select({ row: firstShownRow(info.analysis.table), col: 0 }, { row: info.analysis.table.rows - 1, col: info.analysis.table.cols - 1 });
    } else if (e.key === "Tab") {
      const info = this.info();
      const next = info && this.head ? neighbour(info.analysis.table, this.head.row, this.head.col, e.shiftKey ? "previous" : "next") : null;
      if (next && next.row >= firstShownRow(info!.analysis.table)) this.select(next, next);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private emptyCells(): void {
    const info = this.info();
    const r = this.range();
    if (!info || !r) return;
    const spec = editCellTexts(this.view.state, info, cellsIn(info.analysis.table, r).map((c) => ({ row: c.row, col: c.col, text: "" })));
    if (spec) this.dispatch({ ...spec, userEvent: "delete.ltem" }, { range: { anchor: this.anchor!, head: this.head! } });
  }

  private onCopy(e: ClipboardEvent, cut: boolean): void {
    const info = this.info();
    const r = this.range();
    if (!info || !r || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", rangeTsv(info.analysis.table, r));
    e.clipboardData.setData("text/html", rangeHtml(info.analysis.table, r, this.render));
    if (cut) this.emptyCells();
  }

  private onPaste(e: ClipboardEvent): void {
    const info = this.info();
    const r = this.range();
    if (!info || !r || !e.clipboardData) return;
    e.preventDefault();
    const data = { html: e.clipboardData.getData("text/html"), text: e.clipboardData.getData("text/plain") };
    const spec = pasteTables(this.view.state, data, this.view.state.facet(ltemPasteOptions), { table: info, at: { row: r.top, col: r.left }, keepSelection: true });
    if (spec) this.dispatch(spec, { range: { anchor: this.anchor!, head: this.head! } });
  }

  // -- the table menu

  menu(event: MouseEvent, cell: HTMLTableCellElement): void {
    const at = gridPosition(cell);
    if (!at) return;
    const from = this.view.posAtDOM(this.wrap);
    let target: LtemCellTarget | null;
    if (this.editing) {
      // Keep the edit first; the table may be drawn again, so the target is read afresh.
      this.editing(null);
      const info = tableOnLine(this.view.state, from);
      target = info && {
        table: info, range: cellRange(info.analysis.table, at, at), cell: at, widget: true,
        focusAfter: (c: GridPosition) => {
          this.partial?.remember();
          pending.set(this.view, { from, range: { anchor: c, head: c } });
        },
      };
    } else {
      const r = this.range();
      if (!r || at.row < r.top || at.row > r.bottom || at.col < r.left || at.col > r.right) this.select(at, at);
      target = this.target(at);
    }
    if (!target) return;
    this.menuOpen = true;
    // The menu closes before its action runs. An action that changes the table names the
    // cell to select in the table's new drawing (`focusAfter`); others keep this range.
    openTableMenu(this.view, event, target, () => {
      this.menuOpen = false;
      if (this.wrap.isConnected && this.anchor) this.focusKeys();
    });
  }

  // -- editing a cell in place

  /**
   * Edit a cell, showing the Markdown source of its text (with `append` added), with the
   * caret at its end or (`select`) the text selected. Returns false if the cell is not
   * written in the source (rule V14 padding).
   *
   * The text is edited in a box laid over the cell, not in the cell: typing in the cell
   * would lay out and paint the whole table again at every key, which takes tens of
   * milliseconds in a large table. The table is drawn again when the edit is kept.
   */
  edit(cell: HTMLTableCellElement, append = "", select = false): boolean {
    const view = this.view;
    // A table no longer shown (drawn again since) has nothing to edit.
    if (!this.wrap.isConnected || !this.wrap.contains(cell)) return false;
    const at = gridPosition(cell);
    const info = at && this.info();
    if (!at || !info || !sourceCellAt(info.analysis, at.row, at.col)) return false;
    const model = info.analysis.table.cells.find((c) => c.row === at.row && c.col === at.col);
    if (!model) return false;
    this.clear();
    this.editingAt = at;
    const box = this.wrap.ownerDocument.createElement("div");
    box.className = "cm-ltem-editing";
    box.textContent = model.text + append;
    box.contentEditable = "plaintext-only";
    if (box.contentEditable !== "plaintext-only") box.contentEditable = "true";
    box.spellcheck = false;
    box.setAttribute("role", "textbox");
    box.setAttribute("aria-multiline", "true");
    this.wrap.appendChild(box);
    this.box = box;
    cell.classList.add("cm-ltem-editing-cell");
    let done = false;

    const finish = (keep: boolean, move: Move | null): void => {
      if (done) return;
      done = true;
      this.editing = null;
      this.editingAt = null;
      this.box = null;
      const text = typedText(box);
      box.removeEventListener("keydown", onKey);
      box.removeEventListener("beforeinput", onInput);
      box.removeEventListener("compositionstart", onCompositionStart);
      box.removeEventListener("compositionend", onCompositionEnd);
      box.removeEventListener("blur", onBlur);
      box.remove();
      cellElementAt(this.wrap, at.row, at.col)?.classList.remove("cm-ltem-editing-cell");
      const current = this.info();
      if (!current) return;
      let then: Then = {};
      if (move && isSpan(move)) then = { range: move };
      else if (move) {
        let next = neighbour(current.analysis.table, at.row, at.col, move);
        if (next && next.row < firstShownRow(current.analysis.table)) next = null; // the empty header row is not shown
        // Tab selects the text of the next cell, as it does in the source.
        if (next) then = { edit: next, select: move === "next" || move === "previous" };
      }
      const spec = keep ? editCellText(view.state, current, at.row, at.col, text) : null;
      if (spec) this.dispatch(spec, then);
      else this.restore(then);
      if (then.edit || then.range) return;
      if (!move && keep) return; // a click elsewhere: the focus goes where it was clicked
      view.focus();
    };
    // Shift-Enter starts a new line; any other Enter keeps the text, also one pressed during
    // an IME composition, which arrives as a line break after the composition (see onInput).
    let shiftEnter = false;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Enter") shiftEnter = event.shiftKey;
      if (event.isComposing || event.keyCode === 229) return;
      const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
      if (event.key === "Enter" && plain && !event.shiftKey) {
        event.preventDefault();
        finish(true, "down");
      } else if (event.key === "Tab" && plain) {
        event.preventDefault();
        finish(true, event.shiftKey ? "previous" : "next");
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false, null);
      }
    };
    // An Enter that comes during a composition keeps the text once the composition ends, so
    // that the syllable is committed into this cell first.
    let composing = false;
    let enterAfterComposition = false;
    const onCompositionStart = (): void => {
      composing = true;
    };
    const onCompositionEnd = (): void => {
      composing = false;
      if (enterAfterComposition) {
        enterAfterComposition = false;
        setTimeout(() => finish(true, "down"));
      }
    };
    const onInput = (event: InputEvent): void => {
      if ((event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") && !shiftEnter) {
        event.preventDefault();
        if (composing || event.isComposing) enterAfterComposition = true;
        else setTimeout(() => finish(true, "down"));
      }
      shiftEnter = false;
    };
    const onBlur = (): void => finish(true, null);
    this.editing = (move) => finish(true, move);
    box.addEventListener("keydown", onKey);
    box.addEventListener("beforeinput", onInput);
    box.addEventListener("compositionstart", onCompositionStart);
    box.addEventListener("compositionend", onCompositionEnd);
    box.addEventListener("blur", onBlur);
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.placeBox();
    box.focus({ preventScroll: true });
    const selection = selectionOf(view);
    if (selection && box.isConnected) {
      const range = box.ownerDocument.createRange();
      range.selectNodeContents(box);
      if (!select) range.collapse(false);
      try {
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        // the caret stays where the focus put it
      }
    }
    return true;
  }

  /** Lay the edit box over the cell being edited, in the cell's place, size and text style. */
  private placeBox(): void {
    const box = this.box;
    const cell = box && this.editingAt && cellElementAt(this.wrap, this.editingAt.row, this.editingAt.col);
    if (!box || !cell) return;
    cell.classList.add("cm-ltem-editing-cell");
    const r = cell.getBoundingClientRect();
    const w = this.wrap.getBoundingClientRect();
    const left = r.left - w.left + this.wrap.scrollLeft;
    box.style.left = `${left}px`;
    box.style.top = `${r.top - w.top + this.wrap.scrollTop}px`;
    box.style.minWidth = `${r.width}px`;
    box.style.minHeight = `${r.height}px`;
    // It grows to the right up to the edge of the view, then down.
    box.style.maxWidth = `${Math.max(r.width, this.wrap.clientWidth + this.wrap.scrollLeft - left)}px`;
    const style = cell.ownerDocument.defaultView!.getComputedStyle(cell);
    box.style.fontWeight = style.fontWeight;
    box.style.fontStyle = style.fontStyle;
    box.style.textAlign = style.textAlign;
    box.style.padding = style.padding;
    // Opaque, as the editor's background with the cell's tint (header cells) over it.
    const ground = opaqueBackground(this.wrap);
    if (ground) box.style.backgroundColor = ground;
    box.style.backgroundImage = transparent(style.backgroundColor) ? "" : `linear-gradient(${style.backgroundColor}, ${style.backgroundColor})`;
  }

  // -- the mouse

  /** The cell being edited, if `target` is in its edit box (or with no target). */
  editingCell(target?: EventTarget | null): HTMLTableCellElement | null {
    if (!this.box || !this.editingAt) return null;
    if (target !== undefined && !(target instanceof Node && this.box.contains(target))) return null;
    return cellElementAt(this.wrap, this.editingAt.row, this.editingAt.col);
  }

  /**
   * A press on the table. A click on a cell edits it; while another cell is edited, that
   * edit is kept first. A drag over cells selects a range from the cell pressed, as in a
   * spreadsheet, also while a cell is edited and from the cell being edited (the edit is
   * kept when the drag leaves it).
   */
  mousedown(event: MouseEvent, editInPlace: boolean): void {
    if (event.target === this.keys) return;
    const inBox = this.editingCell(event.target) !== null;
    const cell = inBox ? this.editingCell() : cellOf(event.target, this.wrap);
    // In the edit box the caret goes where it is clicked; elsewhere the press is the table's.
    if (!inBox) event.preventDefault();
    if (event.button !== 0) return; // a right click opens the menu (contextmenu)
    const at = cell ? gridPosition(cell) : null;
    if (inBox && !at) return;
    if (!inBox && (!editInPlace || event.altKey || event.ctrlKey || event.metaKey || !at || !cell)) {
      this.showSource(at);
      return;
    }
    if (!at) return;
    if (event.shiftKey && !inBox) {
      // Shift-click: a range from the cell being edited, or from the range's anchor.
      if (this.editing && this.editingAt) return this.editing({ anchor: this.editingAt, head: at });
      if (this.anchor) return this.select(this.anchor, at);
    }
    const view = this.view;
    const from = view.posAtDOM(this.wrap);
    const doc = this.wrap.ownerDocument;
    let dragging = false;
    // The table's interaction now: a change made during the drag may draw the table again.
    const current = (): TableInteraction | null => (this.wrap.isConnected ? this : interactionAt(view, from));
    const onMove = (e: MouseEvent): void => {
      const table = current();
      if (!table) return;
      const target = elementAt(view, e.clientX, e.clientY);
      const over = cellOf(target, table.wrap) ?? table.editingCell(target);
      const p = over && gridPosition(over);
      if (!p || (!dragging && p.row === at.row && p.col === at.col)) return;
      if (!dragging) {
        dragging = true;
        table.wrap.classList.add("cm-ltem-dragging");
        selectionOf(view)?.removeAllRanges();
        table.editing?.(null); // keep the edit
      }
      current()?.select(at, p);
    };
    const onUp = (): void => {
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
      const table = current();
      table?.wrap.classList.remove("cm-ltem-dragging");
      if (dragging || inBox || !table) return;
      if (table.editing) return table.editing(at); // keep the edit and go on at the clicked cell
      table.clear();
      const el = table.cellEl(at.row, at.col);
      if (!el || !table.edit(el)) table.showSource(at);
    };
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
  }

  /** Show the table's source, with the cursor at cell `at`. */
  showSource(at: GridPosition | null): void {
    const from = this.view.posAtDOM(this.wrap);
    this.editing?.(null);
    this.clear();
    const info = tableOnLine(this.view.state, from);
    if (info) {
      const doc = this.view.state.doc;
      this.view.dispatch({
        selection: { anchor: sourcePosition(info, at) },
        effects: revealTableSource.of({ from: doc.lineAt(info.from).from, to: doc.lineAt(info.to).to }),
        scrollIntoView: true,
        userEvent: "select.pointer",
      });
    }
    this.view.focus();
  }
}

/** The large tables drawn in parts, by their widget's element. */
const partials = new WeakMap<HTMLElement, PartialTable>();

/** The tables drawn, by their widget's element: the widget shown in it and its interaction. */
const drawnTables = new WeakMap<HTMLElement, { widget: TableWidget; table: TableInteraction; wrap: HTMLElement }>();

/** The interaction of the table drawn at document position `from`, if it is drawn. */
function interactionAt(view: EditorView, from: number): TableInteraction | null {
  for (const wrap of Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-ltem-widget"))) {
    const drawn = drawnTables.get(wrap);
    if (drawn && wrap.isConnected && view.posAtDOM(wrap) === from) return drawn.table;
  }
  return null;
}

/** The marks put on the cells of each drawn table, to take off before marking again. */
const applied = new WeakMap<HTMLElement, { el: HTMLElement; classes: string[]; title: boolean }[]>();

/** Put the application's marks (`setLtemCellMarks`) on the cells of a drawn table. */
function applyMarks(view: EditorView, wrap: HTMLElement): void {
  for (const a of applied.get(wrap) ?? []) {
    a.el.classList.remove(...a.classes);
    if (a.title) a.el.removeAttribute("title");
  }
  applied.delete(wrap);
  const marks = view.state.field(ltemCellMarks, false);
  const info = marks?.length ? drawnTables.get(wrap)?.table.info() : null;
  if (!marks || !info) return;
  const now: { el: HTMLElement; classes: string[]; title: boolean }[] = [];
  for (const m of marks) {
    if (m.table < info.from || m.table > info.to) continue;
    const el = cellElementAt(wrap, m.row, m.col);
    if (!el) continue; // a block of a large table not drawn: marked when it is
    const classes = (m.class ?? "").split(/\s+/).filter(Boolean);
    el.classList.add(...classes);
    if (m.title !== undefined) el.title = m.title;
    now.push({ el, classes, title: m.title !== undefined });
  }
  applied.set(wrap, now);
}

class TableWidget extends WidgetType {
  constructor(
    /** The table's text, which decides whether two widgets are the same. */
    readonly key: string,
    readonly model: Table,
    readonly ctx: BuildContext,
    /** The table's HTML, for a table drawn whole. */
    readonly html: () => string,
    /** Where the table was when the widget was made. */
    readonly from: number,
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.key === this.key && other.ctx === this.ctx;
  }

  override get estimatedHeight(): number {
    return this.model.rows * 26 + 8;
  }

  toDOM(view: EditorView): HTMLElement {
    const ctx = this.ctx;
    // The frame holds the table (a box that scrolls sideways) and, at its left, outside it,
    // the handle to the source.
    const frame = document.createElement("div");
    frame.className = "cm-ltem-frame";
    const wrap = document.createElement("div");
    wrap.className = "cm-ltem-widget";
    frame.appendChild(wrap);
    const table = new TableInteraction(view, wrap, ctx.render);
    const drawn = { widget: this as TableWidget, table, wrap };
    drawnTables.set(wrap, drawn);
    drawnTables.set(frame, drawn);
    if (this.model.rows - this.model.header_rows > VIRTUAL_ROWS) {
      const partial = new PartialTable(view, this.model, ctx.render, () => table.keepRows(), () => table.redrawn(), this.from);
      table.partial = partial;
      partials.set(wrap, partial);
      wrap.appendChild(partial.element);
      requestAnimationFrame(() => partial.update());
    } else {
      wrap.innerHTML = this.html();
      const element = wrap.querySelector("table");
      if (element) {
        // A table with no header (an empty header row, specification Section 11): the
        // header row is not drawn; rows keep their numbers.
        const head = hasEmptyHeader(this.model) ? element.querySelector("thead") : null;
        if (head) {
          head.remove();
          const body = element.querySelector("tbody");
          if (body) annotate(body, this.model.header_rows);
        } else {
          annotate(element, 0);
        }
      }
    }
    if (ctx.sourceButton) {
      const button = handle("source", ctx);
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (event.button === 0) table.showSource(null);
      });
      frame.appendChild(button);
    }
    wrap.addEventListener("mousedown", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link && ctx.openLink && (event.ctrlKey || event.metaKey) && event.button === 0) {
        event.preventDefault();
        ctx.openLink(link.getAttribute("href")!, event);
        return;
      }
      table.mousedown(event, ctx.edit);
    });
    // Links in cells are opened only through `openLink`, never by the browser.
    wrap.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) event.preventDefault();
    });
    wrap.addEventListener("contextmenu", (event) => {
      // On a cell, or on the box of the cell being edited (the edit is kept first).
      const cell = cellOf(event.target, wrap) ?? table.editingCell(event.target);
      if (!ctx.edit || !cell || !view.state.facet(ltemContextMenuConfig)) return;
      event.preventDefault();
      table.menu(event, cell);
    });
    const ref = (target: EventTarget | null): LtemCellRef | null => {
      const cell = cellOf(target, wrap) ?? table.editingCell(target);
      const at = cell && gridPosition(cell);
      const info = at && table.info();
      return at && info ? { table: info.from, row: at.row, col: at.col } : null;
    };
    if (ctx.onCellHover) {
      const hover = ctx.onCellHover;
      let last: LtemCellRef | null = null;
      wrap.addEventListener("mouseover", (event) => {
        const cell = ref(event.target);
        if (cell?.row === last?.row && cell?.col === last?.col && cell?.table === last?.table) return;
        last = cell;
        hover(cell, event);
      });
      wrap.addEventListener("mouseleave", (event) => {
        if (last) hover((last = null), event);
      });
    }
    if (ctx.onCellClick) {
      const click = ctx.onCellClick;
      wrap.addEventListener("click", (event) => {
        const cell = ref(event.target);
        if (cell) click(cell, event);
      });
    }
    // Once the table is in the document (after this update): the application's marks, and
    // the edit or range of a change made on this table, brought back at once, so that no key
    // can go elsewhere in between.
    const restore = ctx.edit ? pending.get(view) : undefined;
    queueMicrotask(() => {
      if (!wrap.isConnected) return;
      applyMarks(view, wrap);
      const p = pending.get(view);
      if (!restore || p !== restore || view.posAtDOM(wrap) !== p.from) return;
      pending.delete(view);
      table.restore(p);
    });
    return frame;
  }

  /**
   * A table changed only in the texts of its cells (also by another editor of the same
   * document) is updated where it is drawn: only those cells are drawn again, and an edit or
   * a range in it stays.
   */
  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const drawn = drawnTables.get(dom);
    if (!drawn || drawn.widget.ctx !== this.ctx || !sameShape(drawn.widget.model, this.model)) return false;
    const old = drawn.widget.model;
    if (hasEmptyHeader(old) !== hasEmptyHeader(this.model)) return false; // the header row drawn or not
    this.model.cells.forEach((cell, i) => {
      if (cell.text === old.cells[i]!.text) return;
      const el = cellElementAt(drawn.wrap, cell.row, cell.col);
      if (el) el.innerHTML = cellContent(cell.text, this.ctx.render);
    });
    partials.get(drawn.wrap)?.setModel(this.model);
    drawn.widget = this;
    queueMicrotask(() => {
      if (!dom.isConnected) return;
      applyMarks(view, drawn.wrap);
      // The edit or range of a change made on this table (by the table menu, for one).
      const p = this.ctx.edit ? pending.get(view) : undefined;
      if (p && view.posAtDOM(dom) === p.from) {
        pending.delete(view);
        drawn.table.restore(p);
      }
    });
    return true;
  }

  override destroy(dom: HTMLElement): void {
    partials.get(drawnTables.get(dom)?.wrap ?? dom)?.destroy();
  }

  override ignoreEvent(): boolean {
    // The widget handles its own events (clicks, keys, typing in a cell being edited).
    return true;
  }
}

interface BuildContext {
  render: InlineRenderer;
  edit: boolean;
  openLink: LtemWidgetOptions["openLink"];
  revealSource: "cursor" | "altClick";
  onCellHover: LtemWidgetOptions["onCellHover"];
  onCellClick: LtemWidgetOptions["onCellClick"];
  sourceButton: boolean;
  label: (id: LtemWidgetMessage) => string;
  cache: TextCache<string>;
}

/** The decorations of a table node: its widget, or none while its source is shown. */
function decorationsFor(state: EditorState, ctx: BuildContext, node: SyntaxNode): Range<Decoration>[] {
  const from = state.doc.lineAt(node.from).from;
  const to = state.doc.lineAt(node.to).to;
  // The table being edited keeps its source (its handle is drawn by `sourceHandles`); it is
  // not even analysed.
  if (state.selection.ranges.some((r) => r.to >= from && r.from <= to) && (ctx.revealSource !== "altClick" || isRevealed(state, from, to))) return [];
  const widget = widgetFor(state, ctx, node, from, to);
  return widget ? [widget] : [];
}

/** The widget for a table node, or null if it is no table. */
function widgetFor(state: EditorState, ctx: BuildContext, node: SyntaxNode, from: number, to: number): Range<Decoration> | null {
  const table = tableFromNode(state, node);
  if (!table) return null;
  const key = table.analysis.lines.join("\n");
  const model = table.analysis.table;
  const html = (): string => {
    let out = ctx.cache.get(key);
    if (out === undefined) {
      out = renderHtml(model, ctx.render);
      ctx.cache.set(key, out, out.length);
    }
    return out;
  };
  const widget = new TableWidget(key, model, ctx, html, from);
  return Decoration.replace({ widget, block: true }).range(from, to);
}

/** The widgets of all tables of the document. */
function buildAll(state: EditorState, ctx: BuildContext): DecorationSet {
  return rebuild(state, ctx, Decoration.none, [{ from: 0, to: state.doc.length }]);
}

/**
 * The widgets again for the tables in some regions of the document, those elsewhere kept
 * as they are: a change or a cursor move looks only at the blocks it touched, so that it
 * costs the same in a document of any size.
 */
function rebuild(state: EditorState, ctx: BuildContext, decorations: DecorationSet, regions: { from: number; to: number }[]): DecorationSet {
  if (!regions.length) return decorations;
  const add: Range<Decoration>[] = [];
  const seen = new Set<number>();
  const tree = syntaxTree(state);
  // The tables found are made again whole: their old decorations go, also those outside the regions.
  const covered = [...regions];
  for (const region of regions) {
    tree.iterate({ from: region.from, to: region.to, enter(n) {
      if (n.name !== NODE.table) return holdsTables(n.type);
      if (!seen.has(n.from)) {
        seen.add(n.from);
        covered.push({ from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to });
        add.push(...decorationsFor(state, ctx, n.node));
      }
      return false;
    } });
  }
  return decorations.update({ filter: (from, to) => !covered.some((r) => from <= r.to && to >= r.from), add, sort: true });
}

/** The top-level block (or the line) around a position. */
function blockAround(state: EditorState, pos: number): { from: number; to: number } {
  const line = state.doc.lineAt(pos);
  let node: SyntaxNode | null = syntaxTree(state).resolve(pos, 1);
  while (node && node.parent && !node.parent.type.isTop) node = node.parent;
  return node && !node.type.isTop ? { from: Math.min(node.from, line.from), to: Math.max(node.to, line.to) } : { from: line.from, to: line.to };
}

/** Characters of code fences, HTML blocks and front matter, which can change what the text after them is. */
const OPENS_BLOCKS = /[`~<>$]|^-{3}|\n-{3}/;

/** Whether the block at a position is one that can reach over what follows it (a code fence or HTML block). */
function spansBlocks(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolve(pos, 1); node; node = node.parent) {
    if (/^(FencedCode|HTMLBlock|CommentBlock|ProcessingInstructionBlock|FrontMatter)$/.test(node.name)) return true;
  }
  return false;
}

/** The lines of a state's selection. */
export function selectionLines(state: EditorState): { from: number; to: number }[] {
  return state.selection.ranges.map((r) => ({ from: state.doc.lineAt(r.from).from, to: state.doc.lineAt(r.to).to }));
}

/**
 * The regions of the new document where block decorations (such as table widgets) may
 * have to change after a transaction that changed the document: the top-level blocks the
 * changes touched, the lines of the selection before and after, and, when a code fence or
 * an HTML block changed (which can change what all the text after it is), the rest of the
 * document from there.
 */
export function changedRegions(tr: Transaction): { from: number; to: number }[] {
  const regions: { from: number; to: number }[] = [];
  let rest = -1;
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const a = blockAround(tr.state, fromB);
    const b = blockAround(tr.state, toB);
    regions.push({ from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) });
    const wide = OPENS_BLOCKS.test(tr.startState.doc.sliceString(fromA, toA)) || OPENS_BLOCKS.test(inserted.toString())
      || spansBlocks(tr.startState, fromA) || spansBlocks(tr.state, fromB);
    if (wide && (rest < 0 || fromB < rest)) rest = Math.min(a.from, b.from);
  });
  if (rest >= 0) regions.push({ from: rest, to: tr.state.doc.length });
  for (const r of selectionLines(tr.startState)) regions.push({ from: tr.changes.mapPos(r.from, -1), to: tr.changes.mapPos(r.to, 1) });
  regions.push(...selectionLines(tr.state));
  return regions;
}

/**
 * The tables the selection touches (their starts), which are shown as source. Found from
 * the selection's own lines, so moving the cursor costs the same in a document of any size.
 */
function touched(state: EditorState): number[] {
  const out: number[] = [];
  const tree = syntaxTree(state);
  for (const r of state.selection.ranges) {
    const from = state.doc.lineAt(r.from).from;
    const to = state.doc.lineAt(r.to).to;
    tree.iterate({ from, to, enter(n) {
      if (n.name !== NODE.table) return holdsTables(n.type);
      const start = state.doc.lineAt(n.from).from;
      if (r.to >= start && r.from <= state.doc.lineAt(n.to).to && !out.includes(start)) out.push(start);
      return false;
    } });
  }
  return out.sort((a, b) => a - b);
}

/** The first lines of the tables shown as source: those the cursor is in (and revealed, with "altClick"). */
function sourceTables(state: EditorState, ctx: BuildContext): number[] {
  return touched(state).filter((start) => ctx.revealSource !== "altClick" || isRevealed(state, start, start));
}

/** The handle back to the table at the left of a table's source: where it is drawn. */
class SourceHandle implements LayerMarker {
  constructor(readonly ctx: BuildContext, readonly view: EditorView, readonly from: number, readonly left: number, readonly top: number) {}

  eq(other: LayerMarker): boolean {
    return other instanceof SourceHandle && other.from === this.from && other.left === this.left && other.top === this.top && other.ctx === this.ctx;
  }

  draw(): HTMLElement {
    const button = handle("table", this.ctx);
    button.style.left = `${this.left}px`;
    button.style.top = `${this.top}px`;
    const view = this.view;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) return;
      const info = tableOnLine(view.state, view.state.doc.lineAt(Math.min(this.from, view.state.doc.length)).from);
      if (!info) return;
      const doc = view.state.doc;
      const from = doc.lineAt(info.from).from;
      const to = doc.lineAt(info.to).to;
      if (this.ctx.revealSource === "altClick") {
        view.dispatch({ effects: concealTableSource.of({ from, to }) });
      } else {
        // The cursor leaves the table: after it, or before it.
        const anchor = to < doc.length ? to + 1 : from > 0 ? from - 1 : null;
        if (anchor !== null) view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent: "select" });
      }
      view.focus();
    });
    return button;
  }
}

/**
 * The handles back to the table at the left of tables shown as source, in a layer over the
 * editor (not in the text, so that the cursor and IME input are not disturbed), at the
 * same place as the handle of the table shown as a table.
 */
function sourceHandles(ctx: BuildContext): Extension {
  return layer({
    above: true,
    class: "cm-ltem-handle-layer",
    update: (update) => update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged
      || update.state.field(revealedTables, false) !== update.startState.field(revealedTables, false),
    markers(view) {
      const starts = sourceTables(view.state, ctx).filter((start) => view.visibleRanges.some((r) => start >= r.from && start <= r.to));
      if (!starts.length) return [];
      const scroller = view.scrollDOM.getBoundingClientRect();
      const baseLeft = scroller.left - view.scrollDOM.scrollLeft;
      const baseTop = scroller.top - view.scrollDOM.scrollTop;
      const content = view.contentDOM.getBoundingClientRect();
      const gutter = parseFloat(getComputedStyle(view.contentDOM).getPropertyValue("--cm-ltem-gutter")) || GUTTER;
      const out: LayerMarker[] = [];
      for (const start of starts) {
        const line = view.coordsAtPos(start, 1);
        if (!line) continue;
        const top = line.top - baseTop + Math.max(0, (line.bottom - line.top - HANDLE) / 2);
        out.push(new SourceHandle(ctx, view, start, content.left - baseLeft + gutter - HANDLE - 2, Math.round(top)));
      }
      return out;
    },
  });
}

/** The room at the left of tables for their handles (the default of `--cm-ltem-gutter`), and a handle's size. */
const GUTTER = 22;
const HANDLE = 18;

/** Show LTEM tables as tables when the cursor is not in them, and edit them there. */
export function ltemTableWidgets(options: LtemWidgetOptions = {}): Extension {
  const ctx: BuildContext = {
    render: options.renderInline ?? plainInline,
    edit: options.editInPlace ?? true,
    openLink: options.openLink,
    revealSource: options.revealSource ?? "cursor",
    onCellHover: options.onCellHover,
    onCellClick: options.onCellClick,
    sourceButton: options.sourceButton ?? true,
    label: (id) => (typeof options.messages === "function" ? options.messages(id) : WIDGET_LABELS[options.messages ?? "en"][id]),
    cache: new TextCache<string>(500, 4_000_000),
  };
  // The tables shown as source: those the cursor is in (and revealed, with "altClick").
  const sources = (state: EditorState): number[] => sourceTables(state, ctx);
  const widgets = StateField.define<DecorationSet>({
    create: (state) => buildAll(state, ctx),
    update(decorations, tr) {
      if (tr.docChanged) return rebuild(tr.state, ctx, decorations.map(tr.changes), changedRegions(tr));
      if (syntaxTree(tr.state) !== syntaxTree(tr.startState)) return buildAll(tr.state, ctx);
      if (tr.selection || tr.state.field(revealedTables, false) !== tr.startState.field(revealedTables, false)) {
        // A cursor move that enters or leaves no table changes nothing.
        const before = sources(tr.startState);
        const after = sources(tr.state);
        if (before.length === after.length && before.every((x, i) => x === after[i])) return decorations;
        return rebuild(tr.state, ctx, decorations, [...selectionLines(tr.startState), ...selectionLines(tr.state)]);
      }
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  // Marks changed by the application: put on the tables drawn now.
  const marks = ViewPlugin.define((view) => ({
    update(update: ViewUpdate) {
      if (update.state.field(ltemCellMarks, false) === update.startState.field(ltemCellMarks, false)) return;
      for (const wrap of Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".cm-ltem-widget"))) {
        if (drawnTables.has(wrap)) applyMarks(view, wrap);
      }
    },
  }));
  return [
    revealedTables, ltemCellMarks, widgets, marks,
    ctx.sourceButton ? [sourceHandles(ctx), EditorView.editorAttributes.of({ class: "cm-ltem-handles" })] : [],
  ];
}
