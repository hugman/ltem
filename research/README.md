# Research artifacts

Artifacts released with the paper *LTEM: LLM-Friendly Table-Enhanced Markdown for Table Understanding and Generation* (EMNLP 2026).

| Artifact | Where |
|---|---|
| Taxonomy of table structural complexity | [`taxonomy.md`](taxonomy.md) |
| STB, the Synthetic Table Benchmark | [Hugging Face: `eunbinkim777/ltem-stb`](https://huggingface.co/datasets/eunbinkim777/ltem-stb) |

## Taxonomy of table structural complexity

Six structural features (F1–F6), the basic operations for expressing table structure, and six complexity levels (L1–L6), the features a table needs, counted cumulatively. The taxonomy is the yardstick the paper uses to compare table formats and to build STB. See [`taxonomy.md`](taxonomy.md).

## STB: Synthetic Table Benchmark

STB is a set of 1,089 synthetic tables with 4,356 question–answer pairs, about four per table. Existing table benchmarks were collected for particular tasks without control over table structure; most tables in WikiTableQuestions, for example, are simple header–data tables. STB spreads its tables across the complexity levels on purpose, so that a result can be read level by level.

- **Download:** [huggingface.co/datasets/eunbinkim777/ltem-stb](https://huggingface.co/datasets/eunbinkim777/ltem-stb), about 15 MB. The dataset card describes the files and fields.
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Same data as the paper:** the tables and questions are those of the paper's experiments, with six answers corrected (see [Corrections](#corrections)).

### Levels and domains

| Level | Tables | Share | Average rows | Average columns |
|---|---:|---:|---:|---:|
| L1 Atomic grid | 96 | 8.82% | 4.33 | 3.15 |
| L2 Headered table | 334 | 30.67% | 5.63 | 3.34 |
| L3 Spanning table | 342 | 31.40% | 7.15 | 5.22 |
| L4 Multi-level header | 164 | 15.06% | 8.84 | 6.65 |
| L5 Block-partitioned | 87 | 7.99% | 12.66 | 4.20 |
| L6 Composite table | 66 | 6.06% | 15.55 | 11.50 |
| **Total** | **1,089** | 100% | | |

About 30% of the tables are L3, the first level that needs merged cells and so the first that Markdown and CSV cannot express. For multi-table (L6) cases, the averages count all sub-tables.

A table's level is the highest feature it needs ([taxonomy](taxonomy.md#using-the-taxonomy)). In STB, the L1–L4 tables build on each other as the levels do. The L5 and L6 tables add sections (L5) or the composition of several tables (L6) to simpler tables, so not every L5 or L6 table also has nested headers.

| Domain | Tables | Share |
|---|---:|---:|
| Scientific | 366 | 33.61% |
| Financial | 286 | 26.26% |
| Survey | 179 | 16.44% |
| Product | 171 | 15.70% |
| Schedule | 87 | 7.99% |

Levels and domains were sampled independently, so that no domain leans towards particular levels.

### How STB was built

1. **Structure:** a rule-based generator chose each table's level, size and merging pattern.
2. **Content:** Claude Sonnet 4.5 and Claude Opus 4.5 filled in headers and cell values suited to the domain, keeping the structure.
3. **Questions:** GPT-5-mini wrote question–answer pairs of four kinds: lookup, counting, comparison and aggregation.

Generated answers may contain errors, so a question was kept only when two models from different families, Qwen3-VL-8B-Instruct and Phi-4-mini-instruct, both gave the generated answer under the same normalization. This agreement filters out most wrong answers, but an error that both models share can remain. The paper's appendices give the prompt templates and further details.

### Corrections

The released STB corrects the answers to six questions; with them, nEM rises by 0.02 to 0.04 percentage points for each format, and no ranking or significance result changes.

## Citation

Eunbin Kim, Hyeonseok Kang, Sangkeun Jung. *LTEM: LLM-Friendly Table-Enhanced Markdown for Table Understanding and Generation.* EMNLP 2026.

## License

The texts in this folder are licensed under [CC BY 4.0](LICENSE); their examples and any code here are also under the MIT License ([`../LICENSE`](../LICENSE)). STB is published under CC BY 4.0 on Hugging Face.
