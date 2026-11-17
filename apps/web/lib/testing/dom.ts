// The browser comes first: React reads it when its modules load.
import "./install-dom";

import { mock } from "node:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export const enableMockTimers = () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
};

export const mount = (node: ReactNode) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    container,
    unmount: () => {
      act(() => root?.unmount());
      container.remove();
    },
  };
};

/**
 * Lets pending promise callbacks and the renders they cause run, enough
 * rounds for a call through the app's oRPC client to be sent and answered.
 */
export const settle = async () => {
  for (let pass = 0; pass < 4; pass += 1) {
    await act(async () => {
      for (let round = 0; round < 5; round += 1) await Promise.resolve();
    });
  }
};

export const tick = async (milliseconds: number) => {
  await act(async () => {
    mock.timers.tick(milliseconds);
  });
  await settle();
};

const valueSetter = (input: HTMLInputElement) =>
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;

/** Types into an input as the browser does: its value, then an input event. */
export const typeInto = (input: HTMLInputElement, text: string) => {
  act(() => {
    input.focus();
    valueSetter(input)?.call(input, text);
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
};

export const focus = (element: HTMLElement) => act(() => element.focus());
export const blur = (element: HTMLElement) => act(() => element.blur());

export const pressKey = (element: HTMLElement, key: string) => {
  act(() => {
    element.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    );
  });
};

/** A pointer pick: the press that blurs the input, then the click. */
export const pointerClick = (element: HTMLElement) => {
  act(() => {
    element.dispatchEvent(
      new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }) as unknown as Event,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    );
  });
};

/** A promise the test answers when it chooses. */
export const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};
