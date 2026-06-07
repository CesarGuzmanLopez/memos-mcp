import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MemosClient } from "../client.js";
import type { Memo, Visibility } from "../types.js";
import { summarizeMemo, resolveToMemoId } from "./utils.js";

function parseToRFC3339(isoString: string, paramName: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date for ${paramName}. Use ISO 8601 (e.g. "2025-01-01").`);
  }
  return date.toISOString();
}

function cleanMemo(memo: Record<string, unknown>, baseUrl?: string): Record<string, unknown> {
  const { nodes, snippet, creator, attachments, ...rest } = memo;

  // Transform attachments with only useful fields
  if (Array.isArray(attachments) && attachments.length > 0) {
    rest.attachments = attachments.map((r: Record<string, unknown>) => {
      const uid = (r.name as string)?.match(/^attachments\/(.+)$/)?.[1] || "";
      const filename = r.filename as string;
      const result: Record<string, unknown> = {
        filename,
        type: r.type || r.mime,
        size: Number(r.size) || 0,
        createTime: r.createTime,
      };
      if (uid && filename && baseUrl) {
        result.url = `${baseUrl}/file/attachments/${uid}/${filename}`;
      }
      return result;
    });
  }

  return rest;
}

interface MemoToolsOptions {
  defaultVisibility: Visibility;
}

export const registerMemoTools = (
  server: McpServer,
  client: MemosClient,
  options: MemoToolsOptions
) => {
  const visibilityEnum = z.enum(["PRIVATE", "PROTECTED", "PUBLIC"]);

  // get — retrieve a single memo
  server.registerTool(
    "get",
    {
      description: "Get a single memo by ID or UID.",
      inputSchema: {
        id: z.string().min(1).describe("Memo ID or UID"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const memo = await client.get<Memo>(`/api/v1/memos/${id}`);
      const cleaned = cleanMemo(memo as unknown as Record<string, unknown>, client.baseUrl);
      return { content: [{ type: "text" as const, text: JSON.stringify(cleaned, null, 2) }] };
    }
  );

  // create — create a new memo
  server.registerTool(
    "create",
    {
      description: "Create a memo with markdown content. Use #hashtags for tags.",
      inputSchema: {
        content: z.string().min(1).describe("Markdown content. Use #tag for tags."),
        visibility: visibilityEnum.optional().describe("Visibility (default: configured default)"),
        createTime: z.string().optional().describe("Backdate. ISO 8601."),
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ content, visibility, createTime }) => {
      const body: Record<string, unknown> = {
        content,
        visibility: visibility ?? options.defaultVisibility,
      };
      if (createTime) body.createTime = parseToRFC3339(createTime, "createTime");

      const memo = await client.post("/api/v1/memos", body) as Record<string, unknown>;
      const name = memo.name as string;
      if (!name) throw new Error("Create failed: no memo name in response");
      const match = name.match(/^memos\/(.+)$/);
      const memoId = match?.[1];
      if (!memoId) throw new Error(`Create failed: unexpected name format: ${name}`);

      return { content: [{ type: "text" as const, text: JSON.stringify({ name: memo.name, visibility: memo.visibility, url: `${client.baseUrl}/m/${memoId}` }) }] };
    }
  );

  // update — modify an existing memo
  server.registerTool(
    "update",
    {
      description: "Update memo fields. Only provided fields are changed.",
      inputSchema: {
        id: z.string().min(1).describe("Memo ID or UID"),
        content: z.string().optional().describe("New markdown content"),
        visibility: visibilityEnum.optional().describe("New visibility"),
        pinned: z.boolean().optional().describe("Pin/unpin"),
        state: z.enum(["NORMAL", "ARCHIVED"]).optional().describe("Archive/restore"),
        createTime: z.string().optional().describe("Override creation time. ISO 8601."),
        updateTime: z.string().optional().describe("Override update time. ISO 8601."),
        preserveUpdateTime: z.boolean().optional().describe("Don't change update time"),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, content, visibility, pinned, state, createTime, updateTime, preserveUpdateTime }) => {
      const memoId = await resolveToMemoId(client, id);
      const body: Record<string, unknown> = {};
      const mask: string[] = [];

      if (content !== undefined) { body.content = content; mask.push("content"); }
      if (visibility !== undefined) { body.visibility = visibility; mask.push("visibility"); }
      if (pinned !== undefined) { body.pinned = pinned; mask.push("pinned"); }
      if (state !== undefined) { body.rowStatus = state === "ARCHIVED" ? "ARCHIVED" : "ACTIVE"; mask.push("row_status"); }
      if (createTime !== undefined) { body.createTime = parseToRFC3339(createTime, "createTime"); mask.push("create_time"); }
      if (updateTime !== undefined) { body.updateTime = parseToRFC3339(updateTime, "updateTime"); mask.push("update_time"); }

      if (mask.length === 0) return { content: [{ type: "text" as const, text: "No fields to update." }] };

      const params: Record<string, string> = { updateMask: mask.join(",") };
      if (preserveUpdateTime) params.preserveUpdateTime = "true";

      await client.patch(`/api/v1/memos/${memoId}`, body, params);
      const updatedMemo = await client.get<Memo>(`/api/v1/memos/${memoId}`);
      const cleaned = cleanMemo(updatedMemo as unknown as Record<string, unknown>, client.baseUrl);
      return { content: [{ type: "text" as const, text: JSON.stringify(cleaned, null, 2) }] };
    }
  );

  // delete — remove a memo
  server.registerTool(
    "delete",
    {
      description: "Permanently delete a memo. Cannot be undone.",
      inputSchema: {
        id: z.string().min(1).describe("Memo ID or UID"),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const memo = await client.get<Memo>(`/api/v1/memos/${id}`);
      const memoId = await resolveToMemoId(client, id);
      await client.delete(`/api/v1/memos/${memoId}`);
      return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, name: memo.name, snippet: memo.snippet?.substring(0, 100) }) }] };
    }
  );
};
