/** The widgets Live Preview shows in place of Markdown: bullets, check boxes, rules, images. */

import { EditorView, WidgetType } from "@codemirror/view";

const BULLETS = ["•", "◦", "▪"];

/** A list item's bullet, by the depth of its list. */
export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }

  override eq(other: BulletWidget): boolean {
    return other.depth === this.depth;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-bullet";
    span.textContent = BULLETS[(this.depth - 1) % BULLETS.length];
    return span;
  }
}

/** A task list item's check box. Clicking it changes `[ ]` to `[x]` and back. */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-live-checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Done" : "Not done");
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const pos = view.posAtDOM(box);
      const marker = view.state.doc.sliceString(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(marker)) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: marker[1] === " " ? "x" : " " }, userEvent: "input.toggle" });
    });
    box.addEventListener("click", (event) => event.preventDefault());
    return box;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** The language of a code block, shown at the block's top in place of its opening fence. */
export class LanguageWidget extends WidgetType {
  constructor(readonly language: string) {
    super();
  }

  override eq(other: LanguageWidget): boolean {
    return other.language === this.language;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-code-language";
    span.textContent = this.language;
    return span;
  }
}

/** A footnote's number, in place of a reference (`[1]`) or of a definition's label (`1.`). */
export class FootnoteWidget extends WidgetType {
  constructor(readonly text: string, readonly kind: "ref" | "label", readonly title = "") {
    super();
  }

  override eq(other: FootnoteWidget): boolean {
    return other.text === this.text && other.kind === this.kind && other.title === this.title;
  }

  toDOM(): HTMLElement {
    const span = document.createElement(this.kind === "ref" ? "sup" : "span");
    span.className = this.kind === "ref" ? "cm-live-footnote-ref" : "cm-live-footnote-label";
    span.textContent = this.kind === "ref" ? `[${this.text}]` : `${this.text}.`;
    if (this.title) span.title = this.title;
    return span;
  }

  // The editor handles clicks on it (Ctrl-click goes to the definition or the reference).
  override ignoreEvent(): boolean {
    return false;
  }
}

/** A line break made with two spaces (or a backslash) at the end of a line, shown where the line is not being edited. */
export class HardBreakWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-hardbreak";
    span.textContent = "↵";
    span.setAttribute("aria-label", "line break");
    return span;
  }
}

/** A horizontal rule across the line. */
export class HorizontalRuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-live-hr";
    span.setAttribute("role", "separator");
    return span;
  }
}

/**
 * Whether an address would be fetched over the network: http, https, ftp and web sockets,
 * and protocol-relative addresses (`//host/...`). Paths, `file:` and `data:` addresses and
 * an application's own schemes are local.
 */
export function isRemote(url: string): boolean {
  const u = url.trim();
  if (u.startsWith("//") || u.startsWith("\\\\")) return true;
  return /^(?:https?|ftp|wss?):/i.test(u);
}

/**
 * The address to show an image from, or why none is shown. A remote image is never
 * loaded, so that opening a document sends nothing out of the computer; an embedded one
 * (`data:image/...`) is shown as it is; any other goes through `resolve`, and its result
 * must not be remote either.
 */
export function imageSource(src: string | null, resolve?: (src: string) => string | null): { url: string } | { blocked: "remote" | "unresolved" } {
  if (src === null || src.trim() === "") return { blocked: "unresolved" };
  if (isRemote(src)) return { blocked: "remote" };
  if (/^data:image\//i.test(src.trim())) return { url: src.trim() };
  const url = resolve?.(src) ?? null;
  if (url === null) return { blocked: "unresolved" };
  if (isRemote(url)) return { blocked: "remote" };
  return { url };
}

/** An image, or a placeholder with its description where it is not shown. */
export class ImageWidget extends WidgetType {
  private readonly source: { url: string } | { blocked: "remote" | "unresolved" };

  constructor(readonly src: string | null, readonly alt: string, resolve?: (src: string) => string | null) {
    super();
    this.source = imageSource(src, resolve);
  }

  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && JSON.stringify(other.source) === JSON.stringify(this.source);
  }

  toDOM(view: EditorView): HTMLElement {
    if ("url" in this.source) {
      const img = document.createElement("img");
      img.className = "cm-live-image";
      img.alt = this.alt;
      img.src = this.source.url;
      img.addEventListener("load", () => view.requestMeasure());
      img.addEventListener("error", () => img.replaceWith(this.placeholder("unresolved")));
      return img;
    }
    return this.placeholder(this.source.blocked);
  }

  private placeholder(reason: "remote" | "unresolved"): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-live-image-missing cm-live-image-${reason}`;
    span.textContent = this.alt || this.src || "image";
    span.title = reason === "remote" ? `Remote image not loaded: ${this.src}` : `Image not found: ${this.src ?? ""}`;
    return span;
  }

  override get estimatedHeight(): number {
    return "url" in this.source ? 120 : -1;
  }
}
