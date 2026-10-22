/**
 * The look of Live Preview. Colours, fonts and sizes are CSS variables, which an
 * application's theme sets on the editor (or any element around it) to override them:
 *
 * | Variable | Default |
 * |---|---|
 * | `--cm-live-heading-font`, `--cm-live-heading-color`, `--cm-live-heading-weight` | the text's, bold |
 * | `--cm-live-h1-size` … `--cm-live-h6-size` | 1.6em, 1.4em, 1.25em, 1.1em, 1em, 0.95em |
 * | `--cm-live-link-color` | blue |
 * | `--cm-live-code-font`, `--cm-live-code-bg`, `--cm-live-codeblock-bg` | monospace, light grey |
 * | `--cm-live-quote-border`, `--cm-live-quote-color` | grey, the text's |
 * | `--cm-live-hr-color`, `--cm-live-bullet-color`, `--cm-live-muted-color` | grey |
 * | `--cm-live-highlight-bg` | yellow, translucent |
 *
 * The styles are a CodeMirror theme (a constructed style sheet), so they work in a Shadow
 * DOM and under a content security policy that allows no inline styles.
 */

import { EditorView } from "@codemirror/view";

const MONO = "ui-monospace, 'D2Coding', 'Nanum Gothic Coding', 'Cascadia Mono', Consolas, monospace";
const SIZES = ["1.6em", "1.4em", "1.25em", "1.1em", "1em", "0.95em"];

/**
 * Bars for block quotes, one per level of nesting (up to four): a background of stripes,
 * so that no element or inline style is needed.
 */
function quoteBars(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {
    ".cm-live-quote": { color: "var(--cm-live-quote-color, inherit)", backgroundRepeat: "no-repeat" },
  };
  for (let depth = 1; depth <= 4; depth++) {
    const stops: string[] = [];
    for (let i = 0; i < depth; i++) {
      const x = 6 + i * 12;
      stops.push(`transparent ${x}px`, `var(--bar) ${x}px`, `var(--bar) ${x + 3}px`, `transparent ${x + 3}px`);
    }
    rules[`.cm-line.cm-live-quote-${depth}`] = {
      paddingLeft: `${6 + depth * 12}px`,
      backgroundImage: `linear-gradient(to right, transparent 0, ${stops.join(", ")})`,
    };
  }
  rules["&light .cm-live-quote"] = { "--bar": "var(--cm-live-quote-border, #c6cbd1)" };
  rules["&dark .cm-live-quote"] = { "--bar": "var(--cm-live-quote-border, #545d68)" };
  return rules;
}

const headings: Record<string, Record<string, string>> = {};
SIZES.forEach((size, i) => {
  headings[`.cm-live-h${i + 1}`] = { fontSize: `var(--cm-live-h${i + 1}-size, ${size})` };
});

export const liveTheme = EditorView.baseTheme({
  ".cm-live-heading": {
    fontFamily: "var(--cm-live-heading-font, inherit)",
    fontWeight: "var(--cm-live-heading-weight, 700)",
    color: "var(--cm-live-heading-color, inherit)",
  },
  ...headings,
  ".cm-live-strong": { fontWeight: "700" },
  ".cm-live-em": { fontStyle: "italic" },
  ".cm-live-strike": { textDecoration: "line-through" },
  ".cm-live-highlight": { borderRadius: "2px" },
  "&light .cm-live-highlight": { backgroundColor: "var(--cm-live-highlight-bg, rgba(255, 213, 0, 0.42))" },
  "&dark .cm-live-highlight": { backgroundColor: "var(--cm-live-highlight-bg, rgba(255, 200, 0, 0.30))" },
  ".cm-live-code": {
    fontFamily: `var(--cm-live-code-font, ${MONO})`,
    borderRadius: "3px",
  },
  "&light .cm-live-code": { backgroundColor: "var(--cm-live-code-bg, rgba(110, 118, 129, 0.14))" },
  "&dark .cm-live-code": { backgroundColor: "var(--cm-live-code-bg, rgba(150, 160, 170, 0.18))" },
  ".cm-live-link": { textDecoration: "underline", textUnderlineOffset: "2px" },
  "&light .cm-live-link": { color: "var(--cm-live-link-color, #1f63c9)" },
  "&dark .cm-live-link": { color: "var(--cm-live-link-color, #6ea8fe)" },
  ".cm-live-list-number": { color: "var(--cm-live-bullet-color, inherit)" },
  ".cm-live-bullet": { color: "var(--cm-live-bullet-color, inherit)", display: "inline-block", minWidth: "0.7em" },
  ".cm-live-checkbox": { margin: "0 0.25em 0 0", verticalAlign: "middle", cursor: "pointer" },
  ...quoteBars(),
  ".cm-live-codeblock": { fontFamily: `var(--cm-live-code-font, ${MONO})` },
  "&light .cm-live-codeblock": { backgroundColor: "var(--cm-live-codeblock-bg, rgba(110, 118, 129, 0.08))" },
  "&dark .cm-live-codeblock": { backgroundColor: "var(--cm-live-codeblock-bg, rgba(150, 160, 170, 0.10))" },
  ".cm-live-code-language": { fontSize: "0.8em", color: "var(--cm-live-muted-color, #8a8f98)" },
  ".cm-live-hr": {
    display: "inline-block", width: "100%", verticalAlign: "middle",
    borderTop: "1px solid var(--cm-live-hr-color, #c6cbd1)",
  },
  ".cm-live-image": { maxWidth: "100%", verticalAlign: "bottom" },
  ".cm-live-image-missing": {
    border: "1px dashed var(--cm-live-muted-color, #8a8f98)", borderRadius: "3px", padding: "0 0.3em",
    color: "var(--cm-live-muted-color, #8a8f98)",
  },
  ".cm-live-definition, .cm-live-muted": { color: "var(--cm-live-muted-color, #8a8f98)" },
  ".cm-live-footnote-ref": { fontSize: "0.75em", lineHeight: "0", color: "var(--cm-live-link-color, #1f63c9)", cursor: "pointer" },
  ".cm-live-footnote-label": { color: "var(--cm-live-muted-color, #8a8f98)", marginRight: "0.3em" },
  ".cm-live-footnote": { fontSize: "var(--cm-live-footnote-size, 0.92em)" },
  ".cm-live-hardbreak": { color: "var(--cm-live-muted-color, #8a8f98)", fontSize: "0.85em", paddingLeft: "0.2em" },
  ".cm-live-hardbreak-source": { backgroundColor: "var(--cm-live-hardbreak-bg, rgba(110, 118, 129, 0.18))" },
  ".cm-live-math": { fontFamily: `var(--cm-live-code-font, ${MONO})` },
  ".cm-live-frontmatter": { fontFamily: `var(--cm-live-code-font, ${MONO})`, color: "var(--cm-live-muted-color, #8a8f98)" },
  ".cm-live-rendered": { cursor: "pointer" },
  "div.cm-live-rendered": { padding: "4px 0", overflowX: "auto" },
  ".cm-live-rendered-error": {
    fontFamily: `var(--cm-live-code-font, ${MONO})`, whiteSpace: "pre-wrap",
    color: "var(--cm-live-error-color, #cf222e)",
  },
});
