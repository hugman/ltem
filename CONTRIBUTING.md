# Contributing to LTEM

Thank you for helping LTEM. This page explains the terms that come with a contribution, who decides about the syntax, and what a change has to include.

## Terms of a contribution

A contribution is anything you submit to this repository, such as a pull request, a patch, or text in an issue that you propose for inclusion. By submitting one, you agree to the following.

1. **Copyright.** You license your contribution to everyone under the license of the files it changes: the MIT License for code and tests, CC BY 4.0 for documentation and research texts, CC BY-ND 4.0 for the specification. In addition, you grant EurekaAI Co., Ltd. ("EurekaAI") a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, distribute and sublicense your contribution, and to publish it under other licenses.
2. **Patents.** You grant EurekaAI and every recipient of LTEM a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license under any patent you own or control whose claims your contribution infringes, alone or combined with LTEM, to make, use, sell, offer for sale, import and distribute it. This license ends for anyone who starts a patent claim alleging that LTEM or an implementation of it infringes a patent, as in [`PATENTS`](PATENTS).
3. **Your right to contribute.** The contribution is your own work, or you have the right to submit it under these terms. If it contains material from others, you say so and name its license.
4. **The syntax.** You accept that final decisions about the LTEM syntax and specification are made as described below.

You confirm these terms by signing off every commit with `git commit -s`, which adds a line such as `Signed-off-by: Your Name <you@example.com>`. With the sign-off you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/) and agree to the terms above.

## Decisions about the syntax

The LTEM specification is published by EurekaAI. Its editor, Sangkeun Jung of EurekaAI, makes the final decision on every change to the syntax and to the specification. If adoption grows, a working group may take over this role.

The specification follows the LTEM paper (EMNLP 2026). A change to the syntax should keep what makes LTEM useful:

- a table is plain text that people and language models can read and write line by line;
- every GFM table keeps its meaning;
- renderers without LTEM support still show the cells in rows and columns.

To propose a change, open an issue. Describe the problem, give example tables, and explain what happens to existing LTEM tables.

The text of the specification is written by its editor. Pull requests that change the specification are not merged as they are; the editor writes the change. If you send text for the specification, the license to EurekaAI in item 1 above covers it.

## Code and tests

- Every implementation must pass the conformance tests:
  ```
  python3 conformance/tools/run.py --impl "<command of your implementation>"
  ```
- The cores (Python, TypeScript, Rust, Go and Lua) give the same results. A change in behaviour goes into all of them, with tests in each.
- A change to the specification comes with examples, and the conformance data is updated to match. `conformance/tools/spec_examples.py` checks that the two agree.
- Public files are written in English.
