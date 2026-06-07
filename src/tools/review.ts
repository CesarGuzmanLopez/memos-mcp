import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemosClient } from "../client.js";
import type { Memo } from "../types.js";
import { summarizeMemo } from "./utils.js";

function escapeCel(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parseRelativeDate(input: string): Date {
  const now = new Date();
  const lower = input.toLowerCase().trim();
  const toMidnight = (d: Date) => { d.setUTCHours(0, 0, 0, 0); return d; };

  if (lower === "today") return toMidnight(new Date(now));
  if (lower === "tomorrow") { const d = new Date(now); d.setUTCDate(d.getUTCDate() + 1); return toMidnight(d); }
  if (lower === "yesterday") { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 1); return toMidnight(d); }
  if (lower === "next_week") { const d = new Date(now); d.setUTCDate(d.getUTCDate() + 7); return toMidnight(d); }
  if (lower === "last_week") { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 7); return toMidnight(d); }
  if (lower === "this_week") return toMidnight(new Date(now));
  if (lower === "next_month") { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() + 1); return toMidnight(d); }
  if (lower === "last_month") { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - 1); return toMidnight(d); }
  if (lower === "this_month") return toMidnight(new Date(now));

  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const nextDayMatch = lower.match(/^next_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (nextDayMatch) {
    const targetDay = dayNames.indexOf(nextDayMatch[1]);
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + ((targetDay - d.getUTCDay() + 7) % 7 || 7));
    return toMidnight(d);
  }
  const lastDayMatch = lower.match(/^last_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (lastDayMatch) {
    const targetDay = dayNames.indexOf(lastDayMatch[1]);
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - targetDay + 7) % 7 || 7));
    return toMidnight(d);
  }

  const daysAgoMatch = lower.match(/^(\d+)_days_ago$/);
  if (daysAgoMatch) { const d = new Date(now); d.setUTCDate(d.getUTCDate() - parseInt(daysAgoMatch[1])); return toMidnight(d); }
  const inDaysMatch = lower.match(/^in_(\d+)_days$/);
  if (inDaysMatch) { const d = new Date(now); d.setUTCDate(d.getUTCDate() + parseInt(inDaysMatch[1])); return toMidnight(d); }
  const weeksAgoMatch = lower.match(/^(\d+)_weeks_ago$/);
  if (weeksAgoMatch) { const d = new Date(now); d.setUTCDate(d.getUTCDate() - parseInt(weeksAgoMatch[1]) * 7); return toMidnight(d); }
  const inWeeksMatch = lower.match(/^in_(\d+)_weeks$/);
  if (inWeeksMatch) { const d = new Date(now); d.setUTCDate(d.getUTCDate() + parseInt(inWeeksMatch[1]) * 7); return toMidnight(d); }

  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) return parsed;
  throw new Error(`Cannot parse date: "${input}". Use ISO 8601, "today", "yesterday", "next_monday", "3_days_ago", etc.`);
}

function getWeekBoundaries(refDate: Date): { start: Date; end: Date } {
  const d = new Date(refDate);
  const day = d.getUTCDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() + diffToMonday);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

export const registerSearchTool = (server: McpServer, client: MemosClient) => {
  server.registerTool(
    "search",
    {
      description: [
        "Search memos. Unified tool for date-based, tag-based, and content-based search.",
        "",
        "Date (optional, accepts):",
        "  ISO: '2025-06-15'  |  Relative: 'today', 'yesterday', 'tomorrow'",
        "  Relative: 'next_monday', 'last_friday', 'next_week', 'this_month'",
        "  Relative: 'in_7_days', '3_days_ago', 'in_2_weeks'",
        "  week=true: auto full week (Mon-Sun)",
        "",
        "Filters (all optional, combined with AND):",
        "  tags: ['work', 'meeting']  |  query: 'text search'",
        "  visibility: ['PRIVATE']     |  pinned: true",
        "  state: 'ARCHIVED'           |  hasIncompleteTasks: true",
        "  hasAttachments: true        |  Only memos with file attachments",
        "",
        "No date = all memos. No filters = all memos.",
      ].join("\n"),
      inputSchema: {
        date: z.string().optional().describe("Date (ISO 8601 or relative). Omit to search all memos."),
        endDate: z.string().optional().describe("End date for range. Omit for single-day."),
        week: z.boolean().optional().describe("Auto full week (Mon-Sun) around date"),
        tags: z.array(z.string()).optional().describe("Filter by tags"),
        query: z.string().optional().describe("Full-text search in content"),
        visibility: z.array(z.enum(["PRIVATE", "PROTECTED", "PUBLIC"])).optional().describe("Filter by visibility"),
        pinned: z.boolean().optional().describe("Only pinned memos"),
        state: z.enum(["NORMAL", "ARCHIVED"]).optional().describe("Filter by state"),
        hasIncompleteTasks: z.boolean().optional().describe("Only memos with incomplete tasks"),
        hasAttachments: z.boolean().optional().describe("Only memos with file attachments"),
        pageSize: z.number().int().min(1).max(100).default(20).describe("Results per page"),
        pageToken: z.string().optional().describe("Pagination token"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      let currentUser: string;
      try {
        currentUser = await client.getCurrentUser();
      } catch {
        currentUser = "";
      }

      // Build CEL filter
      const parts: string[] = [];

      if (currentUser) parts.push(`creator == "${escapeCel(currentUser)}"`);

      // Date filtering
      if (args.date) {
        try {
          const refDate = parseRelativeDate(args.date);
          let startTs: number;
          let endTs: number;
          if (args.week) {
            const b = getWeekBoundaries(refDate);
            startTs = Math.floor(b.start.getTime() / 1000);
            endTs = Math.floor(b.end.getTime() / 1000);
          } else {
            startTs = Math.floor(refDate.getTime() / 1000);
            endTs = args.endDate ? Math.floor(parseRelativeDate(args.endDate).getTime() / 1000) : startTs + 86400;
          }
          parts.push(`created_ts >= ${startTs}`);
          parts.push(`created_ts <= ${endTs}`);
        } catch (e) {
          return { content: [{ type: "text" as const, text: String(e) }] };
        }
      }

      // Other filters
      if (args.tags?.length) {
        const tagList = args.tags.map((t) => `"${escapeCel(t)}"`).join(", ");
        parts.push(`tag in [${tagList}]`);
      }
      if (args.query) parts.push(`content.contains("${escapeCel(args.query)}")`);
      if (args.visibility?.length) {
        const visList = args.visibility.map((v) => `"${v}"`).join(", ");
        parts.push(`visibility in [${visList}]`);
      }
      if (args.pinned !== undefined) parts.push(`pinned == ${args.pinned}`);
      if (args.state) parts.push(`row_status == "${args.state === "ARCHIVED" ? "ARCHIVED" : "NORMAL"}"`);
      if (args.hasIncompleteTasks) parts.push(`has_incomplete_tasks == true`);

      const filter = parts.length > 0 ? parts.join(" && ") : "";

      const params: Record<string, string> = {
        pageSize: String(args.pageSize),
        orderBy: "create_time desc",
      };
      if (filter) params.filter = filter;
      if (args.pageToken) params.pageToken = args.pageToken;

      const result = await client.get<{ memos: Memo[]; nextPageToken?: string }>("/api/v1/memos", params);
      let summaries = (result.memos || []).map((m) => summarizeMemo(m as unknown as Record<string, unknown>));

      // Filter by attachments count (post-fetch since Memos API doesn't support this in CEL)
      if (args.hasAttachments) {
        summaries = summaries.filter((s) => (s.attachmentsCount as number) > 0);
      }

      const output: Record<string, unknown> = { memos: summaries, totalFound: summaries.length };
      if (result.nextPageToken) output.nextPageToken = result.nextPageToken;

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );
};
