package conformance

import "testing"

func TestNormalize(t *testing.T) {
	same := [][2]string{
		{`<td align="left">a</td>`, `<td style="text-align:left">a</td>`},
		{`<td style="text-align: right;">a</td>`, `<td align="right">a</td>`},
		{`<td colspan="2" align="left">a</td>`, `<td align='left' colspan=2>a</td>`},
		{"<td>6.1&quot; &lt; 7</td>", `<td>6.1" &lt; 7</td>`},
		{"<td>a<br>b</td>", "<td>a<br />b</td>"},
		{"<tr>\n<td> a \n b </td>\n</tr>", "<tr><td>a b</td></tr>"},
		{"<pre>a  b</pre>", "<pre>a  b</pre>"},
	}
	for _, c := range same {
		if Normalize(c[0]) != Normalize(c[1]) {
			t.Errorf("%q and %q differ:\n%s\n--\n%s", c[0], c[1], Normalize(c[0]), Normalize(c[1]))
		}
	}
	different := [][2]string{
		{"<td>　a</td>", "<td>a</td>"},
		{"<pre>a  b</pre>", "<pre>a b</pre>"},
		{`<td align="left">a</td>`, `<td>a</td>`},
		{"<th>a</th>", "<td>a</td>"},
		{"<td>a</td>", "<td>b</td>"},
	}
	for _, c := range different {
		if Normalize(c[0]) == Normalize(c[1]) {
			t.Errorf("%q and %q compare equal", c[0], c[1])
		}
	}
	if got := Tables("<p>x</p>\n<table>\n<tr><td>1</td></tr>\n</table>\n<table><tr></tr></table>"); len(got) != 2 {
		t.Errorf("got %d tables, want 2", len(got))
	}
}

func TestMultiset(t *testing.T) {
	a := Multiset([]ErrorKey{{"V1", 0, 0}, {"V14", 1, -1}, {"V1", 0, 0}})
	b := Multiset([]ErrorKey{{"V14", 1, -1}, {"V1", 0, 0}, {"V1", 0, 0}})
	c := Multiset([]ErrorKey{{"V14", 1, -1}, {"V1", 0, 0}})
	if len(a) != len(b) || a[0] != b[0] || a[1] != b[1] || a[2] != b[2] {
		t.Errorf("%v != %v", a, b)
	}
	if len(a) == len(c) {
		t.Errorf("a repeated problem must count twice")
	}
}
