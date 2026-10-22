/**
 * The features an application can switch in its settings, with their names and
 * descriptions in English and Korean, for a settings page. All are on by default but HTML,
 * which markdown-it reads as text by default. `liveMarkdown({ settings })` sets them, and
 * `applyLiveSettings(view, settings)` changes them in a running editor.
 */

/** The features of `liveMarkdown` that can be switched on and off. */
export interface LiveSettings {
  /** Live Preview; off shows the source. */
  livePreview: boolean;
  /** Bare URLs and e-mail addresses styled as links. */
  bareLinks: boolean;
  /** Highlights, `==text==`. */
  highlight: boolean;
  /** TeX math, `$...$` and `$$...$$`. */
  math: boolean;
  /** Footnotes. */
  footnotes: boolean;
  /** Front matter. */
  frontMatter: boolean;
  /** HTML blocks and tags read as HTML. */
  html: boolean;
  /** LTEM tables shown as tables. */
  tables: boolean;
  /** Cells of shown tables edited where they are shown. */
  editTablesInPlace: boolean;
  /** Buttons to a shown table's source and back to the table. */
  sourceButton: boolean;
  /** The table menu on a right click. */
  tableMenu: boolean;
  /** Ranges of cells, as in a spreadsheet. */
  cellRanges: boolean;
  /** Columns lined up by Tab and Enter. */
  autoAlign: boolean;
  /** The key bindings for tables. */
  tableKeys: boolean;
  /** Problems with tables marked, with fixes. */
  lint: boolean;
  /** HTML tables and tab-separated text pasted as LTEM tables. */
  pasteTables: boolean;
  /** Tables copied as HTML tables too. */
  copyTables: boolean;
  /** Table rows in a monospace font. */
  monospaceTables: boolean;
}

export const defaultLiveSettings: Readonly<LiveSettings> = Object.freeze({
  livePreview: true,
  bareLinks: true,
  highlight: true,
  math: true,
  footnotes: true,
  frontMatter: true,
  html: false,
  tables: true,
  editTablesInPlace: true,
  sourceButton: true,
  tableMenu: true,
  cellRanges: true,
  autoAlign: true,
  tableKeys: true,
  lint: true,
  pasteTables: true,
  copyTables: true,
  monospaceTables: true,
});

/** A setting as a settings page shows it. */
export interface LiveSettingInfo {
  key: keyof LiveSettings;
  /** `view`: how the document is shown; `syntax`: what is read; `tables`: LTEM tables. */
  group: "view" | "syntax" | "tables";
  default: boolean;
  label: { en: string; ko: string };
  description: { en: string; ko: string };
  /** What the preview needs, when the setting is on, to read the document the same way. */
  preview?: { en: string; ko: string };
  /** Changing it parses the document again (a moment in a large document). */
  reparse?: boolean;
}

/** The settings, in the order a settings page can show them. */
export const liveSettingsInfo: readonly LiveSettingInfo[] = [
  {
    key: "livePreview", group: "view", default: true,
    label: { en: "Live Preview", ko: "실시간 미리보기" },
    description: {
      en: "Markdown marks show only where the cursor is; the rest of the document looks as it will be rendered. Off shows the source.",
      ko: "Markdown 기호는 커서가 있는 곳에만 보이고, 나머지는 완성된 모습으로 보입니다. 끄면 원문을 그대로 봅니다.",
    },
  },
  {
    key: "bareLinks", group: "view", default: true,
    label: { en: "Bare links", ko: "맨 주소를 링크로" },
    description: {
      en: "http(s):// and ftp:// addresses and e-mail addresses written as they are show as links (Ctrl-click opens them).",
      ko: "그냥 적은 http(s)://, ftp:// 주소와 전자우편 주소를 링크로 보여 줍니다(Ctrl+클릭으로 엶).",
    },
    preview: { en: "markdown-it option linkify: true", ko: "markdown-it 옵션 linkify: true" },
  },
  {
    key: "highlight", group: "syntax", default: true, reparse: true,
    label: { en: "Highlights (==text==)", ko: "형광펜 강조 (==글==)" },
    description: {
      en: "==text== is highlighted, as in Obsidian and Typora. It is not standard Markdown: GitHub shows it as written.",
      ko: "==글==을 형광펜처럼 강조합니다(Obsidian, Typora와 같음). 표준 Markdown은 아니어서 GitHub에서는 글자 그대로 보입니다.",
    },
    preview: { en: "markdown-it-mark", ko: "markdown-it-mark 플러그인" },
  },
  {
    key: "math", group: "syntax", default: true, reparse: true,
    label: { en: "Math ($...$)", ko: "수식 ($...$)" },
    description: {
      en: "$...$ and $$...$$ are TeX math (Pandoc's rule, as the LTEM specification recommends), drawn by the application.",
      ko: "$...$, $$...$$를 TeX 수식으로 읽어 그립니다(LTEM 명세가 권하는 Pandoc 규칙).",
    },
    preview: { en: "a math plugin with Pandoc's dollar rule (as markdown-it-texmath)", ko: "Pandoc $ 규칙의 수식 플러그인(markdown-it-texmath 등)" },
  },
  {
    key: "footnotes", group: "syntax", default: true, reparse: true,
    label: { en: "Footnotes", ko: "각주" },
    description: {
      en: "[^label] references, [^label]: definitions and ^[inline footnotes], numbered as in the preview.",
      ko: "[^이름] 참조와 [^이름]: 정의, ^[인라인 각주]를 읽고 미리보기와 같은 번호로 보여 줍니다.",
    },
    preview: { en: "markdown-it-footnote", ko: "markdown-it-footnote 플러그인" },
  },
  {
    key: "frontMatter", group: "syntax", default: true, reparse: true,
    label: { en: "Front matter", ko: "문서 머리 정보 (front matter)" },
    description: {
      en: "A YAML block at the very start, between --- lines, is the document's properties.",
      ko: "문서 맨 앞 --- 줄 사이의 YAML을 문서 정보로 읽습니다.",
    },
    preview: {
      en: "a front matter plugin with the same rule (a closing --- or ... line; the opening line exactly ---)",
      ko: "같은 규칙의 front matter 플러그인(닫는 --- 또는 ... 줄이 있어야 하고, 여는 줄은 정확히 ---)",
    },
  },
  {
    key: "html", group: "syntax", default: false, reparse: true,
    label: { en: "HTML", ko: "HTML 읽기" },
    description: {
      en: "HTML blocks and tags in the document are read as HTML. Off, HTML is text, as with markdown-it's default.",
      ko: "문서 안의 HTML 블록과 태그를 HTML로 읽습니다. 끄면 HTML을 글자로 둡니다(markdown-it 기본).",
    },
    preview: { en: "markdown-it option html: true", ko: "markdown-it 옵션 html: true" },
  },
  {
    key: "tables", group: "tables", default: true,
    label: { en: "Show tables as tables", ko: "표를 표로 보이기" },
    description: {
      en: "An LTEM table the cursor is not in is shown rendered. Off, tables show as source.",
      ko: "커서가 없는 LTEM 표를 완성된 표로 보여 줍니다. 끄면 표도 원문으로 보입니다.",
    },
  },
  {
    key: "editTablesInPlace", group: "tables", default: true,
    label: { en: "Edit tables where they are shown", ko: "표 위에서 바로 편집" },
    description: {
      en: "A click on a cell of a shown table edits its text there. Off, a click shows the table's source.",
      ko: "보이는 표의 칸을 누르면 그 자리에서 글을 고칩니다. 끄면 누를 때 표의 원문으로 갑니다.",
    },
  },
  {
    key: "sourceButton", group: "tables", default: true,
    label: { en: "Source handle", ko: "원문 손잡이" },
    description: {
      en: "A small handle left of a shown table, while the mouse is over it, shows its source (as Alt-click does); while the source is shown, a handle at the same place shows the table again.",
      ko: "보이는 표에 마우스를 올리면 표 왼쪽 바깥에 작은 손잡이가 떠서 누르면 원문을 보입니다(Alt+클릭과 같음). 원문을 보이는 동안에는 같은 자리의 손잡이로 표로 돌아갑니다.",
    },
  },
  {
    key: "tableMenu", group: "tables", default: true,
    label: { en: "Table menu", ko: "표 메뉴" },
    description: {
      en: "A right click in a table opens a menu: insert, delete and move rows and columns, merge and split cells, alignment, copy and paste.",
      ko: "표에서 오른쪽 클릭하면 행·열 넣기·지우기·옮기기, 칸 병합·나누기, 정렬, 복사·붙여넣기 메뉴가 뜹니다.",
    },
  },
  {
    key: "cellRanges", group: "tables", default: true,
    label: { en: "Ranges of cells", ko: "칸 범위 선택" },
    description: {
      en: "A selection over two or more cells works on cells, as in a spreadsheet: delete, copy, cut, paste and typing. Off, it is text, as in the source: deleted, copied and pasted as it is written.",
      ko: "여러 칸에 걸친 선택을 스프레드시트처럼 칸 단위로 다룹니다(지우기, 복사, 잘라내기, 붙여넣기, 입력). 끄면 원문 글처럼 지우고 복사하고 붙여넣습니다.",
    },
  },
  {
    key: "autoAlign", group: "tables", default: true,
    label: { en: "Line up columns", ko: "열 자동 줄맞춤" },
    description: {
      en: "Tab and Enter line up the columns of the table's source as they move between cells.",
      ko: "Tab·Enter로 칸을 옮길 때 표 원문의 열을 공백으로 맞춥니다.",
    },
  },
  {
    key: "tableKeys", group: "tables", default: true,
    label: { en: "Table keys", ko: "표 단축키" },
    description: {
      en: "Tab, Shift-Tab and Enter move between cells; Alt with the arrow keys moves rows and columns; Alt-Shift-F lines up the table.",
      ko: "Tab, Shift-Tab, Enter로 칸을 옮기고, Alt+화살표로 행·열을 옮기고, Alt+Shift+F로 표를 줄맞춤합니다.",
    },
  },
  {
    key: "lint", group: "tables", default: true,
    label: { en: "Check tables", ko: "표 규칙 검사" },
    description: {
      en: "Breaches of the LTEM rules are marked on the cell, with fixes.",
      ko: "LTEM 규칙에 어긋난 곳을 칸에 표시하고 고치는 방법을 보여 줍니다.",
    },
  },
  {
    key: "pasteTables", group: "tables", default: true,
    label: { en: "Paste tables", ko: "표 붙여넣기 변환" },
    description: {
      en: "Tables copied from a web page, Word or Excel (HTML, tab-separated text) are pasted as LTEM tables, merged cells included.",
      ko: "웹, 워드, 엑셀에서 복사한 표(HTML, 탭 구분 글)를 병합 칸까지 LTEM 표로 바꿔 붙입니다.",
    },
  },
  {
    key: "copyTables", group: "tables", default: true,
    label: { en: "Copy tables as HTML too", ko: "표를 HTML로도 복사" },
    description: {
      en: "Copying tables also puts them on the clipboard as HTML tables, so they paste into a word processor with their merged cells. The plain text stays the source (but for ranges of cells, copied as tab-separated text).",
      ko: "표를 복사하면 HTML 표도 함께 클립보드에 넣어, 워드 등에 병합 칸까지 붙습니다. 글은 원문 그대로입니다(칸 범위 선택은 탭 구분 글).",
    },
  },
  {
    key: "monospaceTables", group: "tables", default: true,
    label: { en: "Monospace table source", ko: "표 원문 고정폭 글꼴" },
    description: {
      en: "The rows of a table's source are set in a monospace font, so that columns line up.",
      ko: "표 원문 줄을 고정폭 글꼴로 보여 열이 맞아 보이게 합니다.",
    },
  },
];
