/**
 * Shared test support: the conformance cases, the HTML normalizer of
 * conformance/tools/run.py (see "HTML is normalized" in conformance/README.md:
 * ASCII whitespace between tags ignored, text trimmed of it, runs of it in text
 * collapsed except inside <pre>, character references decoded, attributes as a set,
 * style text-align as align, <br> and <br /> alike),
 * and a small JSON Schema check for ast/table.schema.json.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The LTEM repository root. */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface ExpectedError {
  rule: string;
  row: number;
  col: number | null;
}

export interface Example {
  example: number;
  section: string;
  ltem: string;
  html: string;
  tables: unknown[];
  errors: ExpectedError[];
}

export function loadExamples(): Example[] {
  const path = join(REPO, "conformance", "cases", "spec-examples.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { examples: Example[] }).examples;
}

export function loadSchema(): Schema {
  return JSON.parse(readFileSync(join(REPO, "ast", "table.schema.json"), "utf8")) as Schema;
}

// -- HTML normalization (a port of `normalize` in conformance/tools/run.py) ------------

export type HtmlToken =
  | ["start", string, [string, string | null][]]
  | ["end", string]
  | ["text", string];

const TAG = /<(\/?)([A-Za-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const TEXT_ALIGN = /^\s*text-align\s*:\s*(left|center|right)\s*;?\s*$/;
const ASCII_WS_START = /^[ \t\n\r\f]+/;
const ASCII_WS_END = /[ \t\n\r\f]+$/;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xa0" };

/** Decode character references, as an HTML parser does. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, name: string) => {
    if (name[0] === "#") {
      const hex = name[1] === "x" || name[1] === "X";
      return String.fromCodePoint(Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10));
    }
    return ENTITIES[name] ?? whole;
  });
}

/** Token list of a whole HTML fragment. */
export function normalize(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let pre = 0; // depth of <pre> elements, inside which whitespace is kept
  const text = (data: string): void => {
    // Only ASCII whitespace is insignificant; other spaces such as U+3000 are content.
    const trimmed = decodeEntities(data).replace(ASCII_WS_START, "").replace(ASCII_WS_END, "");
    if (trimmed) tokens.push(["text", pre ? trimmed : trimmed.replace(/[ \t\n\r\f]+/g, " ")]);
  };
  let last = 0;
  for (const m of html.matchAll(TAG)) {
    text(html.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      if (tag === "pre") pre = Math.max(0, pre - 1);
      if (tag !== "br") tokens.push(["end", tag]);
      continue;
    }
    if (tag === "pre") pre++;
    const attrs: [string, string | null][] = [];
    for (const a of m[3].replace(/\/\s*$/, "").matchAll(ATTRIBUTE)) {
      const name = a[1].toLowerCase();
      const raw = a[2] ?? a[3] ?? a[4];
      const value = raw === undefined ? null : decodeEntities(raw);
      const align = name === "style" ? TEXT_ALIGN.exec(value ?? "") : null;
      attrs.push(align ? ["align", align[1]] : [name, value]);
    }
    attrs.sort(([k1, v1], [k2, v2]) => (k1 < k2 ? -1 : k1 > k2 ? 1 : (v1 ?? "") < (v2 ?? "") ? -1 : 1));
    tokens.push(["start", tag, attrs]);
    if (tag === "br") tokens.push(["end", "br"]);
  }
  text(html.slice(last));
  return tokens;
}

/** Token lists of the <table> elements only. */
export function normalizeTables(html: string): HtmlToken[][] {
  return (html.match(/<table>[\s\S]*?<\/table>/g) ?? []).map(normalize);
}

/** Errors as a sorted list of [rule, row, col], with col -1 for a whole row. */
export function errorSet(errors: readonly ExpectedError[]): [string, number, number][] {
  return errors
    .map((e): [string, number, number] => [e.rule, e.row, e.col ?? -1])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2]));
}

// -- JSON Schema (the keywords that ast/table.schema.json uses) ------------------------

export interface Schema {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  minimum?: number;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
  items?: Schema;
  $ref?: string;
  $defs?: Record<string, Schema>;
}

/** Return the places where `value` does not match `schema` (empty if it matches). */
export function schemaErrors(schema: Schema, value: unknown, root: Schema = schema, path = "$"): string[] {
  if (schema.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    return schemaErrors(root.$defs![name], value, root, path);
  }
  const errors: string[] = [];
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  switch (schema.type) {
    case "object": if (!isObject) return [`${path}: not an object`]; break;
    case "array": if (!Array.isArray(value)) return [`${path}: not an array`]; break;
    case "integer": if (!Number.isInteger(value)) return [`${path}: not an integer`]; break;
    case "string": if (typeof value !== "string") return [`${path}: not a string`]; break;
  }
  if ("const" in schema && value !== schema.const) errors.push(`${path}: not ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);
  if (schema.minimum !== undefined && (value as number) < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
  if (isObject) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}: missing ${key}`);
    for (const [key, v] of Object.entries(obj)) {
      const sub = schema.properties?.[key];
      if (sub) errors.push(...schemaErrors(sub, v, root, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected ${key}`);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errors.push(...schemaErrors(schema.items!, v, root, `${path}[${i}]`)));
  }
  return errors;
}

// -- random numbers for reproducible random tests ---------------------------------------

/** A small seeded random number generator (mulberry32). */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [a, b], both included. */
  randint(a: number, b: number): number {
    return a + Math.floor(this.random() * (b - a + 1));
  }

  choice<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }
}
