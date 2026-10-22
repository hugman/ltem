# Specification

The normative definition of LTEM: table syntax, span resolution, escaping, canonical form and validation rules.

Authors: Sangkeun Jung, Eunbin Kim. Editor: Sangkeun Jung (EurekaAI). Copyright © 2026 EurekaAI Co., Ltd.

| File | Contents | Status |
|---|---|---|
| [`ltem-spec.md`](ltem-spec.md) | The LTEM 1.0 specification | Final |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history | |
| `grammar.ebnf` | A formal grammar | Later |

The specification formalizes LTEM as published in the EMNLP 2026 paper. Its Appendix A lists what it adds where the paper leaves a detail open, and the five places where it reads a table as GFM does rather than as the paper's grammar does.

Like the GFM specification, `ltem-spec.md` contains numbered examples. Each one gives LTEM input and the expected HTML, separated by a line holding a single `.`. The examples are normative and are extracted into [`../conformance/`](../conformance/).

## License

The specification is licensed under [CC BY-ND 4.0](LICENSE): you may share it unchanged, with credit, but not distribute modified versions or translations without permission. To propose a translation, open an issue; translations that EurekaAI accepts are published as official translations, with the translator's name. The conformance tests, including the examples taken from the specification, are under the MIT License ([`../LICENSE`](../LICENSE)).
