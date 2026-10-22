# Using the name LTEM

LTEM is an open notation: anyone may implement it (see [`LICENSE`](LICENSE), [`spec/LICENSE`](spec/LICENSE) and [`PATENTS`](PATENTS)). The name is protected for one reason: an "LTEM table" should mean the same thing in every tool. "LTEM" and the LTEM logo are trademarks of EurekaAI Co., Ltd. ("EurekaAI").

## The marks

The marks are the word "LTEM" and the LTEM logo:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo/lockup/ltem-lockup-horizontal-dark.svg">
  <img src="assets/logo/lockup/ltem-lockup-horizontal.svg" width="240" alt="The LTEM logo: the LTEM symbol next to the word LTEM">
</picture>

The official logo files, with versions for dark backgrounds, one colour and small sizes, are in [`assets/logo/`](assets/logo/). Its README says which file to use where.

## What you may do without asking

- Write about LTEM in papers, articles, documentation, talks and comparisons.
- Say that your software reads or writes LTEM tables, if the conditions below are met.
- Name a package or plugin after the library it extends and LTEM, such as `<library>-ltem`, if it meets the conditions below and does not suggest that EurekaAI makes or endorses it.
- Use the LTEM logo where you may use the name under this policy, as long as you use it unchanged. To use it in any other way, ask EurekaAI first.

## Calling an implementation LTEM

An implementation may be called an LTEM implementation, or be described as "LTEM compatible", only if:

1. it follows the official LTEM specification, and
2. it passes the official conformance tests (in [`conformance/`](conformance/)) for the version it names.

Name the version, for example "LTEM 1.0 compatible". If your software does only part of the work, say which part, for example "renders LTEM 1.0 tables" or "writes LTEM 1.0 tables".

An implementation that does not yet pass the tests may not be described as an LTEM implementation. To describe it in relation to LTEM in another way, for example as "working towards LTEM 1.0", ask EurekaAI first by opening an issue; EurekaAI decides case by case.

## Variants

A notation whose syntax or behaviour is similar to LTEM as described in the LTEM paper or the specification, but that differs from the specification, for example by adding, removing or redefining markers, must not be called LTEM. It must not use a name that could be confused with LTEM either: a name that contains "LTEM" or looks or sounds like it, such as "LTEM+", "LTEM 2" or "L-TEM" (unless EurekaAI publishes it). You may say that it is "based on LTEM".

## Official

Only EurekaAI may call a specification, test suite, library or translation "official".

## Questions and misuse

If you are unsure whether a use is allowed, or think a use does not follow this policy, open an issue in the LTEM repository.

If a use does not follow this policy, EurekaAI will contact the people responsible and ask them to change it, and may take further steps if it is not changed.
