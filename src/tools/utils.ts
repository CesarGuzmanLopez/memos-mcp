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
  // Extract UID from name field (format: "memos/uid")
  const uid = name?.match(/^memos\/(.+)$/)?.[1] || "";

  const summary: Record<string, unknown> = {
    name: name,
    uid: uid,
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

  // Include attachments count if present
  const attachments = memo.attachments as Array<unknown> | undefined;
  if (Array.isArray(attachments) && attachments.length > 0) {
    summary.attachmentsCount = attachments.length;
  }

  return summary;
}

// Resolver un memo ID a su identifier usable en la API
// Memos 0.29.1 usa UIDs (memos/abc123) en vez de IDs numéricos
export async function resolveToMemoId(client: MemosClient, id: string): Promise<string> {
  // Si ya es numérico, usarlo directo
  if (/^\d+$/.test(id)) {
    return id;
  }
  // Si ya parece un UID (letras + números, largo > 5), usarlo directo
  if (/^[a-zA-Z0-9_-]{6,}$/.test(id)) {
    return id;
  }
  // Intentar buscar por el path completo
  const memo = await client.get<{ name: string }>(`/api/v1/memos/${id}`);
  if (!memo?.name) throw new Error(`Memo not found: ${id}`);
  const match = memo.name.match(/^memos\/(.+)$/);
  if (!match) throw new Error(`Unexpected memo name format: ${memo.name}`);
  return match[1];
}
