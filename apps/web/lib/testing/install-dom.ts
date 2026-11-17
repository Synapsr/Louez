import React from "react";
import { Window } from "happy-dom";

/**
 * A browser for tests that mount components and drive them with events.
 * Timers are node's mock timers: a test moves time with `tick`, never waits.
 */
const installDom = () => {
  const window = new Window({ url: "https://shop.test/" });
  // Timers go through node's mock, which the test enables and moves.
  window.setTimeout = ((...args: Parameters<typeof setTimeout>) =>
    globalThis.setTimeout(...args)) as unknown as typeof window.setTimeout;
  window.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) =>
    globalThis.clearTimeout(id)) as typeof window.clearTimeout;
  Object.assign(globalThis, {
    // tsx loads the shared UI package through CommonJS with the classic JSX runtime.
    React,
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    FocusEvent: window.FocusEvent,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      globalThis.setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  // Node has its own navigator, readable only.
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
};

installDom();
