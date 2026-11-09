import type { SVGProps } from "react";

/** Mistral AI's mark, which Le Chat uses (Simple Icons, CC0). One color: `currentColor`. */
const LeChat = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z" />
  </svg>
);

export { LeChat };
