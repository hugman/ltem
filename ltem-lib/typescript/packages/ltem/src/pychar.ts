/**
 * Character classes and string operations as Python defines them.
 *
 * The HTML converter and the problem messages follow the Python implementation of
 * LTEM exactly. These helpers reproduce the few Python string operations they rely on:
 * `str.isspace`, `str.isalpha`, `str.isalnum`, `str.strip()` and `repr()`. Characters
 * are code points.
 */

import { ALNUM_EXTRA, ALPHA, PRINTABLE } from "./pychar-tables.js";

/** Whether a code point lies in a table of [first, last] pairs. */
function inRanges(table: readonly number[], cp: number): boolean {
  let lo = 0;
  let hi = table.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (table[2 * mid + 1] < cp) lo = mid + 1;
    else if (table[2 * mid] > cp) hi = mid - 1;
    else return true;
  }
  return false;
}

/** `str.isspace()` for one code point, which is also what `\s` matches in Python's `re`. */
export function isSpace(cp: number): boolean {
  return (cp >= 0x09 && cp <= 0x0d) || (cp >= 0x1c && cp <= 0x20) || cp === 0x85 || cp === 0xa0
    || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029
    || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

function isAsciiAlpha(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

/** `str.isalpha()` for one code point. */
export function isAlpha(cp: number): boolean {
  if (cp < 0x80) return isAsciiAlpha(cp);
  return inRanges(ALPHA, cp);
}

/** `str.isalnum()` for one code point. */
export function isAlnum(cp: number): boolean {
  if (cp < 0x80) return isAsciiAlpha(cp) || (cp >= 0x30 && cp <= 0x39);
  return inRanges(ALPHA, cp) || inRanges(ALNUM_EXTRA, cp);
}

function isPrintable(cp: number): boolean {
  if (cp < 0x80) return cp >= 0x20 && cp <= 0x7e;
  return inRanges(PRINTABLE, cp);
}

// Every Python whitespace character is in the Basic Multilingual Plane, so the string
// operations below can look at UTF-16 code units.

/** `str.strip()` without arguments: remove leading and trailing whitespace. */
export function strip(s: string): string {
  let i = 0;
  let j = s.length;
  while (i < j && isSpace(s.charCodeAt(i))) i++;
  while (j > i && isSpace(s.charCodeAt(j - 1))) j--;
  return s.slice(i, j);
}

/** `str.lstrip()` without arguments. */
export function lstrip(s: string): string {
  let i = 0;
  while (i < s.length && isSpace(s.charCodeAt(i))) i++;
  return s.slice(i);
}

/** `str.rstrip()` without arguments. */
export function rstrip(s: string): string {
  let j = s.length;
  while (j > 0 && isSpace(s.charCodeAt(j - 1))) j--;
  return s.slice(0, j);
}

function hex(cp: number, width: number): string {
  return cp.toString(16).padStart(width, "0");
}

/** `repr(s)` for a string, as shown in problem messages. */
export function repr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === quote) out += "\\" + ch;
    else if (isPrintable(cp)) out += ch;
    else if (cp <= 0xff) out += "\\x" + hex(cp, 2);
    else if (cp <= 0xffff) out += "\\u" + hex(cp, 4);
    else out += "\\U" + hex(cp, 8);
  }
  return out + quote;
}
