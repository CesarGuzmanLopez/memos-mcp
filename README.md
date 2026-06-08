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

---

## What can the AI do with this MCP?

Once connected, your AI assistant gains **persistent memory**. Here's what it can do:

### 📝 Create Notes
- Save meeting notes, ideas, tasks, or anything
- Use `#hashtags` for automatic tagging
- Backdate notes to a specific time
- Markdown support (bold, lists, code blocks, etc.)

### 🔍 Search & Recall
- "What did I do yesterday?" → searches by date
- "Show me #project notes" → filters by tag
- "Find notes about API design" → full-text search
- "What's on my agenda today?" → today's memos
- "Notes from last week" → date range search
- "Show pinned notes" → filter by pin status
- "Find notes with incomplete tasks" → task filter

### ✏️ Update & Organize
- Edit existing notes
- Pin important memos
- Archive old notes
- Change visibility (private/public)

### 🗑️ Clean Up
- Delete notes you no longer need

### 🏷️ Tag Management
- List all tags with usage counts
- Browse tag hierarchy (`#work/meeting`, `#project/backend`)
- Analyze and suggest tag improvements

---

## Tools (6)

| Tool | What it does | Key Features |
|------|-------------|--------------|
| `search` | Search memos by date, tags, content, visibility, pinned status | Relative dates (`today`, `yesterday`, `next_monday`), date ranges, week view, full-text search |
| `get` | Get a single memo's full content | By ID or UID, includes attachments metadata |
| `create` | Create a memo with markdown and #hashtags | Backdate support, visibility control. **Max 13,000 chars** |
| `update` | Update memo content, visibility, or pin status | Partial updates (only changed fields), archive/restore |
| `delete` | Permanently delete a memo | Cannot be undone |
| `tags` | List all tags with usage counts | Hierarchical: top-level, children, or recursive flat list |

### Search Date Examples

| You say | The AI calls |
|---------|-------------|
| "What did I do yesterday?" | `search(date="yesterday")` |
| "What's on my agenda today?" | `search(date="today")` |
| "Notes from last week" | `search(date="last_week", week=true)` |
| "Show me #project notes" | `search(tags=["project"])` |
| "Find notes about API design" | `search(query="API design")` |
| "What happened on June 15?" | `search(date="2025-06-15")` |
| "March to April overview" | `search(date="2025-03-01", endDate="2025-04-30")` |
| "Show all my memos" | `search()` |
| "Find notes with incomplete tasks" | `search(hasIncompleteTasks=true)` |
| "Show notes with attachments" | `search(hasAttachments=true)` |

### Supported Relative Dates

`today`, `yesterday`, `tomorrow`, `this_week`, `next_week`, `last_week`, `this_month`, `next_month`, `last_month`, `next_monday`, `last_friday`, `3_days_ago`, `in_7_days`, `2_weeks_ago`, `in_2_weeks`

---

## Prompts (4)

Prompts are pre-built workflows the AI can follow:

| Prompt | What it does | Workflow |
|--------|-------------|----------|
| `capture` | Quick-save a thought, task, or idea | Asks for content + optional tags, creates memo |
| `review` | Review memos from a time period | Searches memos, reads each one, summarizes |
| `on_day` | Check what happened/is planned for a date | Searches by date, presents findings |
| `tag_overview` | Analyze your tag system | Lists tags, shows hierarchy, suggests cleanup |

---

## What the AI sees (Model Instructions)

When the AI connects to this MCP, it receives these tool descriptions:

### `create` tool instructions:
> "Create a memo with markdown content. Use #hashtags for tags. **CRITICAL LIMIT: Each memo MUST NOT exceed 13,000 characters.** The Memos server enforces a hard limit of ~18K but to avoid errors always stay under 13K. If you need to write more, split into multiple memos with a shared tag (e.g. #project/my-post) and add part numbers."

### `search` tool instructions:
> "Search memos. Unified tool for date-based, tag-based, and content-based search. Date accepts ISO, relative dates ('today', 'yesterday', 'next_monday'), and week mode. Filters: tags, query, visibility, pinned, state, hasIncompleteTasks, hasAttachments. No date = all memos."

### `tags` tool instructions:
> "List tags with usage counts extracted from your memo content. Tags are hashtags like #project or #work/meeting. Results are cached for 60 seconds. No args = top-level tags only. parent='work' = children of 'work'. recursive=true = all tags flat."

### `update` tool instructions:
> "Update memo fields. Only provided fields are changed. CRITICAL: MUST NOT exceed 13,000 chars."

### `get` tool instructions:
> "Get a single memo by ID or UID."

### `delete` tool instructions:
> "Permanently delete a memo. Cannot be undone."

---

## Setup

### Prerequisites

- Node.js >= 18
- A running Memos instance (v0.29+)
- A Memos access token (Settings → Access Tokens)

### Quick Start — Claude Desktop/Code

Add to your MCP config (`claude_desktop_config.json` or equivalent):

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

### Quick Start — OpenCode

Add to `opencode.json`:

```json
"mcp": {
  "memos": {
    "type": "remote",
    "enabled": true,
    "url": "http://your-server:8444/mcp",
    "headers": {
      "Authorization": "Bearer your-memos-access-token"
    }
  }
}
```

### Quick Start — LibreChat

Add to `librechat.yaml`:

```yaml
mcpServers:
  memos:
    type: streamable-http
    url: http://your-server:8444/mcp
    headers:
      Authorization: "Bearer your-memos-access-token"
    timeout: 240000
```

---

## Running the Server

### HTTP Mode (Multi-tenant)

For servers that support remote MCP (OpenCode, LibreChat, etc.):

```bash
# Start with npx
MEMOS_URL=https://your-memos-instance.com npx -y memos-mcp --http

# Or with custom port
MEMOS_URL=https://your-memos-instance.com npx -y memos-mcp --http --port 8443
```

Each client sends its own Bearer token — no token in the server config.

### Stdio Mode (Single user)

For Claude Desktop/Code:

```bash
MEMOS_URL=https://your-memos-instance.com MEMOS_TOKEN=your-token npx -y memos-mcp
```

### Running from Source

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

### Docker

```bash
docker run -d --name memos-mcp \
  -p 8444:8443 \
  -e MEMOS_URL=https://your-memos-instance.com \
  ghcr.io/cesarguzmanlopez/memos-mcp:latest \
  node dist/index.js --http --port 8443
```

Or with Dockerfile:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY dist/ ./
RUN npm install --omit=dev @modelcontextprotocol/sdk express zod
EXPOSE 8443
ENV MEMOS_URL=https://your-memos-instance.com
CMD ["node", "dist/index.js", "--http", "--port", "8443"]
```

### Nginx Reverse Proxy (Production)

```nginx
server {
    listen 443 ssl;
    server_name memos-mcp.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8444;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Accept "application/json, text/event-stream";
    }
}
```

---

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

## Memos Compatibility

| Memos Version | Compatible | Notes |
|---------------|------------|-------|
| **0.29.x** | ✅ Yes | Fully supported. Tested with 0.29.1 |
| **0.28.x** | ⚠️ Partial | API works but UIDs may not be supported |
| **0.22.x — 0.27.x** | ❌ No | Uses v1 API but without UID support |
| **< 0.22** | ❌ No | Old API, not compatible |

**Minimum required:** Memos **v0.29+** (uses UID-based identifiers `memos/abc123` instead of numeric IDs)

**Tested with:** Memos **0.29.1** (neosmemo/memos:stable Docker image)

**API used:** REST v1 (`/api/v1/memos`) with CEL filter expressions for queries

## Important Notes

- **Content limit:** Each memo has a hard limit of ~18,000 characters (server-side). The MCP enforces a safe limit of **13,000 characters**. For longer content, split into multiple memos with a shared tag.
- **Multi-tenant:** In HTTP mode, each client sends their own Bearer token. The server uses that token to access Memos as that specific user.
- **Rate limiting:** 100 requests per minute per IP.
- **Tags:** Use `#hashtags` in your memo content. The MCP extracts them automatically.

## License

MIT
