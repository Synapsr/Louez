import {
  EMBED_INITIAL_HEIGHT,
  EMBED_RESIZE_MESSAGE_TYPE,
  EMBED_STATIC_HEIGHT,
} from "./embed-widget.constants";

/**
 * `auto`: the iframe plus the listener that follows the widget's height.
 * `fixed`: the iframe alone, for a merchant who cannot add a script tag.
 */
export type EmbedSnippetVariant = "auto" | "fixed";

interface BuildEmbedSnippetOptions {
  embedUrl: string;
  iframeTitle: string;
  variant: EmbedSnippetVariant;
}

/**
 * The copy-paste code a merchant puts on their site. The dashboard hands it
 * out and the dev playground renders exactly this markup, so what we test is
 * what they ship.
 */
export const buildEmbedSnippet = ({
  embedUrl,
  iframeTitle,
  variant,
}: BuildEmbedSnippetOptions): string => {
  const height = variant === "auto" ? EMBED_INITIAL_HEIGHT : EMBED_STATIC_HEIGHT;
  const container = `<div id="louez-embed">
  <iframe
    src="${embedUrl}"
    width="100%"
    height="${height}"
    frameborder="0"
    style="border: none; border-radius: 16px; transition: height 0.3s ease;"
    title="${iframeTitle}"
    allow="popups"
  ></iframe>
</div>`;

  if (variant === "fixed") {
    return container;
  }

  return `${container}
<script>
  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "${EMBED_RESIZE_MESSAGE_TYPE}") {
      var iframe = document.querySelector("#louez-embed iframe");
      if (iframe) iframe.style.height = e.data.height + "px";
    }
  });
</script>`;
};
