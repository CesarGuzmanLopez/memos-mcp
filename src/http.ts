import express, { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServerWithClient } from "./server.js";
import { MemosClient } from "./client.js";
import { Config, getCorsOrigins } from "./config.js";

// Logger simple
function log(level: "info" | "warn" | "error" | "debug", message: string, meta?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`);
}

// Extraer Bearer token del header Authorization
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

// Configuración de SSE sessions
const SSE_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
const SSE_MAX_SESSIONS = 100;

// Map para mantener sesiones SSE activas
const sseSessions = new Map<string, {
  transport: SSEServerTransport;
  lastActivity: number;
}>();

// Sweep de sesiones SSE idle
function sweepIdleSessions() {
  const now = Date.now();
  for (const [id, session] of sseSessions) {
    if (now - session.lastActivity > SSE_IDLE_TIMEOUT_MS) {
      log("info", "Closing idle SSE session", { sessionId: id });
      session.transport.close();
      sseSessions.delete(id);
    }
  }
}

// Sweep cada 30 segundos
setInterval(sweepIdleSessions, 30_000);

// Crear aplicación Express
export function createHttpApp(config: Config) {
  const app = express();

  // Middleware
  app.use(express.json({ limit: "10mb" }));

  // Request ID middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { requestId: string }).requestId = Math.random().toString(36).slice(2, 11);
    next();
  });

  // Logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as Request & { requestId: string }).requestId;
    log("info", `${req.method} ${req.path}`, { requestId, ip: req.ip });
    next();
  });

  // CORS
  const corsOrigins = getCorsOrigins(config);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && (corsOrigins.includes("*") || corsOrigins.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCT-PROXY-VERSION");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "3.0.0",
      activeSessions: sseSessions.size,
    });
  });

  // Streamable HTTP endpoint (moderno) - POST
  app.post("/mcp", async (req: Request, res: Response) => {
    const requestId = (req as Request & { requestId: string }).requestId;

    const token = extractBearerToken(req);
    if (!token) {
      log("warn", "Missing or invalid Authorization header", { requestId });
      res.status(401).json({ error: "Missing or invalid Authorization header. Use: Authorization: Bearer <token>" });
      return;
    }

    if (!config.MEMOS_URL) {
      log("error", "MEMOS_URL not configured");
      res.status(500).json({ error: "Server configuration error: MEMOS_URL not set" });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless
    });

    const client = new MemosClient(config.MEMOS_URL, token);
    const server = createServerWithClient(client);
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try { transport.close(); } catch {}
      try { server.close(); } catch {}
    };

    try {
      await server.connect(transport as any);
      await transport.handleRequest(req, res, req.body);

      res.on("close", cleanup);
    } catch (error) {
      log("error", "Error handling MCP request", { requestId, error: String(error) });
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Streamable HTTP endpoint - GET
  app.get("/mcp", async (req: Request, res: Response) => {
    const requestId = (req as Request & { requestId: string }).requestId;

    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    if (!config.MEMOS_URL) {
      res.status(500).json({ error: "Server configuration error: MEMOS_URL not set" });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const client = new MemosClient(config.MEMOS_URL, token);
    const server = createServerWithClient(client);
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try { transport.close(); } catch {}
      try { server.close(); } catch {}
    };

    try {
      await server.connect(transport as any);
      await transport.handleRequest(req, res);

      res.on("close", cleanup);
    } catch (error) {
      log("error", "Error in MCP GET", { requestId, error: String(error) });
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // SSE endpoint - GET para iniciar stream
  app.get("/sse", async (req: Request, res: Response) => {
    const requestId = (req as Request & { requestId: string }).requestId;

    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    if (!config.MEMOS_URL) {
      res.status(500).json({ error: "Server configuration error: MEMOS_URL not set" });
      return;
    }

    // Verificar límite de sesiones
    if (sseSessions.size >= SSE_MAX_SESSIONS) {
      log("warn", "SSE session limit reached", { currentSessions: sseSessions.size, requestId });
      res.status(429).json({ error: "Too many SSE sessions. Try again later." });
      return;
    }

    const transport = new SSEServerTransport("/sse/messages", res);
    const client = new MemosClient(config.MEMOS_URL, token);
    const server = createServerWithClient(client);

    // Guardar sesión
    sseSessions.set(transport.sessionId, {
      transport,
      lastActivity: Date.now(),
    });

    // Cleanup cuando se cierra la conexión
    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      try { transport.close(); } catch {}
      try { server.close(); } catch {}
    });

    try {
      await server.connect(transport as any);
      transport.start();
      log("info", "SSE session started", { sessionId: transport.sessionId, requestId });
    } catch (error) {
      log("error", "Error starting SSE", { requestId, error: String(error) });
      sseSessions.delete(transport.sessionId);
      try { transport.close(); } catch {}
      try { server.close(); } catch {}
    }
  });

  // SSE endpoint - POST para recibir mensajes
  app.post("/sse/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId query parameter" });
      return;
    }

    const session = sseSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found or expired" });
      return;
    }

    // Actualizar actividad
    session.lastActivity = Date.now();

    try {
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      log("error", "Error handling SSE message", { sessionId, error: String(error) });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log("error", "Unhandled error", { error: err.message, stack: err.stack });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}

// Iniciar servidor HTTP
export function startHttpServer(config: Config) {
  const app = createHttpApp(config);
  const { HTTP_PORT, HTTP_HOST } = config;

  const server = app.listen(HTTP_PORT, HTTP_HOST, () => {
    log("info", `HTTP server started`, {
      host: HTTP_HOST,
      port: HTTP_PORT,
      url: `http://${HTTP_HOST}:${HTTP_PORT}`,
    });
    log("info", `Endpoints:`, {
      health: `GET http://${HTTP_HOST}:${HTTP_PORT}/health`,
      mcp: `POST http://${HTTP_HOST}:${HTTP_PORT}/mcp`,
      sse: `GET http://${HTTP_HOST}:${HTTP_PORT}/sse`,
    });
  });

  // Graceful shutdown - cerrar todo limpiamente
  const shutdown = () => {
    log("info", "Shutting down HTTP server...");

    // Cerrar todas las sesiones SSE
    for (const [id, session] of sseSessions) {
      session.transport.close();
      sseSessions.delete(id);
    }

    // Cerrar el servidor Express
    server.close(() => {
      log("info", "HTTP server stopped");
      process.exit(0);
    });

    // Forzar salida después de 5 segundos
    setTimeout(() => {
      log("warn", "Force shutdown after timeout");
      process.exit(1);
    }, 5_000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}
