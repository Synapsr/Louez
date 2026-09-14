import { z } from "zod";

import { EMBED_RESIZE_MESSAGE_TYPE } from "./embed-widget.constants";

const embedResizeMessageSchema = z.object({
  type: z.literal(EMBED_RESIZE_MESSAGE_TYPE),
  height: z.number().finite(),
});

/**
 * Host side: read a resize message off the `message` bus, which also carries
 * traffic from browser extensions and other iframes. Returns `null` for
 * anything that is not one of ours.
 */
export const readEmbedResizeHeight = (data: unknown): number | null => {
  const parsed = embedResizeMessageSchema.safeParse(data);
  return parsed.success ? parsed.data.height : null;
};

/**
 * Widget side: ask the host page to resize the iframe. The target origin stays
 * `*` because the widget never knows which site embedded it, and the message
 * carries no customer data.
 */
export const postEmbedHeight = (height: number): void => {
  window.parent.postMessage({ type: EMBED_RESIZE_MESSAGE_TYPE, height }, "*");
};
