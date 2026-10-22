//! `mdbook-ltem`: an mdBook preprocessor that turns LTEM tables into HTML tables.
//!
//! mdBook runs it as `mdbook-ltem supports RENDERER`, to ask whether it supports a
//! renderer, and as `mdbook-ltem` with the JSON array `[context, book]` on standard
//! input, expecting the book back as JSON on standard output. The protocol is read with
//! serde_json alone: the preprocessor only needs a few settings from the context and
//! the chapters' Markdown, and walking the JSON keeps it independent of mdBook's Rust
//! types, so it reads the books of mdBook 0.5 (`items`) and 0.4 (`sections`) alike.

use std::collections::HashSet;
use std::io::{self, Read, Write};
use std::process::ExitCode;

use pulldown_cmark_ltem::pulldown_cmark::{Event, Options, Parser, Tag};
use pulldown_cmark_ltem::TableBlock;
use serde_json::Value;

const USAGE: &str = "\
usage: mdbook-ltem                     read [context, book] as JSON from standard input
                                       and write the book with LTEM tables as HTML
       mdbook-ltem supports RENDERER   exit with status 0 if RENDERER is supported (html)
       mdbook-ltem --version
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        [] => run(),
        ["supports", renderer] => {
            if supports(renderer) {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        ["--version" | "-V"] => {
            println!("mdbook-ltem {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        ["--help" | "-h"] => {
            print!("{USAGE}");
            ExitCode::SUCCESS
        }
        _ => {
            eprint!("{USAGE}");
            ExitCode::from(2)
        }
    }
}

/// The renderers whose output is HTML made from the chapters' Markdown. Others, such
/// as `markdown`, keep the LTEM text unless `renderers` in the preprocessor's table of
/// `book.toml` names them.
fn supports(renderer: &str) -> bool {
    renderer == "html"
}

fn run() -> ExitCode {
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        eprintln!("mdbook-ltem: cannot read standard input: {e}");
        return ExitCode::FAILURE;
    }
    match preprocess(&input) {
        Ok((book, warnings)) => {
            for warning in warnings {
                eprintln!("mdbook-ltem: warning: {warning}");
            }
            let mut stdout = io::stdout().lock();
            if let Err(e) = stdout
                .write_all(book.as_bytes())
                .and_then(|()| stdout.flush())
            {
                eprintln!("mdbook-ltem: cannot write the book: {e}");
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("mdbook-ltem: {message}");
            ExitCode::FAILURE
        }
    }
}

/// What the context says about rendering.
struct Settings {
    /// pulldown-cmark options of mdBook's HTML renderer, for cell text.
    options: Options,
    /// Wrap tables in `<div class="table-wrapper">`, as mdBook's HTML renderer does
    /// with its own tables (it makes wide tables scroll).
    wrapper: bool,
    /// Report validation errors on standard error.
    warnings: bool,
}

impl Settings {
    fn from_context(context: &Value) -> Settings {
        // mdBook 0.5 turned smart punctuation on by default and added definition lists
        // and admonitions. In 0.4 smart punctuation is on if `smart-punctuation` or its
        // older name `curly-quotes` is true.
        let version: Vec<u64> = context["mdbook_version"]
            .as_str()
            .unwrap_or("")
            .split('.')
            .map_while(|n| n.parse().ok())
            .collect();
        let legacy = matches!(version.as_slice(), [0, minor, ..] if *minor < 5);
        let html = &context["config"]["output"]["html"];
        let flag = |key: &str| html[key].as_bool();
        let smart = if legacy {
            flag("smart-punctuation").unwrap_or(false) || flag("curly-quotes").unwrap_or(false)
        } else {
            flag("smart-punctuation").unwrap_or(true)
        };
        let mut options = Options::ENABLE_TABLES
            | Options::ENABLE_FOOTNOTES
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_TASKLISTS
            | Options::ENABLE_HEADING_ATTRIBUTES;
        options.set(Options::ENABLE_SMART_PUNCTUATION, smart);
        options.set(
            Options::ENABLE_DEFINITION_LIST,
            !legacy && flag("definition-lists").unwrap_or(true),
        );
        options.set(
            Options::ENABLE_GFM,
            !legacy && flag("admonitions").unwrap_or(true),
        );
        Settings {
            options,
            wrapper: context["renderer"].as_str() == Some("html"),
            warnings: context["config"]["preprocessor"]["ltem"]["warnings"]
                .as_bool()
                .unwrap_or(true),
        }
    }
}

/// Preprocess the JSON input; returns the book as JSON and the warnings.
fn preprocess(input: &str) -> Result<(String, Vec<String>), String> {
    let value: Value =
        serde_json::from_str(input).map_err(|e| format!("cannot read the input as JSON: {e}"))?;
    let Value::Array(mut parts) = value else {
        return Err("the input must be the JSON array [context, book]".to_string());
    };
    if parts.len() != 2 {
        return Err("the input must be the JSON array [context, book]".to_string());
    }
    let mut book = parts.pop().expect("two parts");
    let settings = Settings::from_context(&parts[0]);
    let mut warnings = Vec::new();
    visit_chapters(&mut book, &settings, &mut warnings);
    let output = serde_json::to_string(&book).map_err(|e| format!("cannot write the book: {e}"))?;
    Ok((output, warnings))
}

/// Process every chapter of the book: each `{"Chapter": {...}}` object, at any depth.
fn visit_chapters(value: &mut Value, settings: &Settings, warnings: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::Object(chapter)) = map.get_mut("Chapter") {
                let path = ["source_path", "path"]
                    .iter()
                    .find_map(|key| chapter.get(*key).and_then(Value::as_str))
                    .unwrap_or("")
                    .to_string();
                if let Some(Value::String(content)) = chapter.get_mut("content") {
                    *content = process_chapter(content, &path, settings, warnings);
                }
            }
            for value in map.values_mut() {
                visit_chapters(value, settings, warnings);
            }
        }
        Value::Array(items) => {
            for value in items {
                visit_chapters(value, settings, warnings);
            }
        }
        _ => {}
    }
}

/// The chapter's Markdown with every LTEM table that mdBook would not render the same
/// way on its own replaced by its HTML.
///
/// The table's lines become one line: the container prefix of its first line (such as
/// `> ` or a list marker), an empty HTML comment and the table. A line that begins with
/// `<!--` is an HTML block that ends at the first line holding `-->`, which is the
/// same line, so the lines after it are read as before and nothing else changes.
fn process_chapter(
    content: &str,
    path: &str,
    settings: &Settings,
    warnings: &mut Vec<String>,
) -> String {
    let tables = pulldown_cmark_ltem::find_tables(content, settings.options);
    if settings.warnings {
        for table in &tables {
            warnings.extend(problems(table, path));
        }
    }
    let mut out = content.to_string();
    for table in tables.iter().rev().filter(|t| !t.native) {
        let line_start = content[..table.range.start]
            .rfind(['\n', '\r'])
            .map_or(0, |i| i + 1);
        let prefix = &content[line_start..table.range.start];
        // After a task list marker the HTML would be inline, inside a paragraph.
        if prefix.contains('[') {
            continue;
        }
        let body = content[table.range.clone()].trim_end_matches(['\n', '\r']);
        let ending = &content[table.range.start + body.len()..table.range.end];
        let html = table.html.replace('\n', "");
        let html = if settings.wrapper {
            format!("<div class=\"table-wrapper\">{html}</div>")
        } else {
            html
        };
        out.replace_range(
            line_start..table.range.end,
            &format!("{prefix}<!---->{html}{ending}"),
        );
    }
    hide_other_tables(&mut out, settings.options);
    out
}

/// Keep mdBook from reading lines as a GFM table where LTEM reads none.
///
/// pulldown-cmark reads some lines as a delimiter row that GFM and LTEM do not, such as
/// `- | -`, which is a list item. An empty HTML comment at the end of such a line keeps
/// it from being a delimiter row (which may only hold `-`, `:`, `|` and spaces), and the
/// line renders as before: as a list item or as paragraph text.
fn hide_other_tables(markdown: &mut String, options: Options) {
    loop {
        let ltem: HashSet<usize> = pulldown_cmark_ltem::find_tables(markdown, options)
            .iter()
            .map(|t| t.range.start)
            .collect();
        let delimiter_ends: Vec<usize> = Parser::new_ext(markdown, options)
            .into_offset_iter()
            .filter_map(|(event, range)| match event {
                Event::Start(Tag::Table(_)) if !ltem.contains(&range.start) => {
                    // The delimiter row is the line after the header row.
                    let header_end = line_end(markdown, range.start);
                    let next = header_end + line_ending_len(&markdown[header_end..]);
                    Some(line_end(markdown, next))
                }
                _ => None,
            })
            .collect();
        if delimiter_ends.is_empty() {
            return;
        }
        for end in delimiter_ends.into_iter().rev() {
            markdown.insert_str(end, "<!---->");
        }
    }
}

/// The byte offset of the end of the line that holds `offset`, before its line ending.
fn line_end(text: &str, offset: usize) -> usize {
    text[offset..]
        .find(['\n', '\r'])
        .map_or(text.len(), |i| offset + i)
}

/// The length of the line ending at the start of `text`.
fn line_ending_len(text: &str) -> usize {
    if text.starts_with("\r\n") {
        2
    } else {
        usize::from(text.starts_with(['\n', '\r']))
    }
}

/// The validation errors of a table, as `path:line: problem`. Warnings (rule V14, a
/// row padded or cut as in GFM) are left out: they are common in valid GFM tables.
fn problems<'t>(table: &'t TableBlock, path: &'t str) -> impl Iterator<Item = String> + 't {
    table
        .problems
        .iter()
        .filter(|p| p.severity() == "error")
        .map(move |p| {
            // Body rows follow the delimiter row.
            let below = usize::from(p.row >= table.table.header_rows);
            let line = table.lines.start + p.row + below + 1;
            format!("{path}:{line}: {p}")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings() -> Settings {
        Settings::from_context(&json!({"renderer": "markdown"}))
    }

    #[test]
    fn options_follow_the_mdbook_version_and_config() {
        let modern =
            Settings::from_context(&json!({"mdbook_version": "0.5.4", "renderer": "html"}));
        assert!(modern.wrapper && modern.warnings);
        assert!(modern.options.contains(
            Options::ENABLE_SMART_PUNCTUATION
                | Options::ENABLE_DEFINITION_LIST
                | Options::ENABLE_GFM
        ));
        let legacy = Settings::from_context(&json!({"mdbook_version": "0.4.52"}));
        assert!(!legacy.options.contains(Options::ENABLE_SMART_PUNCTUATION));
        assert!(!legacy.options.contains(Options::ENABLE_DEFINITION_LIST));
        let curly = json!({"mdbook_version": "0.4.10",
            "config": {"output": {"html": {"smart-punctuation": false, "curly-quotes": true}}}});
        assert!(Settings::from_context(&curly)
            .options
            .contains(Options::ENABLE_SMART_PUNCTUATION));
        let off = json!({"mdbook_version": "0.5.0", "config": {
            "output": {"html": {"smart-punctuation": false, "definition-lists": false, "admonitions": false}},
            "preprocessor": {"ltem": {"warnings": false}}}});
        let off = Settings::from_context(&off);
        assert!(!off.warnings && !off.wrapper);
        assert_eq!(
            off.options,
            Options::ENABLE_TABLES
                | Options::ENABLE_FOOTNOTES
                | Options::ENABLE_STRIKETHROUGH
                | Options::ENABLE_TASKLISTS
                | Options::ENABLE_HEADING_ATTRIBUTES
        );
    }

    #[test]
    fn tables_become_one_line() {
        let mut warnings = Vec::new();
        let md = "Intro\n> | a {c:2} |\n> |---|---|\n> | << | 1 |\r\nafter\n";
        let out = process_chapter(md, "ch.md", &settings(), &mut warnings);
        assert_eq!(
            out,
            "Intro\n> <!----><table><thead><tr><th colspan=\"2\">a</th></tr></thead><tbody>\
             <tr><td>&lt;&lt;</td><td>1</td></tr></tbody></table>\r\nafter\n"
        );
        assert_eq!(
            warnings,
            ["ch.md:4: V13 at (1,0): '<<' has no cell to extend"]
        );
    }

    #[test]
    fn gfm_tables_and_other_text_stay() {
        let mut warnings = Vec::new();
        let md = "| a | b |\n|---|---|\n| 1 |\n\n```\n| a {c:2} |\n|---|---|\n```\n";
        assert_eq!(process_chapter(md, "", &settings(), &mut warnings), md);
        assert!(warnings.is_empty());
    }

    #[test]
    fn lines_that_only_pulldown_cmark_reads_as_a_table_are_kept_from_it() {
        let md = "Size | Price\n- | -\n\n| a |\n|-:-|\r\n";
        let out = process_chapter(md, "", &settings(), &mut Vec::new());
        assert_eq!(out, "Size | Price\n- | -<!---->\n\n| a |\n|-:-|<!---->\r\n");
    }

    #[test]
    fn a_table_after_a_task_marker_stays() {
        let md = "- [ ] | a {c:2} |\n  |---|---|\n";
        assert_eq!(process_chapter(md, "", &settings(), &mut Vec::new()), md);
    }

    #[test]
    fn input_errors() {
        assert!(preprocess("not json").unwrap_err().contains("JSON"));
        assert!(preprocess("{}").unwrap_err().contains("[context, book]"));
        assert!(preprocess("[1, 2, 3]")
            .unwrap_err()
            .contains("[context, book]"));
        assert_eq!(
            preprocess("[{}, {\"items\": []}]").unwrap().0,
            "{\"items\":[]}"
        );
    }
}
