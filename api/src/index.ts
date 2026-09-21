import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app";
import { Auth, validatePassword, validateUsername, normalizeUsername } from "./auth";
import { loadConfig } from "./config";
import { createPool, migrate } from "./db";
import { S3Store } from "./storage";

async function main() {
  const config = loadConfig();
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string };
  const version = { version: pkg.version, commit: config.GIT_COMMIT.slice(0, 7), startedAt: new Date().toISOString() };

  const pool = createPool(config.DATABASE_URL);
  await migrate(pool);

  const auth = new Auth(pool, {
    idleMs: config.SESSION_IDLE_HOURS * 3600 * 1000,
    absoluteMs: config.SESSION_MAX_DAYS * 86400 * 1000,
  });

  // İlk kurulum: hiç kullanıcı yoksa ve ADMIN_* verilmişse ilk kullanıcıyı oluştur.
  if ((await auth.userCount()) === 0) {
    const u = normalizeUsername(config.ADMIN_USERNAME);
    const err = validatePassword(config.ADMIN_PASSWORD);
    if (config.ADMIN_USERNAME && config.ADMIN_PASSWORD && validateUsername(u) && !err) {
      await auth.createUser(u, config.ADMIN_PASSWORD);
      console.log(`İlk kullanıcı oluşturuldu: ${u} (ADMIN_PASSWORD değişkenini .env'den silebilirsiniz)`);
    } else {
      console.warn(
        "UYARI: Hiç kullanıcı yok, kimse giriş yapamaz. .env içinde ADMIN_USERNAME/ADMIN_PASSWORD verin " +
          "ya da: docker compose exec api node dist/cli.js user add <kullanici>" +
          (err && config.ADMIN_PASSWORD ? ` (ADMIN_PASSWORD geçersiz: ${err})` : ""),
      );
    }
  }

  const store = new S3Store(config);
  await store.ensureBucket();

  const app = buildApp({ config, pool, auth, store, version });
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(
      `Künye API v${version.version}${version.commit ? " (" + version.commit + ")" : ""} ${config.HOST}:${config.PORT} adresinde çalışıyor.`,
    );
  });

  const shutdown = (sig: string) => {
    console.log(`${sig} alındı, kapatılıyor...`);
    server.close(async () => {
      auth.dispose();
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
