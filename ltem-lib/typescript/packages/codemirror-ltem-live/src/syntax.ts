/**
 * Markdown syntax that the preview reads only with plugins, for Live Preview to read the
 * same way: front matter and TeX math. Each is opt-in (see `liveMarkdown`), to be turned on
 * together with the matching markdown-it plugin in the preview.
 *
 * - Front matter: a YAML block at the very start of the document, between a `---` line
 *   and a closing `---` (or `...`) line (see `frontMatterSyntax`).
 * - Math (as Pandoc's tex_math_dollars, which the LTEM specification recommends):
 *   `$...$` inline and `$$...$$` display. The opening `$` must be followed by a non-space
 *   character, the closing `$` preceded by one and not followed by a digit; `\$` is a
 *   dollar sign. Display math may span the lines of a paragraph.
 */

import type { BlockContext, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

const FENCE = /^(?:---|\.\.\.)[ \t]*$/;

/**
 * Front matter: a YAML block at the very start of the document, from a `---` line to a
 * closing `---` or `...` line. Without a closing line there is no front matter. (This is
 * not exactly markdown-it-front-matter, which also takes a block without a closing line
 * to the end of the document, and `----` or `--- text` as an opening line.)
 */
export const frontMatterSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "FrontMatter", block: true },
    { name: "FrontMatterMark", style: tags.processingInstruction },
    { name: "FrontMatterContent", style: tags.meta },
  ],
  parseBlock: [{
    name: "FrontMatter",
    before: "HorizontalRule",
    parse(cx: BlockContext, line: Line): boolean {
      if (cx.lineStart !== 0 || !/^---[ \t]*$/.test(line.text)) return false;
      // Only with a closing line, as the preview's plugin requires.
      const input = (cx as unknown as { input?: { length: number; read(from: number, to: number): string } }).input;
      if (input) {
        const rest = input.read(line.text.length, Math.min(input.length, 1 << 16));
        if (!/\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.test(rest)) return false;
      }
      const start = cx.lineStart;
      const children = [cx.elt("FrontMatterMark", start, start + line.text.length)];
      let contentFrom = -1;
      let contentTo = -1;
      while (cx.nextLine()) {
        if (FENCE.test(line.text)) {
          if (contentFrom >= 0) children.push(cx.elt("FrontMatterContent", contentFrom, contentTo));
          children.push(cx.elt("FrontMatterMark", cx.lineStart, cx.lineStart + line.text.length));
          cx.nextLine();
          break;
        }
        if (contentFrom < 0) contentFrom = cx.lineStart;
        contentTo = cx.lineStart + line.text.length;
      }
      cx.addElement(cx.elt("FrontMatter", start, cx.prevLineEnd(), children));
      return true;
    },
  }],
};

const DOLLAR = 36;
const BACKSLASH = 92;
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;

export const mathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: tags.special(tags.content) },
    { name: "DisplayMath", style: tags.special(tags.content) },
    { name: "MathMark", style: tags.processingInstruction },
  ],
  parseInline: [{
    name: "Math",
    before: "Escape",
    parse(cx: InlineContext, next: number, pos: number): number {
      if (next !== DOLLAR) return -1;
      // A `$` right after a backslash is escaped (the Escape parser comes after this one).
      if (pos > cx.offset && cx.char(pos - 1) === BACKSLASH) return -1;
      const display = cx.char(pos + 1) === DOLLAR;
      const open = display ? 2 : 1;
      if (!display && (isSpace(cx.char(pos + 1)) || cx.char(pos + 1) === -1)) return -1;
      for (let i = pos + open; i < cx.end; i++) {
        const c = cx.char(i);
        if (c === BACKSLASH) {
          i++;
          continue;
        }
        if (c !== DOLLAR) continue;
        if (display) {
          if (cx.char(i + 1) !== DOLLAR || i === pos + open) continue;
          return cx.addElement(cx.elt("DisplayMath", pos, i + 2, [cx.elt("MathMark", pos, pos + 2), cx.elt("MathMark", i, i + 2)]));
        }
        if (i === pos + 1 || isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) continue;
        return cx.addElement(cx.elt("InlineMath", pos, i + 1, [cx.elt("MathMark", pos, pos + 1), cx.elt("MathMark", i, i + 1)]));
      }
      return -1;
    },
  }],
};

// -- footnotes ------------------------------------------------------------------------------

/** `[^label]:` at the start of a definition: a label of one or more characters, no spaces. */
const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:/;

/**
 * Footnotes as markdown-it-footnote reads them:
 *
 * - A definition `[^label]: text` starts a block (also interrupting a paragraph); lines
 *   indented by four columns, blank lines between them, and lazy continuation lines of a
 *   paragraph belong to it.
 * - A reference `[^label]` (no spaces in the label) is a footnote if the document defines
 *   the label; labels are matched exactly. A reference followed by `(` is a link.
 * - An inline footnote `^[text]` holds its text.
 */
export const footnoteSyntax: MarkdownConfig = {
  defineNodes: [
    {
      name: "FootnoteDefinition",
      block: true,
      composite(_cx: BlockContext, line: Line, value: number): boolean {
        if (line.indent < line.baseIndent + value && line.next > -1) return false;
        line.moveBaseColumn(line.baseIndent + value);
        return true;
      },
    },
    { name: "FootnoteLabel", style: tags.labelName },
    { name: "FootnoteRef", style: tags.labelName },
    { name: "InlineFootnote" },
    { name: "FootnoteMark", style: tags.processingInstruction },
  ],
  parseBlock: [{
    name: "FootnoteDefinition",
    before: "Blockquote",
    parse(cx: BlockContext, line: Line): boolean | null {
      if (line.indent - line.baseIndent > 3) return false;
      const m = FOOTNOTE_DEFINITION.exec(line.text.slice(line.pos));
      if (!m) return false;
      const start = cx.lineStart + line.pos;
      cx.startComposite("FootnoteDefinition", line.pos, 4);
      cx.addElement(cx.elt("FootnoteLabel", start, start + m[0].length));
      line.moveBase(line.skipSpace(line.pos + m[0].length));
      return null;
    },
    endLeaf(_cx: BlockContext, line: Line): boolean {
      return line.indent - line.baseIndent < 4 && FOOTNOTE_DEFINITION.test(line.text.slice(line.pos));
    },
  }],
  parseInline: [
    {
      name: "FootnoteRef",
      before: "Link",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 94 /* ^ */) return -1;
        let i = pos + 2;
        for (; i < cx.end; i++) {
          const c = cx.char(i);
          if (c === 93 /* ] */) break;
          if (c === 32 || c === 10 || c === 9) return -1;
        }
        if (i === pos + 2 || i >= cx.end || cx.char(i + 1) === 40 /* ( */) return -1;
        return cx.addElement(cx.elt("FootnoteRef", pos, i + 1, [cx.elt("FootnoteMark", pos, pos + 2), cx.elt("FootnoteMark", i, i + 1)]));
      },
    },
    {
      name: "InlineFootnote",
      before: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== 94 /* ^ */ || cx.char(pos + 1) !== 91 /* [ */) return -1;
        // The matching `]`, over nested brackets, escapes and code spans.
        let depth = 1;
        let i = pos + 2;
        for (; i < cx.end && depth > 0; i++) {
          const c = cx.char(i);
          if (c === 92 /* \ */) i++;
          else if (c === 96 /* ` */) {
            let run = 1;
            while (cx.char(i + run) === 96) run++;
            const close = cx.slice(i + run, cx.end).indexOf("`".repeat(run));
            if (close >= 0) i += run + close + run - 1;
            else i += run - 1;
          } else if (c === 91) depth++;
          else if (c === 93) depth--;
        }
        if (depth > 0) return -1;
        const end = i; // just past the `]`
        const content = cx.parser.parseInline(cx.slice(pos + 2, end - 1), pos + 2);
        return cx.addElement(cx.elt("InlineFootnote", pos, end, [
          cx.elt("FootnoteMark", pos, pos + 2), ...content, cx.elt("FootnoteMark", end - 1, end),
        ]));
      },
    },
  ],
};
