# LTEM — LLM-friendly Table-Enhanced Markdown

LTEM extends Markdown pipe tables so they can express merged cells and multi-row headers. An LTEM table stays plain, linear text that people and LLMs can read and write.

```
| Region | Revenue | <<  |
| ^^     | Q1      | Q2  |
|--------|---------|-----|
| Asia   | 100     | 120 |
| Europe | 90      | 110 |
```

- `<<` merges a cell with the cell to its left (colspan).
- `^^` merges a cell with the cell above it (rowspan).
- Every row above the `|---|` delimiter row is a header row.

**Status:** LTEM 1.0. The specification, the table model and the conformance tests are final. The libraries are at version 0.1.0. Version 1.0 covers merged cells and multi-row headers.

## Repository layout

| Folder | Contents |
|---|---|
| [`spec/`](spec/) | The LTEM specification (normative) |
| [`ast/`](ast/) | The language-neutral table model that parsers produce (JSON Schema) |
| [`conformance/`](conformance/) | Test cases every LTEM implementation must pass |
| [`ltem-lib/`](ltem-lib/) | Libraries and Markdown-parser plugins, one workspace per language |
| [`docs/`](docs/) | User guide and examples |
| [`research/`](research/) | Taxonomy and benchmark from the paper |

## Paper

Eunbin Kim, Hyeonseok Kang, Sangkeun Jung. *LTEM: LLM-Friendly Table-Enhanced Markdown for Table Understanding and Generation.* EMNLP 2026.

## License

| Part | License |
|---|---|
| Code: libraries, plugins, tools | [MIT](LICENSE) |
| Conformance tests ([`conformance/`](conformance/)) and table model ([`ast/`](ast/)) | [MIT](LICENSE) |
| Specification ([`spec/`](spec/)) | [CC BY-ND 4.0](spec/LICENSE): share it unchanged; no modified versions or translations without permission |
| Documentation ([`docs/`](docs/)) and research texts ([`research/`](research/)) | [CC BY 4.0](docs/LICENSE); the code samples, example tables and prompts in them are also under MIT |

Unless a file or folder says otherwise, the MIT License applies.

- **Patents.** Implementations that pass the LTEM conformance tests receive a royalty-free license to EurekaAI Co., Ltd.'s patent claims that are essential to the LTEM specification. See [`PATENTS`](PATENTS).
- **The name and the logo.** Only implementations that follow the specification and pass the conformance tests may call themselves LTEM. The logo files in [`assets/logo/`](assets/logo/) are not under the MIT License. See [`TRADEMARK.md`](TRADEMARK.md).
- **Contributing.** See [`CONTRIBUTING.md`](CONTRIBUTING.md).
