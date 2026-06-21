// Cache a nivel de módulo para el usuario actual por combinación baseUrl+token
const userCache = new Map<string, { user: string; timestamp: number }>();
const USER_CACHE_TTL_MS = 300_000; // 5 minutos

// Sweep periódico del cache de usuarios
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of userCache) {
    if (now - entry.timestamp > USER_CACHE_TTL_MS) {
      userCache.delete(key);
    }
  }
}, 60_000); // Cada minuto

// Timeout para requests a Memos API (configurable via MEMOS_FETCH_TIMEOUT, default 120s)
const FETCH_TIMEOUT_MS = parseInt(process.env.MEMOS_FETCH_TIMEOUT || "120000", 10);

// Retry configuration
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 0;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type LogFn = (level: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => void;

export class MemosClient {
  readonly baseUrl: string;
  private token: string;
  private _currentUser: string | null = null;
  private log: LogFn;

  constructor(baseUrl: string, token: string, logFn?: LogFn) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.log = logFn || (() => {});
  }

  // Actualizar token (útil en multi-tenant cuando se reusa el cliente)
  updateToken(newToken: string): void {
    if (newToken !== this.token) {
      this.token = newToken;
      this._currentUser = null; // Forzar recarga del usuario
    }
  }

  // Validate token is working
  async validateToken(): Promise<boolean> {
    try {
      await this.getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }

  // Obtener usuario actual con cache global
  async getCurrentUser(): Promise<string> {
    if (this._currentUser) return this._currentUser;

    const cacheKey = `${this.baseUrl}:${this.token}`;
    const cached = userCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < USER_CACHE_TTL_MS) {
      this._currentUser = cached.user;
      return this._currentUser;
    }

    this.log("debug", "Fetching current user from Memos API");

    const result = await this.get<{ memos: Array<{ creator: string }> }>(
      "/api/v1/memos",
      { pageSize: "1" }
    );

    if (result.memos && result.memos.length > 0) {
      this._currentUser = result.memos[0].creator;
      userCache.set(cacheKey, { user: this._currentUser, timestamp: Date.now() });
    }

    if (!this._currentUser) {
      throw new Error("Could not determine current user. No memos found with this token.");
    }
    return this._currentUser;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  // Helper para fetch con timeout y retry
  private async fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        // Si la respuesta es exitosa o no es reintentable, retornar
        if (response.ok || !isRetryable(response.status) || attempt >= retries) {
          return response;
        }

        this.log("warn", `Retryable response ${response.status}, attempt ${attempt + 1}/${retries}`, { url });
        await delay(RETRY_DELAY_MS * (attempt + 1));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new Error(`Request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms`);
        }
        if (attempt >= retries) throw error;

        this.log("warn", `Network error, attempt ${attempt + 1}/${retries}`, { url });
        await delay(RETRY_DELAY_MS * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }
    // Fallback (no debería llegar aquí)
    throw new Error(`Request to ${url} failed after ${retries + 1} attempts`);
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }
    this.log("debug", `GET ${path}`, { params });
    const res = await this.fetchWithRetry(url.toString(), {
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET ${path} failed (${res.status}): ${body}`);
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    this.log("debug", `POST ${path}`);
    const res = await this.fetchWithRetry(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} failed (${res.status}): ${text}`);
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async patch<T>(path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }
    this.log("debug", `PATCH ${path}`, { params });
    const res = await this.fetchWithRetry(url.toString(), {
      method: "PATCH",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PATCH ${path} failed (${res.status}): ${text}`);
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async delete<T = unknown>(path: string): Promise<T> {
    this.log("debug", `DELETE ${path}`);
    const res = await this.fetchWithRetry(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DELETE ${path} failed (${res.status}): ${text}`);
    }
    // Memos DELETE may return empty body
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
