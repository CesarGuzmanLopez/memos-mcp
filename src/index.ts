#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { startHttpServer } from "./http.js";
import { loadConfig } from "./config.js";

// Detectar modo de ejecución
const args = process.argv.slice(2);
const isHttpMode = args.includes("--http") || args.includes("-h");
const showHelp = args.includes("--help") || args.includes("-?");

// Mostrar ayuda
if (showHelp) {
  console.log(`
memos-mcp - Model Context Protocol server for Memos

Usage:
  memos-mcp              Start in stdio mode (for Claude Desktop/Code)
  memos-mcp --http       Start in HTTP/SSE mode (for OpenCode/LibreChat)

Environment variables:
  MEMOS_URL              Memos instance URL (required)

HTTP mode:
  No token needed in .env. Each client sends its own token via
  Authorization: Bearer <token> header. The server uses that token
  to access Memos as that specific user.

  HTTP_PORT              HTTP server port (default: 3000)
  HTTP_HOST              HTTP server host (default: 127.0.0.1)
  CORS_ORIGIN            Allowed CORS origins (default: *)
  LOG_LEVEL              Log level: debug, info, warn, error (default: info)

Stdio mode:
  MEMOS_TOKEN            Memos access token (required for stdio only)

Examples:
  # Claude Desktop/Code (stdio) - token in env
  MEMOS_URL=https://memos.example.com MEMOS_TOKEN=xxx npx memos-mcp

  # OpenCode/LibreChat (HTTP) - token in client config
  MEMOS_URL=https://memos.example.com npx memos-mcp --http
`);
  process.exit(0);
}

// Modo HTTP
if (isHttpMode) {
  const config = loadConfig();
  console.log(`Starting memos-mcp in HTTP mode...`);
  console.log(`Server will accept requests at:`);
  console.log(`  - http://${config.HTTP_HOST}:${config.HTTP_PORT}/mcp (Streamable HTTP)`);
  console.log(`  - http://${config.HTTP_HOST}:${config.HTTP_PORT}/sse (SSE)`);
  console.log(`  - http://${config.HTTP_HOST}:${config.HTTP_PORT}/health (Health check)`);
  console.log(``);
  console.log(`Each request must include: Authorization: Bearer <token>`);
  startHttpServer(config);
}
// Modo stdio (default)
else {
  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error("Failed to connect transport:", err);
    process.exit(1);
  });
}