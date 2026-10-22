/**
 * The application's environment: the editor in a Shadow DOM, under a content security
 * policy that allows no inline styles (style-src 'self'). The component's styles must
 * still apply, and nothing it does may be refused by the policy.
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

const PAGE = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "dist", "page-shadow.html")).href;
// A folder with system libraries that Chromium needs on machines that lack them; added to LD_LIBRARY_PATH when set.
const LIBS = process.env.LTEM_CHROMIUM_LIBS;

let browser: Browser;
let page: Page;
before(async () => {
  browser = await chromium.launch({ env: { ...process.env, LD_LIBRARY_PATH: [LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } });
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.goto(PAGE);
});
after(async () => {
  await browser?.close();
});

function call<T>(name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(([n, a]) => {
    const t = (window as never as { ltemTest: Record<string, (...x: unknown[]) => unknown> }).ltemTest;
    return t[n as string](...(a as unknown[]));
  }, [name, args] as const) as Promise<T>;
}

const DOC = "Text\n\n| 구분 | 금액 | << |\n|:--|:-:|--:|\n| 인건비 | 100 | 200 |\n\nEnd\n";

test("the policy is in force: an inline style is refused", async () => {
  await page.evaluate(() => {
    const root = (window as never as { ltemTest: { root: ShadowRoot } }).ltemTest.root;
    const style = document.createElement("style");
    style.textContent = ".x { color: red }";
    root.appendChild(style);
  });
  await page.waitForFunction(() => (window as never as { ltemTest: { violations(): string[] } }).ltemTest.violations().length > 0);
});

test("in a Shadow DOM under the policy, the component's styles apply and nothing is refused", async () => {
  const before = (await call<string[]>("violations")).length;
  await call("setDoc", DOC, 0);
  await call("setDoc", DOC, DOC.indexOf("인건비"));
  const font = await page.evaluate(() => {
    const root = (window as never as { ltemTest: { root: ShadowRoot } }).ltemTest.root;
    return getComputedStyle(root.querySelector(".cm-ltem-row")!).fontFamily;
  });
  assert.match(font, /monospace/);
  // Shown as a table: alignment, the menu, a range, an edit.
  await call("setWidgets", true);
  await call("setDoc", DOC, 0);
  const align = await page.evaluate(() => {
    const root = (window as never as { ltemTest: { root: ShadowRoot } }).ltemTest.root;
    return Array.from(root.querySelectorAll(".cm-ltem-widget td")).map((c) => getComputedStyle(c).textAlign);
  });
  // The core marks alignment with the align attribute (browsers report it as -webkit-left and so on).
  assert.deepEqual(align.slice(0, 3).map((a) => a.replace("-webkit-", "")), ["left", "center", "right"]);
  await page.locator(".cm-ltem-widget td", { hasText: /^100$/ }).click({ button: "right" });
  assert.ok((await call<string[]>("menuItems")).length > 10);
  await page.locator(".cm-ltem-menu-item", { hasText: "Insert row below" }).click();
  assert.equal(await call("widgetCount"), 1);
  await page.locator(".cm-ltem-widget td", { hasText: /^인건비$/ }).click();
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  assert.match(await call<string>("doc"), /인건비x/);
  assert.deepEqual((await call<string[]>("violations")).slice(before), []);
  await call("setWidgets", false);
});
