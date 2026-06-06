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
- Include tags in the content using #hashtag syntax (e.g. "Meeting notes about #project/backend")
- Choose visibility: PRIVATE (only you), PROTECTED (logged-in users), PUBLIC (everyone)

Example:
create_memo(content="Had a great idea about #ai/agents", visibility="PRIVATE")`,
  },
  review: {
    description: "Review memos from a specific time period",
    text: `Review your memos from a time period.

Step 1: Use search_memos_by_date with a date range to find memos.
- For "today": use today's date as both startDate and endDate
- For "this week": use 7 days ago as startDate
- For "this month": use 30 days ago as startDate

Step 2: Present each memo ONE AT A TIME to the user.
- Use get_memo with the memo id to fetch full content
- Show: created date, tags, and the full content
- Wait for user to say "next" or "ok" before showing the next memo

Step 3: After all memos, give a brief summary of what was reviewed.

Example tool calls:
search_memos_by_date(startDate="2025-06-01", endDate="2025-06-06")
get_memo(id="42")`,
  },
  on_this_day: {
    description: "See what you wrote on this day in previous years",
    text: `Show "On This Day" memories from previous years.

Step 1: Use get_memos_from_this_day_previous_years to find past memos.
- Default searches 5 years back
- Results are grouped by year

Step 2: For each year with memos, use get_memo to show full content.
- Present starting from the most recent year
- Add a brief reflection on how thoughts evolved

Example tool calls:
get_memos_from_this_day_previous_years(years=5)
get_memo(id="42")`,
  },
  digest: {
    description: "Summarize your memo activity for a period",
    text: `Create a digest of your memo activity.

Step 1: Get memos from the period.
- For "today": search_memos_by_date with today's date
- For "week": search_memos_by_date with startDate 7 days ago
- For "month": search_memos_by_date with startDate 30 days ago

Step 2: Analyze and summarize:
- Total memos created
- Main themes based on tags and content
- Memos with incomplete tasks (hasIncompleteTasks)
- Memos pinned for attention
- Any trends or patterns

Example tool calls:
search_memos_by_date(startDate="2025-05-30", endDate="2025-06-06")
list_tags()`,
  },
  tag_overview: {
    description: "Analyze your tag system and suggest improvements",
    text: `Analyze your tag organization.

Step 1: Get all top-level tags.
list_tags()

Step 2: For tags with hasChildren=true, explore the hierarchy.
list_tags(parent="work")
list_tags(parent="project")

Step 3: Present analysis:
- Tag hierarchy structure
- Most used vs rarely used tags
- Tags that could be merged (similar names)
- Suggestions for cleanup

Example tool calls:
list_tags()
list_tags(parent="work")
list_tags(parent="project")`,
  },
  relation_graph: {
    description: "Explore connections between memos",
    text: `Explore how your memos are connected.

Step 1: Get the starting memo.
get_memo(id="<memo_id>")

Step 2: Find related memos with increasing depth.
list_memo_relations(id="<memo_id>", depth=2)

Step 3: For each connected memo found, fetch its content.
get_memo(id="<connected_memo_id>")

Step 4: Present:
- Text visualization of the graph (which memos reference which)
- Brief summary of each connected memo
- Common themes connecting the memos

Example tool calls:
get_memo(id="42")
list_memo_relations(id="42", depth=2)
get_memo(id="15")`,
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
        const tagList = tags
          .split(",")
          .map((t) => `#${t.trim()}`)
          .join(" ");
        memoContent = `${memoContent}\n\n${tagList}`;
      }
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Create a memo with the following content using the create_memo tool. Visibility: ${visibility}.\n\nContent:\n${memoContent}`,
            },
          },
        ],
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
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Review your memos from ${label}.\n\nUse these tool calls in order:\n1. search_memos_by_date(startDate="${startDate}", endDate="${endDate}")\n2. get_memo(id="<id_from_results>") for each memo, one at a time\n3. Wait for user confirmation between each memo\n4. Summarize when done`,
            },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "on_this_day",
    {
      description: defs.on_this_day.description,
      argsSchema: {
        years: z.number().int().min(1).max(10).default(5).describe("How many years back to search"),
      },
    },
    ({ years }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Show me what I wrote on this day in previous years.\n\nUse these tool calls:\n1. get_memos_from_this_day_previous_years(years=${years})\n2. get_memo(id="<id>") for each memo found\n3. Present grouped by year, most recent first`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "digest",
    {
      description: defs.digest.description,
      argsSchema: {
        period: z.enum(["today", "week", "month"]).default("week").describe("Time period to summarize"),
      },
    },
    ({ period }) => {
      const periodMap: Record<string, { days: number; label: string }> = {
        today: { days: 1, label: "today" },
        week: { days: 7, label: "the past week" },
        month: { days: 30, label: "the past month" },
      };
      const { days, label } = periodMap[period];

      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Create a digest of my memo activity for ${label}.\n\nUse these tool calls:\n1. search_memos_by_date(startDate="${startDate}", endDate="${endDate}")\n2. list_tags() to see tag usage\n3. Summarize: total memos, main themes, incomplete tasks, trends`,
            },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "tag_overview",
    {
      description: defs.tag_overview.description,
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Analyze my tag organization.\n\nUse these tool calls:\n1. list_tags() for top-level tags\n2. list_tags(parent="<tag>") for tags with hasChildren=true\n3. Present: hierarchy, usage patterns, cleanup suggestions`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "relation_graph",
    {
      description: defs.relation_graph.description,
      argsSchema: {
        memo: z.string().describe("Memo ID or UID to start from"),
      },
    },
    ({ memo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Explore memo connections starting from memo ${memo}.\n\nUse these tool calls:\n1. get_memo(id="${memo}")\n2. list_memo_relations(id="${memo}", depth=3)\n3. get_memo(id="<connected_id>") for each relation\n4. Present graph visualization and themes`,
          },
        },
      ],
    })
  );
};