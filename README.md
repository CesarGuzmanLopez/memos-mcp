# memos-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that turns [Memos](https://github.com/usememos/memos) into a **multi-purpose database** for your AI assistants — notes, projects, tasks, agendas, knowledge base, and more.

[中文文档](README_zh.md)

## What is this?

**memos-mcp** is a bridge between AI assistants and your Memos instance. Instead of context windows that forget, your AI has a **persistent memory database** it can query, create, and organize notes in.

Think of it as:
- 📝 **Personal knowledge base** — capture ideas, research, learnings
- 📋 **Task manager** — to-dos, checklists, project tracking
- 📅 **Agenda/planner** — schedules, meeting notes, deadlines
- 🏗️ **Project database** — specs, decisions, retrospectives
- 🔖 **Bookmark system** — save links, quotes, references

Your AI assistant can search by date, filter by tags, create notes on the fly, and query your entire history — all through natural language.

## Setup

### Prerequisites

- Node.js >= 18
- A running Memos instance (v0.29+)
- A Memos access token (Settings → Access Tokens)

### HTTP Mode (Multi-tenant)

For servers that support remote MCP servers (OpenCode, LibreChat, etc.):

```bash
# Start the server
MEMOS_URL=https://your-memos-instance.com npx -y memos-mcp --http

# Or with custom port
MEMOS_URL=https://your-memos-instance.com npx -y memos-mcp --http --port 8443
```

Each client sends its own Bearer token — no token in the server config.

### Stdio Mode (Single user)

For Claude Desktop/Code:

```json
{
  "mcpServers": {
    "memos": {
      "command": "npx",
      "args": ["-y", "memos-mcp"],
      "env": {
        "MEMOS_URL": "https://your-memos-instance.com",
        "MEMOS_TOKEN": "your-access-token"
      }
    }
  }
}
```

### Local Mode (Running from source)

If you've cloned the repository and want to run it locally:

```bash
# 1. Clone and install
git clone https://github.com/CesarGuzmanLopez/memos-mcp.git
cd memos-mcp
pnpm install

# 2. Build
pnpm build

# 3. Run in stdio mode
MEMOS_URL=https://your-memos-instance.com MEMOS_TOKEN=your-token node dist/index.js

# 4. Or run in HTTP mode
MEMOS_URL=https://your-memos-instance.com node dist/index.js --http
```

Then add to your MCP client config:

```json
{
  "mcpServers": {
    "memos": {
      "command": "node",
      "args": ["/path/to/memos-mcp/dist/index.js"],
      "env": {
        "MEMOS_URL": "https://your-memos-instance.com",
        "MEMOS_TOKEN": "your-access-token"
      }
    }
  }
}
```

## Remote MCP Server Setup

To expose memos-mcp as a remote server:

### 1. Docker Setup

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY dist/ ./
RUN npm install --omit=dev @modelcontextprotocol/sdk express zod
EXPOSE 8443
ENV MEMOS_URL=https://your-memos-instance.com
CMD ["node", "dist/index.js", "--http", "--port", "8443"]
```

### 2. Nginx Proxy

```nginx
server {
    listen 8443;
    listen [::]:8443;

    location / {
        proxy_pass http://127.0.0.1:8444;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Client Configuration

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

## Tools (6)

| Tool | Description |
|------|-------------|
| `search` | Search memos by date, tags, content, visibility, pinned status. Supports relative dates and ranges |
| `get` | Get a single memo's full content by ID or UID |
| `create` | Create a memo with markdown content and #hashtags. Supports backdating |
| `update` | Update memo content, visibility, or pin status |
| `delete` | Permanently delete a memo |
| `tags` | List all tags with usage counts and hierarchy |

### Search examples

| What you want | Tool call |
|---|---|
| "What did I do yesterday?" | `search(date="yesterday")` |
| "What's on my agenda today?" | `search(date="today")` |
| "Notes from last week" | `search(date="last_week", week=true)` |
| "Show me #project notes" | `search(tags=["project"])` |
| "Find notes about API design" | `search(query="API design")` |
| "What happened on June 15?" | `search(date="2025-06-15")` |
| "March to April overview" | `search(date="2025-03-01", endDate="2025-04-30")` |
| "Show all my memos" | `search()` |
| "Find notes with incomplete tasks" | `search(hasIncompleteTasks=true)` |

### Create with date

```json
{
  "content": "Meeting notes from today",
  "createTime": "2025-06-15T14:00:00",
  "visibility": "PRIVATE"
}
```

## Prompts (4)

| Prompt | Description |
|--------|-------------|
| `capture` | Quick-save a thought, task, or idea |
| `review` | Review memos from a time period (today, week, month, year) |
| `on_day` | Check what happened or is planned for a specific date |
| `tag_overview` | Analyze your tag system and suggest improvements |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MEMOS_URL` | Yes | Your Memos instance URL |
| `MEMOS_TOKEN` | Stdio only | Access token for stdio mode |
| `HTTP_PORT` | No | HTTP server port (default: 3000) |
| `HTTP_HOST` | No | HTTP server host (default: 127.0.0.1) |
| `CORS_ORIGIN` | No | Allowed CORS origins (default: *) |
| `LOG_LEVEL` | No | Log level: debug, info, warn, error (default: info) |

## API Endpoints

When running in HTTP mode:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with uptime and memory stats |
| `/mcp` | POST | Streamable HTTP MCP endpoint |
| `/sse` | GET | SSE connection endpoint |
| `/sse/messages` | POST | SSE message endpoint |

## License

MIT
