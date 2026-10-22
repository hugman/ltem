/**
 * Random Markdown documents with LTEM tables, for differential tests of parser plugins
 * against the core.
 *
 * A document is built from blocks separated by blank lines, using only constructs on which
 * a CommonMark host with an LTEM plugin and the core's light scan (`findTables`) agree by
 * design: no HTML blocks, no reference definitions, and no lines that a host would take
 * as a lazy continuation of a container. Some table blocks are put in a block quote or a
 * list item. `unwrapped` is the same document with those container markers removed, so
 * `findTables(unwrapped)` gives the tables that the host should find in `markdown`.
 */

import type { Random } from "./conformance.ts";

const BS = "\\";
const IDEOGRAPHIC_SPACE = "　";

/** Cell sources, including LTEM notation, escapes, line breaks and inline Markdown. */
const CELLS = ["", "x", "Revenue", "<<", "^^", "<<", "^^", "a {c:2}", "{c:2}", "b {r:2}", "{r:3}", "c {c:2,r:2}",
  "d {r:2,c:3}", "{c:0}", "e {c:1,c:2}", "f {r:0}", `${BS}<<`, `${BS}^^`, `x ${BS}{c:2}`, `a ${BS}${BS} b`,
  `l1 ${BS}${BS} l2 ${BS}${BS} l3`, `p ${BS}| q`, "**b**", "-", ":-:", "# id", "a << b", "$5 ~ $10",
  "x\t{c:2}", "{c:99}", "{r:99}", "z {c:2}", BS.repeat(3), `${IDEOGRAPHIC_SPACE}y${IDEOGRAPHIC_SPACE}`, "*e*",
  // inline Markdown that the host renders, around the LTEM notation
  `\`a ${BS}| b\``, `\`c ${BS}${BS} d\``, `**a ${BS}${BS} b**`, "[link](https://example.com/a_b)", "_u_ and *v*",
  `a ${BS}${BS}| b`, `${BS}${BS}`, "&amp; &copy; &#35;", "<b>bold</b>", "\u{1f600} 표", " nbsp ",
  "~~gone~~", "<https://example.com>", `x ${BS}* y`, "`` a`b ``", "![img](i.png)", `t ${BS}`];
const SAFE_FIRST = ["x", "Revenue", "z {c:2}", "a {c:2}"];
const DELIMITERS = ["---", ":--", "--:", ":-:", "-"];
const PREFIXES = ["Some text", "| # orders |", "plain | pipe", "| p |", "| p {r:2} | q |", "*emphasis* | here"];
const TERMINATORS = ["# Next", "> quote", "- item", "1. item", "2. item", "***", "- - -", "    code", "- | -", "+ x"];

function randomRow(rng: Random, n: number): string {
  const lead = rng.random() > 0.1;
  const cells = Array.from({ length: n }, (_, i) => (i === 0 && !lead ? rng.choice(SAFE_FIRST) : rng.choice(CELLS)));
  const indent = rng.choice(["", "", "", " ", "   "]);
  return indent + (lead ? "| " : "") + cells.join(" | ") + (rng.random() > 0.1 ? " |" : "");
}

/** The lines of a table block, possibly with paragraph lines above and a block below. */
function randomTableLines(rng: Random): string[] {
  const cols = rng.randint(1, 5);
  const width = (): number => Math.max(1, cols + rng.choice([0, 0, 0, -1, 1, -2]));
  const lines: string[] = [];
  if (rng.random() < 0.3) lines.push(rng.choice(PREFIXES));
  const delimiter = (n: number): string => "|" + Array.from({ length: n }, () => rng.choice(DELIMITERS)).join("|") + "|";
  for (let i = rng.randint(1, 3); i > 0; i--) {
    lines.push(randomRow(rng, width()));
    if (rng.random() < 0.1) lines.push(delimiter(width())); // a delimiter row that may be rejected
  }
  lines.push(delimiter(cols));
  if (rng.random() < 0.1) lines.push(delimiter(width()));
  for (let i = rng.randint(0, 5); i > 0; i--) {
    lines.push(rng.random() < 0.05 ? IDEOGRAPHIC_SPACE : randomRow(rng, width()));
  }
  if (rng.random() < 0.3) lines.push(rng.choice(TERMINATORS));
  return lines;
}

export interface RandomDocument {
  /** The document. */
  markdown: string;
  /** The document without the container markers of the table blocks put in containers. */
  unwrapped: string;
}

export interface DocumentOptions {
  /** Put some table blocks in block quotes and list items. Default true. */
  containers?: boolean;
}

/** Put the lines of a block in a block quote or a list item, keeping their indentation. */
function wrap(rng: Random, lines: string[]): string[] {
  if (rng.random() < 0.5) return lines.map((line) => "> " + line);
  // A list item's content begins after the marker and up to four spaces; later lines
  // must be indented to that column to stay in the item.
  const indent = /^ */.exec(lines[0])![0].length;
  const marker = rng.choice(["-", "*", "1."]);
  const column = marker.length + 1 + indent;
  return [marker + " " + lines[0], ...lines.slice(1).map((line) => " ".repeat(column) + line)];
}

export function randomDocument(rng: Random, options: DocumentOptions = {}): RandomDocument {
  const markdown: string[] = [];
  const unwrapped: string[] = [];
  const add = (block: string, plain = block): void => {
    markdown.push(block);
    unwrapped.push(plain);
  };
  for (let i = rng.randint(1, 5); i > 0; i--) {
    const kind = rng.random();
    if (kind < 0.7) {
      const lines = randomTableLines(rng);
      const contained = (options.containers ?? true) && rng.random() < 0.25;
      // marked trims Unicode whitespace, such as an ideographic space, at the end of a list
      // item. A trailing pipe keeps it in the last cell without changing the row.
      if (contained && /[^\S \t]$/.test(lines[lines.length - 1])) lines[lines.length - 1] += " |";
      add((contained ? wrap(rng, lines) : lines).join("\n"), lines.join("\n"));
      // A list item takes in an indented block after a blank line; end the list first.
      if (/^(?:[-+] |\d\. )/.test(lines[lines.length - 1]) || contained) add("End of list");
    } else if (kind < 0.8) {
      add(rng.choice(["```\n| a |\n|---|\n```", "````\n```\n| a |\n|---|\n````", "~~~\n```js\n| a |\n|---|\n~~~~  "]));
    } else if (kind < 0.9) {
      add("# Heading\n| a | b |\n|---|---|");
    } else {
      add("Some text\nmore text");
    }
  }
  return { markdown: markdown.join("\n\n") + "\n", unwrapped: unwrapped.join("\n\n") + "\n" };
}

/** Pieces of Markdown and LTEM syntax, for fragments that may be anything. */
const PIECES = ["|", "|", "|", "-", "--", ":", " ", " ", "\t", BS, `${BS}${BS}`, `${BS}|`, "<<", "^^", "{c:2}", "{r:2}",
  "{c:0}", "\n", "\n", "\n", "\n", "> ", "- ", "1. ", "a", "b", "`", "*", "#", "<div>", "&amp;", IDEOGRAPHIC_SPACE,
  "  ", "    ", "[x](y)", "$", "\r\n", "~~~", "```", "=", "_"];

/** A random fragment of Markdown, mostly not well formed, for tests that nothing throws. */
export function randomFragment(rng: Random): string {
  let fragment = "";
  for (let i = rng.randint(1, 60); i > 0; i--) fragment += rng.choice(PIECES);
  return fragment;
}
