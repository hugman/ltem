/**
 * Shared set-up for the browser tests: headless Chromium with the test page, IME
 * composition through the DevTools protocol, and calls into the page.
 */

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Browser, type CDPSession, type Page } from "playwright";

/** The test page; with LTEM_SHADOW=1, the one with a Shadow DOM and a policy against inline styles. */
export const PAGE = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "dist",
  process.env.LTEM_SHADOW ? "page-shadow.html" : "page.html")).href;
// A folder with system libraries that Chromium needs on machines that lack them; added to LD_LIBRARY_PATH when set.
const LIBS = process.env.LTEM_CHROMIUM_LIBS;

export interface Harness {
  browser: Browser;
  page: Page;
  cdp: CDPSession;
}

export async function open(): Promise<Harness> {
  const browser = await chromium.launch({
    env: { ...process.env, LD_LIBRARY_PATH: [LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") },
  });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  await page.goto(PAGE);
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp };
}

/** Syllables of a word as a Korean IME composes them: jamo by jamo, then committed. */
const SYLLABLES: Record<string, string[]> = {
  한: ["ㅎ", "하", "한"],
  글: ["ㄱ", "그", "글"],
  표: ["ㅍ", "표"],
  셀: ["ㅅ", "세", "셀"],
};

/**
 * Compose a syllable. With `keys`, each step is preceded by the key-down that the Windows
 * Korean IME sends first (key "Process", key code 229), as on a real keyboard.
 */
export async function composeSyllable(h: Harness, syllable: string, commit = true, keys = false): Promise<void> {
  for (const text of SYLLABLES[syllable]) {
    if (keys) {
      await h.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Process", code: "KeyG", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    }
    await h.cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    if (keys) await h.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Process", code: "KeyG", windowsVirtualKeyCode: 229 });
  }
  if (commit) await h.cdp.send("Input.insertText", { text: syllable });
}

export async function compose(h: Harness, word: string, keys = false): Promise<void> {
  for (const syllable of word) await composeSyllable(h, syllable, true, keys);
}

/** Call a function of the test page's `ltemTest` object. */
export function call<T>(h: Harness, name: string, ...args: unknown[]): Promise<T> {
  return h.page.evaluate(([n, a]) => {
    const t = (window as never as { ltemTest: Record<string, (...x: unknown[]) => unknown> }).ltemTest;
    return t[n as string](...(a as unknown[]));
  }, [name, args] as const) as Promise<T>;
}
