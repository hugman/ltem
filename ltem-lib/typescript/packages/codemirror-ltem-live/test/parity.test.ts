/**
 * Live Preview reads Markdown as the preview does (markdown-it with markdown-it-ltem,
 * `linkify` on and `html` off, and math as Pandoc's dollars): on random documents, the
 * elements it styles (headings, emphasis, code, math, links, bare links, images, lists,
 * task items, block quotes, code blocks, rules, tables) are the ones the preview renders,
 * in the same order, with the same levels, addresses and TeX.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import markdownit from "markdown-it";
import footnote from "markdown-it-footnote";
import mark from "markdown-it-mark";
import ltemPlugin from "markdown-it-ltem";

import { footnoteSyntax, highlightSyntax, linkTarget, liveMarkdownLanguage, mathSyntax, textLinks, type TextLink } from "../dist/index.js";
import { Random } from "../../../test-support/conformance.ts";

const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;

/** Math as Pandoc's tex_math_dollars, the rule of `mathSyntax`, for markdown-it. */
function pandocMath(md: ReturnType<typeof markdownit>): void {
  md.inline.ruler.before("escape", "math", (state, silent) => {
    const { src, pos, posMax: max } = state;
    if (src.charCodeAt(pos) !== 36) return false;
    const display = src.charCodeAt(pos + 1) === 36;
    const open = display ? 2 : 1;
    if (!display && (pos + 1 >= max || isSpace(src.charCodeAt(pos + 1)))) return false;
    for (let i = pos + open; i < max; i++) {
      const c = src.charCodeAt(i);
      if (c === 92) {
        i++;
        continue;
      }
      if (c !== 36) continue;
      if (display) {
        if (i + 1 >= max || src.charCodeAt(i + 1) !== 36 || i === pos + open) continue;
        if (!silent) state.push("math_display", "math", 0).content = src.slice(pos + 2, i);
        state.pos = i + 2;
        return true;
      }
      if (i === pos + 1 || isSpace(src.charCodeAt(i - 1)) || (i + 1 < max && src.charCodeAt(i + 1) >= 48 && src.charCodeAt(i + 1) <= 57)) continue;
      if (!silent) state.push("math_inline", "math", 0).content = src.slice(pos + 1, i);
      state.pos = i + 1;
      return true;
    }
    return false;
  });
}

const md = markdownit({ html: false, linkify: true }).use(ltemPlugin).use(pandocMath).use(mark);
const mdFootnotes = markdownit({ html: false, linkify: true }).use(ltemPlugin).use(pandocMath).use(mark).use(footnote);

/** TeX as compared: white space and the quote marks of continuation lines do not matter. */
const tex = (s: string): string => s.replace(/\n[ \t]*(?:>[ \t]?)*/g, " ").replace(/\s+/g, " ").trim();
const TEXT_BLOCKS = /^(?:Paragraph|Task|ATXHeading\d|SetextHeading\d)$/;

// -- what Live Preview styles ------------------------------------------------------------------

/**
 * The elements Live Preview styles, in document order. With footnotes, the main text's
 * elements, and the elements of each footnote in the order of its number (markdown-it
 * moves footnotes to the end), as `{ main, notes }`.
 */
function liveFeatures(doc: string, footnotes = false): { main: string[]; notes: string[][] } {
  // The syntax of liveMarkdown() with its default settings (footnotes only where compared).
  const state = EditorState.create({ doc, extensions: [liveMarkdownLanguage({
    extensions: [mathSyntax, ...(footnotes ? [footnoteSyntax] : []), highlightSyntax],
  })] });
  const tree = ensureSyntaxTree(state, doc.length, 10_000)!;
  const main: (string | { ref: number })[] = [];
  const sections = new Map<string, (string | { ref: number })[]>(); // footnote label (or "#n" for inline ones) -> elements
  const refs: { label: string | null; key: string }[] = [];
  const defined = new Set<string>();
  let out = main;
  const stack: (string | { ref: number })[][] = [];
  const text = (n: { from: number; to: number }): string => doc.slice(n.from, n.to);
  const href = (n: SyntaxNode): string | null => {
    const url = linkTarget(state, n);
    return url === null ? null : md.normalizeLink(url);
  };
  // Bare links in runs of text (step 2 of linkify), placed among the nodes by position.
  let links: TextLink[] = [];
  const flush = (upto: number): void => {
    while (links.length && links[0].from < upto) out.push(`link:${md.normalizeLink(links.shift()!.url)}`);
  };
  tree.iterate({
    enter(ref) {
      const n = ref.node;
      flush(ref.from);
      if (TEXT_BLOCKS.test(ref.name)) links = textLinks(state, n);
      switch (ref.name) {
        case "ATXHeading1": case "ATXHeading2": case "ATXHeading3": case "ATXHeading4": case "ATXHeading5": case "ATXHeading6":
        case "SetextHeading1": case "SetextHeading2":
          out.push(`h${ref.name.slice(-1)}`);
          break;
        case "StrongEmphasis": out.push("strong"); break;
        case "Emphasis": out.push("em"); break;
        case "Strikethrough": out.push("s"); break;
        case "Highlight": out.push("mark"); break;
        case "HardBreak": out.push("br"); break;
        case "InlineCode": {
          const marks = n.getChildren("CodeMark");
          // Line breaks in code are spaces (without the quote marks of the next line), and a
          // space at both ends goes (CommonMark).
          out.push(`code:${doc.slice(marks[0].to, marks[marks.length - 1].from).replace(/\n[ \t]*(?:>[ \t]?)*/g, " ").replace(/^ (.+) $/, "$1")}`);
          break;
        }
        case "InlineMath": out.push(`math:${tex(doc.slice(n.from + 1, n.to - 1))}`); return false;
        case "DisplayMath": out.push(`dmath:${tex(doc.slice(n.from + 2, n.to - 2))}`); return false;
        case "Link": case "Autolink": {
          const url = href(n);
          if (url !== null) out.push(`link:${url}`);
          break;
        }
        case "URL": {
          const parent = n.parent?.name;
          if (parent === "Link" || parent === "Image" || parent === "Autolink" || parent === "LinkReference") break;
          const url = href(n);
          if (url !== null) out.push(`link:${url}`);
          break;
        }
        case "Image": out.push(`img:${href(n)}`); return false;
        case "BulletList": out.push("ul"); break;
        case "OrderedList": out.push("ol"); break;
        case "ListItem": out.push("li"); break;
        case "Task": out.push(`task:${/[xX]/.test(text(n.getChild("TaskMarker")!)) ? "x" : " "}`); break;
        case "Blockquote": out.push("quote"); break;
        case "FencedCode": {
          const info = n.getChild("CodeInfo");
          out.push(`fence:${info ? text(info) : ""}`);
          return false;
        }
        case "CodeBlock": out.push("code_block"); return false;
        case "HorizontalRule": out.push("hr"); break;
        case "LtemTable": out.push(`table:${n.getChildren("LtemHeaderRow").length + n.getChildren("LtemRow").length}`); return false;
        case "LinkReference": return false;
        case "FootnoteRef": {
          refs.push({ label: text(n).slice(2, -1), key: text(n).slice(2, -1) });
          out.push({ ref: refs.length - 1 });
          return false;
        }
        case "InlineFootnote": {
          const key = `#${refs.length}`;
          refs.push({ label: null, key });
          out.push({ ref: refs.length - 1 });
          stack.push(out);
          sections.set(key, (out = []));
          return true;
        }
        case "FootnoteDefinition": {
          const label = text(n.getChild("FootnoteLabel")!).slice(2, -2);
          defined.add(label);
          stack.push(out);
          sections.set(label, (out = sections.get(label) ?? []));
          return true;
        }
      }
      return true;
    },
    leave(ref) {
      flush(ref.to);
      if (ref.name === "FootnoteDefinition" || ref.name === "InlineFootnote") out = stack.pop()!;
    },
  });
  // Numbers as markdown-it-footnote gives them, in the order of the references.
  const numbers: (string | null)[] = [];
  const ids = new Map<string, number>();
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const r of refs) {
    if (r.label === null) {
      order.push(r.key);
      numbers.push(String(order.length));
    } else if (defined.has(r.label)) {
      let id = ids.get(r.label);
      if (id === undefined) {
        order.push(r.label);
        ids.set(r.label, (id = order.length));
      }
      const count = counts.get(r.label) ?? 0;
      counts.set(r.label, count + 1);
      numbers.push(count ? `${id}:${count}` : String(id));
    } else {
      numbers.push(null);
    }
  }
  const resolve = (list: (string | { ref: number })[]): string[] =>
    list.flatMap((f) => (typeof f === "string" ? [f] : numbers[f.ref] === null ? [] : [`fnref:${numbers[f.ref]}`]));
  return { main: resolve(main), notes: order.map((key) => resolve(sections.get(key) ?? [])) };
}

// -- what the preview renders ------------------------------------------------------------------

function previewFeatures(doc: string, footnotes = false): { main: string[]; notes: string[][] } {
  const tokens = (footnotes ? mdFootnotes : md).parse(doc, {});
  const main: string[] = [];
  const notes: string[][] = [];
  let out = main;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case "footnote_open": notes[(t.meta as { id: number }).id] = out = []; break;
      case "heading_open": out.push(t.tag); break;
      case "bullet_list_open": out.push("ul"); break;
      case "ordered_list_open": out.push("ol"); break;
      case "list_item_open": {
        out.push("li");
        // A task item (GFM): its first paragraph starts with "[ ] " or "[x] ".
        const inline = tokens[i + 1]?.type === "paragraph_open" ? tokens[i + 2] : null;
        const m = inline?.type === "inline" ? /^\[([ xX])\][ \t]/.exec(inline.content) : null;
        if (m) out.push(`task:${m[1] === " " ? " " : "x"}`);
        break;
      }
      case "blockquote_open": out.push("quote"); break;
      case "fence": out.push(`fence:${t.info.trim()}`); break;
      case "code_block": out.push("code_block"); break;
      case "hr": out.push("hr"); break;
      case "table_open": {
        let rows = 0;
        while (tokens[++i].type !== "table_close") if (tokens[i].type === "tr_open") rows++;
        out.push(`table:${rows}`);
        break;
      }
      case "inline":
        inlineFeatures(t.children ?? [], out, notes);
        break;
    }
  }
  return { main, notes };
}

type Token = ReturnType<typeof md.parse>[number];

function inlineFeatures(children: Token[], out: string[], notes: string[][]): void {
  for (const c of children) {
    if (c.type === "strong_open") out.push("strong");
    else if (c.type === "em_open") out.push("em");
    else if (c.type === "s_open") out.push("s");
    else if (c.type === "mark_open") out.push("mark");
    else if (c.type === "hardbreak") out.push("br");
    else if (c.type === "code_inline") out.push(`code:${c.content}`);
    else if (c.type === "math_inline") out.push(`math:${tex(c.content)}`);
    else if (c.type === "math_display") out.push(`dmath:${tex(c.content)}`);
    else if (c.type === "link_open") out.push(`link:${c.attrGet("href")}`);
    else if (c.type === "image") out.push(`img:${c.attrGet("src")}`);
    else if (c.type === "footnote_ref") {
      const meta = c.meta as { id: number; subId?: number };
      out.push(`fnref:${meta.id + 1}${meta.subId ? `:${meta.subId}` : ""}`);
    }
  }
}

// -- random documents --------------------------------------------------------------------------

const WORDS = ["표", "공문서", "Revenue", "data", "인건비", "값", "plain", "text", "합계"];
const INLINE = [
  (r: Random) => `**${r.choice(WORDS)}**`,
  (r: Random) => `*${r.choice(WORDS)}*`,
  (r: Random) => `_${r.choice(WORDS)}_`,
  (r: Random) => `~~${r.choice(WORDS)}~~`,
  (r: Random) => `\`${r.choice(["code", "x = 1", "a|b"])}\``,
  (r: Random) => `[${r.choice(WORDS)}](http://example.com/${r.choice(["a", "b/c", "한글"])})`,
  (r: Random) => `[${r.choice(WORDS)}](http://example.com/t "title")`,
  (r: Random) => `![${r.choice(WORDS)}](${r.choice(["img.png", "./a/b.jpg", "http://example.com/i.png"])})`,
  () => "<http://example.com/auto>",
  () => "<someone@example.com>",
  () => "https://example.com/bare",
  () => "mail@example.com",
  () => "www.example.com",
  (r: Random) => `[${r.choice(WORDS)}][ref]`,
  () => "[ref][]",
  () => "[undefined]",
  () => "\\*not em\\*",
  (r: Random) => `***${r.choice(WORDS)}***`,
  (r: Random) => `**${r.choice(WORDS)} *${r.choice(WORDS)}* ${r.choice(WORDS)}**`,
  // Bare links next to punctuation, math, marks and escapes, as found in the preview's
  // tests: where they end, and whether they are links at all.
  () => ".http://e.com/$x$",
  () => "[http://e.m/$x$]()",
  () => "$x$http://e.com",
  () => "(http://e.com/a)",
  () => "http://e.com/a*b*",
  () => "**http://e.com**",
  () => "~~http://e.com~~",
  () => "\\.http://e.com",
  () => "http\\://e.com",
  () => "a_http://e.com_b",
  () => "xhttp://e.com",
  () => "HTTPS://E.COM/X",
  () => "ftp://f.org/a.",
  () => "mail@example.com.",
  () => "<mail@example.com>",
  () => "<javascript:alert(1)>",
  // HTML is text (`html: false`).
  () => "<b>http://e.com</b>",
  () => "<span title=\"*x*\">t</span>",
  () => "<!-- *c* -->",
  // Math, and the syntax of CodeMirror's Markdown that the preview does not have.
  (r: Random) => `$${r.choice(["a+b", "x", "\\$", "x_1"])}$`,
  () => "$$x^2$$",
  () => "$ not math $",
  () => "\\$5 and $6",
  () => "x^$a$^",
  () => "H~$2$~O",
  () => ":smile:",
  // Highlights (markdown-it-mark), next to other marks and in runs.
  (r: Random) => `==${r.choice(WORDS)}==`,
  (r: Random) => `==${r.choice(WORDS)} **${r.choice(WORDS)}**==`,
  () => "a====b",
  () => "==a====b==",
  () => "=== not ===",
  () => "==http://e.com==",
  () => "x ==$a$== y",
];

function inline(rng: Random): string {
  const parts: string[] = [];
  for (let i = rng.randint(1, 5); i > 0; i--) parts.push(rng.random() < 0.5 ? rng.choice(WORDS) : rng.choice(INLINE)(rng));
  // Sometimes with no spaces between the parts; but not a bracket right after a reference
  // (`[a][b]`), which markdown-it reads again when the label is not defined (README).
  if (rng.random() >= 0.3) return parts.join(" ");
  return parts.reduce((out, part) => out + (/\]$/.test(out) && /^[[(]/.test(part) ? " " : "") + part, "");
}

function listItem(rng: Random, marker: string, depth: number): string[] {
  const indent = " ".repeat(marker.length + 1);
  const task = rng.random() < 0.3 ? rng.choice(["[ ] ", "[x] "]) : "";
  const lines = [`${marker} ${task}${inline(rng)}`];
  if (depth < 2 && rng.random() < 0.3) lines.push(...list(rng, depth + 1).map((l) => indent + l));
  return lines;
}

function list(rng: Random, depth = 0): string[] {
  const ordered = rng.random() < 0.4;
  const bullet = rng.choice(["-", "*", "+"]);
  const lines: string[] = [];
  for (let i = 0; i < rng.randint(1, 3); i++) lines.push(...listItem(rng, ordered ? `${i + 1}.` : bullet, depth));
  return lines;
}

function block(rng: Random): string {
  switch (rng.randint(0, 16)) {
    case 0: return `${"#".repeat(rng.randint(1, 6))} ${inline(rng)}`;
    case 1: return `${inline(rng)}\n${rng.choice(["===", "---"])}`;
    case 2: return `## ${inline(rng)} ##`;
    case 3: return list(rng).join("\n");
    case 4: return `> ${inline(rng)}\n> ${inline(rng)}`;
    case 5: return `> - ${inline(rng)}\n> - ${inline(rng)}`;
    case 6: return `\`\`\`${rng.choice(["", "js", "python"])}\n${rng.choice(["let x = 1", "# not a heading", "**not bold**"])}\n\`\`\``;
    case 7: return `    ${rng.choice(["indented code", "# also code"])}`;
    case 8: return rng.choice(["---", "***", "___"]);
    case 9: return rng.choice(["| a | b |\n|---|---|\n| 1 | 2 |", "| 구분 | 금액 | << |\n| ^^ | 상 | 하 |\n|---|---|---|\n| 인건비 | 1 | 2 |"]);
    case 11: return `> > ${inline(rng)}\n> > ${inline(rng)}\nlazy ${rng.choice(WORDS)}`;
    case 12: return `${inline(rng)}${rng.choice(["  ", "\\"])}\n${inline(rng)}`;
    // HTML lines are text: they go on with a paragraph, and do not start HTML blocks.
    case 13: return `<div>\n${inline(rng)}\n</div>`;
    case 14: return `${inline(rng)}\n<div>\n${inline(rng)}`;
    case 15: return "<b>\n```\ncode\n```";
    case 16: return `> $$\n> ${rng.choice(["a+b", "x^2"])}\n> $$`;
    default: return `${inline(rng)}\n${inline(rng)}`;
  }
}

const NOTES = ["1", "2", "note"];

function footnoteInline(rng: Random): string {
  const parts: string[] = [];
  for (let i = rng.randint(1, 4); i > 0; i--) {
    const r = rng.random();
    parts.push(r < 0.3 ? `${rng.choice(WORDS)}[^${rng.choice([...NOTES, "undefined"])}]`
      : r < 0.4 ? `^[${rng.choice(WORDS)} *${rng.choice(WORDS)}*]`
      : r < 0.6 ? rng.choice(INLINE)(rng)
      : rng.choice(WORDS));
  }
  return parts.join(" ");
}

function footnoteDocument(rng: Random): string {
  const blocks = [footnoteInline(rng)];
  for (let i = rng.randint(1, 4); i > 0; i--) blocks.push(rng.random() < 0.5 ? footnoteInline(rng) : block(rng));
  for (const label of NOTES) {
    if (rng.random() < 0.2) continue;
    const body = rng.random() < 0.3 ? `${footnoteInline(rng)}\n    ${rng.choice(WORDS)}` : rng.random() < 0.2
      ? `${footnoteInline(rng)}\n\n    - ${rng.choice(WORDS)}\n    - ${rng.choice(WORDS)}` : footnoteInline(rng);
    blocks.push(`[^${label}]: ${body}`);
  }
  return blocks.join("\n\n") + "\n";
}

function randomDocument(rng: Random): string {
  const blocks = [rng.choice(WORDS)];
  for (let i = rng.randint(1, 6); i > 0; i--) blocks.push(block(rng));
  if (rng.random() < 0.5) blocks.push("[ref]: http://example.com/ref");
  return blocks.join("\n\n") + "\n";
}

/** Documents per test; more with LTEM_PARITY_DOCS. */
const DOCS = Number(process.env.LTEM_PARITY_DOCS ?? 2000);
const SEED = Number(process.env.LTEM_PARITY_SEED ?? 0);

test("the elements Live Preview styles are the ones the preview renders", () => {
  const rng = new Random(20261018 + SEED);
  for (let i = 0; i < DOCS; i++) {
    const doc = randomDocument(rng);
    assert.deepEqual(liveFeatures(doc), previewFeatures(doc), doc);
  }
});

test("with footnotes (markdown-it-footnote): references, their numbers, and each footnote's elements", () => {
  const rng = new Random(20261019 + SEED);
  let notes = 0;
  for (let i = 0; i < DOCS; i++) {
    const doc = footnoteDocument(rng);
    const live = liveFeatures(doc, true);
    assert.deepEqual(live, previewFeatures(doc, true), doc);
    notes += live.notes.length;
  }
  assert.ok(notes > DOCS, `${notes} footnotes compared`);
});
