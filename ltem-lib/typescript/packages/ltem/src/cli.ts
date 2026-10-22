#!/usr/bin/env node
/**
 * Command-line interface.
 *
 *     ltem parse    [FILE]          table models of all tables, as JSON
 *     ltem render   [FILE]          HTML of all tables
 *     ltem validate [FILE] [--json] validation problems; exit status 1 if there are errors
 *     ltem fmt      [FILE]          rewrite the input with every table in canonical form
 *     ltem write    [FILE]          canonical LTEM of table models given as JSON
 *     ltem from-html [FILE] [--header-rows N] [--plain]   convert HTML tables to LTEM
 *
 * Input is read from FILE or standard input. `parse`, `render`, `validate --json` and
 * `write` follow the command-line protocol of the LTEM conformance tests.
 */

import { readFileSync } from "node:fs";

import { fromHtml } from "./fromhtml/index.js";
import { renderHtml } from "./html.js";
import { checkTable, formatProblem, problemSeverity, problemToJSON, tableFromJSON, type Table } from "./model.js";
import { findTables } from "./parser.js";
import { VERSION } from "./version.js";
import { write } from "./writer.js";

const USAGE = `usage: ltem <command> [FILE]

LTEM tables: parse, render, validate, format, convert from HTML.

commands:
  parse    [FILE]          print the table model of every table as JSON
  render   [FILE]          print the HTML of every table
  validate [FILE] [--json] print validation problems; exit status 1 if there are errors
  fmt      [FILE]          rewrite the input with every table in canonical form
  write    [FILE]          print the canonical LTEM of table models given as JSON:
                           one model, or {"tables": [...]}
  from-html [FILE] [--header-rows N] [--plain]
                           convert every HTML table to LTEM; warnings go to standard error.
                           --header-rows: number of header rows (default: <thead>, leading
                           <th> rows, or 1; 0: no header). --plain: cell text only, without
                           Markdown formatting

Input is read from FILE, or from standard input if FILE is missing or "-".
`;

const COMMANDS = new Set(["parse", "render", "validate", "fmt", "write", "from-html"]);

class UsageError extends Error {}

interface Args {
  command: string;
  file: string | null;
  json: boolean;
  headerRows: number | null;
  plain: boolean;
}

/** An integer as Python's int() reads a command-line value. */
function parseInteger(value: string | undefined, option: string): number {
  if (value === undefined || !/^[ \t]*[+-]?[0-9]+(?:_[0-9]+)*[ \t]*$/.test(value)) {
    throw new UsageError(`argument ${option}: invalid int value: ${value === undefined ? "missing" : `'${value}'`}`);
  }
  return Number.parseInt(value.trim().replaceAll("_", ""), 10);
}

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  if (command === undefined) throw new UsageError("a command is required");
  if (!COMMANDS.has(command)) throw new UsageError(`unknown command: ${command}`);
  let file: string | null = null;
  let json = false;
  let headerRows: number | null = null;
  let plain = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--json" && command === "validate") json = true;
    else if (arg === "--plain" && command === "from-html") plain = true;
    else if (arg === "--header-rows" && command === "from-html") headerRows = parseInteger(rest[++i], arg);
    else if (arg.startsWith("--header-rows=") && command === "from-html") {
      headerRows = parseInteger(arg.slice("--header-rows=".length), "--header-rows");
    } else if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option: ${arg}`);
    else if (file === null) file = arg;
    else throw new UsageError(`unexpected argument: ${arg}`);
  }
  return { command, file, json, headerRows, plain };
}

function read(path: string | null): string {
  const text = readFileSync(path === null || path === "-" ? 0 : path, "utf8");
  return text.replace(/\r\n?/g, "\n"); // universal newlines
}

/**
 * Replace each table in the text by its canonical form, keeping everything else. The
 * table keeps the indentation of its first line, so a table in a list item stays there.
 */
function fmt(text: string): string {
  const lines = text.split("\n");
  for (const result of findTables(text).reverse()) {
    const indent = /^[ \t]*/.exec(lines[result.start])![0];
    const canonical = write(result.table).split("\n").map((line) => indent + line);
    lines.splice(result.start, result.end - result.start, ...canonical);
  }
  return lines.join("\n");
}

/** Print the canonical form of table models: one model, or {"tables": [...]}. */
function writeModels(text: string): number {
  let tables: Table[];
  try {
    const data: unknown = JSON.parse(text);
    const wrapped = typeof data === "object" && data !== null && "tables" in data && !("version" in data);
    const items = wrapped ? (data as { tables: unknown }).tables : [data];
    if (!Array.isArray(items)) throw new TypeError("tables must be an array");
    tables = items.map(tableFromJSON);
  } catch (e) {
    process.stderr.write(`ltem: error: not a table model: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  for (const [n, table] of tables.entries()) {
    const problems = checkTable(table);
    if (problems.length) {
      process.stderr.write(`ltem: table ${n + 1}: invalid table model: ${problems.join("; ")}\n`);
      return 1;
    }
  }
  process.stdout.write(tables.map(write).join("\n\n") + "\n");
  return 0;
}

function main(argv: string[]): number {
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv[0] === "--version") {
    process.stdout.write(`ltem ${VERSION}\n`);
    return 0;
  }
  let args: Args;
  let text: string;
  try {
    args = parseArgs(argv);
    text = read(args.file);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(e instanceof UsageError ? `${USAGE}\nltem: error: ${message}\n` : `ltem: ${message}\n`);
    return 2;
  }
  if (args.command === "write") return writeModels(text);
  if (args.command === "from-html") {
    const converted = fromHtml(text, { headerRows: args.headerRows, inline: args.plain ? "plain" : "markdown" });
    converted.forEach((item, n) => {
      for (const warning of item.warnings) process.stderr.write(`table ${n + 1}: ${warning}\n`);
    });
    process.stdout.write(converted.map((item) => write(item.table)).join("\n\n") + "\n");
    return 0;
  }
  const results = findTables(text);

  switch (args.command) {
    case "parse":
      process.stdout.write(JSON.stringify({ tables: results.map((r) => r.table) }, null, 2) + "\n");
      return 0;
    case "render":
      process.stdout.write(results.map((r) => renderHtml(r.table)).join("\n") + "\n");
      return 0;
    case "validate": {
      const problems = results.flatMap((r) => r.problems);
      if (args.json) {
        const errors = problems.map((p) => ({ ...problemToJSON(p), severity: problemSeverity(p) }));
        process.stdout.write(JSON.stringify({ errors }, null, 2) + "\n");
      } else {
        results.forEach((r, n) => {
          for (const problem of r.problems) process.stdout.write(`table ${n + 1}: ${formatProblem(problem)}\n`);
        });
      }
      return problems.some((p) => problemSeverity(p) === "error") ? 1 : 0;
    }
    default:
      process.stdout.write(fmt(text));
      return 0;
  }
}

process.exitCode = main(process.argv.slice(2));
