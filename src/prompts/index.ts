import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface PromptDefinition {
  description: string;
  text: string;
}

export const getPromptDefinitions = (): Record<string, PromptDefinition> => ({
  capture: {
    description: "Quick-save a thought, note, task, or idea as a memo",
    text: `Capture a new memo.

Step 1: Use the create_memo tool with the content provided.
- Include tags using #hashtag syntax (e.g. "Meeting notes about #project/backend")
- Visibility: PRIVATE (only you), PROTECTED (logged-in users), PUBLIC (everyone)

Example:
create_memo(content="Had a great idea about #ai/agents", visibility="PRIVATE")`,
  },
  review: {
    description: "Review memos from a time period",
    text: `Review your memos from a time period.

Step 1: Use search with a date range.
- "today": search(date="today")
- "this week": search(date="this_week", week=true)
- "this month": search(date="this_month")

Step 2: Present each memo ONE AT A TIME.
- Use get_memo to fetch full content
- Show: date, tags, full content
- Wait for user to say "next" before showing the next

Step 3: After all memos, give a brief summary.

Example:
search(date="this_week", week=true)
get_memo(id="42")`,
  },
  on_day: {
    description: "Check what happened or is planned for a specific date",
    text: `Check memos for a specific day.

Scenarios:
- "What did I do on June 15?" → search(date="2025-06-15")
- "What's on my agenda today?" → search(date="today")
- "What was I working on last month?" → search(date="2025-05-06")
- "Do I have anything planned for next week?" → search(date="next_week", week=true)
- "What happened yesterday?" → search(date="yesterday")

Example:
search(date="2025-06-15")`,
  },
  tag_overview: {
    description: "Analyze your tag system and suggest improvements",
    text: `Analyze your tag organization.

Step 1: Get all top-level tags.
list_tags()

Step 2: For tags with hasChildren=true, explore hierarchy.
list_tags(parent="work")

Step 3: Present analysis:
- Tag hierarchy structure
- Most used vs rarely used tags
- Tags that could be merged
- Suggestions for cleanup

Example:
list_tags()
list_tags(parent="work")`,
  },
});

export const registerPrompts = (server: McpServer) => {
  const defs = getPromptDefinitions();

  server.registerPrompt(
    "capture",
    {
      description: defs.capture.description,
      argsSchema: {
        content: z.string().describe("The thought or note to save"),
        tags: z.string().optional().describe("Comma-separated tags (e.g. 'idea,project,meeting')"),
        visibility: z.enum(["PRIVATE", "PROTECTED", "PUBLIC"]).default("PRIVATE").describe("Who can see this memo"),
      },
    },
    ({ content, tags, visibility }) => {
      let memoContent = content;
      if (tags) {
        const tagList = tags.split(",").map((t) => `#${t.trim()}`).join(" ");
        memoContent = `${memoContent}\n\n${tagList}`;
      }
      return {
        messages: [{
          role: "user",
          content: { type: "text", text: `Create a memo with the following content using the create_memo tool. Visibility: ${visibility}.\n\nContent:\n${memoContent}` },
        }],
      };
    }
  );

  server.registerPrompt(
    "review",
    {
      description: defs.review.description,
      argsSchema: {
        period: z.enum(["today", "week", "month", "year"]).default("week").describe("Time period to review"),
      },
    },
    ({ period }) => {
      const periodMap: Record<string, string> = {
        today: "today",
        week: "this_week",
        month: "this_month",
        year: "this_year",
      };
      const dateExpr = periodMap[period];
      const weekFlag = period === "week" || period === "year" ? ", week=true" : "";

      return {
        messages: [{
          role: "user",
          content: { type: "text", text: `Review your memos from ${period}.\n\n1. search(date="${dateExpr}"${weekFlag})\n2. get_memo(id="<id>") for each memo, one at a time\n3. Wait for user confirmation between each\n4. Summarize when done` },
        }],
      };
    }
  );

  server.registerPrompt(
    "on_day",
    {
      description: defs.on_day.description,
      argsSchema: {
        date: z.string().describe("Date to check (ISO 8601, 'today', 'yesterday', 'next_monday', etc.)"),
      },
    },
    ({ date }) => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Check what happened or is planned for ${date}.\n\nUse: search(date="${date}")\nPresent the memos found, grouped by date.` },
      }],
    })
  );

  server.registerPrompt(
    "tag_overview",
    {
      description: defs.tag_overview.description,
    },
    () => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Analyze my tag organization.\n\n1. list_tags() for top-level tags\n2. list_tags(parent="<tag>") for children\n3. Present: hierarchy, usage, cleanup suggestions` },
      }],
    })
  );
};
