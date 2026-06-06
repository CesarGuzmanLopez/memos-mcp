import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemosClient } from "../client.js";
import type { MemoRelation } from "../types.js";
import { resolveToMemoId } from "./utils.js";

function extractId(memoRef: unknown): string | undefined {
  const name = typeof memoRef === "string" ? memoRef : (memoRef as Record<string, unknown>)?.name as string;
  if (!name || typeof name !== "string") return undefined;
  const match = name.match(/^memos\/(.+)$/);
  return match ? match[1] : undefined;
}

interface Edge {
  from: string;
  to: string;
  type: string;
}

async function buildRelationGraph(
  client: MemosClient,
  startId: string,
  maxDepth: number
): Promise<{ nodes: string[]; edges: Edge[] }> {
  const visited = new Set<string>();
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const result = await client.get<{ relations: MemoRelation[] }>(
      `/api/v1/memos/${id}/relations`
    );

    for (const r of result.relations || []) {
      const fromId = extractId(r.memo);
      const toId = extractId(r.relatedMemo);
      if (fromId === undefined || toId === undefined) continue;

      const edgeKey = `${fromId}->${toId}:${r.type}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);
      edges.push({ from: fromId, to: toId, type: r.type });

      const neighborId = fromId === id ? toId : fromId;
      if (depth < maxDepth && !visited.has(neighborId)) {
        queue.push({ id: neighborId, depth: depth + 1 });
      }
    }
  }

  return { nodes: [...visited], edges };
}

export const registerRelationTools = (server: McpServer, client: MemosClient) => {
  server.registerTool(
    "list_memo_relations",
    {
      description: [
        "List relations of a memo. Returns edges with direction (from → to) and type.",
        "- depth=1 (default): direct relations only.",
        "- depth=2+: recursively expand related memos to build a relation graph.",
        "Each edge shows {from, to, type}. Use get_memo to inspect specific nodes.",
      ].join(" "),
      inputSchema: {
        id: z.string().min(1).describe("Memo identifier. Numeric ID or UID string"),
        depth: z.number().int().min(1).max(5).default(1).describe("How many levels deep to traverse. 1 = direct relations, 2+ = recursive graph"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, depth }) => {
      const memoId = await resolveToMemoId(client, id);
      const { nodes, edges } = await buildRelationGraph(client, memoId, depth);

      if (edges.length === 0) {
        return { content: [{ type: "text" as const, text: "No relations found." }] };
      }

      const output = { startNode: memoId, nodes, edges };
      return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
    }
  );

  server.registerTool(
    "set_memo_relations",
    {
      description: [
        "Add or remove REFERENCE relations for a memo.",
        "- action=\"add\": add new references without affecting existing ones.",
        "- action=\"remove\": remove specific references.",
        "Note: COMMENT relations are managed by the system and cannot be modified here.",
      ].join(" "),
      inputSchema: {
        id: z.string().min(1).describe("Memo identifier. Numeric ID or UID string"),
        action: z.enum(["add", "remove"]).describe("Whether to add or remove relations"),
        targetIds: z.array(z.string().min(1)).min(1).describe("IDs of memos to add/remove as references. Numeric IDs or UID strings"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, action, targetIds }) => {
      const memoId = await resolveToMemoId(client, id);

      const resolvedTargets = await Promise.all(
        targetIds.map((t) => resolveToMemoId(client, t))
      );

      const current = await client.get<{ relations: MemoRelation[] }>(
        `/api/v1/memos/${memoId}/relations`
      );
      const existing = (current.relations || []).filter(
        (r) => extractId(r.memo) === memoId && r.type === "REFERENCE"
      );

      let finalIds: string[];
      if (action === "add") {
        const existingIds = new Set(existing.map((r) => extractId(r.relatedMemo)));
        finalIds = [
          ...existing.map((r) => extractId(r.relatedMemo)!),
          ...resolvedTargets.filter((t) => !existingIds.has(t)),
        ];
      } else {
        const removeSet = new Set(resolvedTargets);
        finalIds = existing
          .map((r) => extractId(r.relatedMemo)!)
          .filter((rid) => !removeSet.has(rid));
      }

      const body = {
        relations: finalIds.map((targetId) => ({
          memo: { name: `memos/${memoId}` },
          relatedMemo: { name: `memos/${targetId}` },
          type: "REFERENCE",
        })),
      };
      await client.patch(`/api/v1/memos/${memoId}/relations`, body);

      const verb = action === "add" ? "added" : "removed";
      return {
        content: [{ type: "text" as const, text: `${resolvedTargets.length} reference(s) ${verb}. Memo ${id} now has ${finalIds.length} outgoing reference(s).` }],
      };
    }
  );
};
