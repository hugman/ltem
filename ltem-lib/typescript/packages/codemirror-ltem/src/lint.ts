/** Validation problems of LTEM tables as CodeMirror diagnostics, with fixes. */

import type { EditorState, Extension } from "@codemirror/state";
import { linter, type Action, type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { problemSeverity, type Problem } from "ltem-core";

import { sourceCellAt } from "./analysis.js";
import { fixTable, keepCoveredText } from "./commands.js";
import { tableAt, tablesIn } from "./query.js";

/** How a problem is described: in English (the LTEM core's message), in Korean, or by a function. */
export type LtemMessages = "en" | "ko" | ((problem: Problem) => string);

const KOREAN: Record<string, string> = {
  V1: "병합 속성 값이 잘못되었습니다. 값이 0이거나, 같은 키(c 또는 r)가 두 번 나옵니다.",
  V2: "병합이 표의 마지막 열을 넘습니다. 넘는 부분은 잘립니다.",
  V3: "병합이 표의 마지막 행을 넘습니다. 넘는 부분은 잘립니다.",
  V4: "병합한 칸이 다른 칸과 겹칩니다. 겹치지 않게 잘립니다.",
  V5: "위 행에서 병합해 내려온 자리에 글자가 있습니다. 이 글자는 버려집니다. 빈칸이나 ^^로 두세요.",
  V6: "왼쪽 칸이 병합해 덮은 자리에 글자가 있습니다. 이 글자는 버려집니다. 빈칸이나 <<로 두세요.",
  V7: "머리 행의 칸은 본문까지 병합할 수 없습니다. 머리 행 끝에서 잘립니다.",
  V13: "늘릴 칸이 없는 병합 표시입니다. 글자로 보입니다. 글자로 쓰려면 \\<<, \\^^로 쓰세요.",
  V14: "이 행의 칸 수가 표의 열 수와 맞지 않습니다. 모자라면 빈칸을 더하고, 넘치면 버립니다.",
};

const ACTION_NAMES = {
  en: { fix: "Fix table", text: "Write as text", keep: "Keep the text" },
  ko: { fix: "표 정리", text: "글자로 쓰기", keep: "글자 살리기" },
};

function describe(problem: Problem, messages: LtemMessages): string {
  if (typeof messages === "function") return messages(problem);
  if (messages === "ko") return `${problem.rule}: ${KOREAN[problem.rule] ?? problem.message}`;
  return `${problem.rule}: ${problem.message}`;
}

export interface LtemDiagnosticOptions {
  /** Language of the messages and fix names (default "en"). */
  messages?: LtemMessages;
}

/**
 * The problems of the LTEM tables in a range of the document (spec Section 5). A problem
 * is shown on the cell, placeholder or marker concerned; V14, which concerns a row, on the
 * whole row. V14 is a warning, every other rule an error.
 *
 * Each problem offers a fix: "Fix table" rewrites the table in canonical form, which writes
 * out the recovery rules (spec Section 3.6) so that no problem is left, dropping text that
 * a merged cell covers. Text where a merged cell lies (V5, V6) can instead be kept, by
 * shrinking the merged cell; a marker with no cell to extend (V13) can be escaped so that
 * it reads as text.
 */
export function ltemDiagnostics(state: EditorState, from = 0, to = state.doc.length, options: LtemDiagnosticOptions = {}): Diagnostic[] {
  const messages = options.messages ?? "en";
  const names = ACTION_NAMES[messages === "ko" ? "ko" : "en"];
  const fix: Action = {
    name: names.fix,
    apply(view, at) {
      const table = tableAt(view.state, at);
      if (table) view.dispatch(fixTable(view.state, table));
    },
  };
  const out: Diagnostic[] = [];
  for (const table of tablesIn(state, from, to)) {
    const { analysis, lineStarts } = table;
    for (const problem of analysis.result.problems) {
      const rowLine = analysis.rows.find((r) => r.row === problem.row);
      if (!rowLine) continue;
      const start = lineStarts[rowLine.line];
      let range = { from: start, to: start + analysis.lines[rowLine.line].length };
      let marker = false;
      let covered = false;
      if (problem.col !== null) {
        const found = sourceCellAt(analysis, problem.row, problem.col);
        if (found) {
          const i = found.row.cells.indexOf(found.cell);
          if (found.cell.end > found.cell.start) {
            range = { from: start + found.cell.start, to: start + found.cell.end };
          } else {
            const b = found.row.bounds[i];
            range = { from: start + b.from, to: start + Math.max(b.to, b.from + 1) };
          }
          marker = problem.rule === "V13" && (found.cell.text === "<<" || found.cell.text === "^^");
          covered = (problem.rule === "V5" || problem.rule === "V6") && found.cell.end > found.cell.start;
        }
      }
      const actions: Action[] = [fix];
      if (marker) {
        actions.unshift({
          name: names.text,
          apply(view, a) {
            view.dispatch({ changes: { from: a, insert: "\\" }, userEvent: "input.ltem.fix" });
          },
        });
      }
      if (covered) {
        const { row, col } = problem;
        actions.unshift({
          name: names.keep,
          apply(view, a) {
            const current = tableAt(view.state, a);
            const spec = current && keepCoveredText(view.state, current, row, col!);
            if (spec) view.dispatch(spec);
          },
        });
      }
      out.push({
        from: range.from,
        to: range.to,
        severity: problemSeverity(problem) === "warning" ? "warning" : "error",
        message: describe(problem, messages),
        source: "LTEM",
        actions,
      });
    }
  }
  return out;
}

export interface LtemLintOptions extends LtemDiagnosticOptions {
  /** Milliseconds to wait after the last change before checking (default 500). */
  delay?: number;
}

/**
 * A linter for LTEM tables. While an IME composition (Korean, for example) is in progress
 * it waits for the composition to end, so that the diagnostics do not disturb it.
 */
export function ltemLinter(options: LtemLintOptions = {}): Extension {
  return linter(async (view: EditorView) => {
    while (view.composing) await new Promise((resolve) => setTimeout(resolve, 50));
    return ltemDiagnostics(view.state, 0, view.state.doc.length, options);
  }, { delay: options.delay ?? 500 });
}
