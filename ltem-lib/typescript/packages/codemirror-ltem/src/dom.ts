/**
 * DOM helpers that work when the editor is inside a Shadow DOM: there the document sees
 * the shadow host, not the element, as the focused element, the target of events and the
 * element under the mouse.
 */

import type { EditorView } from "@codemirror/view";

/** The document or shadow root the editor is in. */
export function rootOf(view: EditorView): Document | ShadowRoot {
  return view.root as Document | ShadowRoot;
}

/** The focused element, inside the editor's shadow root if it is in one. */
export function activeElement(view: EditorView): Element | null {
  return rootOf(view).activeElement;
}

/** The element at a point of the window, inside the editor's shadow root if it is in one. */
export function elementAt(view: EditorView, x: number, y: number): Element | null {
  return rootOf(view).elementFromPoint(x, y);
}

/** The selection, from the editor's shadow root if it is in one and has one. */
export function selectionOf(view: EditorView): Selection | null {
  const root = rootOf(view) as Document & { getSelection?: () => Selection | null };
  return (typeof root.getSelection === "function" ? root.getSelection() : null) ?? view.dom.ownerDocument.getSelection();
}

/** Whether an event happened in `element`, also across a shadow root. */
export function eventIn(event: Event, element: Element): boolean {
  return event.composedPath().includes(element);
}
