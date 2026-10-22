// Command ltem parses, renders, validates and formats LTEM tables.
//
//	ltem parse     [FILE]          table models of all tables, as JSON
//	ltem render    [FILE]          HTML of all tables
//	ltem validate  [FILE] [--json] validation problems; exit status 1 if there are errors
//	ltem fmt       [FILE]          the input with every table in canonical form
//	ltem write     [FILE]          canonical LTEM of table models given as JSON
//
// Input is read from FILE, or from standard input if FILE is missing or "-". parse,
// render, validate --json and write follow the command-line protocol of the LTEM
// conformance tests.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

const usage = `usage: ltem <command> [FILE] [options]

LTEM tables: parse, render, validate, format.

commands:
  parse    [FILE]           print the table model of every table as JSON
  render   [FILE]           print the HTML of every table
  validate [FILE] [--json]  print validation problems; exit status 1 if there are errors
  fmt      [FILE]           rewrite the input with every table in canonical form
  write    [FILE]           print the canonical LTEM of table models given as JSON:
                            one model, or {"tables": [...]}

Input is read from FILE, or from standard input if FILE is missing or "-".
`

// Exit statuses.
const (
	exitOK       = 0
	exitProblems = 1 // validate found errors, or write got an invalid table model
	exitUsage    = 2 // a usage error, or the input could not be read
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

type options struct {
	command string
	file    string
	json    bool
}

func parseArgs(args []string) (options, error) {
	if len(args) == 0 {
		return options{}, errors.New("a command is required")
	}
	opts := options{command: args[0]}
	switch opts.command {
	case "parse", "render", "validate", "fmt", "write":
	default:
		return options{}, fmt.Errorf("unknown command: %s", opts.command)
	}
	for _, arg := range args[1:] {
		switch {
		case arg == "--json" && opts.command == "validate":
			opts.json = true
		case strings.HasPrefix(arg, "-") && arg != "-":
			return options{}, fmt.Errorf("unrecognized arguments: %s", arg)
		case opts.file == "":
			opts.file = arg
		default:
			return options{}, fmt.Errorf("unrecognized arguments: %s", arg)
		}
	}
	return opts, nil
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	for i, arg := range args {
		if arg == "-h" || arg == "--help" {
			fmt.Fprint(stdout, usage)
			return exitOK
		}
		if i == 0 && arg == "--version" {
			fmt.Fprintf(stdout, "ltem %s (LTEM specification %s)\n", ltem.Version, ltem.SpecVersion)
			return exitOK
		}
	}
	opts, err := parseArgs(args)
	if err != nil {
		fmt.Fprintf(stderr, "%s\nltem: error: %v\n", usage, err)
		return exitUsage
	}
	text, err := readInput(opts.file, stdin)
	if err != nil {
		fmt.Fprintf(stderr, "ltem: error: %v\n", err)
		return exitUsage
	}
	var out bytes.Buffer
	status := execute(opts, text, &out, stderr)
	if _, err := stdout.Write(out.Bytes()); err != nil {
		fmt.Fprintf(stderr, "ltem: error: %v\n", err)
		return exitUsage
	}
	return status
}

// readInput reads FILE or standard input, which must be UTF-8, and turns every line
// ending into "\n".
func readInput(file string, stdin io.Reader) (string, error) {
	var data []byte
	var err error
	if file == "" || file == "-" {
		data, err = io.ReadAll(stdin)
	} else {
		data, err = os.ReadFile(file)
	}
	if err != nil {
		return "", err
	}
	if !utf8.Valid(data) {
		return "", errors.New("the input is not valid UTF-8")
	}
	return strings.ReplaceAll(strings.ReplaceAll(string(data), "\r\n", "\n"), "\r", "\n"), nil
}

func execute(opts options, text string, out, stderr io.Writer) int {
	switch opts.command {
	case "parse":
		tables := []*ltem.Table{}
		for _, r := range ltem.FindTables(text) {
			tables = append(tables, r.Table)
		}
		writeJSON(out, map[string]any{"tables": tables})
	case "render":
		var parts []string
		for _, r := range ltem.FindTables(text) {
			parts = append(parts, ltem.RenderHTML(r.Table, goldmarkltem.CommonMarkInline))
		}
		fmt.Fprintln(out, strings.Join(parts, "\n"))
	case "validate":
		return validate(text, opts.json, out)
	case "fmt":
		io.WriteString(out, ltem.Format(text))
	case "write":
		return write(text, out, stderr)
	}
	return exitOK
}

func validate(text string, asJSON bool, out io.Writer) int {
	status := exitOK
	problems := []ltem.Problem{}
	for n, r := range ltem.FindTables(text) {
		for _, p := range r.Problems {
			if p.Severity() == ltem.SeverityError {
				status = exitProblems
			}
			if !asJSON {
				fmt.Fprintf(out, "table %d: %s\n", n+1, p)
			}
		}
		problems = append(problems, r.Problems...)
	}
	if asJSON {
		writeJSON(out, map[string]any{"errors": problems})
	}
	return status
}

// write prints the canonical form of the table models in text: one model, or
// {"tables": [...]}.
func write(text string, out, stderr io.Writer) int {
	tables, err := models(text)
	if err != nil {
		fmt.Fprintf(stderr, "ltem: error: not a table model: %v\n", err)
		return exitUsage
	}
	written := make([]string, len(tables))
	for i := range tables {
		if written[i], err = ltem.Write(&tables[i]); err != nil {
			fmt.Fprintf(stderr, "ltem: table %d: %v\n", i+1, err)
			return exitProblems
		}
	}
	fmt.Fprintln(out, strings.Join(written, "\n\n"))
	return exitOK
}

func models(text string) ([]ltem.Table, error) {
	var object map[string]json.RawMessage
	items := []json.RawMessage{json.RawMessage(text)}
	if json.Unmarshal([]byte(text), &object) == nil {
		_, hasVersion := object["version"]
		if list, ok := object["tables"]; ok && !hasVersion {
			if err := json.Unmarshal(list, &items); err != nil {
				return nil, errors.New("tables must be an array")
			}
		}
	}
	tables := make([]ltem.Table, len(items))
	for i, item := range items {
		if err := json.Unmarshal(item, &tables[i]); err != nil {
			return nil, err
		}
	}
	return tables, nil
}

func writeJSON(out io.Writer, v any) {
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		panic(err) // the values written here always encode
	}
}
