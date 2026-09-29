// What the scripted pointer does to the product, besides a plain click. The events are
// untrusted, so the host never mistakes them for the visitor taking over.

const centerOf = (target: Element) => {
  const rect = target.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

const dispatch = (target: Element, type: string, point: { x: number; y: number }, buttons = 0) => {
  const init = {
    bubbles: !type.endsWith("enter") && !type.endsWith("leave"),
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    buttons,
  };
  target.dispatchEvent(
    type.startsWith("pointer")
      ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })
      : new MouseEvent(type, init),
  );
};

/** Pointer down and up before the click, for controls that open on press: selects, menus. */
export const pressElement = (target: HTMLElement) => {
  const point = centerOf(target);
  dispatch(target, "pointerdown", point, 1);
  dispatch(target, "mousedown", point, 1);
  dispatch(target, "pointerup", point);
  dispatch(target, "mouseup", point);
  target.click();
};

/** Opens what a real hover opens (tooltips, previews), then closes it again. */
export const hoverElement = (target: HTMLElement, inside: boolean) => {
  const point = centerOf(target);
  const types = inside
    ? ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]
    : ["pointerout", "pointerleave", "mouseout", "mouseleave"];
  for (const type of types) dispatch(target, type, point);
};

/** Sets the value the way typing does, so controlled fields follow. It never takes the focus. */
export const typeInto = (target: HTMLElement, value: string) => {
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
  const prototype =
    target instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, value);
  target.dispatchEvent(new Event("input", { bubbles: true }));
};

/** A signature-like stroke across the target, for `fraction` from 0 to 1. */
export const strokePoint = (target: HTMLElement, fraction: number) => {
  const rect = target.getBoundingClientRect();
  return {
    x: rect.left + rect.width * (0.2 + 0.6 * fraction),
    y:
      rect.top +
      rect.height * (0.55 - 0.2 * Math.sin(fraction * Math.PI * 3) * (1 - 0.5 * fraction)),
  };
};

export const strokeOn = (
  target: HTMLElement,
  step: "start" | "move" | "end",
  point: { x: number; y: number },
) => {
  const type = step === "start" ? "down" : step === "move" ? "move" : "up";
  const buttons = step === "end" ? 0 : 1;
  dispatch(target, `pointer${type}`, point, buttons);
  dispatch(target, `mouse${type}`, point, buttons);
};

/** Scenes listen to `emit` cues with `useDemoCue`, where no control of the product moves them on. */
export const DEMO_CUE_EVENT = "louez:demo:cue";
export const emitDemoCue = (name: string) =>
  document.dispatchEvent(new CustomEvent(DEMO_CUE_EVENT, { detail: name }));
