import { MemosClient } from "../client.js";
import type { Memo } from "../types.js";

export const SNIPPET_MAX_LENGTH = 200;

export function compactProperty(property: Record<string, unknown> | undefined) {
  if (!property) return undefined;
  const truthy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(property)) {
    // Only include truthy properties to reduce noise
    if (v) truthy[k] = v;
  }
  return Object.keys(truthy).length > 0 ? truthy : undefined;
}

export function summarizeMemo(memo: Record<string, unknown>) {
  // Usar el snippet del memo si existe, de lo contrario generar uno del contenido
  let snippet = memo.snippet as string | undefined;
  if (!snippet) {
    const content = (memo.content as string) || "";
    snippet = content.length > SNIPPET_MAX_LENGTH
      ? content.slice(0, SNIPPET_MAX_LENGTH) + "..."
      : content;
  }

  const name = memo.name as string;
  const id = name?.match(/^memos\/(\d+)$/)?.[1];

  const summary: Record<string, unknown> = {
    id: id ? Number(id) : undefined,
    uid: memo.uid,
    createTime: memo.createTime,
    snippet,
    tags: memo.tags,
    visibility: memo.visibility,
  };

  if (memo.updateTime && memo.updateTime !== memo.createTime) {
    summary.updateTime = memo.updateTime;
  }

  if (memo.pinned) summary.pinned = true;

  const property = compactProperty(memo.property as Record<string, unknown> | undefined);
  if (property) summary.property = property;

  return summary;
}

// Resolver un ID (numérico o UID string) a un ID numérico
export async function resolveToNumericId(client: MemosClient, id: string): Promise<number> {
  if (/^\d+$/.test(id)) {
    return parseInt(id, 10);
  }
  const memo = await client.get<Memo>(`/api/v1/memos/${id}`);
  const match = memo.name.match(/^memos\/(\d+)$/);
  if (!match) throw new Error(`Unexpected memo name format: ${memo.name}`);
  return parseInt(match[1], 10);
}
