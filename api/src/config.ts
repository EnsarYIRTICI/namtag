import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL gerekli"),

  // S3 uyumlu nesne deposu (MinIO, Garage, RustFS, AWS S3 ...)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("kunye-evrak"),
  S3_ACCESS_KEY: z.string().min(1, "S3_ACCESS_KEY gerekli"),
  S3_SECRET_KEY: z.string().min(1, "S3_SECRET_KEY gerekli"),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // Tarayıcının bu API'ye eriştiği adres (CSRF Origin kontrolü). Örn: https://kunye.ornek.com
  APP_ORIGIN: z.string().url().optional(),
  // 1 ise ilk proxy'ye (host nginx) güvenilir: gerçek IP + HTTPS bilgisi
  TRUST_PROXY: z
    .enum(["0", "1"])
    .default("0")
    .transform((v) => v === "1"),

  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  GIT_COMMIT: z.string().default(""),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Compose boş değişkenleri "" olarak geçirir; bunları tanımsız say.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "") cleaned[k] = v;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error("Geçersiz yapılandırma:\n" + msg);
  }
  return parsed.data;
}
