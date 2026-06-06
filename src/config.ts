import { z } from "zod";

// Schema de validación para variables de entorno
const EnvSchema = z.object({
  // Memos connection (required)
  MEMOS_URL: z.string().url().describe("Memos instance URL"),

  // HTTP server options
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000).describe("HTTP server port"),
  HTTP_HOST: z.string().default("127.0.0.1").describe("HTTP server host"),

  // Security
  CORS_ORIGIN: z.string().default("*").describe("CORS allowed origins (comma-separated)"),

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info").describe("Log level"),
});

export type Config = z.infer<typeof EnvSchema>;

// Cargar configuración desde variables de entorno
export function loadConfig(): Config {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Configuration error:", result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

// Obtener orígenes CORS como array
export function getCorsOrigins(config: Config): string[] {
  return config.CORS_ORIGIN.split(",").map((o) => o.trim());
}