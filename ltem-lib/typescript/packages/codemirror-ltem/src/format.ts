/** Writing a table in canonical form with its columns lined up. */

import { write, type Table } from "ltem-core";

import { cellSegments } from "./analysis.js";

/**
 * Display width of a string in a monospace font: 2 for wide East Asian characters
 * (Hangul, CJK, full-width forms, most emoji), 0 for combining marks, 1 otherwise.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0x20 && cp < 0x7f) {
      width++;
      continue;
    }
    if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        cp = (cp - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i++;
      }
    }
    width += charWidth(cp);
  }
  return width;
}

function charWidth(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x20d0 && cp <= 0x20ff)
      || (cp >= 0xfe20 && cp <= 0xfe2f) || cp === 0x200b || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if ((cp >= 0x1160 && cp <= 0x11ff) || (cp >= 0xd7b0 && cp <= 0xd7ff)) return 0; // Hangul medial and final jamo
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff)
      || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf)
      || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
      || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x20000 && cp <= 0x3fffd)) {
    return 2;
  }
  return 1;
}

/**
 * Write a table in the canonical form (spec Section 8) and pad the cells so that the
 * pipes of every row line up. Padding is only spaces around cell text, so the table reads
 * the same; only the exact canonical text differs.
 */
export function writeAligned(table: Table): string {
  return alignedLines(table).join("\n");
}

/**
 * The lines of `writeAligned`. They are grid rows: line `r` holds the cells of row `r`, and
 * the delimiter row comes after the header rows, so cell (row, col) is cell `col` of line
 * `row` (header) or `row + 1` (body).
 */
export function alignedLines(table: Table): string[] {
  return alignTable(table).lines;
}

/** The lines of `writeAligned`, and the text of each cell of each line before padding. */
export function alignTable(table: Table): { lines: string[]; cells: string[][] } {
  const lines = write(table).split("\n");
  const delimiter = table.header_rows;
  // Only spaces and tabs are trimmed, as the core trims cells (spec 2.1); other spaces are text.
  const rows = lines.map((line) => cellSegments(line).map((s) => line.slice(s.from, s.to).replace(/^[ \t]+|[ \t]+$/g, "")));
  const sizes = rows.map((cells, r) => (r === delimiter ? [] : cells.map(displayWidth)));
  const widths: number[] = new Array(table.cols).fill(3);
  for (const row of sizes) {
    for (let c = 0; c < row.length; c++) if (row[c] > widths[c]) widths[c] = row[c];
  }
  const out = rows.map((cells, r) => {
    const padded = cells.map((text, c) => r === delimiter
      ? delimiterCell(table.align[c], widths[c])
      : text + " ".repeat(Math.max(0, widths[c] - sizes[r][c])));
    return `| ${padded.join(" | ")} |`;
  });
  return { lines: out, cells: rows };
}

/**
 * The lines of a table with its pipes lined up, from the lines as written: only the spaces
 * around cell texts, the outer pipes and the number of dashes in the delimiter row change,
 * so the table reads the same however it is written (span attributes, escapes, problems).
 * Null unless every line has as many cells as the delimiter row: compact rows, and rows
 * with too few or too many cells, cannot be lined up by their cells.
 */
export function alignText(lines: readonly string[], delimiter: number): string[] | null {
  const rows = lines.map((line) => cellSegments(line).map((s) => line.slice(s.from, s.to).replace(/^[ \t]+|[ \t]+$/g, "")));
  const cols = rows[delimiter]?.length ?? 0;
  if (!cols || rows.some((cells) => cells.length !== cols)) return null;
  const align: Table["align"] = [];
  for (const cell of rows[delimiter]) {
    const m = /^(:?)-+(:?)$/.exec(cell);
    if (!m) return null;
    align.push(m[1] && m[2] ? "center" : m[1] ? "left" : m[2] ? "right" : null);
  }
  const sizes = rows.map((cells, r) => (r === delimiter ? [] : cells.map(displayWidth)));
  const widths: number[] = new Array(cols).fill(3);
  for (const row of sizes) {
    for (let c = 0; c < row.length; c++) if (row[c] > widths[c]) widths[c] = row[c];
  }
  return rows.map((cells, r) => {
    const padded = cells.map((text, c) => r === delimiter
      ? delimiterCell(align[c], widths[c])
      : text + " ".repeat(widths[c] - sizes[r][c]));
    return `| ${padded.join(" | ")} |`;
  });
}

function delimiterCell(align: Table["align"][number], width: number): string {
  switch (align) {
    case "left": return ":" + "-".repeat(width - 1);
    case "right": return "-".repeat(width - 1) + ":";
    case "center": return ":" + "-".repeat(width - 2) + ":";
    default: return "-".repeat(width);
  }
}
