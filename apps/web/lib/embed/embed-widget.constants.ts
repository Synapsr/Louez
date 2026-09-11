/**
 * The contract between the storefront embed widget and the merchant page that
 * hosts it. Both sides (the widget, the dashboard preview, the dev playground)
 * read these instead of repeating the literals.
 */

/** Message the widget posts to `window.parent` whenever its height changes. */
export const EMBED_RESIZE_MESSAGE_TYPE = "louez-embed-resize";

/** Iframe height before the first resize message arrives: fields and CTA only. */
export const EMBED_INITIAL_HEIGHT = 210;

/** Iframe height for hosts that skip the resize script: the open calendar fits. */
export const EMBED_STATIC_HEIGHT = 800;
