// The name each assistant gives the connector, the same in every language.
export const CONNECTOR_NAME = "Louez";

/** Claude.ai's "Add custom connector" form, filled with Louez's name and address. */
export const claudeConnectorLink = (mcpUrl: string) => {
  const url = new URL("https://claude.ai/customize/connectors");
  url.searchParams.set("modal", "add-custom-connector");
  url.searchParams.set("connectorName", CONNECTOR_NAME);
  url.searchParams.set("connectorUrl", mcpUrl);
  return url.toString();
};

/** Claude Code's command that adds Louez as a remote server. */
export const claudeCodeCommand = (mcpUrl: string) =>
  `claude mcp add --transport http ${CONNECTOR_NAME.toLowerCase()} ${mcpUrl}`;

const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** Cursor's install link: the server's config as base64 JSON. */
export const cursorInstallLink = (mcpUrl: string) => {
  const url = new URL("cursor://anysphere.cursor-deeplink/mcp/install");
  url.searchParams.set("name", CONNECTOR_NAME);
  url.searchParams.set("config", toBase64(JSON.stringify({ url: mcpUrl })));
  return url.toString();
};

/** VS Code's install link: the server's config as URL-encoded JSON. */
export const vscodeInstallLink = (mcpUrl: string) =>
  `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({ name: CONNECTOR_NAME, type: "http", url: mcpUrl }),
  )}`;
