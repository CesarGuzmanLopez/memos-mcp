#!/usr/bin/env node
/**
 * Smoke test del bridge mcp-for-memos.
 *
 * Verifica que el binario construido (dist/) arranque en ambos modos:
 *   - stdio (Claude Desktop / OpenCode local)
 *   - HTTP  (multi-tenant, cada cliente con su Bearer token)
 * y que exponga los 7 tools, degradando con gracia con un token inválido.
 *
 * No toca ningún Memos real: MEMOS_URL apunta a un puerto cerrado.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const NODE = process.execPath;
const BASE_ENV = { ...process.env, MEMOS_URL: "http://127.0.0.1:1", LOG_LEVEL: "error" };
const EXPECTED_TOOLS = ["get", "create", "update", "delete", "tags", "search", "memo_links"];

let failures = 0;
const ok = (msg) => console.log("  ok  " + msg);
const fail = (msg) => {
  failures++;
  console.error("  FAIL " + msg);
};

function checkTools(names, where) {
  const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
  if (missing.length) fail(`${where}: tools faltantes ${missing.join(", ")} (recibidas: ${names.join(", ") || "ninguna"})`);
  else ok(`${where}: ${names.length} tools -> ${names.join(", ")}`);
}

function rpcReply(text) {
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice(6) : text);
}

async function testStdio() {
  console.log("stdio:");
  const child = spawn(NODE, ["dist/index.js"], {
    env: { ...BASE_ENV, MEMOS_TOKEN: "memos_pat_smoke" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const messages = [];
  const logs = [];
  child.stdout.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        logs.push(line);
      }
    }
  });
  child.stderr.on("data", (d) => logs.push(d.toString()));

  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !messages.some((m) => m.id === 2)) await sleep(100);

  const reply = messages.find((m) => m.id === 2);
  if (!reply) fail(`stdio: sin respuesta a tools/list en 10s${logs.length ? " | " + logs.join(" ").slice(0, 300) : ""}`);
  else checkTools((reply.result?.tools ?? []).map((t) => t.name), "stdio tools/list");

  child.kill("SIGKILL");
}

async function testHttp() {
  console.log("http:");
  const port = 18444;
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(NODE, ["dist/index.js", "--http", "--port", String(port)], {
    env: BASE_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (d) => logs.push(d.toString()));
  child.stderr.on("data", (d) => logs.push(d.toString()));

  try {
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 10000) {
      try {
        const r = await fetch(`${base}/health`);
        if (r.ok) {
          up = true;
          break;
        }
      } catch {
        /* aún no escucha */
      }
      await sleep(150);
    }
    if (!up) {
      fail(`http: /health no respondió en 10s${logs.length ? " | " + logs.join(" ").slice(0, 300) : ""}`);
      return;
    }
    ok("http: /health 200");

    const rpc = async (method, params) => {
      const body = { jsonrpc: "2.0", id: 1, method };
      if (params !== undefined) body.params = params;
      const r = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: "Bearer memos_pat_smoke",
        },
        body: JSON.stringify(body),
      });
      return { status: r.status, parsed: rpcReply(await r.text()) };
    };

    const list = await rpc("tools/list");
    if (list.status !== 200 || !list.parsed.result) fail(`http: tools/list status ${list.status}`);
    else checkTools((list.parsed.result.tools ?? []).map((t) => t.name), "http tools/list");

    const search = await rpc("tools/call", { name: "search", arguments: { pageSize: 1 } });
    const text = search.parsed.result?.content?.[0]?.text;
    if (text === undefined) fail(`http: tools/call search sin content (status ${search.status})`);
    else {
      try {
        ok(`http: search degrada sin excepción (totalFound=${JSON.parse(text).totalFound ?? "n/a"})`);
      } catch {
        ok("http: search devolvió contenido");
      }
    }
  } finally {
    child.kill("SIGTERM");
  }
}

try {
  await testStdio();
  await testHttp();
} catch (e) {
  fail("excepción: " + (e?.stack ?? e));
}

if (failures) {
  console.error(`\nSMOKE FAIL (${failures})`);
  process.exit(1);
}
console.log("\nSMOKE OK");
process.exit(0);
