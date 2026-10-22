/**
 * Converting HTML tables to LTEM table models.
 *
 * The grid is formed as in the HTML table model: row groups are shown with the first
 * `<thead>` first and the first `<tfoot>` last, cells take the next free position,
 * `rowspan="0"` reaches the end of its row group, and spans stop at the end of their row
 * group. Span values are read with HTML's rules for non-negative integers. Cell content
 * becomes inline Markdown.
 *
 * The converter follows the Python implementation of LTEM exactly, including how it reads
 * malformed HTML. It needs no DOM. Its parts:
 *
 * - `tokenizer`: HTML tokens, as Python's `html.parser` reads them
 * - `charref`, `entities`: character references
 * - `tree`: a forgiving tree builder that closes table elements implicitly
 * - `inline`: cell content to inline Markdown
 * - this module: rows, header rows, spans and alignment
 */

import { MODEL_VERSION, type Alignment, type Cell, type Table } from "../model.js";
import { strip } from "../pychar.js";
import { write } from "../writer.js";
import { cellText } from "./inline.js";
import { cellsOf, findAll, GROUP, parseHtml, type HtmlNode } from "./tree.js";

/** Colspans larger than this are cut to it (as in the HTML table model). */
const MAX_COLSPAN = 1000;
/** Rowspans larger than this are cut to it (as in the HTML table model). */
const MAX_ROWSPAN = 65534;

/** Options for `fromHtml` and `htmlToLtem`. */
export interface FromHtmlOptions {
  /**
   * The number of header rows. By default it is the number of rows in the first
   * `<thead>`; without one (or if it is empty), the number of leading rows made only of
   * `<th>` cells; and if there are none, 1 (with a warning). It is kept between 1 and the
   * number of rows. With 0, the table has no header: it gets one header row of empty
   * cells and every HTML row becomes a body row (spec Section 11). A header cell whose
   * rowspan reaches into the body is cut at the last header row, with a warning; no other
   * cell moves.
   */
  headerRows?: number | null;
  /**
   * How cell content is converted: "markdown" (the default) keeps emphasis, code, links,
   * images, `<sup>` and `<sub>` as inline Markdown; "plain" keeps the text only (an image
   * keeps its `alt` text). Either way, text is escaped so that Markdown reads it literally.
   */
  inline?: "markdown" | "plain";
}

/** A converted table and the notes produced while converting it. */
export interface HtmlTable {
  table: Table;
  /** What was changed or lost, such as a span cut to avoid an overlap. */
  warnings: string[];
}

/**
 * Row groups in display order, as in the HTML table model.
 *
 * The first `<thead>` comes first and the first `<tfoot>` last. Every other group,
 * including a later `<thead>` or `<tfoot>` and each run of rows outside any group, keeps
 * its place in the document as a body group.
 */
function rowsByGroup(table: HtmlNode): [string, HtmlNode[]][] {
  const noTables = new Set(["table"]);
  let head: HtmlNode[] | null = null;
  let foot: HtmlNode[] | null = null;
  const body: [string, HtmlNode[]][] = [];
  let loose: HtmlNode[] = [];
  const endLoose = (): void => {
    if (loose.length) body.push(["tbody", loose]);
    loose = [];
  };
  for (const child of table.children) {
    if (typeof child === "string") continue;
    if (GROUP.has(child.tag)) {
      endLoose();
      const rows = findAll(child, "tr", noTables);
      if (child.tag === "thead" && head === null) head = rows;
      else if (child.tag === "tfoot" && foot === null) foot = rows;
      else body.push(["tbody", rows]);
    } else if (child.tag === "tr") {
      loose.push(child);
    } else if (child.tag !== "caption" && child.tag !== "colgroup" && child.tag !== "col") {
      loose.push(...findAll(child, "tr", noTables));
    }
  }
  endLoose();
  return [
    ...(head !== null ? [["thead", head] as [string, HtmlNode[]]] : []),
    ...body,
    ...(foot !== null ? [["tfoot", foot] as [string, HtmlNode[]]] : []),
  ];
}

/**
 * HTML's rules for parsing non-negative integers: leading ASCII whitespace, an optional
 * sign, then ASCII digits up to the first other character. Null on error (no digits, or
 * a negative value other than zero).
 */
function nonNegative(value: string | undefined): number | null {
  let s = (value ?? "").replace(/^[ \t\n\f\r]+/, "");
  const negative = s.startsWith("-");
  if (s.startsWith("-") || s.startsWith("+")) s = s.slice(1);
  const digits = /^[0-9]+/.exec(s);
  if (digits === null) return null;
  const n = Number.parseInt(digits[0], 10); // may lose precision far above the span limits
  return negative && n !== 0 ? null : n;
}

/** A `colspan` value: 1 on error or 0, at most 1000. */
function colspanValue(value: string | undefined): number {
  const n = nonNegative(value);
  return !n ? 1 : Math.min(n, MAX_COLSPAN);
}

/** A `rowspan` value: 1 on error, at most 65534; 0 means "to the end of the row group". */
function rowspanValue(value: string | undefined): number {
  const n = nonNegative(value);
  return n === null ? 1 : Math.min(n, MAX_ROWSPAN);
}

/** `text-align\s*:\s*(left|center|right)`, matched as ASCII and ignoring case. */
const TEXT_ALIGN = /text-align[ \t\n\r\f\v]*:[ \t\n\r\f\v]*(left|center|right)/i;

/** The alignment of a cell, from its `align` attribute or `text-align` style. */
function alignment(td: HtmlNode): Alignment {
  const a = strip(td.attrs.get("align") ?? "").toLowerCase();
  if (a === "left" || a === "center" || a === "right") return a;
  const m = TEXT_ALIGN.exec(td.attrs.get("style") ?? "");
  return m ? (m[1].toLowerCase() as Alignment) : null;
}

/** Positions of the grid that a cell already covers. */
class Occupied {
  private readonly rows: Set<number>[] = [];

  has(r: number, c: number): boolean {
    return this.rows[r]?.has(c) ?? false;
  }

  add(r: number, c: number): void {
    (this.rows[r] ??= new Set()).add(c);
  }

  delete(r: number, c: number): void {
    this.rows[r]?.delete(c);
  }
}

function convert(tableNode: HtmlNode, headerRowsOption: number | null, plain: boolean): HtmlTable | null {
  const warnings: string[] = [];
  // headerRows 0: the table has no header. LTEM 1.0 needs one, so it gets a header row of
  // empty cells and every HTML row becomes a body row (spec Section 11).
  const headerless = headerRowsOption === 0;
  const rows: HtmlNode[][] = [];
  const groupEnd: number[] = []; // for each row, the index just past its row group
  let theadRows = 0;
  for (const [tag, trs] of rowsByGroup(tableNode)) {
    const start = rows.length;
    for (const tr of trs) rows.push(cellsOf(tr));
    for (let r = start; r < rows.length; r++) groupEnd.push(rows.length);
    if (tag === "thead") theadRows = rows.length - start; // only the first <thead> is a header group
  }
  if (!rows.length) return null;

  let headerRows: number;
  if (headerRowsOption !== null) {
    headerRows = headerRowsOption;
  } else if (theadRows) {
    headerRows = theadRows;
  } else {
    headerRows = 0;
    while (headerRows < rows.length && rows[headerRows].length
           && rows[headerRows].every((c) => c.tag === "th")) {
      headerRows++;
    }
    if (headerRows === 0) {
      headerRows = 1;
      warnings.push("the HTML table has no header row; its first row is used as the header");
    }
  }
  headerRows = headerless ? 0 : Math.max(1, Math.min(headerRows, rows.length));

  // Place the cells as the HTML table model does.
  const occupied = new Occupied();
  const placed: [r: number, c: number, rowspan: number, colspan: number, td: HtmlNode][] = [];
  rows.forEach((cells, r) => {
    let c = 0;
    for (const td of cells) {
      while (occupied.has(r, c)) c++;
      let colspan = colspanValue(td.attrs.get("colspan"));
      let rowspan = rowspanValue(td.attrs.get("rowspan"));
      const end = groupEnd[r];
      rowspan = rowspan === 0 ? end - r : Math.min(rowspan, end - r);
      // Cut a colspan that would run into a cell spanning down from above.
      let k = 1;
      while (k < colspan && !occupied.has(r, c + k)) k++;
      if (k < colspan) {
        warnings.push(`a colspan in row ${r} was cut to avoid overlapping a rowspan`);
        colspan = k;
      }
      let j = 1;
      const rowFree = (rr: number): boolean => {
        for (let d = 0; d < colspan; d++) if (occupied.has(rr, c + d)) return false;
        return true;
      };
      while (j < rowspan && rowFree(r + j)) j++;
      if (j < rowspan) {
        warnings.push(`a rowspan in row ${r} was cut to avoid overlapping another cell`);
        rowspan = j;
      }
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) occupied.add(r + dr, c + dc);
      placed.push([r, c, rowspan, colspan, td]);
      c += colspan;
    }
  });
  // A header cell must not reach into the body (spec V7). Its rowspan is cut at the last
  // header row after placement, so no cell moves; the body positions it covered become
  // empty cells.
  placed.forEach(([r, c, rowspan, colspan, td], i) => {
    if (r < headerRows && headerRows < r + rowspan) {
      for (let dr = headerRows; dr < r + rowspan; dr++) for (let dc = c; dc < c + colspan; dc++) occupied.delete(dr, dc);
      placed[i] = [r, c, headerRows - r, colspan, td];
      warnings.push(`a rowspan in row ${r} was cut at the end of the header rows; `
                    + "header cells do not reach into the body");
    }
  });
  let cols = placed.length ? 0 : 1;
  for (const [, c, , cs] of placed) cols = Math.max(cols, c + cs);

  const rowHeaders = placed.filter(([r, , , , td]) => td.tag === "th" && r >= headerRows).length;
  if (rowHeaders) {
    warnings.push(`${rowHeaders} header cells (<th>) outside the header rows became ordinary cells; `
                  + "LTEM 1.0 has no row headers");
  }

  let cells: Cell[] = placed.map(([r, c, rowspan, colspan, td]) => ({
    row: r, col: c, rowspan, colspan, text: cellText(td, warnings, plain),
  }));
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occupied.has(r, c)) cells.push({ row: r, col: c, rowspan: 1, colspan: 1, text: "" });
    }
  }
  if (headerless) {
    cells = [
      ...Array.from({ length: cols }, (_, c): Cell => ({ row: 0, col: c, rowspan: 1, colspan: 1, text: "" })),
      ...cells.map((x) => ({ ...x, row: x.row + 1 })),
    ];
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col);

  // A column's alignment is the one all its origin cells agree on.
  const byOrigin = new Map<number, Set<Alignment>>();
  for (const [, c, , , td] of placed) {
    let values = byOrigin.get(c);
    if (values === undefined) byOrigin.set(c, (values = new Set()));
    values.add(alignment(td));
  }
  const align = Array.from({ length: cols }, (_, c): Alignment => {
    const values = byOrigin.get(c) ?? new Set<Alignment>([null]);
    return values.size === 1 ? [...values][0] : null;
  });
  const table: Table = {
    version: MODEL_VERSION,
    rows: headerless ? rows.length + 1 : rows.length,
    cols,
    header_rows: headerless ? 1 : headerRows,
    align,
    cells,
  };
  return { table, warnings };
}

function checkOptions(options: FromHtmlOptions): { headerRows: number | null; plain: boolean } {
  const inline = options.inline ?? "markdown";
  if (inline !== "markdown" && inline !== "plain") {
    throw new RangeError(`inline must be "markdown" or "plain", not ${JSON.stringify(inline)}`);
  }
  const headerRows = options.headerRows ?? null;
  if (headerRows !== null && !Number.isInteger(headerRows)) {
    throw new TypeError(`headerRows must be an integer, not ${String(headerRows)}`);
  }
  return { headerRows, plain: inline === "plain" };
}

/**
 * Convert every top-level `<table>` in an HTML string to a table model.
 *
 * Nested tables are flattened into the text of their cell, with a warning.
 */
export function fromHtml(html: string, options: FromHtmlOptions = {}): HtmlTable[] {
  const { headerRows, plain } = checkOptions(options);
  const root = parseHtml(html);
  const out: HtmlTable[] = [];
  for (const node of findAll(root, "table", new Set(["table"]))) {
    const converted = convert(node, headerRows, plain);
    if (converted !== null) out.push(converted);
  }
  return out;
}

/** Convert every top-level `<table>` in an HTML string to canonical LTEM, separated by blank lines. */
export function htmlToLtem(html: string, options: FromHtmlOptions = {}): string {
  return fromHtml(html, options).map((t) => write(t.table)).join("\n\n");
}
