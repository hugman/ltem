/** Decoding HTML character references, as the HTML Standard and Python's `html.unescape` do. */

import { ENTITIES } from "./entities.js";

/** A reference: `&#` digits, `&#x` hex digits, or a name of 1 to 32 code points; `;` optional. */
const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;

/**
 * Numeric references to code points that the HTML Standard replaces (0x80-0x9F are read
 * as Windows-1252). Code point to replacement code point.
 */
const INVALID_CHARREFS = new Map<number, number>([
  [0x00, 0xfffd], [0x0d, 0x0d], [0x80, 0x20ac], [0x81, 0x81], [0x82, 0x201a], [0x83, 0x192],
  [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x2c6], [0x89, 0x2030],
  [0x8a, 0x160], [0x8b, 0x2039], [0x8c, 0x152], [0x8d, 0x8d], [0x8e, 0x17d], [0x8f, 0x8f],
  [0x90, 0x90], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022],
  [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x2dc], [0x99, 0x2122], [0x9a, 0x161], [0x9b, 0x203a],
  [0x9c, 0x153], [0x9d, 0x9d], [0x9e, 0x17e], [0x9f, 0x178],
]);

/** Code points that a numeric reference may not produce: they become nothing. */
function invalidCodepoint(n: number): boolean {
  return (n >= 0x1 && n <= 0x8) || n === 0xb || (n >= 0xe && n <= 0x1f) || (n >= 0x7f && n <= 0x9f)
    || (n >= 0xfdd0 && n <= 0xfdef) || (n <= 0x10ffff && (n & 0xfffe) === 0xfffe);
}

/** Parse digits in the given radix, saturating far above the Unicode range. */
function number(digits: string, radix: number): number {
  let n = 0;
  for (const d of digits) n = Math.min(n * radix + Number.parseInt(d, radix), 2 ** 40);
  return n;
}

/** The replacement for one reference; `body` is the reference without its `&`. */
function replace(body: string): string {
  if (body[0] === "#") {
    const hexadecimal = body[1] === "x" || body[1] === "X";
    let digits = body.slice(hexadecimal ? 2 : 1);
    if (digits.endsWith(";")) digits = digits.slice(0, -1);
    const n = number(digits, hexadecimal ? 16 : 10);
    const replacement = INVALID_CHARREFS.get(n);
    if (replacement !== undefined) return String.fromCodePoint(replacement);
    if ((n >= 0xd800 && n <= 0xdfff) || n > 0x10ffff) return String.fromCodePoint(0xfffd);
    if (invalidCodepoint(n)) return "";
    return String.fromCodePoint(n);
  }
  const value = ENTITIES.get(body);
  if (value !== undefined) return value;
  // The longest name that is a prefix of the reference, at least two code points long;
  // the rest stays text.
  const chars = Array.from(body);
  for (let x = chars.length - 1; x > 1; x--) {
    const prefix = ENTITIES.get(chars.slice(0, x).join(""));
    if (prefix !== undefined) return prefix + chars.slice(x).join("");
  }
  return "&" + body;
}

/** Decode all character references in `s` (`html.unescape`). */
export function unescape(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(CHARREF, (_whole, body: string) => replace(body));
}
