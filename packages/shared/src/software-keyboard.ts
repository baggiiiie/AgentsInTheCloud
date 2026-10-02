/// <reference lib="dom" />

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { changeLayout } from "./layout-transaction.ts";

const softwareKeyboardInputMediaQuery = "(hover: none) and (pointer: coarse)";

/** Dispatched on document, inside the layout transaction, whenever the keyboard arrangement changes. */
export const softwareKeyboardEvent = "atelier:software-keyboard";
export const softwareKeyboardStorageKey = "atelier:software-keyboard";

export function focusLikelyOpensSoftwareKeyboard(): boolean {
  return window.matchMedia(softwareKeyboardInputMediaQuery).matches;
}

export function softwareKeyboardVisible(
  baselineHeight: number,
  viewportHeight: number,
  textEntryFocused: boolean,
  focusOpensSoftwareKeyboard: boolean,
): boolean {
  const minimumOcclusion = Math.min(120, baselineHeight * 0.2);
  return focusOpensSoftwareKeyboard && textEntryFocused && baselineHeight - viewportHeight >= minimumOcclusion;
}

export function isTextEntry(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

/** True while the page is arranged for a soft keyboard, including a predicted one. */
export function softwareKeyboardArranged(): boolean {
  return document.documentElement.classList.contains("software-keyboard-visible");
}

type Orientation = "portrait" | "landscape";

/** What the last focus on this device did, so the next focus can arrange the page before the keyboard shows. */
const keyboardMemorySchema = Type.Object({
  produced: Type.Boolean(),
  heights: Type.Object({ portrait: Type.Optional(Type.Number({ exclusiveMinimum: 0 })), landscape: Type.Optional(Type.Number({ exclusiveMinimum: 0 })) }),
});
type KeyboardMemory = Static<typeof keyboardMemorySchema>;

function readMemory(): KeyboardMemory {
  const stored = localStorage.getItem(softwareKeyboardStorageKey);
  const value: unknown = stored === null ? undefined : JSON.parse(stored);
  return Value.Check(keyboardMemorySchema, value) ? value : { produced: false, heights: {} };
}

let installed = false;

/**
 * Arranges the page for the soft keyboard in one step (snap, don't follow).
 * Focus predicts the keyboard from the height remembered on this device; the
 * visual viewport only confirms or, on the very first focus, corrects it.
 */
export function installSoftwareKeyboardTracking(): void {
  if (installed) return;
  installed = true;

  const root = document.documentElement;
  const viewport = window.visualViewport!;
  let memory = readMemory();
  let arranged = false;
  let inset = 0;
  let top = 0;
  let detected = false;
  let hardwareCheck: ReturnType<typeof setTimeout> | undefined;

  const orientation = (): Orientation => window.matchMedia("(orientation: landscape)").matches ? "landscape" : "portrait";
  const layoutHeight = (): number => root.clientHeight;
  const remember = (next: KeyboardMemory): void => {
    memory = next;
    localStorage.setItem(softwareKeyboardStorageKey, JSON.stringify(memory));
  };

  const arrange = (visible: boolean, nextInset: number, nextTop: number, predicted: boolean): void => {
    nextInset = visible ? Math.round(nextInset) : 0;
    nextTop = visible ? Math.round(nextTop) : 0;
    if (visible === arranged && nextInset === inset && nextTop === top) return;
    changeLayout(() => {
      arranged = visible;
      inset = nextInset;
      top = nextTop;
      root.classList.toggle("software-keyboard-visible", visible);
      root.style.setProperty("--software-keyboard-inset", `${inset}px`);
      root.style.setProperty("--software-keyboard-top", `${top}px`);
      document.dispatchEvent(new CustomEvent(softwareKeyboardEvent, { detail: { visible, inset, top, predicted } }));
    });
  };

  const cancelHardwareCheck = (): void => {
    clearTimeout(hardwareCheck);
    hardwareCheck = undefined;
  };

  const measure = (): void => {
    const height = layoutHeight();
    const focused = isTextEntry(document.activeElement);
    const visible = softwareKeyboardVisible(height, viewport.height, focused, focusLikelyOpensSoftwareKeyboard());
    if (visible) {
      detected = true;
      cancelHardwareCheck();
      const keyboard = height - viewport.height;
      if (!memory.produced || memory.heights[orientation()] !== Math.round(keyboard)) {
        remember({ produced: true, heights: { ...memory.heights, [orientation()]: Math.round(keyboard) } });
      }
      // A remembered height leaves nothing to correct. Only an unpredicted
      // keyboard, or one whose size changed, moves the page here.
      arrange(true, height - viewport.offsetTop - viewport.height, viewport.offsetTop, false);
      return;
    }
    if (!detected) return;
    detected = false;
    // Some keyboards hide without blurring (Android back, a dismiss key).
    // Dismissing the keyboard ends text entry, so the field loses focus too.
    if (focused && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    else arrange(false, 0, 0, false);
  };

  document.addEventListener("focusin", (event) => {
    if (!focusLikelyOpensSoftwareKeyboard() || !isTextEntry(event.target instanceof Element ? event.target : null)) return;
    if (arranged) {
      // Focus moved between text fields: the keyboard stays up. Rearrange
      // once for the new focus (for example, the composer collapsing for a terminal).
      changeLayout(() => document.dispatchEvent(new CustomEvent(softwareKeyboardEvent, { detail: { visible: true, inset, top, predicted: !detected } })));
      return;
    }
    const remembered = memory.heights[orientation()];
    // Like WebKit, only expect a keyboard for focus that comes from a user gesture.
    if (!memory.produced || remembered === undefined || !navigator.userActivation.isActive) return;
    arrange(true, remembered, 0, true);
    cancelHardwareCheck();
    hardwareCheck = setTimeout(() => {
      hardwareCheck = undefined;
      if (detected || !arranged) return;
      // A hardware keyboard took over: stop predicting until a soft keyboard shows again.
      remember({ ...memory, produced: false });
      arrange(false, 0, 0, false);
    }, 1000);
  });

  document.addEventListener("focusout", (event) => {
    if (isTextEntry(event.relatedTarget instanceof Element ? event.relatedTarget : null) && focusLikelyOpensSoftwareKeyboard()) return;
    cancelHardwareCheck();
    detected = false;
    arrange(false, 0, 0, true);
  });

  // WebKit scrolls the page to reveal a tapped field using where it was before
  // focus rearranged the page, so the page would move twice. A tap focuses the
  // field itself without that scroll; the arrangement already keeps it in view.
  let touch: { x: number; y: number; time: number } | undefined;
  document.addEventListener("touchstart", (event) => {
    const point = event.touches.length === 1 ? event.touches[0]! : undefined;
    touch = point ? { x: point.screenX, y: point.screenY, time: event.timeStamp } : undefined;
  }, { capture: true, passive: true });
  document.addEventListener("touchend", (event) => {
    const start = touch;
    touch = undefined;
    const point = event.changedTouches.length === 1 && event.touches.length === 0 ? event.changedTouches[0]! : undefined;
    const field = event.target instanceof Element ? event.target.closest("textarea, input, [contenteditable]") : null;
    if (!start || !point || !event.cancelable || !(field instanceof HTMLElement) || !isTextEntry(field) || document.activeElement === field || field.inert) return;
    if (event.timeStamp - start.time > 500 || Math.hypot(point.screenX - start.x, point.screenY - start.y) > 10) return;
    event.preventDefault();
    field.focus({ preventScroll: true });
  }, { capture: true, passive: false });

  viewport.addEventListener("resize", measure);
  viewport.addEventListener("scroll", measure);
  measure();
}
