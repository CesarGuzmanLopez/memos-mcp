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

  // Helper: normalize to midnight UTC
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
    const daysAhead = (targetDay - d.getUTCDay() + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysAhead);
    return toMidnight(d);
  }
  const lastDayMatch = lower.match(/^last_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (lastDayMatch) {
    const targetDay = dayNames.indexOf(lastDayMatch[1]);
    const d = new Date(now);
    const daysBehind = (d.getUTCDay() - targetDay + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() - daysBehind);
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
  throw new Error(`Cannot parse date: "${input}". Use ISO 8601 (e.g. "2025-06-15"), "today", "tomorrow", "next_monday", "3_days_ago", etc.`);
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
        "Search memos by date, tags, or content. Single unified tool.",
        "",
        "Date inputs (accepts any of):",
        "  ISO 8601: '2025-06-15'",
        "  Relative: 'today', 'tomorrow', 'yesterday'",
        "  Relative: 'next_monday', 'last_friday', 'next_week', 'this_month'",
        "  Relative: 'in_7_days', '3_days_ago', 'in_2_weeks'",
        "",
        "Use cases:",
        "  Single day: search(date='yesterday')",
        "  Date range: search(date='2025-03-01', endDate='2025-04-30')",
        "  Full week: search(date='this_week', week=true)",
        "  Next week: search(date='next_week', week=true)",
        "  By tag: search(date='today', tags=['work'])",
        "  Full text: search(date='this_month', query='reunión')",
        "  Combined: search(date='last_week', week=true, tags=['project'])",
      ].join("\n"),
      inputSchema: {
        date: z.string().describe("Date to search from (ISO 8601 or relative: today, yesterday, next_monday, etc.)"),
        endDate: z.string().optional().describe("End date for range search (ISO 8601 or relative). Omit for single-day."),
        week: z.boolean().optional().describe("If true, auto-calculates full week (Mon-Sun) around the date"),
        tags: z.array(z.string()).optional().describe("Filter by tags (e.g. ['work', 'meeting'])"),
        query: z.string().optional().describe("Search text within memo content"),
        pageSize: z.number().int().min(1).max(100).default(20).describe("Max results per page"),
        pageToken: z.string().optional().describe("Pagination token for next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date, endDate, week, tags, query, pageSize, pageToken }) => {
      const currentUser = await client.getCurrentUser();

      // Resolve date range
      let startTs: number;
      let endTs: number;
      try {
        const refDate = parseRelativeDate(date);
        if (week) {
          const boundaries = getWeekBoundaries(refDate);
          startTs = Math.floor(boundaries.start.getTime() / 1000);
          endTs = Math.floor(boundaries.end.getTime() / 1000);
        } else {
          startTs = Math.floor(refDate.getTime() / 1000);
          endTs = endDate ? Math.floor(parseRelativeDate(endDate).getTime() / 1000) : startTs + 86400;
        }
      } catch (e) {
        return { content: [{ type: "text" as const, text: String(e) }] };
      }

      // Build CEL filter
      const parts: string[] = [
        `creator == "${escapeCel(currentUser)}"`,
        `created_ts >= ${startTs}`,
        `created_ts <= ${endTs}`,
      ];
      if (tags?.length) {
        const tagList = tags.map((t) => `"${escapeCel(t)}"`).join(", ");
        parts.push(`tag in [${tagList}]`);
      }
      if (query) {
        parts.push(`content.contains("${escapeCel(query)}")`);
      }

      const params: Record<string, string> = {
        pageSize: String(pageSize),
        filter: parts.join(" && "),
      };
      if (pageToken) params.pageToken = pageToken;

      const result = await client.get<{ memos: Memo[]; nextPageToken?: string }>("/api/v1/memos", params);
      const summaries = (result.memos || []).map((m) => summarizeMemo(m as unknown as Record<string, unknown>));

      const output: Record<string, unknown> = {
        dateRange: {
          start: new Date(startTs * 1000).toISOString().split("T")[0],
          end: new Date(endTs * 1000).toISOString().split("T")[0],
        },
        memos: summaries,
        totalFound: result.memos?.length || 0,
      };
      if (result.nextPageToken) output.nextPageToken = result.nextPageToken;

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );
};
