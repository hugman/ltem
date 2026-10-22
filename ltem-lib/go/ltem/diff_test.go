package ltem_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/hugman/ltem/ltem-lib/go/goldmarkltem"
	"github.com/hugman/ltem/ltem-lib/go/internal/conformance"
	"github.com/hugman/ltem/ltem-lib/go/internal/randdoc"
	"github.com/hugman/ltem/ltem-lib/go/ltem"
)

// The differential tests compare this package with the reference implementations on
// random documents. They run when the references are available and are skipped with
// -short. LTEM_DIFF_DOCS sets the number of documents (default 3000), and
// LTEM_RUST_CLI the path of the Rust ltem command.

const diffSeed = 20261019

func diffDocs(t *testing.T) []string {
	n := 3000
	if s := os.Getenv("LTEM_DIFF_DOCS"); s != "" {
		var err error
		if n, err = strconv.Atoi(s); err != nil {
			t.Fatalf("LTEM_DIFF_DOCS: %v", err)
		}
	}
	return randdoc.New(diffSeed).Documents(n)
}

// reference is what testdata/reference.py reports for one table.
type reference struct {
	Table     json.RawMessage `json:"table"`
	Problems  []refProblem    `json:"problems"`
	Forms     []string        `json:"forms"`
	Start     int             `json:"start"`
	End       int             `json:"end"`
	Sources   [][7]int        `json:"sources"`
	HTML      string          `json:"html"`
	Canonical string          `json:"canonical"`
}

type refProblem struct {
	Rule string `json:"rule"`
	Row  int    `json:"row"`
	Col  int    `json:"col"`
}

// TestDifferentialPython compares tables, problems, row forms, table lines, cell
// sources, HTML, the canonical form and fmt with the Python reference implementation.
func TestDifferentialPython(t *testing.T) {
	if testing.Short() {
		t.Skip("skipped with -short")
	}
	uv, err := exec.LookPath("uv")
	if err != nil {
		t.Skip("uv is not installed")
	}
	docs := diffDocs(t)
	dir := t.TempDir()
	in, out := filepath.Join(dir, "in.json"), filepath.Join(dir, "out.json")
	data, _ := json.Marshal(docs)
	if err := os.WriteFile(in, data, 0o600); err != nil {
		t.Fatal(err)
	}
	python := filepath.Join(conformance.Dir(), "..", "ltem-lib", "python")
	script, _ := filepath.Abs(filepath.Join("testdata", "reference.py"))
	cmd := exec.Command(uv, "run", "--quiet", "--directory", python, "python", script, in, out)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("the Python reference did not run: %v\n%s", err, output)
	}
	data, err = os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	var want []struct {
		Results []reference `json:"results"`
		Fmt     string      `json:"fmt"`
	}
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}

	tables, differences := 0, map[string]int{}
	differ := func(doc, what string, got, want any) {
		if differences[what]++; differences[what] <= 3 {
			t.Errorf("%s differs for %q:\n got %v\nwant %v", what, doc, got, want)
		}
	}
	for i, doc := range docs {
		results := ltem.FindTables(doc)
		if len(results) != len(want[i].Results) {
			differ(doc, "number of tables", len(results), len(want[i].Results))
			continue
		}
		for j, r := range results {
			tables++
			ref := want[i].Results[j]
			model, _ := json.Marshal(r.Table)
			if eq, err := conformance.JSONEqual(model, ref.Table); err != nil || !eq {
				differ(doc, "table model", string(model), string(ref.Table))
			}
			problems := make([]refProblem, len(r.Problems))
			for k, p := range r.Problems {
				problems[k] = refProblem{string(p.Rule), p.Row, p.Col}
			}
			if !reflect.DeepEqual(problems, ref.Problems) && (len(problems) > 0 || len(ref.Problems) > 0) {
				differ(doc, "problems", problems, ref.Problems)
			}
			forms := make([]string, len(r.Forms))
			for k, f := range r.Forms {
				forms[k] = f.String()
			}
			if !reflect.DeepEqual(forms, ref.Forms) {
				differ(doc, "row forms", forms, ref.Forms)
			}
			if r.Start != ref.Start || r.End != ref.End {
				differ(doc, "table lines", [2]int{r.Start, r.End}, [2]int{ref.Start, ref.End})
			}
			sources := make([][7]int, len(r.Sources))
			for k, s := range r.Sources {
				sources[k] = [7]int{s.Row, s.Col, s.Rowspan, s.Colspan, s.Line, s.Start, s.End}
			}
			if !reflect.DeepEqual(sources, ref.Sources) && (len(sources) > 0 || len(ref.Sources) > 0) {
				differ(doc, "cell sources", sources, ref.Sources)
			}
			if html := ltem.RenderHTML(r.Table, nil); html != ref.HTML {
				differ(doc, "HTML", html, ref.HTML)
			}
			if text, err := ltem.Write(r.Table); err != nil || text != ref.Canonical {
				differ(doc, "canonical form", text, ref.Canonical)
			}
		}
		normalized := strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(doc)
		if got := ltem.Format(normalized); got != want[i].Fmt {
			differ(doc, "fmt", got, want[i].Fmt)
		}
	}
	t.Logf("compared %d documents and %d tables with the Python reference: differences %v", len(docs), tables, differences)
}

// TestDifferentialRust runs the Rust ltem command on every document and compares parse,
// validate --json, fmt and render (normalized as in the conformance tests).
func TestDifferentialRust(t *testing.T) {
	if testing.Short() {
		t.Skip("skipped with -short")
	}
	cli := os.Getenv("LTEM_RUST_CLI")
	if cli == "" {
		cli = filepath.Join(conformance.Dir(), "..", "ltem-lib", "rust", "target", "release", "ltem")
	}
	if _, err := os.Stat(cli); err != nil {
		t.Skipf("the Rust ltem command is not built: %v", err)
	}
	docs := diffDocs(t)
	run := func(input string, args ...string) string {
		cmd := exec.Command(cli, args...)
		cmd.Stdin = strings.NewReader(input)
		var stdout bytes.Buffer
		cmd.Stdout = &stdout
		if err := cmd.Run(); err != nil && args[0] != "validate" {
			t.Fatalf("ltem %s: %v", args[0], err)
		}
		return stdout.String()
	}
	tables, differences := 0, map[string]int{}
	differ := func(doc, what string, got, want any) {
		if differences[what]++; differences[what] <= 3 {
			t.Errorf("%s differs for %q:\n got %v\nwant %v", what, doc, got, want)
		}
	}
	for _, doc := range docs {
		// The command reads every line ending as "\n".
		doc = strings.NewReplacer("\r\n", "\n", "\r", "\n").Replace(doc)
		results := ltem.FindTables(doc)
		tables += len(results)
		models := []*ltem.Table{}
		var keys []conformance.ErrorKey
		var html []string
		for _, r := range results {
			models = append(models, r.Table)
			for _, p := range r.Problems {
				keys = append(keys, conformance.ErrorKey{Rule: string(p.Rule), Row: p.Row, Col: p.Col})
			}
			html = append(html, ltem.RenderHTML(r.Table, goldmarkltem.CommonMarkInline))
		}
		got, _ := json.Marshal(map[string]any{"tables": models})
		if eq, err := conformance.JSONEqual(got, []byte(run(doc, "parse"))); err != nil || !eq {
			differ(doc, "parse", string(got), run(doc, "parse"))
		}
		var errs struct {
			Errors []conformance.Error `json:"errors"`
		}
		if err := json.Unmarshal([]byte(run(doc, "validate", "--json")), &errs); err != nil {
			t.Fatal(err)
		}
		if want := conformance.Keys(errs.Errors); !reflect.DeepEqual(keys, want) && (len(keys) > 0 || len(want) > 0) {
			differ(doc, "validate", keys, want)
		}
		if got, want := ltem.Format(doc), run(doc, "fmt"); got != want {
			differ(doc, "fmt", got, want)
		}
		if got, want := conformance.Tables(strings.Join(html, "\n")), conformance.Tables(run(doc, "render")); !reflect.DeepEqual(got, want) {
			differ(doc, "render", fmt.Sprint(got), fmt.Sprint(want))
		}
	}
	t.Logf("compared %d documents and %d tables with the Rust command: differences %v", len(docs), tables, differences)
}
