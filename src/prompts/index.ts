import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const registerPrompts = (server: McpServer) => {
  // capture — save a thought
  server.registerPrompt(
    "capture",
    {
      description: "Quick-save a thought, note, task, or idea",
      argsSchema: {
        content: z.string().describe("The thought or note to save"),
        tags: z.string().optional().describe("Comma-separated tags (e.g. 'idea,project')"),
        visibility: z.enum(["PRIVATE", "PROTECTED", "PUBLIC"]).default("PRIVATE"),
      },
    },
    ({ content, tags, visibility }) => {
      let memoContent = content;
      if (tags) {
        memoContent = `${memoContent}\n\n${tags.split(",").map((t) => `#${t.trim()}`).join(" ")}`;
      }
      return {
        messages: [{
          role: "user",
          content: { type: "text", text: `Create a memo using the create tool. Visibility: ${visibility}.\n\nContent:\n${memoContent}` },
        }],
      };
    }
  );

  // review — review memos from a period
  server.registerPrompt(
    "review",
    {
      description: "Review memos from a time period",
      argsSchema: {
        period: z.enum(["today", "week", "month", "year"]).default("week"),
      },
    },
    ({ period }) => {
      const map: Record<string, { date: string; week?: boolean }> = {
        today: { date: "today" },
        week: { date: "this_week", week: true },
        month: { date: "this_month" },
        year: { date: "this_year", week: true },
      };
      const { date, week } = map[period];
      const weekArg = week ? ", week=true" : "";

      return {
        messages: [{
          role: "user",
          content: { type: "text", text: `Review your memos from ${period}.\n\n1. search(date="${date}"${weekArg})\n2. get(id="<id>") for each memo, one at a time\n3. Wait for user confirmation between each\n4. Summarize when done` },
        }],
      };
    }
  );

  // on_day — check a specific date
  server.registerPrompt(
    "on_day",
    {
      description: "Check what happened or is planned for a specific date",
      argsSchema: {
        date: z.string().describe("Date to check (ISO 8601, 'today', 'yesterday', 'next_monday', etc.)"),
      },
    },
    ({ date }) => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Check what happened or is planned for ${date}.\n\nUse: search(date="${date}")\nPresent the memos found.` },
      }],
    })
  );

  // tag_overview — analyze tags
  server.registerPrompt(
    "tag_overview",
    {
      description: "Analyze your tag system and suggest improvements",
    },
    () => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Analyze my tag organization.\n\n1. tags() for top-level tags\n2. tags(parent="<tag>") for children\n3. Present: hierarchy, usage, cleanup suggestions` },
      }],
    })
  );
};
