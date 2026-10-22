/**
 * Code blocks and HTML highlighted by their language without nested parsing: the code of
 * each visible code block, HTML block and HTML tag is parsed on its own with its language's
 * parser, and the result is cached by its text. CodeMirror's `markdown()` parses nested
 * languages over the whole document on every change instead (`parseMixed`), which costs
 * several milliseconds per keystroke in a large document.
 */

import { LanguageDescription, highlightingFor, syntaxTree, type Language } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { highlightTree, tags, type Highlighter } from "@lezer/highlight";

import { TextCache } from "./cache.js";

/** The languages of code blocks: descriptions (as `@codemirror/language-data` gives them), or a function from a code block's info string. */
export type CodeLanguages = readonly LanguageDescription[] | ((info: string) => Language | LanguageDescription | null);

export interface CodeHighlightingOptions {
  /** The languages of fenced code blocks, by the first word of their info string. */
  languages?: CodeLanguages;
  /** The language of code blocks whose language is not given or not found, and of indented code blocks. */
  defaultLanguage?: Language;
  /** The language of HTML blocks and tags. */
  html?: Language;
}

interface Mark {
  from: number;
  to: number;
  cls: string;
}

const markDecorations = new Map<string, Decoration>();
function markFor(cls: string): Decoration {
  let deco = markDecorations.get(cls);
  if (!deco) markDecorations.set(cls, (deco = Decoration.mark({ class: cls })));
  return deco;
}

const HTML = new Set(["HTMLBlock", "HTMLTag", "CommentBlock"]);

/** The ranges of a node's code, as nested parsing reads them: code text pieces, or what is not marks for HTML. */
function codeRanges(node: SyntaxNode, html: boolean): { from: number; to: number }[] {
  if (!html) return node.getChildren("CodeText").map(({ from, to }) => ({ from, to }));
  const out: { from: number; to: number }[] = [];
  let pos = node.from;
  for (let child = node.firstChild; ; child = child.nextSibling) {
    const end = child ? child.from : node.to;
    if (end > pos) out.push({ from: pos, to: end });
    if (!child) break;
    pos = child.to;
  }
  return out;
}

/**
 * Highlighting of code blocks by their language, and of HTML, for the visible ones. Fenced
 * code blocks take the language their info string names, or `defaultLanguage`; indented
 * code blocks take `defaultLanguage`.
 */
export function codeHighlighting(options: CodeHighlightingOptions): Extension {
  const { languages = [], defaultLanguage, html } = options;
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private readonly cache = new TextCache<Mark[]>(1000, 2_000_000);
    private signature = "";
    private destroyed = false;

    constructor(readonly view: EditorView) {
      this.decorations = this.build();
    }

    update(update: ViewUpdate): void {
      if (update.view.composing) {
        this.decorations = this.decorations.map(update.changes);
        return;
      }
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = this.build();
      }
    }

    /** The language of a code block, or null if it has none (or its parser is still loading). */
    private language(info: string): Language | null {
      const name = /\S*/.exec(info)![0];
      if (!name) return defaultLanguage ?? null;
      const found = typeof languages === "function" ? languages(name) : LanguageDescription.matchLanguageName(languages, name, true);
      if (!found) return defaultLanguage ?? null;
      if (!(found instanceof LanguageDescription)) return found;
      if (found.support) return found.support.language;
      // Load the parser, then draw again.
      found.load().then(() => {
        if (this.destroyed) return;
        this.decorations = this.build();
        this.view.dispatch({});
      }, () => undefined);
      return null;
    }

    destroy(): void {
      this.destroyed = true;
    }

    private build(): DecorationSet {
      const { state } = this.view;
      // The editor's highlight styles; when they change (another theme), the cache is emptied.
      const highlighter: Highlighter = { style: (t) => highlightingFor(state, t) };
      const signature = `${highlightingFor(state, [tags.keyword])}|${highlightingFor(state, [tags.string])}|${highlightingFor(state, [tags.tagName])}`;
      if (signature !== this.signature) {
        this.signature = signature;
        this.cache.clear();
      }
      const out: Range<Decoration>[] = [];
      let last = -1;
      for (const { from, to } of this.view.visibleRanges) {
        syntaxTree(state).iterate({ from, to, enter: (n) => {
          const isHtml = HTML.has(n.name);
          if (!isHtml && n.name !== "FencedCode" && n.name !== "CodeBlock") {
            // HTML tags are inline: with HTML, descend into everything.
            return html ? true : n.type.isTop || n.type.is("BlockContext");
          }
          if (n.from <= last) return false;
          last = n.from;
          let language: Language | null;
          if (isHtml) language = html ?? null;
          else {
            const info = n.node.getChild("CodeInfo");
            language = this.language(info ? state.doc.sliceString(info.from, info.to) : "");
          }
          if (!language) return false;
          const pieces = codeRanges(n.node, isHtml);
          if (!pieces.length) return false;
          const text = pieces.map((p) => state.doc.sliceString(p.from, p.to)).join("");
          const key = `${language.name}\u0000${text}`;
          let marks = this.cache.get(key);
          if (!marks) {
            const found: Mark[] = [];
            highlightTree(language.parser.parse(text), highlighter, (a, b, cls) => found.push({ from: a, to: b, cls }));
            this.cache.set(key, (marks = found), found.length * 8);
          }
          // Marks are in order; map them from the joined text back to the pieces.
          let piece = 0;
          let start = 0;
          for (const m of marks) {
            for (let a = m.from; a < m.to;) {
              while (piece < pieces.length - 1 && a >= start + pieces[piece]!.to - pieces[piece]!.from) {
                start += pieces[piece]!.to - pieces[piece]!.from;
                piece++;
              }
              const p = pieces[piece]!;
              const b = Math.min(m.to, start + p.to - p.from);
              if (b <= a) break;
              out.push(markFor(m.cls).range(p.from + a - start, p.from + b - start));
              a = b;
            }
          }
          return false;
        } });
      }
      return Decoration.set(out, true);
    }
  }, { decorations: (v) => v.decorations });
}
