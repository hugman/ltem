---
layout: page
title: LLM-friendly Table-Enhanced Markdown
description: LTEM extends Markdown tables with merged cells and multi-row headers. Proposed in our EMNLP 2026 paper, with libraries in JavaScript, Python and Rust.
---

<div class="lt-home">

<HomeHero />

<TryLtem />

<section class="lt-sec">

## Abstract

<div class="lt-prose lt-justify">

Tables in real-world documents, including scientific papers, financial reports, and statistical summaries, frequently use merged cells, multi-level headers, and sectioned layouts. Yet the lightweight formats LLMs handle best (Markdown, CSV) cannot express these structures, while expressive formats (HTML, LaTeX) impose excessive token cost and parsing complexity. To enable systematic analysis of this trade-off, we introduce a taxonomy decomposing table structure into six atomic features (F1–F6) and corresponding complexity levels (L1–L6), and construct STB (Synthetic Table Benchmark), a controlled benchmark with 1,089 tables systematically distributed across complexity levels. Using this framework, we propose <strong class="lt-brand">LTEM (LLM-friendly Table-Enhanced Markdown)</strong>, a formally specified, minimal extension of Markdown that explicitly encodes spans and hierarchical headers. Experiments across five state-of-the-art LLMs show that LTEM achieves **accuracy comparable to HTML**, offers **a favorable accuracy–token trade-off** relative to HTML and LaTeX, and produces substantially fewer invalid responses than LaTeX; for table generation, LTEM is comparable to MultiMarkdown though HTML is best. We release our taxonomy, benchmark, and format specification to support future research on LLM-table interaction.

</div>
</section>

<section class="lt-sec">

## Why LLM-friendly tables?

<p class="lt-lede">A language model reads a table as a line of text. The format decides how much of the structure survives.</p>

<div class="lt-prose">

A model never sees the grid. It reads a serialization token by token and has to rebuild which cells are headers, how far a merged cell reaches and how the headers nest. The same table gives different answers depending on the format it is written in. And the tables people care about, in papers, financial reports and statistics, depend on exactly that structure: merged cells, multi-level headers, sections.

The formats models handle best cannot hold it. Markdown fills their training data, from GitHub to StackExchange, and chat assistants answer with Markdown tables, yet Markdown has no way to merge a cell. HTML and LaTeX can express everything, at a price: more tokens, and a model must decode `colspan` or `\multicolumn` to work out where each cell sits. **LTEM keeps Markdown's familiar, linear form and makes the structure explicit.**

</div>

<div class="vp-doc lt-table-wrap lt-gap lt-ltem-col">

| Structural feature  | Lightweight | <<       | <<            | Expressive | <<    | LTEM     |
| ^^                  | CSV         | Markdown | MultiMarkdown | HTML       | LaTeX | ^^       |
|---------------------|:-----------:|:--------:|:-------------:|:----------:|:-----:|:--------:|
| F1 Grid             | ✓           | ✓        | ✓             | ✓          | ✓     | ✓        |
| F2 Header roles     | △           | ✓        | ✓             | ✓          | ✓     | ✓        |
| F3 Cell merging     | ✗           | ✗        | △             | ✓          | ✓     | ✓        |
| F4 Header nesting   | ✗           | ✗        | △             | ✓          | ✓     | ✓        |
| F5 Section stacking | ✗           | ✗        | ✗             | △†         | ✓     | ✓        |
| F6 Table composition | ✗          | ✗        | ✗             | △†         | ✓     | ✓*       |

</div>

<p class="lt-caption">What each format can express (paper, Table 1; see the <a href="./research/taxonomy#how-formats-compare">taxonomy</a>). ✓ native, △ partial or non-standard, ✗ not supported.<br>* In the paper's design; LTEM 1.0 leaves F6, several linked tables, for a later version.<br>† HTML can approximate sections and composed tables with several <code>&lt;tbody&gt;</code> elements or separate <code>&lt;table&gt;</code> elements, but it cannot state how the parts relate; that takes extra markup or code of your own.</p>

</section>

<section class="lt-sec">

## Five design rules

<div class="lt-rules">
<div class="lt-rule"><b>Markdown-compatible</b><span>A superset of GFM pipe tables. Models already know the syntax, and where LTEM is not supported the body still reads as a Markdown table.</span></div>
<div class="lt-rule"><b>Linear</b><span>Read top to bottom, the source already makes sense, for a model writing it token by token and for a person reviewing it.</span></div>
<div class="lt-rule"><b>Explicit</b><span>Every span is written down. Nothing is left to infer from alignment or repeated text, a common source of structural hallucination.</span></div>
<div class="lt-rule"><b>Minimal</b><span>A handful of marks on top of Markdown: <code>&lt;&lt;</code>, <code>^^</code>, <code>{c:N,r:M}</code> and <code>\\</code>. Every row above <code>|---|</code> is a header.</span></div>
<div class="lt-rule"><b>One pass</b><span>A formal grammar that parses in a single pass, with no forward references, in linear time.</span></div>
</div>

<p class="lt-lede" style="margin-top:20px"><a href="./docs/comparison#why-ltem-writes-it-this-way">How these rules compare with other merged-cell syntaxes →</a></p>

</section>

<section class="lt-sec">

## Syntax at a glance

<p class="lt-lede">Seven patterns cover what Markdown tables could not express. Each one shows a GFM table first, then the same table in LTEM.</p>

<SyntaxGallery />

<p class="lt-lede" style="margin-top:20px"><a href="./docs/guide">Writing LTEM tables: the full guide →</a></p>

</section>

<section class="lt-sec">

## How we tested it

<p class="lt-lede">To compare formats fairly, we first had to say what makes a table hard.</p>

<div class="lt-method">
<div class="lt-method-text">

**A taxonomy.** Six structural features build up six cumulative complexity levels. A format that cannot merge cells cannot express L3, or anything above it.

**A benchmark, STB.** Existing benchmarks are mostly flat tables, so "format A beats format B" may only hold for simple ones. STB has 1,089 tables spread across all levels, about 30% at L3, where Markdown and CSV stop being able to express the table. They come from five domains with 4,356 questions: lookup, counting, comparison and aggregation. STB is on Hugging Face as [ltem-stb](https://huggingface.co/datasets/eunbinkim777/ltem-stb), under CC BY 4.0.

**Models and formats.** Five LLMs (GPT-5, Gemini 2.5 Pro, Llama 4 Maverick, Qwen3-235B, DeepSeek-R1), six formats, three runs each. HiTab adds real-world hierarchical tables.

[The taxonomy in full, with an example for each level →](./research/taxonomy)

</div>
<div class="vp-doc lt-method-table lt-level-table">

| Can a plain Markdown table express it? | Level | What the table needs  | STB tables |
|-----------------|-------|-----------------------|-----------:|
| Yes             | L1    | A grid of cells       | 96         |
| ^^              | L2    | A header row          | 334        |
| No: Markdown has no syntax for merged cells, nested headers or sections | L3    | Merged cells          | 342        |
| ^^              | L4    | Multi-level headers   | 164        |
| ^^              | L5    | Stacked sections      | 87         |
| ^^              | L6    | Several linked tables | 66         |

</div>
</div>

</section>

<section class="lt-sec">

## Results

<p class="lt-lede">Table question answering on STB, averaged over five LLMs and three runs per format.</p>

<StatRow />

<div class="vp-doc lt-table-wrap lt-ltem-row">

| Format        | Accuracy  | <<       | <<     | Tokens | <<    | Errors (%) |
| ^^            | nEM       | Token F1 | Num EM | Prompt | Table | ^^         |
|---------------|----------:|---------:|-------:|-------:|------:|-----------:|
| **LTEM**      | **0.813** | 0.844    | 0.943  | 449    | 228   | **0.29**   |
| HTML          | 0.812     | 0.844    | 0.945  | 612    | 392   | 0.41       |
| MultiMarkdown | 0.810     | 0.843    | 0.946  | 436    | 215   | 0.49       |
| Markdown      | 0.810     | 0.842    | 0.945  | 437    | 217   | 0.61       |
| CSV           | 0.808     | 0.840    | 0.940  | 370    | 149   | 0.31       |
| LaTeX         | 0.777     | 0.812    | 0.933  | 447    | 227   | 3.04       |

</div>

<p class="lt-caption">Paper, Tables 2 and 3. Prompt tokens exclude the LTEM guide; errors are refusals plus invalid answers. The averages include flat tables, which every format can express. The released STB corrects the answers to six questions; with them, nEM rises by 0.02 to 0.04 percentage points for each format, and no ranking or significance result changes.</p>

<details class="lt-source-view">
<summary>This table is itself written in LTEM: view its source</summary>

```text
| Format        | Accuracy  | <<       | <<     | Tokens | <<    | Errors (%) |
| ^^            | nEM       | Token F1 | Num EM | Prompt | Table | ^^         |
|---------------|----------:|---------:|-------:|-------:|------:|-----------:|
| **LTEM**      | **0.813** | 0.844    | 0.943  | 449    | 228   | **0.29**   |
| HTML          | 0.812     | 0.844    | 0.945  | 612    | 392   | 0.41       |
| MultiMarkdown | 0.810     | 0.843    | 0.946  | 436    | 215   | 0.49       |
| Markdown      | 0.810     | 0.842    | 0.945  | 437    | 217   | 0.61       |
| CSV           | 0.808     | 0.840    | 0.940  | 370    | 149   | 0.31       |
| LaTeX         | 0.777     | 0.812    | 0.933  | 447    | 227   | 3.04       |
```

</details>

<div class="lt-findings">

- **As accurate as HTML, far shorter.** LTEM matches HTML (0.813 vs. 0.812 nEM) with 42% fewer tokens per table.
- **The most stable answers.** LTEM has the lowest error rate of the six formats, about a tenth of LaTeX's (0.29% vs. 3.04%). Some models break on LaTeX: Qwen3-235B falls from 0.811 with LTEM to 0.660 with LaTeX. LTEM beats LaTeX significantly for four of the five models (McNemar's test).
- **Structure is where models struggle.** Accuracy drops by 5.7 points at L3, where merged cells appear, and by another 5.4 at L4, where headers nest. This is the range LTEM makes explicit.
- **Models pick it up quickly.** In a LoRA pilot, fine-tuning three 4B models on LTEM table questions raised accuracy on held-out STB tables by 0.20 to 0.35 nEM.

</div>

<p class="lt-caption">On real-world HiTab tables, HTML, LaTeX and LTEM land within 0.6 points of each other (0.295, 0.292 and 0.289 nEM). For table generation, HTML scores highest and LTEM is close to MultiMarkdown. What LTEM adds is explicit structure, at HTML-level accuracy and close to Markdown's token cost.</p>

</section>

<section class="lt-sec">

## Ready to adopt

<p class="lt-lede">Cores and plugins for the Markdown parsers people already use, in five languages, plus an editor component. Every implementation passes the same conformance tests.</p>

<div>

<EcosystemGrid />

<p class="lt-lede" style="margin-top:20px"><a href="./libraries">Every library in detail, with setup for each tool →</a></p>


<p class="lt-licence">Code under MIT · Specification under CC BY-ND 4.0 · Documentation under CC BY 4.0 · A royalty-free license to essential patent claims for conforming implementations · The name LTEM is for implementations that pass the conformance tests</p>

</div>

</section>

<section class="lt-sec">

## An editor built on LTEM

<p class="lt-lede">Cellmark Editor is a desktop Markdown editor for Windows. It writes and edits its tables in LTEM.</p>

<div class="lt-built">
<div class="lt-built-id">
<img src="/img/built-with/cellmark-icon.svg" alt="" width="72" height="72" />

### Cellmark Editor

<p class="lt-built-kind">Desktop app for Windows · Free</p>

A fast, lightweight Markdown editor that is especially good with tables. Its table editing is built on [codemirror-ltem](./libraries#js-codemirror-ltem).

[Learn more at eurekax.co →](https://eurekax.co)

</div>
<div class="lt-built-features">

- **Live editing.** Formatting shows right where you type. Switch to Source or Split at any time to see the Markdown.
- **Table editing in LTEM.** Click a cell to edit it in place, and use the table menu to add rows and columns or merge cells. Tables pasted from the web, Word or Excel keep their merged cells.
- **AI table recognition.** Drag over a table in a PDF or HWP document, and it comes in as an LTEM table.
- **Free, and only on your PC.** Free for personal use and for work. Documents never leave the PC, and every feature works without the internet.

</div>
</div>

</section>

<section class="lt-sec">

## Cite

<BibTex />

</section>

</div>
