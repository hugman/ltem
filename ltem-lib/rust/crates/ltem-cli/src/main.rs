//! Command-line interface for LTEM tables.
//!
//! ```text
//! ltem parse     [FILE]                     table models of all tables, as JSON
//! ltem render    [FILE]                     HTML of all tables
//! ltem validate  [FILE] [--json]            validation problems; exit status 1 if errors
//! ltem fmt       [FILE]                     rewrite the input with every table in canonical form
//! ltem write     [FILE]                     canonical LTEM of table models given as JSON
//! ltem from-html [FILE] [--header-rows N] [--plain]   convert HTML tables to LTEM
//! ```
//!
//! Input is read from FILE or standard input. `parse`, `render`, `validate --json` and
//! `write` follow the command-line protocol of the LTEM conformance tests.

#![forbid(unsafe_code)]

use std::io::{self, Read, Write};
use std::process::ExitCode;

use ltem::{
    commonmark_inline, find_tables, from_html_with, render_html, write, FromHtmlOptions,
    InlineFormat, Problem, Table,
};
use serde::Serialize;

const USAGE: &str = "usage: ltem <command> [FILE] [options]

LTEM tables: parse, render, validate, format, convert from HTML.

commands:
  parse     [FILE]                    print the table model of every table as JSON
  render    [FILE]                    print the HTML of every table
  validate  [FILE] [--json]           print validation problems; exit status 1 if there are errors
  fmt       [FILE]                    rewrite the input with every table in canonical form
  write     [FILE]                    print the canonical LTEM of table models given as JSON:
                                      one model, or {\"tables\": [...]}
  from-html [FILE] [--header-rows N] [--plain]
                                      convert HTML tables to canonical LTEM

Input is read from FILE, or from standard input if FILE is missing or \"-\".
--header-rows sets the number of header rows (default: <thead>, leading <th> rows, or 1;
0: the table has no header). --plain keeps cell text only, without Markdown formatting.
";

const COMMANDS: [&str; 6] = ["parse", "render", "validate", "fmt", "write", "from-html"];

/// The output of `ltem parse`, with the table models' keys in schema order.
#[derive(Serialize)]
struct Tables<'a> {
    tables: &'a [Table],
}

/// The output of `ltem validate --json`.
#[derive(Serialize)]
struct Errors<'a> {
    errors: Vec<ProblemJson<'a>>,
}

/// A problem in the conformance protocol's form, with its severity.
#[derive(Serialize)]
struct ProblemJson<'a> {
    rule: &'a str,
    row: usize,
    col: Option<usize>,
    severity: &'static str,
}

struct Args {
    command: String,
    file: Option<String>,
    json: bool,
    header_rows: Option<usize>,
    plain: bool,
}

/// Read `--header-rows` the way Python's `int()` does: 0 means no header, and negative
/// values mean 1.
fn header_rows(value: &str) -> Result<usize, String> {
    let s = value.trim();
    let digits = s.strip_prefix(['+', '-']).unwrap_or(s).replace('_', "");
    let valid = !digits.is_empty()
        && digits.bytes().all(|b| b.is_ascii_digit())
        && !s.trim_start_matches(['+', '-']).starts_with('_')
        && !s.ends_with('_')
        && !s.contains("__");
    if !valid {
        return Err(format!(
            "argument --header-rows: invalid int value: '{value}'"
        ));
    }
    let n = digits.bytes().fold(0usize, |n, d| {
        n.saturating_mul(10).saturating_add(usize::from(d - b'0'))
    });
    Ok(if s.starts_with('-') && n != 0 { 1 } else { n })
}

fn parse_args(argv: &[String]) -> Result<Args, String> {
    let (command, rest) = argv.split_first().ok_or("a command is required")?;
    if !COMMANDS.contains(&command.as_str()) {
        return Err(format!("unknown command: {command}"));
    }
    let mut args = Args {
        command: command.clone(),
        file: None,
        json: false,
        header_rows: None,
        plain: false,
    };
    let mut rest = rest.iter();
    while let Some(arg) = rest.next() {
        let (name, inline_value) = match arg.split_once('=') {
            Some((n, v)) if n.starts_with("--") => (n, Some(v.to_string())),
            _ => (arg.as_str(), None),
        };
        match name {
            "--json" if command == "validate" && inline_value.is_none() => args.json = true,
            "--plain" if command == "from-html" && inline_value.is_none() => args.plain = true,
            "--header-rows" if command == "from-html" => {
                let value = match inline_value {
                    Some(v) => v,
                    None => rest
                        .next()
                        .ok_or("argument --header-rows: expected one argument")?
                        .clone(),
                };
                args.header_rows = Some(header_rows(&value)?);
            }
            _ if arg.starts_with('-') && arg != "-" => {
                return Err(format!("unrecognized arguments: {arg}"))
            }
            _ if args.file.is_none() => args.file = Some(arg.clone()),
            _ => return Err(format!("unrecognized arguments: {arg}")),
        }
    }
    Ok(args)
}

/// The input text, with universal newlines.
fn read_input(file: Option<&str>) -> io::Result<String> {
    let bytes = match file {
        None | Some("-") => {
            let mut buf = Vec::new();
            io::stdin().read_to_end(&mut buf)?;
            buf
        }
        Some(path) => std::fs::read(path)?,
    };
    let text =
        String::from_utf8(bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    Ok(text.replace("\r\n", "\n").replace('\r', "\n"))
}

/// Replace each table in the text by its canonical form, keeping everything else. The
/// table keeps the indentation of its first line, so a table in a list item stays there.
fn fmt(text: &str) -> String {
    let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    for result in find_tables(text).iter().rev() {
        if let Some(Ok(canonical)) = result.table.as_ref().map(write) {
            let first = &lines[result.start];
            let indent =
                first[..first.len() - first.trim_start_matches([' ', '\t']).len()].to_string();
            lines.splice(
                result.start..result.end,
                canonical.split('\n').map(|line| format!("{indent}{line}")),
            );
        }
    }
    lines.join("\n")
}

fn tables(text: &str) -> (Vec<Table>, Vec<Vec<Problem>>) {
    find_tables(text)
        .into_iter()
        .filter_map(|r| r.table.map(|t| (t, r.problems)))
        .unzip()
}

/// The table models in `text`: one model, or `{"tables": [...]}`.
fn models(text: &str) -> Result<Vec<Table>, String> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let items = match value.get("tables") {
        Some(tables) if value.get("version").is_none() => {
            tables.as_array().ok_or("tables must be an array")?.clone()
        }
        _ => vec![value],
    };
    items
        .iter()
        .map(|item| Table::from_json(&item.to_string()).map_err(|e| e.to_string()))
        .collect()
}

fn run(args: &Args, text: &str, out: &mut impl Write) -> io::Result<ExitCode> {
    match args.command.as_str() {
        "parse" => {
            let (tables, _) = tables(text);
            writeln!(
                out,
                "{}",
                serde_json::to_string_pretty(&Tables { tables: &tables })?
            )?;
        }
        "render" => {
            let (tables, _) = tables(text);
            let html: Vec<String> = tables
                .iter()
                .map(|t| render_html(t, Some(&commonmark_inline)))
                .collect();
            writeln!(out, "{}", html.join("\n"))?;
        }
        "validate" => {
            let (_, problems) = tables(text);
            if args.json {
                let errors: Vec<ProblemJson> = problems
                    .iter()
                    .flatten()
                    .map(|p| ProblemJson {
                        rule: &p.rule,
                        row: p.row,
                        col: p.col,
                        severity: p.severity(),
                    })
                    .collect();
                writeln!(out, "{}", serde_json::to_string_pretty(&Errors { errors })?)?;
            } else {
                for (n, list) in problems.iter().enumerate() {
                    for problem in list {
                        writeln!(out, "table {}: {problem}", n + 1)?;
                    }
                }
            }
            if problems.iter().flatten().any(|p| p.severity() == "error") {
                return Ok(ExitCode::from(1));
            }
        }
        "fmt" => out.write_all(fmt(text).as_bytes())?,
        "write" => {
            let tables = match models(text) {
                Ok(tables) => tables,
                Err(e) => {
                    eprintln!("ltem: error: not a table model: {e}");
                    return Ok(ExitCode::from(2));
                }
            };
            let mut written = Vec::new();
            for (n, table) in tables.iter().enumerate() {
                match write(table) {
                    Ok(ltem) => written.push(ltem),
                    Err(e) => {
                        eprintln!("ltem: table {}: {e}", n + 1);
                        return Ok(ExitCode::from(1));
                    }
                }
            }
            writeln!(out, "{}", written.join("\n\n"))?;
        }
        _ => {
            let options = FromHtmlOptions {
                header_rows: args.header_rows,
                inline: if args.plain {
                    InlineFormat::Plain
                } else {
                    InlineFormat::Markdown
                },
            };
            let converted = from_html_with(text, &options);
            let mut stderr = io::stderr().lock();
            let mut written = Vec::new();
            for (n, item) in converted.iter().enumerate() {
                for warning in &item.warnings {
                    writeln!(stderr, "table {}: {warning}", n + 1)?;
                }
                match write(&item.table) {
                    Ok(ltem) => written.push(ltem),
                    Err(e) => {
                        writeln!(stderr, "ltem: table {}: {e}", n + 1)?;
                        return Ok(ExitCode::from(1));
                    }
                }
            }
            writeln!(out, "{}", written.join("\n\n"))?;
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    match argv.first().map(String::as_str) {
        Some("-h" | "--help") => {
            print!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Some("--version") => {
            println!(
                "ltem {} (LTEM specification {})",
                ltem::VERSION,
                ltem::SPEC_VERSION
            );
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    if argv.iter().skip(1).any(|a| a == "-h" || a == "--help") {
        print!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    let args = match parse_args(&argv) {
        Ok(args) => args,
        Err(message) => {
            eprint!("{USAGE}\nltem: error: {message}\n");
            return ExitCode::from(2);
        }
    };
    let text = match read_input(args.file.as_deref()) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("ltem: error: {e}");
            return ExitCode::from(2);
        }
    };
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    let result = run(&args, &text, &mut out).and_then(|code| out.flush().map(|()| code));
    match result {
        Ok(code) => code,
        // A closed pipe (for example `ltem parse | head`) is not an error.
        Err(e) if e.kind() == io::ErrorKind::BrokenPipe => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("ltem: error: {e}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::header_rows;

    #[test]
    fn header_rows_values() {
        assert_eq!(header_rows("2"), Ok(2));
        assert_eq!(header_rows(" +1_0 "), Ok(10));
        assert_eq!(header_rows("-3"), Ok(1));
        assert_eq!(header_rows("-0"), Ok(0));
        assert_eq!(header_rows("0"), Ok(0));
        assert!(header_rows("x").is_err());
        assert!(header_rows("1__0").is_err());
        assert!(header_rows("_1").is_err());
    }
}
