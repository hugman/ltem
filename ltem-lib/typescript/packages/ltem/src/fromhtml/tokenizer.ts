/**
 * A forgiving HTML tokenizer.
 *
 * It reads HTML the way Python's `html.parser.HTMLParser` (3.12, with
 * `convert_charrefs`) does, so that the converter gives the same result as the Python
 * implementation of LTEM: start tags, end tags and text are reported in order;
 * comments, declarations and processing instructions are skipped; character references
 * in text and attribute values are decoded; the content of `script`, `style` and
 * similar elements is raw text; an unterminated construct at the end of the input is
 * dropped. Every boundary it looks for is an ASCII character, so it works on UTF-16
 * code units without splitting a character.
 */

import { strip } from "../pychar.js";
import { unescape } from "./charref.js";

/** An attribute: its lowercase name and its value, or null if it has none. */
export type Attribute = [name: string, value: string | null];

/** Receives the tokens of a document. */
export interface Sink {
  /** `<tag ...>`. Names are lowercase. */
  startTag(tag: string, attrs: Attribute[]): void;
  /** `<tag .../>`. */
  startEndTag(tag: string, attrs: Attribute[]): void;
  /** `</tag>`. */
  endTag(tag: string): void;
  /** Text, with character references decoded (except in raw text elements). */
  data(text: string): void;
}

/** Elements whose content is raw text, up to their end tag. */
const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "plaintext"]);
/** Elements whose content is text with character references, up to their end tag. */
const ESCAPABLE_RAW_TEXT = new Set(["textarea", "title"]);

const TAB = 0x09, LF = 0x0a, FF = 0x0c, CR = 0x0d, SPACE = 0x20;
const QUOTE = 0x22, APOSTROPHE = 0x27, SLASH = 0x2f, EQUALS = 0x3d, GT = 0x3e, BANG = 0x21, HYPHEN = 0x2d;

/** `[\t\n\r\f ]` */
function isSpace(c: number): boolean {
  return c === TAB || c === LF || c === CR || c === FF || c === SPACE;
}

/** `[\t\n\r\f /]` */
function isSpaceOrSlash(c: number): boolean {
  return isSpace(c) || c === SLASH;
}

/** Characters that end a tag or attribute name: `[\t\n\r\f />]`. */
function endsName(c: number): boolean {
  return isSpaceOrSlash(c) || c === GT;
}

/** Characters after which an attribute name may begin: `['"\t\n\r\f /]`. */
function precedesAttr(c: number): boolean {
  return c === APOSTROPHE || c === QUOTE || isSpaceOrSlash(c);
}

function isAsciiAlpha(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/** Lowercase ASCII letters only. */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** An attribute found by `attrFind`: index ranges of its name and value. */
interface AttrMatch {
  name: [number, number];
  value: [number, number] | null;
  end: number;
}

class Tokenizer {
  private readonly s: string;
  private readonly n: number;
  private readonly sink: Sink;
  /** The raw text element whose end tag is awaited. */
  private cdataElem: string | null = null;
  /** Whether character references are decoded in text. */
  private escapable = true;

  constructor(s: string, sink: Sink) {
    this.s = s;
    this.n = s.length;
    this.sink = sink;
  }

  /** The code unit at i, or NaN past the end. */
  private c(i: number): number {
    return this.s.charCodeAt(i);
  }

  private starts(i: number, prefix: string): boolean {
    return this.s.startsWith(prefix, i);
  }

  private find(needle: string, from: number): number | null {
    const p = this.s.indexOf(needle, from);
    return p < 0 ? null : p;
  }

  private text(i: number, j: number): void {
    const s = this.s.slice(i, j);
    this.sink.data(this.escapable ? unescape(s) : s);
  }

  /** `<` followed by an ASCII letter. */
  private startTagOpen(i: number): boolean {
    return isAsciiAlpha(this.c(i + 1));
  }

  /** The main loop (`HTMLParser.goahead` at the end of the input). */
  run(): void {
    const n = this.n;
    let i = 0;
    while (i < n) {
      let j: number;
      if (this.cdataElem === null) {
        j = this.find("<", i) ?? n;
      } else if (this.cdataElem === "plaintext") {
        j = n;
      } else {
        const end = this.rawTextEnd(i, this.cdataElem);
        if (end === null) break;
        j = end;
      }
      if (i < j) this.text(i, j);
      i = j;
      if (i === n) break;
      let k: number | null;
      if (this.startTagOpen(i)) {
        k = this.parseStarttag(i);
      } else if (this.starts(i, "</")) {
        k = this.parseEndtag(i);
      } else if (this.starts(i, "<!--")) {
        k = this.parseComment(i);
      } else if (this.starts(i, "<?")) {
        const p = this.find(">", i + 2);
        k = p === null ? null : p + 1;
      } else if (this.starts(i, "<!")) {
        k = this.parseHtmlDeclaration(i);
      } else {
        this.sink.data("<");
        k = i + 1;
      }
      if (k === null) {
        // An unterminated construct runs to the end of the input and is dropped,
        // except a "</" that ends the input.
        if (!this.startTagOpen(i) && this.starts(i, "</") && i + 2 === n) this.sink.data("</");
        i = n;
      } else {
        i = k;
      }
    }
    if (i < n) this.text(i, n);
  }

  /** The start of the end tag of the current raw text element: `</elem(?=[\t\n\r\f />])`, ASCII case-insensitive. */
  private rawTextEnd(from: number, elem: string): number | null {
    let i = from;
    for (;;) {
      const p = this.find("<", i);
      if (p === null) return null;
      const name = p + 2;
      if (this.c(p + 1) === SLASH && asciiLower(this.s.slice(name, name + elem.length)) === elem
          && endsName(this.c(name + elem.length))) {
        return p;
      }
      i = p + 1;
    }
  }

  /** The end of a tag whose name starts at p (the `locatetagend` pattern): past the closing `>` if any. */
  private locateTagEnd(p: number): number {
    const n = this.n;
    let q = p + 1;
    while (q < n && !endsName(this.c(q))) q++;
    while (q < n && isSpaceOrSlash(this.c(q))) q++;
    // Attributes: a name after a quote, space or slash, an optional value, and spaces or slashes.
    while (q < n && !endsName(this.c(q)) && precedesAttr(this.c(q - 1))) {
      q++;
      while (q < n && !endsName(this.c(q)) && this.c(q) !== EQUALS) q++;
      const value = this.valueIndicator(q);
      if (value !== null) q = value.end;
      while (q < n && isSpaceOrSlash(this.c(q))) q++;
    }
    if (q < n && this.c(q) === GT) q++;
    return q;
  }

  /** `[\t\n\r\f ]*=[\t\n\r\f ]*(value)` at q: the value's index range and the end. */
  private valueIndicator(q: number): { range: [number, number]; end: number } | null {
    const n = this.n;
    let a = q;
    while (a < n && isSpace(this.c(a))) a++;
    if (this.c(a) !== EQUALS) return null;
    const first = a + 1;
    let v = first;
    while (v < n && isSpace(this.c(v))) v++;
    const end = this.valueAt(v);
    if (end !== null) return { range: [v, end], end };
    // An unclosed quote: backtrack one space, where an empty unquoted value matches.
    return v > first ? { range: [v - 1, v - 1], end: v - 1 } : null;
  }

  /** A quoted or unquoted attribute value at v: its end, or null for an unclosed quote. */
  private valueAt(v: number): number | null {
    const c = this.c(v);
    if (c === APOSTROPHE || c === QUOTE) {
      const e = this.find(this.s[v], v + 1);
      return e === null ? null : e + 1;
    }
    let e = v;
    while (e < this.n && !isSpace(this.c(e)) && this.c(e) !== GT) e++;
    return e;
  }

  /** Spaces, and slashes not followed by `>`: `(?:[\t\n\r\f ]|/(?!>))*`. */
  private skipAttrSpace(from: number): number {
    let q = from;
    while (q < this.n && (isSpace(this.c(q)) || (this.c(q) === SLASH && this.c(q + 1) !== GT))) q++;
    return q;
  }

  /** A tag name at p (`tagfind_tolerant`): the end of the name and of the spaces after it. */
  private tagFind(p: number): [number, number] {
    let q = p + 1;
    while (q < this.n && !endsName(this.c(q))) q++;
    return [q, this.skipAttrSpace(q)];
  }

  /** An attribute at k (`attrfind_tolerant`). */
  private attrFind(k: number): AttrMatch | null {
    const n = this.n;
    if (k >= n || endsName(this.c(k)) || !precedesAttr(this.c(k - 1))) return null;
    let q = k + 1;
    while (q < n && !endsName(this.c(q)) && this.c(q) !== EQUALS) q++;
    const name: [number, number] = [k, q];
    let value: [number, number] | null = null;
    const indicator = this.valueIndicator(q);
    if (indicator !== null) {
      value = indicator.range;
      q = indicator.end;
    }
    return { name, value, end: this.skipAttrSpace(q) };
  }

  private parseStarttag(i: number): number | null {
    const endpos = this.locateTagEnd(i + 1);
    if (this.c(endpos - 1) !== GT) return null;
    const [nameEnd, attrStart] = this.tagFind(i + 1);
    const tag = this.s.slice(i + 1, nameEnd).toLowerCase();
    const attrs: Attribute[] = [];
    let k = attrStart;
    while (k < endpos) {
      const m = this.attrFind(k);
      if (m === null) break;
      const name = this.s.slice(m.name[0], m.name[1]).toLowerCase();
      let value: string | null = null;
      if (m.value !== null) {
        let v = this.s.slice(m.value[0], m.value[1]);
        if (v.length >= 2 && ((v[0] === "'" && v.endsWith("'")) || (v[0] === '"' && v.endsWith('"')))) {
          v = v.slice(1, -1);
        }
        value = unescape(v);
      }
      attrs.push([name, value]);
      k = m.end;
    }
    const end = k <= endpos ? strip(this.s.slice(k, endpos)) : "";
    if (end !== ">" && end !== "/>") {
      this.sink.data(this.s.slice(i, endpos));
      return endpos;
    }
    if (end === "/>") {
      // An XHTML-style empty element, such as <br/>.
      this.sink.startEndTag(tag, attrs);
    } else {
      this.sink.startTag(tag, attrs);
      if (RAW_TEXT.has(tag)) {
        this.cdataElem = tag;
        this.escapable = false;
      } else if (ESCAPABLE_RAW_TEXT.has(tag)) {
        this.cdataElem = tag;
        this.escapable = true;
      }
    }
    return endpos;
  }

  private parseEndtag(i: number): number | null {
    if (this.find(">", i + 2) === null) return null;
    if (!isAsciiAlpha(this.c(i + 2))) {
      if (this.c(i + 2) === GT) return i + 3; // "</>" is ignored
      const p = this.find(">", i + 2); // a bogus comment
      return p === null ? null : p + 1;
    }
    const j = this.locateTagEnd(i + 2);
    if (this.c(j - 1) !== GT) return null;
    const [nameEnd] = this.tagFind(i + 2);
    this.sink.endTag(this.s.slice(i + 2, nameEnd).toLowerCase());
    this.cdataElem = null;
    this.escapable = true;
    return j;
  }

  /** `<!--` up to `-->` or `--!>`, or the abrupt `<!-->` and `<!--->`. */
  private parseComment(i: number): number | null {
    let from = i + 4;
    for (;;) {
      const q = this.find("--", from);
      if (q === null) break;
      if (this.c(q + 2) === GT) return q + 3;
      if (this.c(q + 2) === BANG && this.c(q + 3) === GT) return q + 4;
      from = q + 1;
    }
    if (this.c(i + 4) === GT) return i + 5;
    if (this.c(i + 4) === HYPHEN && this.c(i + 5) === GT) return i + 6;
    return null;
  }

  private parseHtmlDeclaration(i: number): number | null {
    let p: number | null;
    if (this.starts(i, "<![CDATA[")) {
      p = this.find("]]>", i + 9);
      return p === null ? null : p + 3;
    }
    if (asciiLower(this.s.slice(i, i + 9)) === "<!doctype") p = this.find(">", i + 9);
    else if (this.starts(i, "<![")) p = this.find(">", i + 3);
    else p = this.find(">", i + 2); // a bogus comment
    return p === null ? null : p + 1;
  }
}

/** Tokenize a whole HTML document into `sink`. */
export function tokenize(html: string, sink: Sink): void {
  new Tokenizer(html, sink).run();
}
