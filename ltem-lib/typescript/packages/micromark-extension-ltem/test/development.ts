/**
 * Run with `node --conditions=development`: micromark's development build checks the
 * events it gets as it goes, and throws where they break its rules.
 */

import { micromark } from "micromark";

import { ltem, ltemHtml } from "../dist/index.js";
import { Random, loadExamples } from "../../../test-support/conformance.ts";
import { randomDocument, randomFragment } from "../../../test-support/documents.ts";

const docs = loadExamples().map((ex) => ex.ltem);
const rng = new Random(20261020);
for (let i = 0; i < 500; i++) docs.push(randomDocument(rng).markdown, randomFragment(rng));
for (const doc of docs) micromark(doc, { extensions: [ltem()], htmlExtensions: [ltemHtml()] });
console.log(`checked ${docs.length} documents`);
