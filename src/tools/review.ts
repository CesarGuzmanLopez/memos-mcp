import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemosClient } from "../client.js";
import type { Memo } from "../types.js";
import { summarizeMemo } from "./utils.js";

// Límite de concurrencia para requests paralelos
const MAX_CONCURRENT_REQUESTS = 5;

// Helper para ejecutar promises con concurrencia limitada, preservando orden
async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing = new Set<Promise<void>>();

  tasks.forEach((task, index) => {
    const p = task().then((result) => {
      results[index] = result;
    });
    const wrapped = p.then(() => { executing.delete(wrapped); });
    executing.add(wrapped);

    if (executing.size >= limit) {
      return Promise.race(executing);
    }
  });

  await Promise.all(executing);
  return results.filter((r): r is T => r !== undefined);
}

// Validar y convertir fecha a timestamp Unix
function parseDateToTimestamp(dateStr: string, paramName: string): number {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${paramName}: "${dateStr}". Use ISO 8601 format (e.g. "2025-01-01").`);
  }
  return Math.floor(date.getTime() / 1000);
}

export const registerReviewTools = (server: McpServer, client: MemosClient) => {
  server.registerTool(
    "search_memos_by_date",
    {
      description: "Search memos from a specific date range. Useful for reviewing past entries.",
      inputSchema: {
        startDate: z.string().describe("Start date (ISO 8601, e.g. '2025-01-01' or '2025-01-01T00:00:00Z')"),
        endDate: z.string().optional().describe("End date (ISO 8601). Defaults to start date if not provided."),
        pageSize: z.number().int().min(1).max(100).default(20).describe("Number of memos per page"),
        pageToken: z.string().optional().describe("Token for fetching the next page"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ startDate, endDate, pageSize, pageToken }) => {
      const currentUser = await client.getCurrentUser();

      const startTs = parseDateToTimestamp(startDate, "startDate");
      const endTs = endDate
        ? parseDateToTimestamp(endDate, "endDate")
        : startTs + 86400;

      const filter = `creator == "${currentUser}" && created_ts >= ${startTs} && created_ts <= ${endTs}`;

      const params: Record<string, string> = {
        pageSize: String(pageSize),
        filter,
      };
      if (pageToken) params.pageToken = pageToken;

      const result = await client.get<{ memos: Memo[]; nextPageToken?: string }>(
        "/api/v1/memos",
        params
      );

      const summaries = (result.memos || []).map((m) =>
        summarizeMemo(m as unknown as Record<string, unknown>)
      );

      const output: Record<string, unknown> = {
        memos: summaries,
        totalFound: result.memos?.length || 0,
      };
      if (result.nextPageToken) output.nextPageToken = result.nextPageToken;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
      };
    }
  );

  server.registerTool(
    "get_memos_from_this_day_previous_years",
    {
      description: "Get memos created on this same day in previous years. Great for revisiting past thoughts.",
      inputSchema: {
        years: z.number().int().min(1).max(10).default(5).describe("How many years back to search"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ years }) => {
      const currentUser = await client.getCurrentUser();
      const now = new Date();
      const month = now.getUTCMonth() + 1;
      const day = now.getUTCDate();
      const currentYear = now.getUTCFullYear();

      // Crear tasks para buscar cada año en paralelo
      const tasks: (() => Promise<{ year: number; memos: unknown[] } | null>)[] = [];

      for (let year = currentYear - 1; year >= currentYear - years; year--) {
        tasks.push(async () => {
          const yearStart = Math.floor(Date.UTC(year, month - 1, day) / 1000);
          const yearEnd = yearStart + 86400;

          const filter = `creator == "${currentUser}" && created_ts >= ${yearStart} && created_ts < ${yearEnd}`;

          const result = await client.get<{ memos: Memo[] }>("/api/v1/memos", {
            pageSize: "10",
            filter,
          });

          if (result.memos && result.memos.length > 0) {
            return {
              year,
              memos: result.memos.map((m) =>
                summarizeMemo(m as unknown as Record<string, unknown>)
              ),
            };
          }
          return null;
        });
      }

      const allResults = await parallelLimit(tasks, MAX_CONCURRENT_REQUESTS);
      const results = allResults.filter((r): r is { year: number; memos: unknown[] } => r !== null);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No memos found on this day (${month}/${day}) in previous ${years} years.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                message: `Memories from this day in previous years`,
                date: `${month}/${day}`,
                groups: results,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
};
