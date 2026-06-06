import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface PromptDefinition {
  description: string;
  text: string;
}

export const getPromptDefinitions = (): Record<string, PromptDefinition> => ({
  capture: {
    description: "Quick-save a thought or note as a memo",
    text: `Capture a new memo.

Step 1: Use the create_memo tool with the content provided.
- Include tags using #hashtag syntax (e.g. "Meeting notes about #project/backend")
- Visibility: PRIVATE (only you), PROTECTED (logged-in users), PUBLIC (everyone)

Example:
create_memo(content="Had a great idea about #ai/agents", visibility="PRIVATE")`,
  },
  review: {
    description: "Review memos from a specific time period",
    text: `Review your memos from a time period.

Step 1: Use search_memos_by_date with a date range.
- "today": startDate = today, endDate = today
- "this week": startDate = 7 days ago
- "this month": startDate = 30 days ago

Step 2: Present each memo ONE AT A TIME.
- Use get_memo to fetch full content
- Show: date, tags, full content
- Wait for user to say "next" before showing the next

Step 3: After all memos, give a brief summary.

Example tool calls:
search_memos_by_date(startDate="2025-06-01", endDate="2025-06-06")
get_memo(id="42")`,
  },
  on_day: {
    description: "Check memos for a specific date — past, present, or future",
    text: `Check what happened or is planned for a specific day.

Uses: on_day tool

Scenarios:
- "What did I do on June 15?" → on_day(date="2025-06-15")
- "What's on my agenda today?" → on_day(date="today")
- "What was I working on last month?" → on_day(date="2025-05-06")
- "Do I have anything planned for next week?" → on_day(date="next_monday")
- "What happened yesterday?" → on_day(date="yesterday")

The tool returns memos from that day plus this same day in previous years.

Example:
on_day(date="2025-06-15", years=3)`,
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

Example tool calls:
list_tags()
list_tags(parent="work")`,
  },
});

export const registerPrompts = (server: McpServer) => {
  const defs = getPromptDefinitions();

  // Prompt: capture
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

  // Prompt: review
  server.registerPrompt(
    "review",
    {
      description: defs.review.description,
      argsSchema: {
        period: z.enum(["today", "week", "month", "year"]).default("week").describe("Time period to review"),
      },
    },
    ({ period }) => {
      const periodMap: Record<string, { days: number; label: string }> = {
        today: { days: 1, label: "today" },
        week: { days: 7, label: "the past week" },
        month: { days: 30, label: "the past month" },
        year: { days: 365, label: "the past year" },
      };
      const { days, label } = periodMap[period];
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

      return {
        messages: [{
          role: "user",
          content: { type: "text", text: `Review your memos from ${label}.\n\nUse these tool calls in order:\n1. search_memos_by_date(startDate="${startDate}", endDate="${endDate}")\n2. get_memo(id="<id>") for each memo, one at a time\n3. Wait for user confirmation between each memo\n4. Summarize when done` },
        }],
      };
    }
  );

  // Prompt: on_day
  server.registerPrompt(
    "on_day",
    {
      description: defs.on_day.description,
      argsSchema: {
        date: z.string().describe("Date to check (ISO 8601 e.g. '2025-06-15') or 'today'"),
        years: z.number().int().min(1).max(10).default(5).describe("Also check this day in previous N years"),
      },
    },
    ({ date, years }) => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Check what happened or is planned for ${date}.\n\nUse: on_day(date="${date}", years=${years})\n\nPresent:\n- Memos from the target date (agenda/past notes)\n- This same day in previous years (if any)\n- Group by year, most recent first` },
      }],
    })
  );

  // Prompt: tag_overview
  server.registerPrompt(
    "tag_overview",
    {
      description: defs.tag_overview.description,
    },
    () => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Analyze my tag organization.\n\nUse these tool calls:\n1. list_tags() for top-level tags\n2. list_tags(parent="<tag>") for tags with hasChildren=true\n3. Present: hierarchy, usage patterns, cleanup suggestions` },
      }],
    })
  );
};
