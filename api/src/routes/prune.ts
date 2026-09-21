import type { Deps } from "../deps";

/** Hiç künyesi kalmayan evrakları (ve MinIO'daki orijinal dosyalarını) temizler. */
export async function pruneEmptyEvraklar(d: Deps): Promise<void> {
  const r = await d.pool.query(
    `DELETE FROM evraklar e
      WHERE NOT EXISTS (SELECT 1 FROM kunyeler k WHERE k.evrak_id = e.id)
      RETURNING s3_key`,
  );
  for (const row of r.rows as { s3_key: string | null }[]) {
    if (row.s3_key) await d.store.delete(row.s3_key).catch((e) => console.warn("Dosya silinemedi:", row.s3_key, e.message));
  }
}
