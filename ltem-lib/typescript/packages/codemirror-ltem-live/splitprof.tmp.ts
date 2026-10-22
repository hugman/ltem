import { open } from "./test-browser/harness.ts";
function table(rows: number, cols: number): string {
  const header = `| ${Array.from({ length: cols }, (_, c) => `열 ${c + 1}`).join(" | ")} |`;
  const body = Array.from({ length: rows }, (_, r) => `| ${Array.from({ length: cols }, (_, c) => `값 ${r}-${c}`).join(" | ")} |`);
  return [header, `|${"---|".repeat(cols)}`, ...body].join("\n");
}
const doc = `글\n\n${table(200, 30)}\n\n끝\n`;
const h = await open();
await h.page.evaluate(([d]) => { const t = (window as any).ltemTest; t.split(false); t.setDoc(d, d.length); t.split(true); }, [doc] as const);
await new Promise((r) => setTimeout(r, 1500));
const at = doc.indexOf("값 100-3") + 4;
await h.page.evaluate(([p]) => (window as any).ltemTest.sourceFocus(p), [at] as const);
for (let i = 0; i < 5; i++) { await h.page.keyboard.type("x"); await new Promise((r) => setTimeout(r, 50)); }
await h.cdp.send("Profiler.enable"); await h.cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await h.cdp.send("Profiler.start");
for (let i = 0; i < 15; i++) { await h.page.keyboard.type("x"); await new Promise((r) => setTimeout(r, 80)); }
const { profile } = await h.cdp.send("Profiler.stop") as any;
const byId = new Map<number, any>(); for (const n of profile.nodes) byId.set(n.id, n);
const parent = new Map<number, number>(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const counts = new Map<number, number>(); profile.samples.forEach((id: number, i: number) => counts.set(id, (counts.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
const incl = new Map<string, number>(); const self = new Map<string, number>();
for (const [id, t] of counts) { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + t);
  const seen = new Set<string>(); for (let x: number | undefined = id; x !== undefined; x = parent.get(x)) { const m = byId.get(x); const kk = `${m.callFrame.functionName || "(anon)"}:${m.callFrame.lineNumber}`; if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) ?? 0) + t); } } }
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000 / 15).toFixed(1)}ms ${k}`).join("\n");
console.log("SELF\n" + top(self, 15)); console.log("INCL\n" + top(incl, 40));
await h.browser.close();
