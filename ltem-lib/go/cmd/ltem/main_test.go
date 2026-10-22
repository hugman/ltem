package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func runCLI(stdin string, args ...string) (string, string, int) {
	var stdout, stderr bytes.Buffer
	status := run(args, strings.NewReader(stdin), &stdout, &stderr)
	return stdout.String(), stderr.String(), status
}

const sample = "| Region | Revenue | <<  |\r\n| ^^     | Q1      | Q2  |\r\n|--------|--------:|----:|\r\n| Asia   | **1**   | 2 |\r\n"

func TestParse(t *testing.T) {
	out, _, status := runCLI(sample, "parse")
	if status != 0 || !strings.HasPrefix(out, "{\n  \"tables\": [\n    {\n      \"version\": \"1.0\",") ||
		!strings.Contains(out, `"text": "**1**"`) || !strings.HasSuffix(out, "}\n") {
		t.Errorf("status %d, output:\n%s", status, out)
	}
	if out, _, _ := runCLI("no tables\n", "parse"); out != "{\n  \"tables\": []\n}\n" {
		t.Errorf("got %q", out)
	}
	if out, _, _ := runCLI("| <b> |\n|---|", "parse"); !strings.Contains(out, `"text": "<b>"`) {
		t.Errorf("HTML characters must not be escaped in JSON: %s", out)
	}
}

func TestRender(t *testing.T) {
	out, _, status := runCLI(sample+"\n| x |\n|---|\n", "render")
	if status != 0 || !strings.Contains(out, `<th colspan="2" align="right">Revenue</th>`) ||
		!strings.Contains(out, "<strong>1</strong>") || strings.Count(out, "<table>") != 2 || !strings.HasSuffix(out, "</table>\n") {
		t.Errorf("status %d, output:\n%s", status, out)
	}
}

func TestValidate(t *testing.T) {
	invalid := "| A {r:2} | B |\n|---|---|\n| 1 | 2 | 3 |\n"
	out, _, status := runCLI(invalid, "validate", "--json")
	want := "{\n  \"errors\": [\n    {\n      \"rule\": \"V7\",\n      \"row\": 0,\n      \"col\": 0,\n      \"severity\": \"error\"\n    },\n" +
		"    {\n      \"rule\": \"V14\",\n      \"row\": 1,\n      \"col\": null,\n      \"severity\": \"warning\"\n    }\n  ]\n}\n"
	if status != 1 || out != want {
		t.Errorf("status %d, output:\n%s", status, out)
	}
	out, _, status = runCLI(invalid, "validate")
	if status != 1 || out != "table 1: V7 at (0,0): a header cell spans into the body\n"+
		"table 1: V14 at row 1: row has 3 cells; it fits neither as a grid row (2 cells) nor as a compact row\n" {
		t.Errorf("status %d, output:\n%s", status, out)
	}
	if out, _, status := runCLI("| a |\n|---|\n| 1 | 2 |\n", "validate", "--json"); status != 0 || !strings.Contains(out, "V14") {
		t.Errorf("a warning alone leaves the table valid: status %d, %s", status, out)
	}
	if out, _, status := runCLI(sample, "validate", "--json"); status != 0 || out != "{\n  \"errors\": []\n}\n" {
		t.Errorf("status %d, output %q", status, out)
	}
}

func TestFmt(t *testing.T) {
	out, _, status := runCLI("Intro\n\n- item\n  | A {c:2} |\n  |---|:-:|\n  | 1 | 2 |\n\nend", "fmt")
	if want := "Intro\n\n- item\n  | A | << |\n  | --- | :---: |\n  | 1 | 2 |\n\nend"; status != 0 || out != want {
		t.Errorf("status %d, got %q, want %q", status, out, want)
	}
}

func TestWrite(t *testing.T) {
	model := `{"version": "1.0", "rows": 2, "cols": 2, "header_rows": 1, "align": [null, "left"], "cells": [
		{"row": 0, "col": 0, "rowspan": 1, "colspan": 2, "text": "A"},
		{"row": 1, "col": 0, "rowspan": 1, "colspan": 1, "text": "<<"},
		{"row": 1, "col": 1, "rowspan": 1, "colspan": 1, "text": "a|b"}]}`
	want := "| A | << |\n| --- | :--- |\n| \\<< | a\\|b |\n"
	if out, errOut, status := runCLI(model, "write"); status != 0 || out != want {
		t.Errorf("status %d, got %q (%s)", status, out, errOut)
	}
	if out, _, status := runCLI(`{"tables": [`+model+`, `+model+`]}`, "write"); status != 0 || out != strings.TrimSuffix(want, "\n")+"\n\n"+want {
		t.Errorf("status %d, got %q", status, out)
	}
	cases := map[string]int{
		"not json":           2,
		`{"tables": 1}`:      2,
		`{"version": "1.0"}`: 2,
		`[1]`:                2,
		`{"version": "1.0", "rows": 1, "cols": 1, "header_rows": 1, "align": [null], "cells": []}`: 1,
	}
	for input, wantStatus := range cases {
		if _, errOut, status := runCLI(input, "write"); status != wantStatus || errOut == "" {
			t.Errorf("write %q: status %d (want %d), stderr %q", input, status, wantStatus, errOut)
		}
	}
}

func TestArguments(t *testing.T) {
	file := filepath.Join(t.TempDir(), "table.md")
	if err := os.WriteFile(file, []byte(sample), 0o600); err != nil {
		t.Fatal(err)
	}
	fromFile, _, status := runCLI("", "parse", file)
	fromStdin, _, _ := runCLI(sample, "parse", "-")
	if status != 0 || fromFile != fromStdin {
		t.Errorf("file and standard input differ: %d\n%s\n%s", status, fromFile, fromStdin)
	}
	if out, _, status := runCLI("", "validate", file, "--json"); status != 0 || !strings.Contains(out, "errors") {
		t.Errorf("--json after FILE: %d %q", status, out)
	}
	if out, _, status := runCLI("", "--version"); status != 0 || out != "ltem 0.1.0 (LTEM specification 1.0)\n" {
		t.Errorf("--version: %d %q", status, out)
	}
	if out, _, status := runCLI("", "render", "--help"); status != 0 || !strings.HasPrefix(out, "usage: ltem") {
		t.Errorf("--help: %d %q", status, out)
	}
	for _, args := range [][]string{{}, {"nope"}, {"parse", "--json"}, {"parse", "a", "b"}, {"fmt", "-x"}} {
		if _, errOut, status := runCLI("", args...); status != 2 || !strings.Contains(errOut, "ltem: error:") {
			t.Errorf("%q: status %d, stderr %q", args, status, errOut)
		}
	}
	if _, errOut, status := runCLI("", "parse", filepath.Join(t.TempDir(), "missing.md")); status != 2 || errOut == "" {
		t.Errorf("missing file: status %d", status)
	}
	if _, errOut, status := runCLI("| \xff |\n|---|", "parse"); status != 2 || !strings.Contains(errOut, "UTF-8") {
		t.Errorf("invalid UTF-8: status %d, %q", status, errOut)
	}
}
