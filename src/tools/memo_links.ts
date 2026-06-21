import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemosClient } from "../client.js";
import { resolveToMemoId } from "./utils.js";

// Schemas compartidos
const actionSchema = z.enum([
  "list_comments",
  "add_comment",
  "list_reactions",
  "add_reaction",
  "remove_reaction",
  "set_relations",
  "list_relations",
]);

const visibilitySchema = z.enum(["PRIVATE", "PROTECTED", "PUBLIC"]);

const relationTypeSchema = z.enum(["REFERENCE", "COMMENT"]);

export const registerMemoLinksTool = (server: McpServer, client: MemosClient) => {
  server.registerTool(
    "memo_links",
    {
      description: [
        "Manage comments, reactions, and relations on memos.",
        "",
        "Actions:",
        "  list_comments   - List comments on a memo",
        "  add_comment     - Add a comment to a memo",
        "  list_reactions  - List reactions on a memo",
        "  add_reaction    - React to a memo (👍, ❤️, 🎉, etc.)",
        "  remove_reaction - Remove your reaction from a memo",
        "  list_relations  - List relations (links) from a memo",
        "  set_relations   - Set relations between memos (link them together)",
        "",
        "Examples:",
        '  memo_links(action="list_comments", memoId="abc123")',
        '  memo_links(action="add_comment", memoId="abc123", content="Great post!")',
        '  memo_links(action="add_reaction", memoId="abc123", reaction="👍")',
        '  memo_links(action="set_relations", memoId="abc123", relations=[{name:"memos/def456", type:"REFERENCE"}])',
      ].join("\n"),
      inputSchema: {
        action: actionSchema.describe("Operation to perform"),
        memoId: z.string().min(1).describe("Memo ID or UID to target"),
        content: z.string().optional().describe("Comment content (for add_comment)"),
        visibility: visibilitySchema.optional().describe("Comment visibility (default: PRIVATE)"),
        reaction: z.string().optional().describe("Reaction emoji like 👍 ❤️ 🎉 🚀 👀 (for add_reaction / remove_reaction)"),
        relations: z.array(z.object({
          name: z.string().describe("Target memo name, e.g. 'memos/abc123'"),
          type: relationTypeSchema.default("REFERENCE"),
        })).optional().describe("Relations to set (for set_relations)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ action, memoId, content, visibility, reaction, relations }) => {
      const resolvedId = await resolveToMemoId(client, memoId);

      switch (action) {
        // ── Comments ──────────────────────────────────────
        case "list_comments": {
          const data = await client.get<{ memos: Array<Record<string, unknown>> }>(
            `/api/v1/memos/${resolvedId}/comments`
          );
          const comments = (data.memos || []).map((c: Record<string, unknown>) => ({
            name: c.name,
            uid: ((c.name as string) || "").replace(/^memos\//, ""),
            content: c.content,
            createTime: c.createTime,
            visibility: c.visibility,
            snippet: ((c.content as string) || "").substring(0, 200),
          }));
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ memos: resolvedId, comments, total: comments.length }, null, 2) }],
          };
        }

        case "add_comment": {
          if (!content) {
            return { content: [{ type: "text" as const, text: "Error: 'content' is required for add_comment." }] };
          }
          const body: Record<string, unknown> = {
            content,
            visibility: visibility ?? "PRIVATE",
          };
          const result = await client.post(`/api/v1/memos/${resolvedId}/comments`, body) as Record<string, unknown>;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                created: true,
                memoId: resolvedId,
                comment: {
                  name: result.name,
                  content: (result.content as string)?.substring(0, 200),
                  createTime: result.createTime,
                },
              }, null, 2),
            }],
          };
        }

        // ── Reactions ─────────────────────────────────────
        case "list_reactions": {
          const data = await client.get<{ reactions: Array<Record<string, unknown>> }>(
            `/api/v1/memos/${resolvedId}/reactions`
          );
          const reactions = (data.reactions || []).map((r: Record<string, unknown>) => ({
            name: r.name,
            reactionType: r.reactionType || r.reaction_type,
            creator: r.creator,
            createTime: r.createTime,
          }));
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ memoId: resolvedId, reactions, total: reactions.length }, null, 2) }],
          };
        }

        case "add_reaction": {
          if (!reaction) {
            return { content: [{ type: "text" as const, text: "Error: 'reaction' is required for add_reaction (e.g. '👍')." }] };
          }
          const body = {
            reaction: {
              content_id: `memos/${resolvedId}`,
              reaction_type: reaction,
            },
          };
          const result = await client.post(`/api/v1/memos/${resolvedId}/reactions`, body) as Record<string, unknown>;
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ added: true, reactionType: result.reactionType || reaction }, null, 2) }],
          };
        }

        case "remove_reaction": {
          if (!reaction) {
            return { content: [{ type: "text" as const, text: "Error: 'reaction' is required for remove_reaction (e.g. '👍')." }] };
          }
          // Find the reaction by reactionType
          const data = await client.get<{ reactions: Array<Record<string, unknown>> }>(
            `/api/v1/memos/${resolvedId}/reactions`
          );
          const targetReaction = (data.reactions || []).find(
            (r: Record<string, unknown>) => r.reactionType === reaction
          );
          if (!targetReaction) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ removed: false, reason: `Reaction "${reaction}" not found on this memo.` }) }] };
          }
          await client.delete(`/api/v1/${targetReaction.name}`);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ removed: true, reaction }, null, 2) }],
          };
        }

        // ── Relations ─────────────────────────────────────
        case "list_relations": {
          const data = await client.get<{ relations: Array<Record<string, unknown>> }>(
            `/api/v1/memos/${resolvedId}/relations`
          );
          const rels = (data.relations || []).map((r: Record<string, unknown>) => ({
            type: r.type,
            source: (r.memo as Record<string, unknown>)?.name || "",
            relatedMemo: (r.relatedMemo as Record<string, unknown>)?.name || "",
            relatedSnippet: (r.relatedMemo as Record<string, unknown>)?.snippet || "",
          }));
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ memoId: resolvedId, relations: rels, total: rels.length }, null, 2) }],
          };
        }

        case "set_relations": {
          if (!relations) {
            return { content: [{ type: "text" as const, text: "Error: 'relations' array is required for set_relations." }] };
          }
          const body = {
            relations: relations.map((r) => ({
              memo: { name: `memos/${resolvedId}` },
              related_memo: { name: r.name.startsWith("memos/") ? r.name : `memos/${r.name}` },
              type: r.type || "REFERENCE",
            })),
          };
          await client.patch(`/api/v1/memos/${resolvedId}/relations`, body);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ updated: true, memoId: resolvedId, relationsCount: relations.length }, null, 2) }],
          };
        }

        default:
          return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }] };
      }
    }
  );
};
