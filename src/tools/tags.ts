import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemosClient } from "../client.js";
import type { Memo } from "../types.js";

interface TagInfo {
  name: string;
  count: number;
  hasChildren?: boolean;
}

// Cache de tags con TTL y limpieza automática
interface TagsCacheEntry {
  tagCounts: Map<string, number>;
  timestamp: number;
}

const tagsCache = new Map<string, TagsCacheEntry>();
const TAGS_CACHE_TTL_MS = 60_000; // 1 minuto
const TAGS_MAX_PAGES = 20; // Máximo 20 páginas (10,000 memos) para evitar fetch infinito

// Sweep periódico del cache
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of tagsCache) {
    if (now - entry.timestamp > TAGS_CACHE_TTL_MS) {
      tagsCache.delete(key);
    }
  }
}, 30_000);

function getCachedTags(key: string): Map<string, number> | null {
  const entry = tagsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TAGS_CACHE_TTL_MS) {
    tagsCache.delete(key);
    return null;
  }
  return entry.tagCounts;
}

function setCachedTags(key: string, tagCounts: Map<string, number>): void {
  tagsCache.set(key, { tagCounts, timestamp: Date.now() });
}

function hasChildTags(allTags: Set<string>, tagName: string): boolean {
  const prefix = tagName + "/";
  for (const tag of allTags) {
    if (tag.startsWith(prefix) && tag !== tagName) return true;
  }
  return false;
}

function getTopLevelTags(tagCounts: Map<string, number>): TagInfo[] {
  const allTags = new Set(tagCounts.keys());
  const result: TagInfo[] = [];
  for (const [name, count] of tagCounts) {
    if (!name.includes("/")) {
      result.push({ name, count, hasChildren: hasChildTags(allTags, name) });
    }
  }
  return result.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function getChildTags(tagCounts: Map<string, number>, parent: string): TagInfo[] {
  const allTags = new Set(tagCounts.keys());
  const prefix = parent + "/";
  const result: TagInfo[] = [];
  const seen = new Set<string>();

  for (const tag of allTags) {
    if (tag.startsWith(prefix) && tag !== parent) {
      const remainder = tag.slice(prefix.length);
      const firstChild = remainder.split("/")[0];
      const childTag = prefix + firstChild;

      if (!seen.has(childTag)) {
        seen.add(childTag);
        let totalCount = 0;
        for (const t of allTags) {
          if (t === childTag || t.startsWith(childTag + "/")) {
            totalCount += tagCounts.get(t) || 0;
          }
        }
        result.push({
          name: childTag,
          count: totalCount,
          hasChildren: hasChildTags(allTags, childTag),
        });
      }
    }
  }
  return result.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function getAllTags(tagCounts: Map<string, number>): TagInfo[] {
  const allTagNames = new Set(tagCounts.keys());
  const result: TagInfo[] = [];
  for (const [name, count] of tagCounts) {
    result.push({
      name,
      count,
      hasChildren: name.includes("/") ? false : hasChildTags(allTagNames, name),
    });
  }
  return result.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Fetch tags del usuario con cache y límite de páginas
async function fetchTagsForUser(client: MemosClient): Promise<Map<string, number>> {
  const currentUser = await client.getCurrentUser();
  const cacheKey = `tags:${currentUser}`;

  const cached = getCachedTags(cacheKey);
  if (cached) return cached;

  const tagCounts = new Map<string, number>();
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    const params: Record<string, string> = {
      pageSize: "500",
      filter: `creator == "${currentUser}"`,
    };
    if (pageToken) params.pageToken = pageToken;

    const result = await client.get<{ memos: Memo[]; nextPageToken?: string }>(
      "/api/v1/memos",
      params
    );

    if (result.memos) {
      for (const memo of result.memos) {
        for (const tag of memo.tags ?? []) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }

    pageToken = result.nextPageToken;
    pageCount++;

    // Límite de seguridad para evitar fetch infinito
    if (pageCount >= TAGS_MAX_PAGES) break;
  } while (pageToken);

  setCachedTags(cacheKey, tagCounts);
  return tagCounts;
}

export const registerTagTools = (server: McpServer, client: MemosClient) => {
  server.registerTool(
    "tags",
    {
      description: [
        "List tags with usage counts extracted from your memo content.",
        "Tags are hashtags like #project or #work/meeting in your memos.",
        "Results are cached for 60 seconds.",
        "",
        "Usage modes:",
        "- No args: top-level tags only (e.g. 'project', 'work')",
        "- parent='work': children of 'work' (e.g. 'work/meeting', 'work/notes')",
        "- recursive=true: all tags flat (useful for tag recommendations)",
      ].join("\n"),
      inputSchema: {
        parent: z.string().optional().describe("Parent tag to filter children. E.g. 'project' to see 'project/backend', 'project/frontend'"),
        recursive: z.boolean().optional().describe("Return ALL tags including nested ones"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ parent, recursive }) => {
      const tagCounts = await fetchTagsForUser(client);

      if (tagCounts.size === 0) {
        return {
          content: [{ type: "text" as const, text: "No tags found in your memos." }],
        };
      }

      let results: TagInfo[];

      if (recursive) {
        results = getAllTags(tagCounts);
      } else if (parent) {
        results = getChildTags(tagCounts, parent);
      } else {
        results = getTopLevelTags(tagCounts);
      }

      if (results.length === 0) {
        const msg = parent
          ? `No child tags found under "${parent}".`
          : "No tags found.";
        return { content: [{ type: "text" as const, text: msg }] };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );
};
