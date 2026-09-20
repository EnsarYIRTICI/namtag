# Künye Arşivi — Ubuntu VPS Kurulumu

Bu, önceki claude.ai sürümüyle aynı arayüze sahip ama tamamen kendi sunucunuzda,
kendi veritabanıyla (SQLite, tek dosya) çalışan bağımsız bir sürümdür.
İnternet/Claude bağlantısı gerekmez.

## 1. Sunucuya kopyalayın

Bu klasörün tamamını (node_modules ve data hariç) VPS'inize yükleyin, örneğin:

```bash
scp -r kunye-server kullanici@sunucu_ip:/tmp/
```

## 2. Node.js kurun (Ubuntu 22.04/24.04)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
node -v   # v18 veya üzeri olmalı
```

(`build-essential` gerekli çünkü `better-sqlite3` küçük bir native modül derliyor.)

## 3. Uygulamayı yerleştirin ve bağımlılıkları kurun

```bash
sudo mkdir -p /opt/kunye-arsivi
sudo cp -r /tmp/kunye-server/* /opt/kunye-arsivi/
cd /opt/kunye-arsivi
sudo npm install --omit=dev
```

Bir kullanıcı hesabı açıp uygulamayı ona verin (root olarak çalıştırmayın):

```bash
sudo useradd -r -s /bin/false kunye
sudo chown -R kunye:kunye /opt/kunye-arsivi
```

## 4. Elle test edin

```bash
cd /opt/kunye-arsivi
sudo -u kunye PORT=3000 node server.js
```

Başka bir terminalden: `curl http://localhost:3000/api/health` → `{"ok":true}` dönmeli.
Sorun yoksa Ctrl+C ile durdurun ve systemd servisine geçin.

## 5. Kalıcı servis olarak çalıştırın (systemd)

```bash
sudo cp /opt/kunye-arsivi/kunye-arsivi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kunye-arsivi
sudo systemctl status kunye-arsivi
```

Loglar: `sudo journalctl -u kunye-arsivi -f`

Uygulama artık sunucu her yeniden başladığında otomatik ayağa kalkar.

## 6. Dışarıya açma (Nginx + HTTPS — internete açacaksanız zorunlu sayın)

Doğrudan 3000 portunu dışarı açmak yerine Nginx ile önden geçirin:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp /opt/kunye-arsivi/nginx-kunye-arsivi.conf /etc/nginx/sites-available/kunye-arsivi
# dosyadaki "kunye.alanadiniz.com" kısmını kendi (alt)alan adınızla değiştirin
sudo ln -s /etc/nginx/sites-available/kunye-arsivi /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d kunye.alanadiniz.com
```

Bir alan adınız yoksa VPS'in IP adresi + `:3000` üzerinden de erişebilirsiniz, ancak bu **HTTPS'siz**
olduğu için giriş şifreniz ağda açık gider. Sadece güvendiğiniz bir ağdan (ör. VPN) kullanın.

## 7. Kimlik doğrulama (giriş sistemi)

Uygulama artık **giriş yapmadan hiçbir şey göstermez** (arayüz dosyaları dahil). Hiç kullanıcı
oluşturmadıysanız kimse giremez; bu bilinçli bir tercih (güvenli varsayılan).

**İlk kullanıcıyı oluşturun** (şifre en az 10 karakter, ekranda görünmez):

```bash
cd /opt/kunye-arsivi
sudo -u kunye KUNYE_DATA_DIR=/opt/kunye-arsivi/data node manage-users.js add manav
```

Diğer komutlar:

```bash
sudo -u kunye KUNYE_DATA_DIR=/opt/kunye-arsivi/data node manage-users.js list
sudo -u kunye KUNYE_DATA_DIR=/opt/kunye-arsivi/data node manage-users.js passwd manav   # şifre değiştir, açık oturumlar kapanır
sudo -u kunye KUNYE_DATA_DIR=/opt/kunye-arsivi/data node manage-users.js delete manav
```

Tarayıcıdan `/login` sayfasına gidin; sağ üstteki **Çıkış** ile oturumu kapatın.
Kullanıcı ekleme/silme sunucuda komut satırından yapılır, web arayüzünden yapılamaz (bilerek).

### ÖNEMLİ: HTTPS kullanın

Giriş şifresi istekle birlikte gider. Düz HTTP üzerinden (ör. `http://IP:3000`) internete açarsanız
şifre ağda açık taşınır. Dışarıya açacaksanız **6. adımdaki Nginx + HTTPS** kurulumunu yapın, sonra
`kunye-arsivi.service` içinde şunları açın ve servisi yeniden başlatın:

```
Environment=KUNYE_TRUST_PROXY=1
Environment=HOST=127.0.0.1
```

`HOST=127.0.0.1` uygulamayı sadece Nginx'in erişeceği şekilde kapatır (3000 portu dışarıdan görünmez);
`KUNYE_TRUST_PROXY=1` gerçek istemci IP'sinin (deneme sınırı için) ve HTTPS bilgisinin (`Secure` çerez)
Nginx'ten okunmasını sağlar. Bunu Nginx **olmadan** açmayın.

### Neler var / neler yok

- Şifreler `scrypt` ile hash'lenir; oturum belirteçleri veritabanında yalnızca SHA-256 özeti olarak tutulur.
- Çerez: `HttpOnly`, `SameSite=Strict`, HTTPS'te `Secure`. Bosta 12 saat, en fazla 7 gün geçerli.
- Hatalı girişte hız sınırı: aynı IP'den 15 dakikada 8 hata → 15 dakika kilit. Sayaç bellekte tutulur, servis yeniden başlayınca sıfırlanır.
- Rol/yetki ayrımı **yok**: giriş yapan herkes künyeleri yükleyebilir, silebilir ve "bakım" temizliğini çalıştırabilir.
- İki adımlı doğrulama ve "şifremi unuttum" akışı yok; şifre sıfırlama sunucudan `passwd` ile yapılır.
- `data/kunye.db` artık kullanıcı ve oturum tablolarını da içerir, yedeklerinizi buna göre koruyun.

## Veriler nerede tutuluyor, yedek nasıl alınır?

Tüm künye kayıtları tek bir dosyada: `/opt/kunye-arsivi/data/kunye.db` (SQLite).
Yedek almak için bu dosyayı kopyalamanız yeterli:

```bash
sudo cp /opt/kunye-arsivi/data/kunye.db ~/kunye-yedek-$(date +%F).db
```

Otomatik günlük yedek için bir cron satırı ekleyebilirsiniz:

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * cp /opt/kunye-arsivi/data/kunye.db /opt/kunye-arsivi/data/backup-\$(date +\%F).db") | crontab -
```

## Güncelleme

Yeni bir sürüm geldiğinde `server.js` ve `public/` klasörünü değiştirip servisi
yeniden başlatmanız yeterli — `data/kunye.db` dokunulmadığı sürece kayıtlarınız kalır:

```bash
sudo systemctl restart kunye-arsivi
```

## Görünümü değiştirmek (Tailwind CSS)

Arayüz Tailwind CSS ile tasarlandı; hazır, derlenmiş `public/vendor/tailwind.css`
dosyası geliyor, VPS'te Tailwind kurmanıza gerek yok. Renk/boşluk gibi şeyleri
değiştirmek isterseniz kaynak dosyalar `tailwind-build/` klasöründe:

```bash
cd kunye-server/tailwind-build
npm install                      # sadece bir kere, Tailwind derleyicisini kurar
# input.css içindeki .panel, .rcard, .printbtn gibi sınıfları düzenleyin
npx tailwindcss -i ./input.css -o ../public/vendor/tailwind.css --minify
sudo systemctl restart kunye-arsivi
```

Renk paleti `tailwind-build/tailwind.config.js` içindeki `clay` (vurgu rengi,
turuncu-kahve) ve `cream` (arka plan) tonlarından geliyor — kurum renklerinize
göre buradan değiştirebilirsiniz.

## Klasör yapısı

```
kunye-server/
├── server.js                  # Express + SQLite API sunucusu
├── auth.js                    # kimlik doğrulama (şifre hash, oturum, hız sınırı)
├── manage-users.js            # kullanıcı ekle/sil/şifre değiştir (komut satırı)
├── package.json
├── kunye-arsivi.service       # systemd servis şablonu
├── nginx-kunye-arsivi.conf    # Nginx reverse proxy şablonu
├── public/
│   ├── index.html             # arayüz (yükleme, arama, A4 yazdırma)
│   ├── login.html             # giriş sayfası
│   └── vendor/                # PDF okuyucu, QR üretici, Tailwind CSS (yerel, CDN'e bağımlı değil)
├── tailwind-build/            # Tailwind kaynak dosyaları (sadece stil değiştirmek isterseniz)
└── data/                      # (otomatik oluşur) kunye.db burada tutulur
```
