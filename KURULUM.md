# TusDostum · kurulum

Bu klasör, TusDostum'un Claude dışında çalışan sürümüdür: uygulama **GitHub Pages**'te yayınlanır, veriler **Supabase**'te durur.
İkisi de ücretsiz planla çalışır. Kurulum bir kez yapılır; arkadaşların yalnızca bağlantıyı açıp kayıt olur.

Sıra: **1 GitHub → 2 Supabase → 3 Anahtarları yaz → 4 İlk giriş → 5 Bildirimler (isteğe bağlı) → 6 Verileri taşı**

> Panellerdeki düğme adları zamanla değişebiliyor. Bir adımı bulamazsan Claude oturumunda sor.

---

## 1. GitHub: depo ve yayın (5 dk)

1. <https://github.com> adresinde hesap aç (varsa giriş yap).
2. Sağ üstte **+ → New repository**. Ad: `tusdostum`. **Public** seç (ücretsiz planda yayın için gerekli). **Create repository**.
   - Depo herkese açık olur ama içinde gizli hiçbir şey yoktur; kayıtlar Supabase'te durur.
3. Dosyaları yükle. İki yol var:
   - **Kolay yol:** Claude oturumunda depo adını söyle; dosyaları Claude yükler (Claude'un GitHub erişimine izin vermen istenir).
   - **Elle:** bilgisayarda depo sayfasında **Add file → Upload files**; bu klasörün içindekileri (`.github` klasörü dahil) sürükle, **Commit changes**.
4. Depoda **Settings → Pages → Build and deployment → Source: GitHub Actions** seç.
5. **Actions** sekmesinde "Yayınla (GitHub Pages)" işi yeşil olunca uygulama şu adreste açılır:
   `https://KULLANICI_ADIN.github.io/tusdostum/`
   - Bu aşamada "Sunucu ayarı yapılmamış" yazısı görünür; 3. adımdan sonra kaybolur.

## 2. Supabase: veritabanı (10 dk)

1. <https://supabase.com> → **Start your project** → hesap aç → **New project**.
   - Name: `tusdostum` · Database password: güçlü bir şifre üret ve bir yere kaydet · Region: **Europe (Frankfurt)** ya da en yakını.
2. Proje açılınca sol menüden **SQL Editor → New query**. `supabase/schema.sql` dosyasının **tamamını** yapıştır → **Run**.
   - "Success. No rows returned" görmelisin. Tekrar çalıştırmak zarar vermez.
3. **Authentication → Sign In / Providers → Email**: **Confirm email** seçeneğini **kapat** → Save.
   - Neden: Supabase'in hazır e-posta servisi saatte 2 e-posta ile sınırlı ve yalnızca senin adresine gönderebiliyor; açık kalırsa arkadaşların kayıt olamaz.
4. **Authentication → URL Configuration**: **Site URL** alanına uygulamanın adresini yaz (`https://KULLANICI_ADIN.github.io/tusdostum/`) → Save.
5. **Project Settings → API Keys** (ya da **Data API**) sayfasından iki değeri kopyala:
   - **Project URL** (ör. `https://abcdefgh.supabase.co`)
   - **Publishable key** (`sb_publishable_…`; eski projelerde adı `anon public`)
   - `secret` / `service_role` anahtarını **kopyalama**, hiçbir yere yazma.

## 3. Anahtarları uygulamaya yaz (2 dk)

Depodaki `config.js` dosyasını aç (kalem simgesi → düzenle), iki satırı doldur, **Commit changes**:

```js
supabaseUrl: "https://abcdefgh.supabase.co",
supabaseAnahtar: "sb_publishable_…",
```

Bir iki dakika sonra uygulama adresini yenile: giriş ekranı gelmeli.

## 4. İlk giriş ve yönetici olmak (2 dk)

1. Uygulamada **Kayıt ol** → e-posta ve şifre (en az 6 karakter).
2. Kendini yönetici yap (kişileri listeden çıkarabilmek için). Supabase **SQL Editor**'da, e-postanı yazarak çalıştır:

```sql
insert into public.yoneticiler (uid) select id from auth.users where email = 'SENIN_EPOSTAN';
```

3. Uygulamayı yenile. Artık Genel listesinde bir kişiye dokununca "Listeden çıkar" görünür.

Arkadaş davet etmek: **Salon → Arkadaş davet et → Bağlantıyı kopyala**. Bağlantıyı açan kişi kayıt olur ve odaya tek dokunuşla katılır.

## 5. Bildirimler: ekran kapalıyken uyarı (isteğe bağlı, 15 dk)

Bu adım atlanırsa uygulama çalışır; mola/çalışma uyarıları yalnızca uygulama açıkken çalar.

1. **Anahtar üret:** telefonda ya da bilgisayarda `https://KULLANICI_ADIN.github.io/tusdostum/anahtar.html` sayfasını aç → **Anahtar çifti üret**.
2. **Açık anahtarı** `config.js` içindeki `vapidAcikAnahtar: ""` tırnaklarının arasına yapıştır → Commit.
3. Supabase → **Edge Functions → Deploy a new function → Via Editor**:
   - Ad: `uyari-gonder`
   - `supabase/functions/uyari-gonder/index.ts` dosyasının tamamını yapıştır → **Deploy**.
   - İşlevin ayarlarında **Verify JWT** (JWT doğrulama) seçeneğini **kapat** → Save. (Yetkiyi işlev kendi gizli değeriyle denetliyor.)
4. **Edge Functions → Secrets** bölümüne dört değer ekle:

| Ad | Değer |
|---|---|
| `CRON_GIZLI` | Kendi uyduracağın uzun, rastgele bir metin (en az 30 karakter) |
| `VAPID_ACIK` | anahtar.html'deki açık anahtar |
| `VAPID_OZEL` | anahtar.html'deki özel anahtar |
| `VAPID_KONU` | `mailto:` ile başlayan bir e-posta adresin (ör. `mailto:ad@ornek.com`) |

5. **Integrations → Cron** bölümünden Cron'u (pg_cron) etkinleştir; **Database → Extensions** içinde **pg_net**'i aç.
6. `supabase/cron.sql` dosyasını SQL Editor'a yapıştır. İçindeki `PROJE_ADRESI` ve `CRON_GIZLI` yazılarını kendi değerlerinle değiştir → **Run**.
7. **Deneme:** telefonda uygulamayı ana ekrana ekle ve oradan aç → kronometre kartındaki **zil** → mola uyarısını 5 seç (bildirim izni sorulur, izin ver) → Başlat → Mola ver → telefonu kilitle. 5 dakika sonra bildirim gelmeli.
   - Beklemeden denemek için molaya geçtikten sonra SQL Editor'da `update public.uyarilar set zaman = now();` çalıştır; en geç 1 dakikada gelir.
   - Gelmezse: SQL Editor'da `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;` ve Edge Functions → uyari-gonder → **Logs**.

iPhone'da bildirim yalnızca **ana ekrana eklenmiş** uygulamada çalışır (iOS 16.4 ve sonrası). Telefon sessizdeyse bildirim sessiz gelir.

## 6. Eski kayıtları taşımak (kişi başı 1 dk)

Herkes kendi kayıtlarını taşır:

1. Claude'daki eski TusDostum'da **Ayarlar → Yedeği indir (JSON)**.
2. Yeni uygulamada **Ayarlar → Yedekten yükle** → indirilen dosyayı seç.

Var olan kayıtlara dokunulmaz; aynı yedek iki kez yüklenirse kayıtlar çoğalmaz.

---

## Bilmen gerekenler

- **Şifresini unutan arkadaş:** hazır e-posta servisi arkadaşlarına posta gönderemediği için uygulamada "Şifremi unuttum" düğmesi kapalıdır. Şifreyi sen sıfırlarsın (SQL Editor):

```sql
update auth.users set encrypted_password = extensions.crypt('YENI_SIFRE', extensions.gen_salt('bf')) where email = 'ARKADASIN_EPOSTASI';
```

  İleride Supabase'e kendi e-posta sunucunu (Authentication → Emails → SMTP) bağlarsan `config.js` içinde `epostaGonderimi: true` yap; düğme görünür.
- **Listeden çıkarılan kişi** yeniden katılamaz. Geri almak için: `delete from public.engelliler where uid = (select id from auth.users where email = 'E_POSTA');`
- **Oda adı parola gibidir.** Son 10 günü yalnızca aynı oda adını bilen kişiler görür; bunu veritabanı uygular. Tahmin edilmesi zor bir oda adı seç.
- **Ücretsiz plan sınırları** (Kasım 2026 itibarıyla Supabase belgelerine göre; değişebilir): 500 MB veritabanı, aynı anda 200 canlı bağlantı, ayda 2 milyon canlı ileti. Kabaca 30 etkin kişiye kadar rahat yeter.
- **Proje duraklaması:** ücretsiz projeler yaklaşık bir hafta hiç kullanılmazsa duraklatılır; veriler silinmez, Supabase panelinden tek tuşla açılır.
- **Gizli tutulacaklar:** Supabase `secret`/`service_role` anahtarı, veritabanı şifresi, `VAPID_OZEL`, `CRON_GIZLI`. Bunları GitHub'a ya da sohbete yazma. `config.js`'teki değerler gizli değildir.
- **Çevrimdışı:** uygulama internetsiz açılır ama kayıt eklemek için bağlantı gerekir.

## Kayıtların güvenliği ve yedekler

- **Bağlantı koparsa:** kayıt önce telefonda saklanır, bağlantı gelince (uygulama kapatılıp açılsa bile) kendiliğinden sunucuya gider. Ekranda "N kayıt telefonda bekliyor" yazar.
- **İki cihaz:** kayıtlar sunucuda her zaman birleştirilerek yazılır; iki cihaz aynı anda yazsa da hiçbir kayıt ezilmez.
- **Gece yedeği:** sunucu her gece (00:17 UTC) bütün özel kayıtların bir kopyasını alır, son 14 günü tutar. Geri almak için SQL Editor'da:

```sql
-- Hangi günlerin yedeği var?
select gun, count(*) from public.ozel_yedek group by gun order by gun desc;
-- Bir kişinin kayıtlarını o günün yedeğiyle birleştir (mevcut kayıtlar silinmez, kaybolanlar geri gelir)
select public.td_yedekten_geri_al((select id from auth.users where email = 'E_POSTA'), 'YYYY-AA-GG');
```

- **Kişisel yedek:** herkes **Ayarlar → Yedeği indir (JSON)** ile kendi kayıtlarını indirebilir; ayda bir indirmek iyi bir alışkanlıktır.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `index.html` | Uygulama. `yap.py` tarafından ana uygulamadan üretilir; elle düzenleme. |
| `config.js` | Senin dolduracağın ayarlar (gizli değil). |
| `altyapi.js` | Uygulamayı Supabase'e bağlayan katman (giriş, kayıtlar, odalar, bildirim). |
| `sw.js`, `manifest.webmanifest`, `icons/` | Ana ekrana ekleme, tam ekran, çevrimdışı açılış, bildirim. |
| `anahtar.html` | Bildirim anahtarı üretir (bir kez kullanılır). |
| `supabase/schema.sql` | Tablolar ve gizlilik kuralları. |
| `supabase/functions/uyari-gonder/index.ts` | Bildirimi gönderen sunucu işlevi. |
| `supabase/cron.sql` | Bildirim göndericiyi her dakika çağıran zamanlayıcı. |
| `yap.py` | Ana uygulama (`../index.html`) değişince `index.html`'i yeniden üretir: `python3 yap.py` |
| `test/` | Otomatik testler (aşağıda). Yayına gitmez. |

## Testler (geliştirme için)

Yerel PostgreSQL 16, Node 22, Playwright, Deno ve `pg`, `ws`, `http_ece` paketleri gerekir.

| Komut | Neyi dener |
|---|---|
| `psql -f test/sql/00-supabase-taklit.sql -f supabase/schema.sql -f test/sql/10-kurallar.sql` | Gizlilik kuralları (38 denetim) |
| `node test/uctan-uca.js` | Uçtan uca: kayıt, oda, davet, zil, yedek, iki cihaz, yönetici (gerçek PostgreSQL) |
| `GERCEK=1 node test/uctan-uca.js` | Aynısı, gerçek supabase-js kütüphanesi ve protokol taklidiyle |
| `node test/bildirim.mjs` | Bildirim şifrelemesi ve imzası (bağımsız kütüphaneyle doğrulama) |
| `node test/deno-islev.js` | Sunucu işlevi gerçek Deno'da |
| `node test/bildirim-zinciri.js` | Zil → sunucu → şifreli ileti → servis çalışanı → ekranda bildirim; çevrimdışı açılış |
| `node test/yerel-kabul.js`, `node test/mobil-denetim.js` | Uygulamanın kendi kabul ve mobil denetimleri |
