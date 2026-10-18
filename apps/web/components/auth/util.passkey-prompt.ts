/** Third-party widgets can keep closed dialogs mounted in the dashboard. */
export const isVisiblePromptElement = (element: Element): boolean => {
  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;

  if (typeof element.checkVisibility === "function") {
    return element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  }

  // Older WebAuthn-capable browsers may not support checkVisibility yet.
  const style = window.getComputedStyle(element);
  return (
    element.getClientRects().length > 0 && style.visibility === "visible" && style.opacity !== "0"
  );
};
