import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemosClient } from "./client.js";
import { registerMemoTools } from "./tools/memos.js";
import { registerTagTools } from "./tools/tags.js";
import { registerSearchTool } from "./tools/review.js";
import { registerPrompts } from "./prompts/index.js";
import { VALID_VISIBILITIES, type Visibility } from "./types.js";

export interface ServerOptions {
  defaultVisibility?: Visibility;
}

// Crear servidor con cliente inyectado (para HTTP multi-tenant)
export const createServerWithClient = (
  client: MemosClient,
  options: ServerOptions = {}
) => {
  const defaultVisibility = options.defaultVisibility ?? "PRIVATE";

  const server = new McpServer({
    name: "memos-mcp",
    version: "3.0.0",
  });

  registerMemoTools(server, client, { defaultVisibility });
  registerTagTools(server, client);
  registerSearchTool(server, client);
  registerPrompts(server);

  return server;
};

// Crear servidor con env vars (para stdio mode)
export const createServer = () => {
  const memosUrl = process.env.MEMOS_URL;
  const memosToken = process.env.MEMOS_TOKEN;

  if (!memosUrl) {
    console.error("Error: MEMOS_URL environment variable is required");
    process.exit(1);
  }
  if (!memosToken) {
    console.error("Error: MEMOS_TOKEN environment variable is required");
    process.exit(1);
  }

  const rawVisibility = process.env.MEMOS_DEFAULT_VISIBILITY?.toUpperCase();
  const defaultVisibility: Visibility =
    rawVisibility && VALID_VISIBILITIES.includes(rawVisibility as Visibility)
      ? (rawVisibility as Visibility)
      : "PRIVATE";

  const client = new MemosClient(memosUrl, memosToken);
  return createServerWithClient(client, { defaultVisibility });
};
