/**
 * Live Preview for Markdown in CodeMirror 6, with LTEM tables.
 *
 * ```ts
 * import { EditorView, basicSetup } from "codemirror";
 * import { liveMarkdown, toggleLivePreview } from "codemirror-ltem-live";
 *
 * const view = new EditorView({ extensions: [basicSetup, liveMarkdown()], parent: document.body });
 * toggleLivePreview(view); // to the source and back
 * ```
 *
 * @packageDocumentation
 */

import { Compartment, Facet, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  ltem, ltemCellMarks, ltemTableWidgets, revealedTables, type LtemConfig, type LtemContextMenuOptions, type LtemLintOptions,
  type LtemWidgetOptions,
} from "codemirror-ltem";

import { renderedBlocks, type BlockRenderer, type MathRenderer } from "./blocks.js";
import { liveDecorations, type DecorateOptions } from "./decorate.js";
import { footnoteDefinition, footnoteFirstReference, footnoteIndex } from "./footnotes.js";
import { footnoteSyntax, frontMatterSyntax, mathSyntax } from "./syntax.js";
import { highlightSyntax } from "./markdownit.js";
import { liveMarkdownLanguage, type LiveMarkdownLanguageConfig } from "./language.js";
import { defaultLiveSettings, type LiveSettings } from "./settings.js";
import { linkAt } from "./links.js";
import { liveTheme } from "./theme.js";

export { liveDecorations, type DecorateOptions } from "./decorate.js";
export { linkAt, linkTarget } from "./links.js";
export { linkifySyntax, textLinks, type TextLink } from "./linkify.js";
export { highlightSyntax, highlightTag, markdownItSyntax, strikethroughSyntax } from "./markdownit.js";
export { liveMarkdownLanguage, noHtmlMarkdown, type LiveMarkdownLanguageConfig } from "./language.js";
export { codeHighlighting, type CodeHighlightingOptions, type CodeLanguages } from "./code.js";
export { defaultLiveSettings, liveSettingsInfo, type LiveSettingInfo, type LiveSettings } from "./settings.js";
export { imageSource, isRemote } from "./widgets.js";
export { liveTheme } from "./theme.js";
export { footnoteSyntax, frontMatterSyntax, mathSyntax } from "./syntax.js";
export { RenderedWidget, type BlockRenderer, type MathRenderer, type Renderers } from "./blocks.js";
export { footnoteDefinition, footnoteFirstReference, footnoteIndex, footnoteLabelNumber, footnoteNumber } from "./footnotes.js";

export interface LivePreviewOptions {
  /** Start in Live Preview (default true); false starts in the source. */
  enabled?: boolean;
  /**
   * Opens a link on Ctrl-click (Cmd-click on macOS), with its address as written (or
   * `mailto:` for an e-mail address). Without it, links are not opened.
   */
  openLink?: (url: string, event: MouseEvent) => void;
  /**
   * Turns an image's address as written into one to show it from (for example a file or
   * application URL for a path relative to the document), or null to show a placeholder.
   * Remote addresses (http, https, ftp, `//host`, `\\host`) are never loaded, before or
   * after this. Embedded `data:image/` addresses are shown as they are. Without it, only
   * embedded images are shown.
   */
  resolveImage?: (src: string) => string | null;
  /** Style bare URLs and e-mail addresses as links, as markdown-it's `linkify` (default true). */
  bareUrls?: boolean;
  /** Options of the table widgets (`codemirror-ltem`), or false to show tables as source. */
  tables?: LtemWidgetOptions | false;
  /**
   * Draws TeX math (`$...$`, `$$...$$`; needs `mathSyntax`, see `liveMarkdown`), for
   * example with KaTeX. Under a policy that allows no inline styles, draw MathML (KaTeX's
   * `output: "mathml"`). Without it, math is shown as styled source.
   */
  renderMath?: MathRenderer;
  /** Draws Mermaid diagrams (code blocks of language `mermaid`). Without it, they are code blocks. */
  renderMermaid?: BlockRenderer;
  /** Draws front matter (needs `frontMatterSyntax`). Without it, front matter is shown as muted source. */
  renderFrontMatter?: BlockRenderer;
}

/** The compartment that holds Live Preview, and what goes into it when it is on. */
const liveSetup = Facet.define<{ compartment: Compartment; content: Extension }, { compartment: Compartment; content: Extension } | null>({
  combine: (values) => values[0] ?? null,
});

function livePlugin(options: DecorateOptions): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = liveDecorations(view.state, view.visibleRanges, options);
    }

    update(update: ViewUpdate): void {
      // During an IME composition the decorations are only moved with the text, so that
      // the composition is not disturbed.
      if (update.view.composing) {
        this.decorations = this.decorations.map(update.changes);
        return;
      }
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged
          || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = liveDecorations(update.state, update.view.visibleRanges, options);
      }
    }
  }, { decorations: (v) => v.decorations });
}

/** The footnote reference or definition label at a position, and where Ctrl-click goes from it. */
function footnoteJump(view: EditorView, pos: number): number | null {
  const tree = syntaxTree(view.state);
  for (const side of [1, -1] as const) {
    for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (n.name === "FootnoteRef") return footnoteDefinition(view.state, view.state.doc.sliceString(n.from + 2, n.to - 1));
      if (n.name === "FootnoteLabel") return footnoteFirstReference(view.state, view.state.doc.sliceString(n.from + 2, n.to - 2));
      if (n.name === "Paragraph" || n.type.isTop) break;
    }
  }
  return null;
}

function linkClicks(openLink: LivePreviewOptions["openLink"]): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      // A footnote: from its reference to its definition, and back.
      const target = pos === null ? null : footnoteJump(view, pos);
      if (target !== null) {
        event.preventDefault();
        view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: "select.pointer" });
        return true;
      }
      if (!openLink) return false;
      const link = pos === null ? null : linkAt(view.state, pos);
      if (!link) return false;
      event.preventDefault();
      openLink(link.url, event);
      return true;
    },
  });
}

/**
 * Live Preview: Markdown marks shown only where the cursor is, the rest styled; LTEM tables
 * shown and edited as tables. Needs the Markdown language with LTEM tables (`ltem()` from
 * `codemirror-ltem`, or use `liveMarkdown()`, which includes it). Switch it on and off with
 * `setLivePreview` or `toggleLivePreview`.
 */
export function livePreview(options: LivePreviewOptions = {}): Extension {
  const compartment = new Compartment();
  const renderers = { math: options.renderMath, mermaid: options.renderMermaid, frontMatter: options.renderFrontMatter };
  const decorate: DecorateOptions = { resolveImage: options.resolveImage, bareUrls: options.bareUrls, renderers };
  const content: Extension = [
    footnoteIndex,
    livePlugin(decorate),
    renderedBlocks(renderers),
    options.tables === false ? [] : ltemTableWidgets({ ...options.tables, openLink: options.tables?.openLink ?? options.openLink }),
    linkClicks(options.openLink),
    EditorView.editorAttributes.of({ class: "cm-live" }),
  ];
  return [
    liveSetup.of({ compartment, content }),
    // Outside the compartment, so that marks on cells stay while Live Preview is off.
    ltemCellMarks,
    revealedTables,
    compartment.of(options.enabled === false ? [] : content),
    liveTheme,
  ];
}

/** Whether Live Preview is on. */
export function livePreviewEnabled(state: EditorState): boolean {
  const setup = state.facet(liveSetup);
  return !!setup && setup.compartment.get(state) === setup.content;
}

/** Switch Live Preview on (true) or off (false: the source). */
export function setLivePreview(view: EditorView, on: boolean): boolean {
  const setup = view.state.facet(liveSetup);
  if (!setup || livePreviewEnabled(view.state) === on) return false;
  view.dispatch({ effects: setup.compartment.reconfigure(on ? setup.content : []) });
  return true;
}

/** Switch between Live Preview and the source; a command, for a key binding. */
export function toggleLivePreview(view: EditorView): boolean {
  return setLivePreview(view, !livePreviewEnabled(view.state));
}

/** The options of `liveMarkdown`. */
export interface LiveMarkdownOptions {
  /** Options of `codemirror-ltem`'s `ltem()` (messages, lint delay, paste options...); `markdown` options go to the language. */
  ltem?: LtemConfig;
  /** Options of Live Preview: opening links, images, drawing math, Mermaid and front matter. */
  live?: LivePreviewOptions;
  /** Options of the Markdown language (`liveMarkdownLanguage`): code languages, extensions, `nestedLanguages`. */
  language?: LiveMarkdownLanguageConfig;
  /** Syntax to read, as settings do (`math`, `frontMatter`, `footnotes`, `html`, `highlight`). */
  syntax?: { math?: boolean; frontMatter?: boolean; footnotes?: boolean; html?: boolean; highlight?: boolean };
  /** The features switched on and off (see `liveSettingsInfo`); these come before the other options. */
  settings?: Partial<LiveSettings>;
}

/** The settings that options set, over the defaults, and then `settings` over them. */
function settingsOf(options: LiveMarkdownOptions): LiveSettings {
  const s: LiveSettings = { ...defaultLiveSettings };
  const ltemOptions = options.ltem ?? {};
  const live = options.live ?? {};
  const set = (key: keyof LiveSettings, value: boolean | undefined): void => {
    if (value !== undefined) s[key] = value;
  };
  set("livePreview", live.enabled);
  set("bareLinks", live.bareUrls);
  set("tables", live.tables === false ? false : undefined);
  set("editTablesInPlace", live.tables ? live.tables.editInPlace : undefined);
  set("sourceButton", live.tables ? live.tables.sourceButton : undefined);
  const off = (value: unknown): boolean | undefined => (value === false ? false : undefined);
  set("lint", off(ltemOptions.lint));
  set("pasteTables", off(ltemOptions.paste));
  set("copyTables", off(ltemOptions.copy));
  set("tableMenu", off(ltemOptions.contextMenu));
  set("tableKeys", ltemOptions.keymap);
  set("autoAlign", ltemOptions.autoAlign);
  set("monospaceTables", ltemOptions.monospace);
  set("cellRanges", ltemOptions.cellRanges);
  set("html", options.language?.html);
  for (const key of ["math", "frontMatter", "footnotes", "html", "highlight"] as const) set(key, options.syntax?.[key]);
  for (const [key, value] of Object.entries(options.settings ?? {})) set(key as keyof LiveSettings, value);
  return s;
}

/** The settings that the language depends on: changing one of them parses the document again. */
const LANGUAGE_SETTINGS = ["math", "frontMatter", "footnotes", "html", "highlight"] as const;

function languageOf(options: LiveMarkdownOptions, s: LiveSettings): Extension {
  if (options.ltem?.markdown === false) return []; // the application's own language
  const config = { ...(typeof options.ltem?.markdown === "object" ? options.ltem.markdown : {}), ...options.language };
  const extra = config.extensions ?? [];
  return liveMarkdownLanguage({
    ...config,
    html: s.html,
    // Your extensions come after the ones of markdown-it's reading, so they can add syntax back.
    extensions: [
      ...(Array.isArray(extra) ? extra : [extra]),
      ...(s.math ? [mathSyntax] : []),
      ...(s.frontMatter ? [frontMatterSyntax] : []),
      ...(s.footnotes ? [footnoteSyntax] : []),
      ...(s.highlight ? [highlightSyntax] : []),
    ],
  });
}

/** The language of the table menu's labels, if it is one of the component's. */
function menuLanguage(options: LtemConfig): "en" | "ko" | undefined {
  const messages = typeof options.contextMenu === "object" ? options.contextMenu.messages : undefined;
  return messages === "en" || messages === "ko" ? messages : undefined;
}

function featuresOf(options: LiveMarkdownOptions, s: LiveSettings): Extension {
  const ltemOptions = options.ltem ?? {};
  const keep = <T>(on: boolean, value: T | boolean | undefined): T | boolean => (on ? (typeof value === "object" ? value : true) : false);
  const live = options.live ?? {};
  const tables = live.tables === false || live.tables === undefined ? {} : live.tables;
  return [
    ltem({
      ...ltemOptions,
      markdown: false,
      widgets: false,
      lint: keep(s.lint, ltemOptions.lint),
      paste: keep(s.pasteTables, ltemOptions.paste),
      copy: keep(s.copyTables, ltemOptions.copy),
      contextMenu: keep(s.tableMenu, ltemOptions.contextMenu),
      keymap: s.tableKeys,
      autoAlign: s.autoAlign,
      monospace: s.monospaceTables,
      cellRanges: s.cellRanges,
    }),
    livePreview({
      ...live,
      enabled: s.livePreview,
      bareUrls: s.bareLinks,
      // The table buttons speak the language of the table menu, unless the tables' options say.
      tables: s.tables ? { messages: menuLanguage(ltemOptions), ...tables, editInPlace: s.editTablesInPlace, sourceButton: s.sourceButton } : false,
    }),
  ];
}

/**
 * One editor's setup of `liveMarkdown`: the parts that settings and options make again, and
 * the options and settings in force. Each call of `liveMarkdown` makes its own, so that an
 * application that sets the editor up again (with other messages, for one) gets its new
 * options, not the content CodeMirror keeps in a compartment it already had.
 */
interface LiveSetup {
  language: Compartment;
  features: Compartment;
  state: StateField<{ options: LiveMarkdownOptions; settings: LiveSettings }>;
}

const liveInstance = Facet.define<LiveSetup, LiveSetup | null>({ combine: (values) => values[values.length - 1] ?? null });
const updateLive = StateEffect.define<{ setup: LiveSetup; options: LiveMarkdownOptions; settings: LiveSettings }>();

/**
 * The Markdown language with LTEM tables and their editing (`ltem()` from
 * `codemirror-ltem`), with Live Preview. Markdown is read as markdown-it reads it
 * (`liveMarkdownLanguage`). The features of `liveSettingsInfo` are on by default (but
 * HTML, which markdown-it reads as text by default); `settings` (or the older options that
 * set them, such as `syntax`) switch them, and `applyLiveSettings` changes them later. Turn
 * on what the preview needs for the syntax settings that are on (`liveSettingsInfo[].preview`).
 */
export function liveMarkdown(options: LiveMarkdownOptions = {}): Extension {
  const s = settingsOf(options);
  const setup: LiveSetup = {
    language: new Compartment(),
    features: new Compartment(),
    state: StateField.define({
      create: () => ({ options, settings: s }),
      update: (value, tr) => tr.effects.reduce((v, e) => (e.is(updateLive) && e.value.setup === setup ? e.value : v), value),
    }),
  };
  return [
    liveInstance.of(setup),
    setup.state,
    // Outside the parts that settings change, so that marks on cells stay.
    ltemCellMarks,
    revealedTables,
    setup.language.of(languageOf(options, s)),
    setup.features.of(featuresOf(options, s)),
  ];
}

/** The setup of an editor set up with `liveMarkdown`, and its options and settings in force. */
function liveSetupOf(state: EditorState): { setup: LiveSetup; options: LiveMarkdownOptions; settings: LiveSettings } | null {
  const setup = state.facet(liveInstance);
  const value = setup && state.field(setup.state, false);
  return setup && value ? { setup, ...value } : null;
}

/** The settings of an editor set up with `liveMarkdown`, or null. */
export function currentLiveSettings(state: EditorState): LiveSettings | null {
  const live = liveSetupOf(state);
  return live ? { ...live.settings, livePreview: livePreviewEnabled(state) } : null;
}

/**
 * Change settings of an editor set up with `liveMarkdown`, as a settings page does. Settings
 * of syntax parse the document again; Live Preview on and off is quick. Returns false if
 * nothing changed.
 */
export function applyLiveSettings(view: EditorView, settings: Partial<LiveSettings>): boolean {
  const live = liveSetupOf(view.state);
  const current = currentLiveSettings(view.state);
  if (!live || !current) return false;
  const { setup, options } = live;
  const next: LiveSettings = { ...current };
  for (const [key, value] of Object.entries(settings)) if (typeof value === "boolean") next[key as keyof LiveSettings] = value;
  const changed = (Object.keys(next) as (keyof LiveSettings)[]).filter((key) => next[key] !== current[key]);
  if (!changed.length) return false;
  if (changed.length === 1 && changed[0] === "livePreview") return setLivePreview(view, next.livePreview);
  const effects: StateEffect<unknown>[] = [updateLive.of({ setup, options, settings: next })];
  if (changed.some((key) => (LANGUAGE_SETTINGS as readonly string[]).includes(key))) effects.push(setup.language.reconfigure(languageOf(options, next)));
  if (changed.some((key) => !(LANGUAGE_SETTINGS as readonly string[]).includes(key))) effects.push(setup.features.reconfigure(featuresOf(options, next)));
  view.dispatch({ effects });
  return true;
}

/** The texts of the table menu, the table checks and the table buttons, by language, or each by its own function. */
export type LiveMessages = "en" | "ko" | {
  menu?: NonNullable<LtemContextMenuOptions["messages"]>;
  lint?: NonNullable<LtemLintOptions["messages"]>;
  tables?: NonNullable<LtemWidgetOptions["messages"]>;
};

/**
 * Change the language of the texts of an editor set up with `liveMarkdown`: the table menu,
 * the messages of table checks, and the table buttons and their hints. Settings stay as
 * they are. Returns false if the editor was not set up with `liveMarkdown`.
 */
export function setLiveMessages(view: EditorView, messages: LiveMessages): boolean {
  const live = liveSetupOf(view.state);
  if (!live) return false;
  const { setup, options, settings } = live;
  const pick = <T>(key: "menu" | "lint" | "tables"): T => (typeof messages === "string" ? messages : messages[key]) as T;
  const ltemOptions = options.ltem ?? {};
  const object = <T extends object>(value: T | boolean | undefined): T | object => (typeof value === "object" ? value : {});
  const tables = options.live?.tables;
  const next: LiveMarkdownOptions = {
    ...options,
    ltem: {
      ...ltemOptions,
      contextMenu: ltemOptions.contextMenu === false ? false : { ...object(ltemOptions.contextMenu), messages: pick("menu") },
      lint: ltemOptions.lint === false ? false : { ...object(ltemOptions.lint), messages: pick("lint") },
    },
    live: { ...options.live, tables: tables === false ? false : { ...object(tables), messages: pick("tables") } },
  };
  view.dispatch({ effects: [updateLive.of({ setup, options: next, settings }), setup.features.reconfigure(featuresOf(next, settings))] });
  return true;
}
