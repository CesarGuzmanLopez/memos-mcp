import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemosClient } from "../client.js";
import type { Memo } from "../types.js";
import { summarizeMemo } from "./utils.js";

const MAX_CONCURRENT_REQUESTS = 5;

async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing = new Set<Promise<void>>();

  tasks.forEach((task, index) => {
    const p = task().then(
      (result) => { results[index] = result; },
      () => { /* Task failed, leave undefined */ }
    );
    const wrapped = p.then(() => { executing.delete(wrapped); });
    executing.add(wrapped);

    if (executing.size >= limit) {
      return Promise.race(executing);
    }
  });

  await Promise.all(executing);
  return results.filter((r): r is T => r !== undefined);
}

function parseDateToTimestamp(dateStr: string, paramName: string): number {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${paramName}: "${dateStr}". Use ISO 8601 format (e.g. "2025-01-01").`);
  }
  return Math.floor(date.getTime() / 1000);
}

function escapeCel(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Parse relative date expressions into actual dates
function parseRelativeDate(input: string): Date {
  const now = new Date();
  const lower = input.toLowerCase().trim();

  if (lower === "today") return new Date(now);
  if (lower === "tomorrow") { const d = new Date(now); d.setUTCDate(d.getUTCDate() + 1); return d; }
  if (lower === "yesterday") { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 1); return d; }

  // "next_week" / "last_week" / "this_week"
  if (lower === "next_week") { const d = new Date(now); d.setUTCDate(d.getUTCDate() + 7); return d; }
  if (lower === "last_week") { const d = new Date(now); d.setUTCDate(d.getUTCDate() - 7); return d; }
  if (lower === "this_week") return new Date(now);

  // "next_month" / "last_month" / "this_month"
  if (lower === "next_month") { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() + 1); return d; }
  if (lower === "last_month") { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - 1); return d; }
  if (lower === "this_month") return new Date(now);

  // "next_monday", "next_tuesday", etc.
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const nextDayMatch = lower.match(/^next_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (nextDayMatch) {
    const targetDay = dayNames.indexOf(nextDayMatch[1]);
    const d = new Date(now);
    const currentDay = d.getUTCDay();
    const daysAhead = (targetDay - currentDay + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + daysAhead);
    return d;
  }

  // "last_monday", "last_tuesday", etc.
  const lastDayMatch = lower.match(/^last_(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (lastDayMatch) {
    const targetDay = dayNames.indexOf(lastDayMatch[1]);
    const d = new Date(now);
    const currentDay = d.getUTCDay();
    const daysBehind = (currentDay - targetDay + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() - daysBehind);
    return d;
  }

  // "N_days_ago" / "in_N_days"
  const daysAgoMatch = lower.match(/^(\d+)_days_ago$/);
  if (daysAgoMatch) { const d = new Date(now); d.setUTCDate(d.getUTCDate() - parseInt(daysAgoMatch[1])); return d; }
  const inDaysMatch = lower.match(/^in_(\d+)_days$/);
  if (inDaysMatch) { const d = new Date(now); d.setUTCDate(d.getUTCDate() + parseInt(inDaysMatch[1])); return d; }

  // "N_weeks_ago" / "in_N_weeks"
  const weeksAgoMatch = lower.match(/^(\d+)_weeks_ago$/);
  if (weeksAgoMatch) { const d = new Date(now); d.setUTCDate(d.getUTCDate() - parseInt(weeksAgoMatch[1]) * 7); return d; }
  const inWeeksMatch = lower.match(/^in_(\d+)_weeks$/);
  if (inWeeksMatch) { const d = new Date(now); d.setUTCDate(d.getUTCDate() + parseInt(inWeeksMatch[1]) * 7); return d; }

  // Fallback: try ISO 8601 parse
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime())) return parsed;

  throw new Error(`Cannot parse date: "${input}". Use ISO 8601 (e.g. "2025-06-15"), "today", "tomorrow", "yesterday", "next_monday", "next_week", "in_7_days", "3_days_ago", etc.`);
}

// Calculate week boundaries (Monday to Sunday)
function getWeekBoundaries(refDate: Date): { start: Date; end: Date } {
  const d = new Date(refDate);
  const day = d.getUTCDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day; // Monday = 1, Sunday = 0 → -6
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() + diffToMonday);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

export const registerReviewTools = (server: McpServer, client: MemosClient) => {
  // Tool: search_memos_by_date
  server.registerTool(
    "search_memos_by_date",
    {
      description: [
        "Search memos from a specific date range.",
        "Supports ISO 8601 dates AND relative expressions:",
        "- 'today', 'tomorrow', 'yesterday'",
        "- 'next_monday', 'last_friday'",
        "- 'next_week', 'last_week', 'this_week'",
        "- 'in_7_days', '3_days_ago', 'in_2_weeks'",
        "- 'this_month', 'next_month'",
        "Use with 'week' parameter to get full week ranges automatically.",
      ].join(" "),
      inputSchema: {
        startDate: z.string().describe("Start date — ISO 8601 or relative (e.g. 'today', 'next_monday', 'in_7_days')"),
        endDate: z.string().optional().describe("End date — ISO 8601 or relative. Omit for single-day search."),
        week: z.boolean().optional().describe("If true, startDate is the reference and endDate auto-calculates to end of that week (Mon-Sun)"),
        pageSize: z.number().int().min(1).max(100).default(20).describe("Number of memos per page"),
        pageToken: z.string().optional().describe("Token for fetching the next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ startDate, endDate, week, pageSize, pageToken }) => {
      const currentUser = await client.getCurrentUser();
      const refDate = parseRelativeDate(startDate);

      let startTs: number;
      let endTs: number;

      if (week) {
        const boundaries = getWeekBoundaries(refDate);
        startTs = Math.floor(boundaries.start.getTime() / 1000);
        endTs = Math.floor(boundaries.end.getTime() / 1000);
      } else {
        startTs = Math.floor(refDate.getTime() / 1000);
        endTs = endDate
          ? Math.floor(parseRelativeDate(endDate).getTime() / 1000)
          : startTs + 86400;
      }

      const filter = `creator == "${escapeCel(currentUser)}" && created_ts >= ${startTs} && created_ts <= ${endTs}`;

      const params: Record<string, string> = { pageSize: String(pageSize), filter };
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

  // Tool: on_day — versatile date lookup
  server.registerTool(
    "on_day",
    {
      description: [
        "Look up memos for a specific day.",
        "- A specific date: check what happened or was planned on that day.",
        "- Today: see what's on your agenda for today.",
        "- Future date: check if you have anything planned.",
        "- Past date: revisit what you wrote.",
        "Accepts ISO 8601 dates, 'today', 'tomorrow', 'yesterday', 'next_monday', etc.",
      ].join(" "),
      inputSchema: {
        date: z.string().describe("Date to check (ISO 8601, 'today', 'tomorrow', 'yesterday', 'next_monday', etc.)"),
        years: z.number().int().min(1).max(10).default(5).describe("Also check this day in previous N years"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date, years }) => {
      const currentUser = await client.getCurrentUser();

      // Resolve the target date
      let targetDate: Date;
      try {
        targetDate = parseRelativeDate(date);
      } catch (e) {
        return { content: [{ type: "text" as const, text: String(e) }] };
      }

      const month = targetDate.getUTCMonth() + 1;
      const day = targetDate.getUTCDate();
      const targetYear = targetDate.getUTCFullYear();
      const now = new Date();
      const todayYear = now.getUTCFullYear();

      const tasks: (() => Promise<{ year: number; memos: unknown[] } | null>)[] = [];

      // Task 1: Get memos from the exact target date
      tasks.push(async () => {
        const tsStart = Math.floor(Date.UTC(targetYear, month - 1, day) / 1000);
        const tsEnd = tsStart + 86400;
        const filter = `creator == "${escapeCel(currentUser)}" && created_ts >= ${tsStart} && created_ts < ${tsEnd}`;
        const result = await client.get<{ memos: Memo[] }>("/api/v1/memos", { pageSize: "50", filter });
        if (result.memos && result.memos.length > 0) {
          return {
            year: targetYear,
            memos: result.memos.map((m) => summarizeMemo(m as unknown as Record<string, unknown>)),
          };
        }
        return null;
      });

      // Task 2+: Check same day in previous N years (skip the target year)
      for (let year = todayYear - 1; year >= todayYear - years; year--) {
        if (year === targetYear) continue; // Already fetched above
        tasks.push(async () => {
          const tsStart = Math.floor(Date.UTC(year, month - 1, day) / 1000);
          const tsEnd = tsStart + 86400;
          const filter = `creator == "${escapeCel(currentUser)}" && created_ts >= ${tsStart} && created_ts < ${tsEnd}`;
          const result = await client.get<{ memos: Memo[] }>("/api/v1/memos", { pageSize: "10", filter });
          if (result.memos && result.memos.length > 0) {
            return {
              year,
              memos: result.memos.map((m) => summarizeMemo(m as unknown as Record<string, unknown>)),
            };
          }
          return null;
        });
      }

      const allResults = await parallelLimit(tasks, MAX_CONCURRENT_REQUESTS);
      const results = allResults.filter((r): r is { year: number; memos: unknown[] } => r !== null);

      const dateStr = `${targetYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      if (results.length === 0) {
        const isToday = date.toLowerCase() === "today";
        const msg = isToday
          ? `No memos found for today (${dateStr}). Nothing on your agenda.`
          : `No memos found for ${dateStr} or this day in previous years.`;
        return { content: [{ type: "text" as const, text: msg }] };
      }

      // Sort by year descending (most recent first)
      results.sort((a, b) => b.year - a.year);

      const output = {
        date: dateStr,
        groups: results,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );
};
