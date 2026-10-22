/**
 * Live Preview in a real browser engine: what is shown, Korean IME composition on styled
 * lines, check boxes, links, images, switching to the source, and tables.
 *
 *     npm run build && npm run test:browser
 *
 * With LTEM_SHADOW=1 the page has the editor in a Shadow DOM under a policy that allows no
 * inline styles, as in the application.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { call as callIn, compose as composeIn, composeSyllable, open, type Harness } from "./harness.ts";

let h: Harness;
const requests: string[] = [];
before(async () => {
  h = await open();
  h.page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
});
after(async () => {
  await h?.browser.close();
});

const call = <T>(name: string, ...args: unknown[]): Promise<T> => callIn<T>(h, name, ...args);
const doc = (): Promise<string> => call<string>("doc");
const setDoc = (text: string, cursor: number): Promise<void> => call("setDoc", text, cursor);
type Line = { cls: string; text: string };
const lines = (): Promise<Line[]> => call<Line[]>("lines");
const idle = (): Promise<void> => h.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

const DOC = [
  "# 제목 *강조*", "", "글 **굵게** 와 [링크](http://example.com/a) 그리고 `코드`", "", "- 항목 하나", "- [ ] 할 일", "",
  "> 인용 글", "", "```js", "let x = 1", "```", "", "---", "", "끝",
].join("\n");

describe("what Live Preview shows", () => {
  test("marks hidden away from the cursor, shown on its line; text styled", async () => {
    await setDoc(DOC, DOC.length);
    const shown = await lines();
    assert.deepEqual(shown[0], { cls: "cm-live-heading cm-live-h1", text: "제목 강조" });
    assert.equal(shown[2].text, "글 굵게 와 링크 그리고 코드");
    assert.equal(shown[4].text, "• 항목 하나");
    assert.equal(shown[7].cls, "cm-live-quote cm-live-quote-1");
    assert.equal(shown[7].text, "인용 글");
    assert.equal(await call("count", ".cm-live-checkbox"), 1);
    assert.equal(await call("count", ".cm-live-hr"), 1);
    assert.deepEqual(await call("texts", ".cm-live-link"), ["링크"]);
    await setDoc(DOC, DOC.indexOf("굵게"));
    assert.equal((await lines())[2].text, "글 **굵게** 와 [링크](http://example.com/a) 그리고 `코드`".replace("[링크](http://example.com/a)", "링크").replace("`코드`", "코드"));
    await setDoc(DOC, 2);
    assert.equal((await lines())[0].text, "# 제목 강조");
  });

  test("switching to the source and back", async () => {
    await setDoc(DOC, DOC.length);
    assert.equal(await call("live"), true);
    await call("toggle");
    assert.equal(await call("live"), false);
    assert.equal((await lines())[0].text, "# 제목 *강조*");
    assert.equal(await call("count", ".cm-live-checkbox"), 0);
    await call("setLive", true);
    assert.equal((await lines())[0].text, "제목 강조");
  });
});

describe("Korean composition on styled lines", () => {
  for (const [name, anchor] of [["a heading", "제목"], ["a list item", "항목 하나"], ["a link", "링크"], ["a block quote", "인용 글"]] as const) {
    test(`in ${name}: the syllables once, the other lines unchanged during the composition`, async () => {
      const at = DOC.indexOf(anchor) + anchor.length;
      await setDoc(DOC, at);
      const before = await lines();
      await composeSyllable(h, "한", false);
      const during = await lines();
      // Lines other than the one composed in keep their look while composing.
      const line = DOC.slice(0, at).split("\n").length - 1;
      assert.deepEqual(during.filter((_, i) => i !== line), before.filter((_, i) => i !== line));
      await h.cdp.send("Input.insertText", { text: "한" });
      await composeIn(h, "글");
      assert.equal(await doc(), DOC.slice(0, at) + "한글" + DOC.slice(at));
    });
  }

  test("Enter during composition in a list item commits the syllable once (Joplin #16745)", async () => {
    const at = DOC.indexOf("항목 하나") + 5;
    await setDoc(DOC, at);
    await composeSyllable(h, "한", false);
    await h.page.keyboard.press("Enter");
    await h.cdp.send("Input.insertText", { text: "한" });
    await idle();
    const text = await doc();
    assert.equal(text.split("한").length - 1, 1, text);
    assert.match(text, /- 항목 하나한\n/);
  });

  test("at a line-wrap point in a styled paragraph no character is lost", async () => {
    const long = `**굵게** ${"가나다라마바사 ".repeat(12)}`;
    const text = `${long}\n\n끝`;
    await setDoc(text, long.length);
    await composeIn(h, "한글표");
    assert.equal(await doc(), `${long}한글표\n\n끝`);
  });
});

describe("check boxes, links and images", () => {
  test("a check box toggles its task item", async () => {
    await setDoc(DOC, DOC.length);
    await h.page.locator(".cm-live-checkbox").click();
    assert.match(await doc(), /- \[x\] 할 일/);
    await h.page.locator(".cm-live-checkbox").click();
    assert.match(await doc(), /- \[ \] 할 일/);
  });

  test("Ctrl-click opens a link through the application; a click puts the cursor there", async () => {
    await setDoc(DOC, DOC.length);
    await h.page.locator(".cm-live-link").click({ modifiers: ["Control"] });
    assert.deepEqual(await call("opened"), ["http://example.com/a"]);
    await h.page.locator(".cm-live-link").click();
    assert.match((await lines())[2].text, /\[링크\]\(http:\/\/example\.com\/a\)/);
    assert.equal((await call<string[]>("opened")).length, 1);
  });

  test("images: local ones through the application; remote ones never loaded", async () => {
    const text = "![작은 그림](local.png)\n\n![원격](https://example.com/r.png)\n\n![바뀐 원격](remote-after.png)\n\n![없음](missing.png)\n\n끝";
    await setDoc(text, text.length);
    await idle();
    assert.equal(await call("count", "img.cm-live-image"), 1);
    assert.deepEqual(await call("texts", ".cm-live-image-remote"), ["원격", "바뀐 원격"]);
    assert.deepEqual(await call("texts", ".cm-live-image-unresolved"), ["없음"]);
    assert.deepEqual(requests, []);
  });
});

describe("drawn by the application: math, Mermaid, front matter", () => {
  const TEXT = "---\ntitle: 표\ntags: [a]\n---\n\n글 $x^2$ 과 $$y$$ 끝.\n\n$$\n\\frac{a}{b}\n$$\n\n```mermaid\ngraph TD; A-->B\n```\n\n끝";

  test("drawn where the cursor is not; a click shows the source", async () => {
    await setDoc(TEXT, TEXT.length);
    await h.page.waitForFunction(() => (window as never as { ltemTest: { texts(s: string): string[] } }).ltemTest.texts(".cm-live-rendered-mermaid").some((t) => t.startsWith("diagram:")));
    assert.deepEqual(await call("texts", ".cm-live-rendered-math"), ["inline:x^2", "display:y", "display:\\frac{a}{b}"]);
    assert.deepEqual(await call("texts", ".cm-live-rendered-mermaid"), ["diagram:graph TD; A-->B"]);
    assert.deepEqual(await call("texts", ".cm-live-rendered-frontmatter"), ["properties:2"]);
    await h.page.locator(".cm-live-rendered-mermaid").click();
    assert.equal(await call("count", ".cm-live-rendered-mermaid"), 0);
    assert.ok((await lines()).some((l) => l.text === "```mermaid"));
  });

  test("display math in a block quote is drawn without the quote marks", async () => {
    const quoted = "글\n\n> $$\n> a+b\n> $$\n\n끝";
    await setDoc(quoted, quoted.length);
    assert.deepEqual(await call("texts", ".cm-live-rendered-math"), ["display:a+b"]);
  });

  test("Korean composition next to drawn math", async () => {
    const at = TEXT.indexOf(" 끝.");
    await setDoc(TEXT, at);
    await composeIn(h, "한글");
    assert.equal(await doc(), TEXT.slice(0, at) + "한글" + TEXT.slice(at));
    assert.equal((await call<string[]>("texts", ".cm-live-rendered-math")).includes("inline:x^2"), true);
  });
});

describe("footnotes, line breaks, nested quotes", () => {
  const TEXT = "본문[^a] 그리고^[인라인 각주] 다시[^a] 없음[^zz].\n\n첫 줄  \n둘째 줄\n\n> 바깥\n> > 안쪽 인용\n> > 둘째\n\n[^a]: 각주 내용\n    이어짐\n\n끝";

  test("references and definitions as numbers; Ctrl-click goes to the definition and back", async () => {
    await setDoc(TEXT, TEXT.length);
    assert.deepEqual(await call("texts", ".cm-live-footnote-ref"), ["[1]", "[2]", "[1:1]"]);
    assert.deepEqual(await call("texts", ".cm-live-footnote-label"), ["1."]);
    await h.page.locator(".cm-live-footnote-ref").first().click({ modifiers: ["Control"] });
    assert.equal(await call("head"), TEXT.indexOf("[^a]:"));
    await setDoc(TEXT, TEXT.length);
    await h.page.locator(".cm-live-footnote-label").click({ modifiers: ["Control"] });
    assert.equal(await call("head"), TEXT.indexOf("[^a]"));
  });

  test("a line break at the end of a line is shown; nested quotes have a bar per level", async () => {
    await setDoc(TEXT, TEXT.length);
    assert.equal(await call("count", ".cm-live-hardbreak"), 1);
    const padding = (await call<string[]>("styles", ".cm-live-quote", "padding-left")).map((p) => parseFloat(p));
    assert.deepEqual(padding, [18, 30, 30]);
    const bars = await call<string[]>("styles", ".cm-live-quote-2", "background-image");
    assert.equal((bars[0].match(/rgb\(/g) ?? []).length, 4, bars[0]); // two bars, two colour stops each
  });

  for (const [name, anchor] of [["a footnote definition", "각주 내용"], ["a line with a line break", "첫 줄"], ["a nested quote", "안쪽 인용"], ["right after a footnote reference", "본문[^a]"]] as const) {
    test(`Korean composition in ${name}`, async () => {
      const at = TEXT.indexOf(anchor) + anchor.length;
      await setDoc(TEXT, at);
      await composeIn(h, "한글");
      assert.equal(await doc(), TEXT.slice(0, at) + "한글" + TEXT.slice(at));
    });
  }
});

describe("tables in Live Preview", () => {
  test("an LTEM table is shown as a table and edited there", async () => {
    const text = "글\n\n| 구분 | 금액 |\n|---|---|\n| 인건비 | 100 |\n\n끝";
    await setDoc(text, 0);
    assert.equal(await call("count", ".cm-ltem-widget"), 1);
    await h.page.locator(".cm-ltem-widget td", { hasText: /^100$/ }).click();
    await h.page.keyboard.type("0");
    await h.page.keyboard.press("Enter");
    assert.match(await doc(), /\| 인건비 \| 1000 \|/);
    await call("setLive", false);
    assert.equal(await call("count", ".cm-ltem-widget"), 0);
    await call("setLive", true);
  });
});

describe("the application's environment", () => {
  test("theme variables override colours; nothing is refused by the policy", async () => {
    await setDoc(DOC, DOC.length);
    await call("setHostVariable", "--cm-live-link-color", "rgb(1, 2, 3)");
    assert.equal(await call("style", ".cm-live-link", "color"), "rgb(1, 2, 3)");
    assert.deepEqual(await call("violations"), []);
  });
});
