# Künye Arşivi v2

Hal Kayıt Sistemi künye evraklarını (CSV / HTML / PDF) yükleyip arşivleyen, arayan ve A4 şablonda yazdıran uygulama.

**Yığın:** Next.js 16 + TypeScript + Tailwind CSS 4 (arayüz) · Express 5 + TypeScript (API) · PostgreSQL 17 · MinIO/S3 (orijinal evrak arşivi) · Docker Compose. Nginx compose dışında, host'ta çalışır.

```
tarayıcı → host nginx ─┬─ /api/ → api  (127.0.0.1:4000) ─┬→ postgres (iç ağ)
                       └─ /     → web  (127.0.0.1:3000)  └→ minio    (iç ağ)
```

Yalnızca `web` ve `api` portları ve sadece `127.0.0.1`'e açılır. PostgreSQL ve MinIO'ya dışarıdan erişilemez; orijinal evraklar oturum kontrolünden geçen API üzerinden indirilir.

## Kurulum

```bash
cp .env.example .env      # CHANGE_ME olanları doldurun, APP_ORIGIN'i kendi adresinize ayarlayın
docker compose up -d --build
docker compose logs -f api
```

Host nginx'e `nginx/kunye.conf` dosyasını ekleyin (alan adını değiştirin), `nginx -t && systemctl reload nginx`, ardından `certbot --nginx -d ...`. HTTPS'siz internete açmayın.

İlk kullanıcı `.env`'deki `ADMIN_USERNAME` / `ADMIN_PASSWORD` ile, hiç kullanıcı yokken ilk açılışta oluşur (sonra `ADMIN_PASSWORD` satırını silin).

## Kullanıcı yönetimi

```bash
docker compose exec api node dist/cli.js user add <kullanici>      # şifre ekranda görünmez
docker compose exec api node dist/cli.js user passwd <kullanici>   # açık oturumlar kapanır
docker compose exec api node dist/cli.js user delete <kullanici>
docker compose exec api node dist/cli.js user list
```

Rol/yetki ayrımı yoktur: giriş yapan herkes yükleyebilir, silebilir, bakım temizliği çalıştırabilir.

## Eski sürümden (SQLite) veri aktarma

Eski sunucuda (sqlite3 komutu gerekir):

```bash
sqlite3 -json data/kunye.db "SELECT * FROM kunyeler" > kunyeler.json
sqlite3 -json data/kunye.db "SELECT username, passwordHash, createdAt FROM users" > users.json
```

İki dosyayı yeni sunucuya kopyalayıp `api` container'ına verin:

```bash
docker compose cp kunyeler.json api:/tmp/ && docker compose cp users.json api:/tmp/
docker compose exec api node dist/cli.js import-legacy /tmp/kunyeler.json /tmp/users.json
```

Eski şifre hash'leri aynı formattadır, kullanıcılar eski şifreleriyle girebilir. Eski künyelerin orijinal dosyası olmadığından listede "İndir" düğmesi görünmez.

## Yedek

```bash
# PostgreSQL
docker compose exec -T db pg_dump -U kunye kunye | gzip > kunye-db-$(date +%F).sql.gz
# Orijinal evraklar (MinIO verisi)
docker run --rm -v kunye-arsivi_miniodata:/data -v "$PWD":/b alpine tar czf /b/kunye-evrak-$(date +%F).tgz -C /data .
```

Günlük yedek için bunları host cron'una ekleyebilirsiniz.

## MinIO hakkında (önemli)

Resmi MinIO topluluk sürümü 2025-2026'da bakım dışı bırakıldı: hazır Docker imajı yayınlanmıyor, depo arşivlendi, güvenlik yaması garantisi yok. Varsayılan imaj, yayınlanmış son resmi sürümlerden biridir ve donmuştur. Riski azaltan şeyler: portu dışarı açılmaz, tarayıcı ona doğrudan erişmez.

API sadece S3 protokolünü konuşur (`S3_*` ayarları). Bakımı süren başka bir S3 uyumlu depoya (Garage, SeaweedFS, RustFS vb.) geçmek için `.env`'de `MINIO_IMAGE`'i ve gerekirse compose'daki `minio` servisini değiştirmeniz yeterlidir; kod değişmez. Depoyu değiştirirken mevcut nesneleri (`evraklar/<id>`) yeni depoya kopyalamayı unutmayın.

## Geliştirme

```bash
# PostgreSQL ve S3 uyumlu depo gerekir (compose'dan sadece db ve minio'yu açabilirsiniz)
cd api && npm i && DATABASE_URL=... S3_ENDPOINT=... S3_ACCESS_KEY=... S3_SECRET_KEY=... APP_ORIGIN=http://localhost:3000 npm run dev
cd web && npm i && npm run dev        # /api istekleri localhost:4000'e yönlenir
npm test                              # hem api/ hem web/ içinde
```

## Notlar

- Ayrıştırma tarayıcıda yapılır (pdf.js); sunucuya ayrıştırılmış kayıtlar ve orijinal dosya gönderilir. Aynı künye no bir kez saklanır; hiç yeni künye getirmeyen evrak "daha önce yüklenmiş" sayılıp reddedilir.
- Yazdırma: A4'te 2x2 kart, kart başına 91 x 122 mm. Yazdır penceresinde ölçek **%100** olmalı. Ölçüler `web/src/app/globals.css` içindeki `.print-page` / `.label-box` kurallarındadır.
- Şifreler scrypt ile hash'lenir, oturum belirteçleri veritabanında yalnızca SHA-256 özeti olarak tutulur. Çerez: HttpOnly, SameSite=Strict, HTTPS'te Secure. Hatalı girişte hız sınırı (IP başına 15 dk'da 8) bellekte tutulur, servis yeniden başlayınca sıfırlanır.
- Sayfa kabuğu herkese açıktır (veri içermez); veri ve dosyalar oturum olmadan API'den dönmez.
- Renkler `web/src/app/globals.css` başındaki `@theme` bloğundadır.
