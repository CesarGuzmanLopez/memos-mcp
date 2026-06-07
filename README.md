# memos-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that turns [Memos](https://github.com/chriscurrycc/memos) into a **multi-purpose database** for your AI assistants — notes, projects, tasks, agendas, knowledge base, and more.

[中文文档](README_zh.md)

## What is this?

**mcp-mcp** is a bridge between AI assistants and your Memos instance. Instead of context windows that forget, your AI has a **persistent memory database** it can query, create, and organize notes in.

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
- A running Memos instance
- A Memos access token (Settings → Access Tokens)

### HTTP Mode (OpenCode, LibreChat, etc.)

```bash
# Start the HTTP server
MEMOS_URL=https://your-memos.com npx -y github:CesarGuzmanLopez/memos-mcp --http
```

Each client sends its own Bearer token — no token in the server config.

### Stdio Mode (Claude Desktop/Code)

```json
{
  "mcpServers": {
    "memos": {
      "command": "npx",
      "args": ["-y", "github:CesarGuzmanLopez/memos-mcp"],
      "env": {
        "MEMOS_URL": "https://your-memos.com",
        "MEMOS_TOKEN": "your-access-token"
      }
    }
  }
}
```

## Tools (7)

| Tool | Description |
|------|-------------|
| `search` | Search memos by date, tags, or content. Supports relative dates (today, yesterday, next_monday, this_week, 3_days_ago) and ranges |
| `list_memos` | List memos with filters (tags, visibility, pinned, content properties) |
| `get_memo` | Get a single memo's full content |
| `create_memo` | Create a memo with markdown content and tags |
| `update_memo` | Update memo content, visibility, or pin status |
| `delete_memo` | Delete a memo permanently |
| `list_tags` | List all tags with usage counts and hierarchy |

### Search examples

| What you want | Tool call |
|---|---|
| "What did I do yesterday?" | `search(date="yesterday")` |
| "What's on my agenda today?" | `search(date="today")` |
| "Notes from last week" | `search(date="last_week", week=true)` |
| "Show me #project notes" | `search(date="this_month", tags=["project"])` |
| "Find notes about API design" | `search(date="this_year", query="API design")` |
| "What happened on June 15?" | `search(date="2025-06-15")` |
| "March to April overview" | `search(date="2025-03-01", endDate="2025-04-30")` |

## Prompts (4)

| Prompt | Description |
|--------|-------------|
| `capture` | Quick-save a thought, task, or idea |
| `review` | Review memos from a time period |
| `on_day` | Check what happened or is planned for a specific date |
| `tag_overview` | Analyze your tag system |

## License

MIT
