# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

memos-mcp is an MCP (Model Context Protocol) server for [Memos](https://github.com/usememos/memos), providing tools, prompts, and resources for memo management via Claude Code, Claude Desktop, OpenCode, LibreChat, and other MCP-compatible clients.

## Development Commands

```bash
# Install dependencies
pnpm install

# Build (TypeScript → dist/)
pnpm build

# Run in dev mode (stdio)
pnpm dev

# Run in HTTP mode
pnpm dev:http
```

## Architecture

- `src/index.ts` - CLI entry point with --http, --port, --help options
- `src/server.ts` - MCP server initialization and tool/prompt registration
- `src/client.ts` - Memos API client with timeout, caching, and token validation
- `src/http.ts` - HTTP/SSE server with rate limiting and CORS support
- `src/config.ts` - Zod-based configuration validation
- `src/types.ts` - TypeScript type definitions
- `src/tools/` - MCP tool implementations:
  - `memos.ts` - get, create, update, delete tools
  - `review.ts` - search tool with date parsing and CEL filters
  - `tags.ts` - tag management with hierarchy and caching
  - `utils.ts` - Shared utilities (summarizeMemo, resolveToMemoId)
- `src/prompts/` - MCP prompt definitions (capture, review, on_day, tag_overview)

### Key Patterns

- Each domain module exports a `register*Tools` function for modular registration
- Zod schemas for input validation
- CEL filter expressions for Memos API queries
- Multi-tenant support via Bearer token authentication
- Rate limiting (100 requests/minute per IP)
- Response caching for tags (60s TTL) and user info (5min TTL)

## API Reference

### Tools

| Tool | Description |
|------|-------------|
| `search` | Search memos by date, tags, content, visibility, pinned status |
| `get` | Get a single memo by ID or UID |
| `create` | Create a memo with markdown content and #hashtags |
| `update` | Update memo content, visibility, or pin status |
| `delete` | Permanently delete a memo |
| `tags` | List all tags with usage counts and hierarchy |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MEMOS_URL` | Yes | Your Memos instance URL |
| `MEMOS_TOKEN` | Stdio only | Access token for stdio mode |
| `HTTP_PORT` | No | HTTP server port (default: 3000) |
| `HTTP_HOST` | No | HTTP server host (default: 127.0.0.1) |
| `CORS_ORIGIN` | No | Allowed CORS origins (default: *) |
| `LOG_LEVEL` | No | Log level: debug, info, warn, error (default: info) |

## Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY dist/ ./
RUN npm install --omit=dev @modelcontextprotocol/sdk express zod
EXPOSE 8443
ENV MEMOS_URL=https://your-memos-instance.com
CMD ["node", "dist/index.js", "--http", "--port", "8443"]
```

### Client Configuration (Remote)

```json
{
  "mcpServers": {
    "memos": {
      "type": "remote",
      "url": "http://your-server:8443/mcp",
      "headers": {
        "Authorization": "Bearer your-memos-access-token"
      }
    }
  }
}
```

## Project-Specific Notes

1. This project does not require typecheck and prettier operations
2. All GitHub operations (issues, PRs, etc.) should target the repository CesarGuzmanLopez/memos-mcp
3. The server supports both stdio mode (single user) and HTTP mode (multi-tenant)
4. Memos 0.29+ uses UIDs instead of numeric IDs
5. CEL filter expressions are used for complex queries (tag in, content.contains, etc.)
