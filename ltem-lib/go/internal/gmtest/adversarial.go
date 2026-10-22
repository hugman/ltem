package gmtest

import "strings"

// Adversarial returns documents of about n lines that a parser with a step that
// looks back over a paragraph for each line would read in quadratic time: lines that
// look like delimiter rows whose header rows do not fit, many header rows over a
// delimiter row that does not fit, many tables in one paragraph, and one long table.
func Adversarial(n int) map[string]string {
	return map[string]string{
		"delimiter rows that do not fit": strings.Repeat("| a | b | c |\n|---|---|\n", n/2),
		"header rows that do not fit":    strings.Repeat("| a | b |\n", n) + "|---|\n",
		"tables in one paragraph":        strings.Repeat("| a |\n|---|\n2. x\n", n/3),
		"a long table":                   "| a | b {c:2} |\n|---|---|---|\n" + strings.Repeat("| 1 | **2** | 3 \\\\ x |\n", n),
	}
}
