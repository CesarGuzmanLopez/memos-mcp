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

// Timeout para requests a Memos API
const FETCH_TIMEOUT_MS = 30_000; // 30 segundos

export class MemosClient {
  readonly baseUrl: string;
  private token: string;
  private _currentUser: string | null = null;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
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

  // Helper para fetch con timeout
  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Request to ${url} timed out after ${FETCH_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
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
    const res = await this.fetchWithTimeout(url.toString(), {
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET ${path} failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
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
    const res = await this.fetchWithTimeout(url.toString(), {
      method: "PATCH",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PATCH ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async delete<T = unknown>(path: string): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
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
