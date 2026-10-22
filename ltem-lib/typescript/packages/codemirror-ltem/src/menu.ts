/**
 * The context menu of a table: a right click on a table, in the source or where it is shown
 * as a table, opens a menu of table actions (`ltemTableActions`). An application can show
 * its own menu instead (`show`), from the same actions.
 */

import { Facet, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { InlineRenderer } from "ltem-core";

import type { LtemPasteData } from "./paste.js";

import { ltemCellTargetAt, ltemTableActions, type LtemActionId, type LtemCellTarget, type LtemTableAction } from "./actions.js";
import { selectedCells } from "./commands.js";
import { activeElement, eventIn } from "./dom.js";

export interface LtemContextMenuOptions {
  /** Language of the labels (default "en"), or a function giving each label. */
  messages?: "en" | "ko" | ((id: LtemActionId) => string);
  /** Renders cell text as HTML for Copy and Cut. */
  renderInline?: InlineRenderer;
  /** Reads the clipboard for Paste (see `LtemActionOptions.readClipboard`). */
  readClipboard?: () => Promise<LtemPasteData | null>;
  /**
   * Show your own menu instead of the component's: called with the actions for the cells
   * clicked. Return true if you showed a menu; false lets the component show its own.
   */
  show?: (event: MouseEvent, actions: LtemTableAction[], target: LtemCellTarget) => boolean;
  /**
   * The application's actions, shown after the component's (with a line between groups): a
   * list, or a function of the cells the menu is for. They come to `show` too.
   */
  extraActions?: readonly LtemTableAction[] | ((target: LtemCellTarget) => readonly LtemTableAction[]);
}

/** The context menu configuration of an editor; null when it has no table context menu. */
export const ltemContextMenuConfig = Facet.define<LtemContextMenuOptions, LtemContextMenuOptions | null>({
  combine: (values) => (values.length ? values[values.length - 1] : null),
});

let openMenu: { close(): void } | null = null;

/** Close the open table menu, if any. */
export function closeTableMenu(): void {
  openMenu?.close();
}

/**
 * Open the table menu for `target` at the mouse position of `event`, or let the
 * application show its own (`show`). Returns false if the editor has no table menu.
 */
export function openTableMenu(view: EditorView, event: MouseEvent, target: LtemCellTarget, onClose?: () => void): boolean {
  const config = view.state.facet(ltemContextMenuConfig);
  if (!config) return false;
  const extra = typeof config.extraActions === "function" ? config.extraActions(target) : config.extraActions ?? [];
  const actions = [
    ...ltemTableActions(target, { messages: config.messages, renderInline: config.renderInline, readClipboard: config.readClipboard }),
    ...extra,
  ];
  if (config.show?.(event, actions, target)) return true;
  closeTableMenu();
  const doc = view.dom.ownerDocument;
  const menu = doc.createElement("div");
  menu.className = "cm-ltem-menu";
  menu.setAttribute("role", "menu");
  const items: HTMLButtonElement[] = [];
  let group: string | null = null;
  for (const action of actions) {
    if (group !== null && action.group !== group) {
      const line = doc.createElement("div");
      line.className = "cm-ltem-menu-separator";
      line.setAttribute("role", "separator");
      menu.appendChild(line);
    }
    group = action.group;
    const item = doc.createElement("button");
    item.type = "button";
    item.className = "cm-ltem-menu-item";
    item.setAttribute("role", action.checked !== undefined ? "menuitemradio" : "menuitem");
    if (action.checked !== undefined) item.setAttribute("aria-checked", String(action.checked));
    item.dataset.action = action.id;
    const enabled = action.enabled;
    if (!enabled) item.setAttribute("aria-disabled", "true");
    const name = doc.createElement("span");
    name.textContent = (action.checked ? "✓ " : "") + action.label;
    item.appendChild(name);
    if (action.shortcut) {
      const key = doc.createElement("span");
      key.className = "cm-ltem-menu-shortcut";
      key.textContent = action.shortcut;
      item.appendChild(key);
    }
    item.addEventListener("mousedown", (e) => e.preventDefault());
    item.addEventListener("click", (e) => {
      e.preventDefault();
      if (!enabled) return;
      close(false);
      action.run(view);
    });
    menu.appendChild(item);
    items.push(item);
  }

  const close = (refocus: boolean): void => {
    if (!menu.isConnected) return;
    menu.remove();
    doc.removeEventListener("mousedown", onOutside, true);
    doc.removeEventListener("keydown", onKey, true);
    view.scrollDOM.removeEventListener("scroll", onScroll);
    doc.defaultView?.removeEventListener("blur", onBlur);
    if (openMenu === handle) openMenu = null;
    onClose?.();
    if (refocus) view.focus();
  };
  const handle = { close: () => close(false) };
  const onOutside = (e: MouseEvent): void => {
    if (!eventIn(e, menu)) close(false);
  };
  const onScroll = (): void => close(false);
  const onBlur = (): void => close(false);
  const enabledItems = (): HTMLButtonElement[] => items.filter((i) => i.getAttribute("aria-disabled") !== "true");
  const onKey = (e: KeyboardEvent): void => {
    const list = enabledItems();
    const current = list.indexOf(activeElement(view) as HTMLButtonElement);
    if (e.key === "Escape") {
      close(!target.widget);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = e.key === "ArrowDown" ? (current + 1) % list.length : (current - 1 + list.length) % list.length;
      list[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      list[e.key === "Home" ? 0 : list.length - 1]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      if (current >= 0) list[current].click();
    } else if (e.key === "Tab") {
      close(false);
      return;
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  view.dom.appendChild(menu);
  // At the mouse, kept inside the window.
  const win = doc.defaultView!;
  const box = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, win.innerWidth - box.width - 4);
  const y = event.clientY + box.height > win.innerHeight - 4 ? Math.max(4, event.clientY - box.height) : event.clientY;
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${y}px`;
  doc.addEventListener("mousedown", onOutside, true);
  doc.addEventListener("keydown", onKey, true);
  view.scrollDOM.addEventListener("scroll", onScroll);
  win.addEventListener("blur", onBlur);
  openMenu = handle;
  enabledItems()[0]?.focus({ preventScroll: true });
  return true;
}

/**
 * Table context menus: a right click in a table in the source opens the table menu (where a
 * table is shown as a table, its widget opens it). Included in `ltem()`.
 */
export function ltemContextMenu(options: LtemContextMenuOptions = {}): Extension {
  return [
    ltemContextMenuConfig.of(options),
    EditorView.domEventHandlers({
      contextmenu(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        let target = ltemCellTargetAt(view, pos);
        if (!target) return false;
        // A right click outside the selection moves the cursor there, as a click does.
        const sel = view.state.selection.main;
        const selected = selectedCells(view.state);
        if (!(selected && target.range === selected.range) && !(pos >= sel.from && pos <= sel.to)) {
          view.dispatch({ selection: { anchor: pos }, userEvent: "select.pointer" });
          target = ltemCellTargetAt(view, pos) ?? target;
        }
        event.preventDefault();
        return openTableMenu(view, event, target);
      },
    }),
    EditorView.baseTheme({
      ".cm-ltem-menu": {
        position: "fixed", zIndex: "300", minWidth: "200px", padding: "4px 0", borderRadius: "6px",
        font: "13px system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif",
        boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
      },
      "&light .cm-ltem-menu": { backgroundColor: "#ffffff", color: "#1f2328", border: "1px solid #d0d7de" },
      "&dark .cm-ltem-menu": { backgroundColor: "#2b3036", color: "#e6edf3", border: "1px solid #444c56" },
      ".cm-ltem-menu-item": {
        display: "flex", justifyContent: "space-between", gap: "24px", width: "100%", padding: "5px 14px",
        border: "none", background: "none", color: "inherit", font: "inherit", textAlign: "left", cursor: "default",
      },
      "&light .cm-ltem-menu-item:focus, &light .cm-ltem-menu-item:hover": { backgroundColor: "#e7f0fb", outline: "none" },
      "&dark .cm-ltem-menu-item:focus, &dark .cm-ltem-menu-item:hover": { backgroundColor: "#37404a", outline: "none" },
      ".cm-ltem-menu-item[aria-disabled=true]": { opacity: "0.45" },
      ".cm-ltem-menu-shortcut": { opacity: "0.6" },
      ".cm-ltem-menu-separator": { height: "1px", margin: "4px 0" },
      "&light .cm-ltem-menu-separator": { backgroundColor: "#d8dee4" },
      "&dark .cm-ltem-menu-separator": { backgroundColor: "#444c56" },
    }),
  ];
}
