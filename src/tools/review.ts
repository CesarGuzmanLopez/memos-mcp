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

export const registerReviewTools = (server: McpServer, client: MemosClient) => {
  // Tool: search_memos_by_date
  server.registerTool(
    "search_memos_by_date",
    {
      description: "Search memos from a specific date range. Useful for reviewing past entries.",
      inputSchema: {
        startDate: z.string().describe("Start date (ISO 8601, e.g. '2025-01-01')"),
        endDate: z.string().optional().describe("End date (ISO 8601). Defaults to start date if not provided."),
        pageSize: z.number().int().min(1).max(100).default(20).describe("Number of memos per page"),
        pageToken: z.string().optional().describe("Token for fetching the next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ startDate, endDate, pageSize, pageToken }) => {
      const currentUser = await client.getCurrentUser();
      const startTs = parseDateToTimestamp(startDate, "startDate");
      const endTs = endDate ? parseDateToTimestamp(endDate, "endDate") : startTs + 86400;

      const filter = `creator == "${escapeCel(currentUser)}" && created_ts >= ${startTs} && created_ts <= ${endTs}`;

      const params: Record<string, string> = { pageSize: String(pageSize), filter };
      if (pageToken) params.pageToken = pageToken;

      const result = await client.get<{ memos: Memo[]; nextPageToken?: string }>("/api/v1/memos", params);
      const summaries = (result.memos || []).map((m) => summarizeMemo(m as unknown as Record<string, unknown>));

      const output: Record<string, unknown> = { memos: summaries, totalFound: result.memos?.length || 0 };
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
        "Accepts ISO 8601 dates (e.g. '2025-06-15') or 'today'.",
      ].join(" "),
      inputSchema: {
        date: z.string().describe("Date to check (ISO 8601 e.g. '2025-06-15') or 'today'"),
        years: z.number().int().min(1).max(10).default(5).describe("Also check this day in previous N years"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date, years }) => {
      const currentUser = await client.getCurrentUser();

      // Resolve the target date
      let targetDate: Date;
      if (date.toLowerCase() === "today") {
        targetDate = new Date();
      } else {
        targetDate = new Date(date);
        if (isNaN(targetDate.getTime())) {
          return { content: [{ type: "text" as const, text: `Invalid date: "${date}". Use ISO 8601 format (e.g. "2025-06-15") or "today".` }] };
        }
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
