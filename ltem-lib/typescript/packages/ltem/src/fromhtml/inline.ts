/** Cell content: HTML elements to inline Markdown, one line per line break. */

import { isAlnum, isAlpha, isSpace, lstrip, rstrip, strip } from "../pychar.js";
import { CELL, findAll, textContent, type HtmlNode } from "./tree.js";

/** Elements that start a new line. */
const BLOCK = new Set(["p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre",
  "section", "article", "header", "footer", "dl", "dt", "dd", "figure", "figcaption", "table"]);
/** Formatting elements that give their text only in plain mode. */
const PLAIN_TEXT = new Set(["strong", "b", "em", "i", "s", "del", "strike", "a", "sup", "sub"]);

// HTML collapses ASCII whitespace only; other spaces such as U+3000 are content (spec 2.1).
const ASCII_SPACES = /[ \t\n\f\r]+/g;

/** Replace each run of ASCII whitespace by one space. */
function collapseAsciiSpaces(s: string): string {
  return s.replace(ASCII_SPACES, " ");
}

function isAsciiSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
}

/** Remove leading and trailing ASCII whitespace (`str.strip(" \t\n\f\r")`). */
function stripAscii(s: string): string {
  let i = 0;
  let j = s.length;
  while (i < j && isAsciiSpace(s.charCodeAt(i))) i++;
  while (j > i && isAsciiSpace(s.charCodeAt(j - 1))) j--;
  return s.slice(i, j);
}

/** `&` followed by what CommonMark reads as a character reference. */
const CHAR_REFERENCE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/y;

/** Escape text so that CommonMark reads it literally and LTEM sees no line break. */
export function escapeText(s: string): string {
  const chars = Array.from(s);
  let out = "";
  let at = 0; // UTF-16 index of chars[i]
  for (let i = 0; i < chars.length; at += chars[i].length, i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    const prev = chars[i - 1];
    const nextCp = next?.codePointAt(0);
    const prevCp = prev?.codePointAt(0);
    if (ch === "\\") {
      // A backslash before punctuation would be an escape, and "\\" an LTEM line break.
      // At the end of the text, what follows is not known yet (cellText undoes this at the
      // end of a line).
      out += nextCp === undefined || (!isAlnum(nextCp) && !isSpace(nextCp)) ? "&#92;" : "\\";
    } else if (ch === "*" || ch === "`" || ch === "[" || ch === "]") {
      out += "\\" + ch;
    } else if (ch === "_" && !(prevCp !== undefined && isAlnum(prevCp) && nextCp !== undefined && isAlnum(nextCp))) {
      out += "\\_";
    } else if (ch === "<" && nextCp !== undefined && (isAlpha(nextCp) || next === "/" || next === "!" || next === "?")) {
      out += "\\<";
    } else if (ch === "&") {
      CHAR_REFERENCE.lastIndex = at;
      out += CHAR_REFERENCE.test(s) ? "\\&" : "&";
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Put `mark` around the text, outside its leading and trailing whitespace.
 *
 * Unicode whitespace (U+3000 too) goes outside the marks, because CommonMark does not
 * open or close emphasis next to it; the whitespace itself is kept.
 */
function wrap(mark: string, text: string): string {
  const stripped = strip(text);
  if (!stripped) return text;
  const lead = text.slice(0, text.length - lstrip(text).length);
  const trail = text.slice(rstrip(text).length);
  return `${lead}${mark}${stripped}${mark}${trail}`;
}

/** What to do with the inline Markdown of an element once it is complete. */
type Wrap =
  | { kind: "plain" }
  | { kind: "block" }
  | { kind: "item"; bullet: string }
  | { kind: "mark"; mark: string }
  | { kind: "link"; href: string }
  | { kind: "tag"; tag: string };

/** The inline Markdown of an element, being built. */
interface ElementFrame {
  type: "element";
  node: HtmlNode;
  next: number;
  /** List items among the children visited so far. */
  items: number;
  out: string;
  wrap: Wrap;
}

/** A table inside a cell, being flattened to one line per row. */
interface TableFrame {
  type: "table";
  rows: HtmlNode[][];
  row: number;
  col: number;
  cells: string[];
  lines: string[];
}

function elementFrame(node: HtmlNode, wrapping: Wrap): ElementFrame {
  return { type: "element", node, next: 0, items: 0, out: "", wrap: wrapping };
}

function finish(f: ElementFrame): string {
  const w = f.wrap;
  switch (w.kind) {
    case "plain": return f.out;
    case "block": return `\n${f.out}\n`;
    case "item": return `\n${w.bullet}${stripAscii(f.out)}\n`;
    case "mark": return wrap(w.mark, f.out);
    case "link": return `[${stripAscii(f.out)}](${destination(w.href)})`;
    case "tag": return `<${w.tag}>${stripAscii(f.out)}</${w.tag}>`;
  }
}

/**
 * Inline Markdown for the children of `node`. Line breaks are "\n". With `plain`,
 * formatting elements give their text only, escaped so that it reads literally.
 *
 * The elements are visited with an explicit stack, so deep nesting is safe.
 */
function inline(node: HtmlNode, warnings: string[], plain: boolean): string {
  const stack: (ElementFrame | TableFrame)[] = [elementFrame(node, { kind: "plain" })];
  for (;;) {
    const top = stack[stack.length - 1];
    if (top.type === "table") {
      const cells = top.rows[top.row];
      if (cells === undefined) {
        stack.pop();
        const parent = stack[stack.length - 1] as ElementFrame; // a table frame sits on an element frame
        parent.out += `\n${top.lines.join("\n")}\n`;
      } else if (top.col < cells.length) {
        stack.push(elementFrame(cells[top.col], { kind: "plain" }));
      } else {
        top.lines.push(top.cells.join("; "));
        top.cells = [];
        top.row++;
        top.col = 0;
      }
      continue;
    }
    const child = top.node.children[top.next];
    if (child === undefined) {
      stack.pop();
      const done = finish(top);
      const parent = stack[stack.length - 1];
      if (parent === undefined) return done;
      if (parent.type === "element") {
        parent.out += done;
      } else {
        parent.cells.push(stripAscii(done.replaceAll("\n", " ")));
        parent.col++;
      }
      continue;
    }
    top.next++;
    if (typeof child === "string") {
      top.out += escapeText(collapseAsciiSpaces(child));
      continue;
    }
    const tag = child.tag;
    if (tag === "br") {
      top.out += "\n";
    } else if (tag === "table") {
      warnings.push("a table inside a cell was flattened to text (not supported in LTEM 1.0)");
      const rows = findAll(child, "tr").map((tr) =>
        tr.children.filter((c): c is HtmlNode => typeof c !== "string" && CELL.has(c.tag)));
      stack.push({ type: "table", rows, row: 0, col: 0, cells: [], lines: [] });
    } else if (tag === "li") {
      top.items++;
      const bullet = top.node.tag === "ol" ? `${top.items}. ` : "- ";
      stack.push(elementFrame(child, { kind: "item", bullet }));
    } else if (BLOCK.has(tag)) {
      stack.push(elementFrame(child, { kind: "block" }));
    } else if (plain && PLAIN_TEXT.has(tag)) {
      stack.push(elementFrame(child, { kind: "plain" }));
    } else if (plain && tag === "code") {
      top.out += escapeText(textContent(child));
    } else if (plain && tag === "img") {
      top.out += escapeText(child.attrs.get("alt") ?? "");
    } else if (tag === "strong" || tag === "b") {
      stack.push(elementFrame(child, { kind: "mark", mark: "**" }));
    } else if (tag === "em" || tag === "i") {
      stack.push(elementFrame(child, { kind: "mark", mark: "*" }));
    } else if (tag === "s" || tag === "del" || tag === "strike") {
      stack.push(elementFrame(child, { kind: "mark", mark: "~~" }));
    } else if (tag === "code") {
      const text = textContent(child);
      if (text.includes("\\\\")) {
        // A code span cannot escape a backslash, and LTEM 1.0 reads "\\" as a line break.
        warnings.push("a code span with two backslashes in a row became plain text; "
                      + "LTEM 1.0 cell text cannot hold \\\\");
        top.out += escapeText(text);
      } else if (text) {
        const fence = text.includes("`") ? "``" : "`";
        top.out += `${fence}${text}${fence}`;
      }
    } else if (tag === "a" && child.attrs.get("href")) {
      stack.push(elementFrame(child, { kind: "link", href: child.attrs.get("href")! }));
    } else if (tag === "img") {
      top.out += `![${escapeText(child.attrs.get("alt") ?? "")}](${destination(child.attrs.get("src") ?? "")})`;
    } else if (tag === "sup" || tag === "sub") {
      stack.push(elementFrame(child, { kind: "tag", tag }));
    } else {
      stack.push(elementFrame(child, { kind: "plain" }));
    }
  }
}

/** Model text of a cell: inline Markdown, one line per line break, no empty lines. */
export function cellText(td: HtmlNode, warnings: string[], plain: boolean): string {
  return inline(td, warnings, plain)
    .split("\n")
    .map((line) => lineEnd(stripAscii(collapseAsciiSpaces(line))))
    .filter((line) => line !== "")
    .join("\n");
}

/** Write a backslash that ends a line as itself: nothing follows it there. */
function lineEnd(line: string): string {
  return line.endsWith("&#92;") && !line.endsWith("\\&#92;") ? line.slice(0, -5) + "\\" : line;
}

/**
 * A link destination with its backslashes as character references. CommonMark reads a
 * backslash in a destination as an escape, and LTEM reads "\\" as a line break; a
 * character reference keeps the backslash.
 */
function destination(url: string): string {
  return url.replaceAll("\\", "&#92;");
}
