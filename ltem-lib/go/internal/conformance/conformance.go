// Package conformance reads the LTEM conformance cases and compares results the way
// conformance/README.md describes. It is used by the tests of this module.
package conformance

import (
	"encoding/json"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

// Example is a numbered example of the specification (cases/spec-examples.json).
type Example struct {
	Example int               `json:"example"`
	Section string            `json:"section"`
	LTEM    string            `json:"ltem"`
	HTML    string            `json:"html"`
	Tables  []json.RawMessage `json:"tables"`
	Errors  []Error           `json:"errors"`
}

// Error is an expected validation problem. Col is nil for a problem that concerns a
// whole row.
type Error struct {
	Rule string `json:"rule"`
	Row  int    `json:"row"`
	Col  *int   `json:"col"`
}

// Canonical is a case of cases/canonical.json: a table model and its canonical LTEM.
type Canonical struct {
	Case    int             `json:"case"`
	Name    string          `json:"name"`
	Section string          `json:"section"`
	Table   json.RawMessage `json:"table"`
	LTEM    string          `json:"ltem"`
}

// Dir returns the conformance directory of the repository.
func Dir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "conformance")
}

// Examples reads the specification examples.
func Examples() ([]Example, error) {
	var data struct {
		Examples []Example `json:"examples"`
	}
	if err := readJSON(filepath.Join(Dir(), "cases", "spec-examples.json"), &data); err != nil {
		return nil, err
	}
	return data.Examples, nil
}

// CanonicalCases reads the canonical-form cases.
func CanonicalCases() ([]Canonical, error) {
	var data struct {
		Cases []Canonical `json:"cases"`
	}
	if err := readJSON(filepath.Join(Dir(), "cases", "canonical.json"), &data); err != nil {
		return nil, err
	}
	return data.Cases, nil
}

func readJSON(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

// ErrorKey is a validation problem as the conformance tests compare it.
type ErrorKey struct {
	Rule     string
	Row, Col int // Col is -1 for a whole row
}

// Multiset sorts problems so that two lists compare equal when they hold the same
// problems the same number of times, in any order.
func Multiset(keys []ErrorKey) []ErrorKey {
	out := append([]ErrorKey{}, keys...)
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Rule != b.Rule {
			return a.Rule < b.Rule
		}
		if a.Row != b.Row {
			return a.Row < b.Row
		}
		return a.Col < b.Col
	})
	return out
}

// Keys turns expected errors into keys.
func Keys(errors []Error) []ErrorKey {
	keys := make([]ErrorKey, len(errors))
	for i, e := range errors {
		keys[i] = ErrorKey{Rule: e.Rule, Row: e.Row, Col: -1}
		if e.Col != nil {
			keys[i].Col = *e.Col
		}
	}
	return keys
}

// JSONEqual reports whether two JSON documents hold the same value.
func JSONEqual(a, b []byte) (bool, error) {
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		return false, err
	}
	if err := json.Unmarshal(b, &y); err != nil {
		return false, err
	}
	return canonicalJSON(x) == canonicalJSON(y), nil
}

func canonicalJSON(v any) string {
	data, _ := json.Marshal(v) // maps are written with sorted keys
	return string(data)
}

var tablePattern = regexp.MustCompile(`(?s)<table>.*?</table>`)

// Tables returns the normalized <table> elements of an HTML fragment.
func Tables(fragment string) []string {
	var out []string
	for _, t := range tablePattern.FindAllString(fragment, -1) {
		out = append(out, Normalize(t))
	}
	return out
}

var (
	spaces    = regexp.MustCompile(`[ \t\n\r\f]+`)
	textAlign = regexp.MustCompile(`^\s*text-align\s*:\s*(left|center|right)\s*;?\s*$`)
	attribute = regexp.MustCompile(`([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?`)
)

// Normalize returns HTML as one token per line, normalized as conformance/README.md
// describes: whitespace between tags is ignored, text is trimmed where it meets a tag
// and runs of ASCII whitespace in text count as one space (except inside <pre>),
// character references are decoded, attributes are compared as a set,
// style="text-align: X" counts as align="X", and <br> and <br /> are the same.
func Normalize(fragment string) string {
	var tokens []string
	pre := 0
	text := func(s string) {
		s = strings.Trim(html.UnescapeString(s), " \t\n\r\f")
		if s == "" {
			return
		}
		if pre == 0 {
			s = spaces.ReplaceAllString(s, " ")
		}
		tokens = append(tokens, "text "+s)
	}
	for len(fragment) > 0 {
		lt := strings.IndexByte(fragment, '<')
		if lt < 0 {
			text(fragment)
			break
		}
		text(fragment[:lt])
		fragment = fragment[lt:]
		if strings.HasPrefix(fragment, "<!--") {
			end := strings.Index(fragment, "-->")
			if end < 0 {
				end = len(fragment) - 3
			}
			tokens = append(tokens, "comment "+fragment[4:end])
			fragment = fragment[end+3:]
			continue
		}
		gt := strings.IndexByte(fragment, '>')
		if gt < 0 {
			text(fragment)
			break
		}
		tag := fragment[1:gt]
		fragment = fragment[gt+1:]
		if strings.HasPrefix(tag, "/") {
			name := strings.ToLower(strings.TrimSpace(tag[1:]))
			if name == "pre" && pre > 0 {
				pre--
			}
			if name != "br" {
				tokens = append(tokens, "end "+name)
			}
			continue
		}
		tag = strings.TrimSuffix(strings.TrimSpace(tag), "/")
		name, rest, _ := strings.Cut(tag, " ")
		name = strings.ToLower(name)
		var attrs []string
		for _, m := range attribute.FindAllStringSubmatch(rest, -1) {
			key, value := strings.ToLower(m[1]), m[2]+m[3]+m[4]
			value = html.UnescapeString(value)
			if a := textAlign.FindStringSubmatch(value); key == "style" && a != nil {
				key, value = "align", a[1]
			}
			attrs = append(attrs, key+"="+value)
		}
		sort.Strings(attrs)
		tokens = append(tokens, "start "+name+" "+strings.Join(attrs, " "))
		if name == "pre" {
			pre++
		}
		if name == "br" {
			tokens = append(tokens, "end br")
		}
	}
	return strings.Join(tokens, "\n")
}
