-- TusDostum · Supabase veritabanı şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın TAMAMINI yapıştır → Run.
-- Tekrar çalıştırmak güvenlidir (var olanı bozmaz).
--
-- Gizlilik kuralları (veritabanı düzeyinde uygulanır):
--   ozel_belgeler  : bütün kayıtlar, notlar, denemeler, ayarlar  → YALNIZCA sahibi
--   profiller      : görünen ad, simge, canlı kronometre, bugünün oturumları → giriş yapmış herkes (Genel)
--   son_gunler     : son 10 günün gün/ders toplamları → sahibi + aynı kişisel odadaki kişiler
--   oda_uyeleri    : oda adının ÖZETİ (adın kendisi değil) → herkes okur, yalnızca sunucu yazar
--   odalarim       : kişinin oda adları → YALNIZCA sahibi (oda adı bir parola gibi çalışır)

-- ---------- Yardımcılar ----------
-- İç içe birleştirme: nesneler birleşir, diziler ve düz değerler değişir, null alanı siler
create or replace function public.td_birlestir(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v jsonb; r jsonb;
begin
  if a is null or jsonb_typeof(a) <> 'object' or b is null or jsonb_typeof(b) <> 'object' then return b; end if;
  r := a;
  for k, v in select * from jsonb_each(b) loop
    if jsonb_typeof(v) = 'null' then r := r - k;
    elsif jsonb_typeof(v) = 'object' and jsonb_typeof(r -> k) = 'object' then r := r || jsonb_build_object(k, public.td_birlestir(r -> k, v));
    else r := r || jsonb_build_object(k, v);
    end if;
  end loop;
  return r;
end $$;

-- ---------- Tablolar ----------
create table if not exists public.profiller (
  uid uuid primary key references auth.users(id) on delete cascade,
  veri jsonb not null default '{}'::jsonb,
  guncellendi timestamptz not null default now()
);
create table if not exists public.son_gunler (
  uid uuid primary key references auth.users(id) on delete cascade,
  son jsonb not null default '[]'::jsonb,
  guncellendi timestamptz not null default now()
);
create table if not exists public.ozel_belgeler (
  uid uuid not null references auth.users(id) on delete cascade,
  belge text not null check (char_length(belge) between 1 and 40),
  veri jsonb not null default '{}'::jsonb,
  guncellendi timestamptz not null default now(),
  primary key (uid, belge)
);
create table if not exists public.oda_uyeleri (
  uid uuid not null references auth.users(id) on delete cascade,
  oda text not null,
  primary key (uid, oda)
);
create index if not exists oda_uyeleri_oda on public.oda_uyeleri (oda);
create table if not exists public.odalarim (
  uid uuid primary key references auth.users(id) on delete cascade,
  etiketler text[] not null default '{}',
  anahtarlar text[] not null default '{}',
  ozetler text[] not null default '{}'
);
create table if not exists public.push_abonelikleri (
  endpoint text primary key,
  uid uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  olusturuldu timestamptz not null default now()
);
create index if not exists push_abonelikleri_uid on public.push_abonelikleri (uid);
create table if not exists public.uyarilar (
  uid uuid not null references auth.users(id) on delete cascade,
  tur text not null check (tur in ('mola', 'calisma', 'sinir')),
  zaman timestamptz not null,
  dk int not null default 0,
  primary key (uid, tur)
);
-- Tekrar: kişi çalışmaya dönene kadar uyarı 5 dakika arayla "kalan" kez daha gönderilir; "sira" kaçıncı olduğudur
alter table public.uyarilar add column if not exists kalan int not null default 0;
alter table public.uyarilar add column if not exists sira int not null default 0;
create index if not exists uyarilar_zaman on public.uyarilar (zaman);
create table if not exists public.yoneticiler (
  uid uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.engelliler (
  uid uuid primary key,
  zaman timestamptz not null default now()
);

-- ---------- Yetki sorguları ----------
create or replace function public.td_engelli_miyim() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from engelliler where uid = auth.uid())
$$;
create or replace function public.td_yonetici_miyim() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from yoneticiler where uid = auth.uid())
$$;
-- İki kişinin ortak bir kişisel odası var mı?
create or replace function public.td_ayni_odada(hedef uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from oda_uyeleri a join oda_uyeleri b on a.oda = b.oda
    where a.uid = auth.uid() and b.uid = hedef)
$$;

-- ---------- Boyut sınırları (ücretsiz veritabanını korur) ----------
create or replace function public.td_sinir() returns trigger
language plpgsql as $$
declare n int;
begin
  new.guncellendi := now();
  -- sütun adı tabloya göre değişir (veri / son); satır jsonb'ye çevrilerek ortak okunur
  n := octet_length(coalesce(to_jsonb(new) ->> (case when tg_table_name = 'son_gunler' then 'son' else 'veri' end), ''));
  if tg_table_name = 'ozel_belgeler' then
    if n > 1500000 then raise exception 'td_boyut: belge çok büyük'; end if;
    if tg_op = 'INSERT' and (select count(*) from public.ozel_belgeler where uid = new.uid) >= 600 then raise exception 'td_boyut: belge sayısı sınırı'; end if;
  elsif n > 60000 then raise exception 'td_boyut: kayıt çok büyük';
  end if;
  return new;
end $$;
drop trigger if exists td_sinir on public.profiller;
create trigger td_sinir before insert or update on public.profiller for each row execute function public.td_sinir();
drop trigger if exists td_sinir on public.son_gunler;
create trigger td_sinir before insert or update on public.son_gunler for each row execute function public.td_sinir();
drop trigger if exists td_sinir on public.ozel_belgeler;
create trigger td_sinir before insert or update on public.ozel_belgeler for each row execute function public.td_sinir();

-- ---------- Satır düzeyi güvenlik ----------
alter table public.profiller enable row level security;
alter table public.son_gunler enable row level security;
alter table public.ozel_belgeler enable row level security;
alter table public.oda_uyeleri enable row level security;
alter table public.odalarim enable row level security;
alter table public.push_abonelikleri enable row level security;
alter table public.uyarilar enable row level security;
alter table public.yoneticiler enable row level security;
alter table public.engelliler enable row level security;

drop policy if exists profil_oku on public.profiller;
-- Ad seçmemiş kişinin profili başkalarına gösterilmez (kendisi görür)
create policy profil_oku on public.profiller for select to authenticated using (uid = auth.uid() or coalesce(btrim(veri ->> 'nick'), '') <> '');
drop policy if exists profil_ekle on public.profiller;
create policy profil_ekle on public.profiller for insert to authenticated with check (uid = auth.uid() and not public.td_engelli_miyim());
drop policy if exists profil_guncelle on public.profiller;
create policy profil_guncelle on public.profiller for update to authenticated using (uid = auth.uid() and not public.td_engelli_miyim()) with check (uid = auth.uid());
drop policy if exists profil_sil on public.profiller;
create policy profil_sil on public.profiller for delete to authenticated using (uid = auth.uid());

drop policy if exists son_oku on public.son_gunler;
create policy son_oku on public.son_gunler for select to authenticated using (uid = auth.uid() or public.td_ayni_odada(uid));
drop policy if exists son_ekle on public.son_gunler;
create policy son_ekle on public.son_gunler for insert to authenticated with check (uid = auth.uid() and not public.td_engelli_miyim());
drop policy if exists son_guncelle on public.son_gunler;
create policy son_guncelle on public.son_gunler for update to authenticated using (uid = auth.uid() and not public.td_engelli_miyim()) with check (uid = auth.uid());
drop policy if exists son_sil on public.son_gunler;
create policy son_sil on public.son_gunler for delete to authenticated using (uid = auth.uid());

drop policy if exists ozel_hepsi on public.ozel_belgeler;
create policy ozel_hepsi on public.ozel_belgeler for all to authenticated using (uid = auth.uid()) with check (uid = auth.uid());

drop policy if exists uye_oku on public.oda_uyeleri;
create policy uye_oku on public.oda_uyeleri for select to authenticated using (true);
-- oda_uyeleri'ne doğrudan yazma yok: yalnızca td_odalari_ayarla işlevi yazar

drop policy if exists odalarim_oku on public.odalarim;
create policy odalarim_oku on public.odalarim for select to authenticated using (uid = auth.uid());

drop policy if exists abonelik_oku on public.push_abonelikleri;
create policy abonelik_oku on public.push_abonelikleri for select to authenticated using (uid = auth.uid());

drop policy if exists uyari_oku on public.uyarilar;
create policy uyari_oku on public.uyarilar for select to authenticated using (uid = auth.uid());
-- yoneticiler ve engelliler: politika yok → yalnızca sunucu (SQL Editor / service_role) okur-yazar

-- ---------- İşlevler (uygulamanın çağırdıkları) ----------
create or replace function public.td_profil_guncelle(p_yama jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare r jsonb;
begin
  update profiller set veri = td_birlestir(veri, p_yama) where uid = auth.uid() returning veri into r;
  return r;   -- satır yoksa (ya da yazma izni yoksa) null
end $$;

-- Kayıt yazmanın TEK yolu: belge yoksa oluşturur, varsa iç içe birleştirir. Asla üzerine yazmaz;
-- iki cihaz aynı anda aynı belgeye (ör. ayın ilk kaydı) yazsa da iki kayıt da kalır.
create or replace function public.td_ozel_birlestir(p_belge text, p_yama jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null then raise exception 'giriş gerekli'; end if;
  if p_yama is null or jsonb_typeof(p_yama) <> 'object' then raise exception 'geçersiz yama'; end if;
  insert into ozel_belgeler as o (uid, belge, veri) values (auth.uid(), p_belge, td_birlestir('{}'::jsonb, p_yama))
    on conflict (uid, belge) do update set veri = td_birlestir(o.veri, excluded.veri)
    returning veri into r;
  return r;
end $$;

create or replace function public.td_ozel_guncelle(p_belge text, p_yama jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare r jsonb;
begin
  update ozel_belgeler set veri = td_birlestir(veri, p_yama) where uid = auth.uid() and belge = p_belge returning veri into r;
  return r;
end $$;

-- Kişinin odalarını belirler. Oda adı gizli kalır; diğerleri yalnızca özetini görür.
create or replace function public.td_odalari_ayarla(p_etiketler text[], p_anahtarlar text[]) returns text[]
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ozet text[] := '{}'; k text; n int;
begin
  if me is null then raise exception 'giriş gerekli'; end if;
  if exists (select 1 from engelliler where uid = me) then raise exception 'td_engelli'; end if;
  n := coalesce(array_length(p_anahtarlar, 1), 0);
  if n > 5 or n <> coalesce(array_length(p_etiketler, 1), 0) then raise exception 'en çok 5 oda'; end if;
  if n > 0 then
    foreach k in array p_anahtarlar loop
      if k is null or k !~ '^[a-z0-9][a-z0-9_.-]{0,47}$' or k = 'genel' then raise exception 'geçersiz oda'; end if;
      ozet := ozet || md5('tusdostum-oda:' || k);
    end loop;
  end if;
  delete from oda_uyeleri where uid = me;
  if n > 0 then
    insert into oda_uyeleri (uid, oda) select me, x from unnest(ozet) x on conflict do nothing;
  end if;
  insert into odalarim (uid, etiketler, anahtarlar, ozetler) values (me, coalesce(p_etiketler, '{}'), coalesce(p_anahtarlar, '{}'), ozet)
    on conflict (uid) do update set etiketler = excluded.etiketler, anahtarlar = excluded.anahtarlar, ozetler = excluded.ozetler;
  return ozet;
end $$;

-- Bu adda (anahtarda) bir oda var mı? Bir oda, çağıran kişiden başka en az bir üyesi varsa vardır.
-- Uygulama bunu "Oda kur" (ad boşta olmalı) ve "Odaya katıl" (oda var olmalı) için kullanır.
create or replace function public.td_oda_var_mi(p_anahtar text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from oda_uyeleri
    where oda = md5('tusdostum-oda:' || p_anahtar) and uid is distinct from auth.uid())
$$;

-- Yönetici bir kişiyi listelerden çıkarır ve yeniden görünmesini engeller (kişinin özel kayıtlarına dokunulmaz)
create or replace function public.td_kisi_cikar(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from yoneticiler where uid = auth.uid()) then raise exception 'td_engelli: yetki yok'; end if;
  if p_uid = auth.uid() then raise exception 'kendini çıkaramazsın'; end if;
  insert into engelliler (uid) values (p_uid) on conflict do nothing;
  delete from profiller where uid = p_uid;
  delete from son_gunler where uid = p_uid;
  delete from oda_uyeleri where uid = p_uid;
  delete from odalarim where uid = p_uid;
  delete from uyarilar where uid = p_uid;
  delete from push_abonelikleri where uid = p_uid;
end $$;

-- Bildirim aboneliği (bir cihaz hesap değiştirirse abonelik yeni hesaba geçer)
create or replace function public.td_abonelik_kaydet(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'giriş gerekli'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 or char_length(p_p256dh) > 200 or char_length(p_auth) > 100 then raise exception 'geçersiz abonelik'; end if;
  insert into push_abonelikleri (endpoint, uid, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
    on conflict (endpoint) do update set uid = excluded.uid, p256dh = excluded.p256dh, auth = excluded.auth;
  -- kişi başına en çok 8 cihaz
  delete from push_abonelikleri where uid = auth.uid() and endpoint not in (
    select endpoint from push_abonelikleri where uid = auth.uid() order by olusturuldu desc limit 8);
end $$;
create or replace function public.td_abonelik_sil(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_abonelikleri where endpoint = p_endpoint and uid = auth.uid()
$$;

-- Kronometre durumuna göre bekleyen uyarılar. p: [{"tur":"mola","zaman":<epoch ms>,"dk":10}, …]
create or replace function public.td_uyarilari_ayarla(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); x jsonb; z timestamptz;
begin
  if me is null then raise exception 'giriş gerekli'; end if;
  delete from uyarilar where uid = me;
  if p is null or jsonb_typeof(p) <> 'array' then return; end if;
  for x in select * from jsonb_array_elements(p) limit 3 loop
    if (x ->> 'tur') not in ('mola', 'calisma', 'sinir') then continue; end if;
    z := to_timestamp((x ->> 'zaman')::double precision / 1000.0);
    if z < now() - interval '1 minute' or z > now() + interval '13 hours' then continue; end if;
    insert into uyarilar (uid, tur, zaman, dk, kalan, sira)
      values (me, x ->> 'tur', z, least(greatest(coalesce((x ->> 'dk')::int, 0), 0), 600),
              case when (x ->> 'tur') in ('sinir', 'calisma') then 0 else least(greatest(coalesce((x ->> 'tekrar')::int, 0), 0), 40) end, 0)
      on conflict (uid, tur) do update set zaman = excluded.zaman, dk = excluded.dk, kalan = excluded.kalan, sira = 0;
  end loop;
end $$;

-- Vakti gelen uyarıları alır ve siler; yalnızca bildirim gönderen işlev (service_role) çağırır
-- Tekrar hakkı kalan uyarı 5 dakika sonrasına yeniden kurulur (kişi çalışmaya dönünce uygulama listeyi siler).
-- Çalışma uyarısı tekrarlanmaz ve gönderilmeden önce son oturum (son moladan beri) kişinin kronometresinden yeniden
-- hesaplanır: kronometre çalışmıyorsa ya da son oturum kişinin seçtiği süreyi (30–120 dk) aşmadıysa gönderilmez.
create or replace function public.td_vadesi_gelenler() returns table (uid uuid, tur text, dk int, sira int, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
declare r record; t jsonb;
begin
  for r in delete from uyarilar u where u.zaman <= now() + interval '20 seconds'
           returning u.uid, u.tur, u.dk, u.zaman, u.kalan, u.sira loop
    if r.zaman <= now() - interval '15 minutes' then continue; end if;
    if r.tur = 'calisma' then
      select p.veri -> 'timer' into t from profiller p where p.uid = r.uid;
      if t is null or jsonb_typeof(t -> 'runStart') is distinct from 'number' or jsonb_typeof(t -> 'breakStart') = 'number'
         or extract(epoch from now()) * 1000 - (t ->> 'runStart')::numeric < greatest(r.dk, 1) * 60000 - 30000 then continue; end if;
      r.kalan := 0;
    end if;
    if r.kalan > 0 then
      insert into uyarilar (uid, tur, zaman, dk, kalan, sira) values (r.uid, r.tur, now() + interval '5 minutes', r.dk, r.kalan - 1, r.sira + 1)
        on conflict on constraint uyarilar_pkey do nothing;
    end if;
    return query select r.uid, r.tur, r.dk, r.sira, a.endpoint, a.p256dh, a.auth from push_abonelikleri a where a.uid = r.uid;
  end loop;
end $$;
create or replace function public.td_olu_abonelikleri_sil(p_endpointler text[]) returns void
language sql security definer set search_path = public as $$
  delete from push_abonelikleri where endpoint = any (p_endpointler)
$$;

-- ---------- Tebrik ve dürtme ----------
-- Yalnızca ortak kişisel odadakiler arasında. Kim kimi tebrik etti/dürttü yalnızca alan (ve gönderen) görür;
-- odadakiler yalnızca tebrik sayısını görür. Kayıtlara ve istatistiklere dokunmaz. 7 gün saklanır.
create table if not exists public.etkilesimler (
  id bigserial primary key,
  gonderen uuid references auth.users(id) on delete cascade,   -- boşsa uygulamanın kendi tebriki (günde 5 saat)
  alici uuid not null references auth.users(id) on delete cascade,
  tur text not null check (tur in ('tebrik', 'durt')),
  oda text not null,                                   -- ortak odanın özeti
  gun date not null,                                   -- Türkiye saatine göre gün
  zaman timestamptz not null default now(),
  goruldu boolean not null default false,
  bildirim_bekliyor boolean not null default false,
  unique (gonderen, alici, tur, gun)
);
alter table public.etkilesimler alter column gonderen drop not null;
alter table public.etkilesimler drop constraint if exists etkilesimler_sistem_tebrik;
alter table public.etkilesimler add constraint etkilesimler_sistem_tebrik check (gonderen is not null or tur = 'tebrik');
create index if not exists etkilesimler_alici on public.etkilesimler (alici, gun);
create unique index if not exists etkilesimler_sistem on public.etkilesimler (alici, gun) where gonderen is null;   -- günde bir
alter table public.etkilesimler enable row level security;
drop policy if exists etk_oku on public.etkilesimler;
create policy etk_oku on public.etkilesimler for select to authenticated using (alici = auth.uid() or gonderen = auth.uid());

create table if not exists public.tebrik_ozet (
  uid uuid primary key references auth.users(id) on delete cascade,
  toplam int not null default 0,
  gun date,
  bugun int not null default 0
);
alter table public.tebrik_ozet enable row level security;
drop policy if exists tebrik_oku on public.tebrik_ozet;
create policy tebrik_oku on public.tebrik_ozet for select to authenticated using (uid = auth.uid() or public.td_ayni_odada(uid));

-- Sunucu ayarları (bildirim işlevinin adresi ve gizli değeri). Politika yok: yalnızca sunucu okur.
create table if not exists public.sunucu_ayar (ad text primary key, deger text not null);
alter table public.sunucu_ayar enable row level security;

create or replace function public.td_bugun() returns date
language sql stable as $$ select (now() at time zone 'Europe/Istanbul')::date $$;

-- Bildirim göndericiyi hemen çağırır (pg_net ve ayarlar varsa; yoksa dakikalık zamanlayıcı gönderir)
create or replace function public.td_bildirim_tetikle() returns void
language plpgsql security definer set search_path = public as $$
declare u text; g text;
begin
  select deger into u from sunucu_ayar where ad = 'islev_adresi';
  select deger into g from sunucu_ayar where ad = 'cron_gizli';
  if u is null or g is null or not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb, timeout_milliseconds := 20000)'
    using u, jsonb_build_object('Content-Type', 'application/json', 'x-cron-gizli', g);
exception when others then return;                     -- bildirim gecikse de gönderme işlemi bozulmasın
end $$;

-- Tebrik ya da dürt gönder. Döner: 'tamam' | 'zaten' | 'ortak_oda_yok' | 'calisiyor' | 'kapali' | 'hak_doldu'
create or replace function public.td_etkilesim_gonder(p_alici uuid, p_tur text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g date := td_bugun(); o text; v jsonb; calisiyor boolean; bildir boolean; saat int;
begin
  if me is null then raise exception 'giriş gerekli'; end if;
  if exists (select 1 from engelliler where uid = me) then raise exception 'td_engelli'; end if;
  if p_tur not in ('tebrik', 'durt') then raise exception 'geçersiz tür'; end if;
  if p_alici is null or p_alici = me then raise exception 'geçersiz alıcı'; end if;
  select a.oda into o from oda_uyeleri a join oda_uyeleri b on a.oda = b.oda where a.uid = me and b.uid = p_alici limit 1;
  if o is null then return 'ortak_oda_yok'; end if;
  if exists (select 1 from etkilesimler where gonderen = me and alici = p_alici and tur = p_tur and gun = g) then return 'zaten'; end if;
  select veri into v from profiller where uid = p_alici;
  calisiyor := v is not null and (v -> 'timer' ->> 'runStart') is not null and (v -> 'timer' ->> 'breakStart') is null;
  if p_tur = 'durt' then
    if calisiyor then return 'calisiyor'; end if;
    if coalesce((select (veri ->> 'durtmeKapali')::boolean from ozel_belgeler where uid = p_alici and belge = 'ayar'), false) then return 'kapali'; end if;
    if (select count(*) from etkilesimler where alici = p_alici and tur = 'durt' and gun = g) >= 2 then return 'hak_doldu'; end if;
    saat := extract(hour from now() at time zone 'Europe/Istanbul');
    bildir := saat >= 8 and saat < 23;                 -- 23:00–08:00 arası dürtme bildirimi gitmez
  else
    bildir := not calisiyor;                           -- çalışan kişiye bildirim gitmez; molada uygulamada görür
  end if;
  begin
    insert into etkilesimler (gonderen, alici, tur, oda, gun, bildirim_bekliyor) values (me, p_alici, p_tur, o, g, bildir);
  exception when unique_violation then return 'zaten';
  end;
  if p_tur = 'tebrik' then
    insert into tebrik_ozet as t (uid, toplam, gun, bugun) values (p_alici, 1, g, 1)
      on conflict (uid) do update set toplam = t.toplam + 1, bugun = case when t.gun = g then t.bugun + 1 else 1 end, gun = g;
  end if;
  if bildir then perform td_bildirim_tetikle(); end if;
  return 'tamam';
end $$;

-- Günde 5 saat: uygulamanın kendi tebriki (günde bir). Bugünkü kronometreli kayıtlar ve işleyen kronometre
-- sunucuda ayrıca toplanır; 300 dakikaya ulaşmamışsa verilmez. Döner: 'tamam' | 'zaten' | 'yetersiz'
create or replace function public.td_hedef_tebrik() returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g date := td_bugun(); dk numeric := 0; t jsonb; is_ms numeric := 0; simdi numeric; gece numeric; bas numeric;
begin
  if me is null then raise exception 'giriş gerekli'; end if;
  if exists (select 1 from engelliler where uid = me) then raise exception 'td_engelli'; end if;
  if exists (select 1 from etkilesimler where alici = me and gonderen is null and gun = g) then return 'zaten'; end if;
  select coalesce(sum(least((e.value ->> 'm')::numeric, 960)), 0) into dk
    from ozel_belgeler o, jsonb_each(case when jsonb_typeof(o.veri -> 'entries') = 'object' then o.veri -> 'entries' else '{}'::jsonb end) e
    where o.uid = me and o.belge = 'kron-' || to_char(g, 'YYYY-MM')
      and jsonb_typeof(e.value) = 'object' and not (e.value ? 'del') and e.value ->> 'd' = g::text
      and jsonb_typeof(e.value -> 'm') = 'number' and (e.value ->> 'm')::numeric > 0;
  -- İşleyen kronometrenin bugüne düşen kısmı (uygulamadaki hesapla aynı)
  select veri -> 'timer' into t from profiller where uid = me;
  if jsonb_typeof(t) = 'object' and jsonb_typeof(t -> 'st') = 'number' then
    simdi := extract(epoch from now()) * 1000;
    gece := extract(epoch from (g::timestamp at time zone 'Europe/Istanbul')) * 1000;
    bas := (t ->> 'st')::numeric;
    is_ms := case when jsonb_typeof(t -> 'workMs') = 'number' then greatest((t ->> 'workMs')::numeric, 0) else 0 end
      + case when jsonb_typeof(t -> 'runStart') = 'number' then least(greatest(simdi - (t ->> 'runStart')::numeric, 0), 3 * 3600000) else 0 end;
    if bas < gece then is_ms := is_ms * least(1, (simdi - gece) / greatest(simdi - bas, 1)); end if;
  end if;
  if least(dk, 960) + floor(is_ms / 60000) < 300 then return 'yetersiz'; end if;
  begin
    insert into etkilesimler (gonderen, alici, tur, oda, gun, bildirim_bekliyor) values (null, me, 'tebrik', '', g, false);
  exception when unique_violation then return 'zaten';
  end;
  insert into tebrik_ozet as o (uid, toplam, gun, bugun) values (me, 1, g, 1)
    on conflict (uid) do update set toplam = o.toplam + 1, bugun = case when o.gun = g then o.bugun + 1 else 1 end, gun = g;
  return 'tamam';
end $$;

-- Profil açılınca düğmelerin durumu
create or replace function public.td_etkilesim_durum(p_alici uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); g date := td_bugun();
begin
  if me is null then return null; end if;
  return jsonb_build_object(
    'ortak', exists (select 1 from oda_uyeleri a join oda_uyeleri b on a.oda = b.oda where a.uid = me and b.uid = p_alici),
    'tebrik', exists (select 1 from etkilesimler where gonderen = me and alici = p_alici and tur = 'tebrik' and gun = g),
    'durt', exists (select 1 from etkilesimler where gonderen = me and alici = p_alici and tur = 'durt' and gun = g),
    'durtSayisi', (select count(*) from etkilesimler where alici = p_alici and tur = 'durt' and gun = g),
    'durtmeKapali', coalesce((select (veri ->> 'durtmeKapali')::boolean from ozel_belgeler where uid = p_alici and belge = 'ayar'), false));
end $$;

create or replace function public.td_etkilesim_goruldu(p_idler bigint[]) returns void
language sql security definer set search_path = public as $$
  update etkilesimler set goruldu = true where alici = auth.uid() and id = any (p_idler)
$$;

-- Bildirim göndericinin aldığı bekleyen tebrik/dürtme bildirimleri (yalnızca service_role)
create or replace function public.td_bekleyen_etkilesimler() returns table (id bigint, tur text, gonderen_ad text, oda_ad text, endpoint text, p256dh text, auth text)
language sql security definer set search_path = public as $$
  with d as (
    update etkilesimler e set bildirim_bekliyor = false
    where e.bildirim_bekliyor and e.zaman > now() - interval '30 minutes'
    returning e.id, e.gonderen, e.alici, e.tur, e.oda)
  select d.id, d.tur,
    coalesce(nullif(btrim(p.veri ->> 'nick'), ''), 'Bir arkadaşın'),
    (select o.etiketler[array_position(o.ozetler, d.oda)] from odalarim o where o.uid = d.alici),
    a.endpoint, a.p256dh, a.auth
  from d join push_abonelikleri a on a.uid = d.alici left join profiller p on p.uid = d.gonderen
$$;

-- ---------- Haftalık özet ----------
-- Pazar akşamı tek bildirim: bu hafta (Pzt–Paz) kronometreyle çalışılan süre ve geçen haftayla farkı.
-- Yalnızca bildirimi açık ve bu hafta çalışmış kişilere gider. Kayıtlara dokunmaz; yalnızca service_role çağırır.
create or replace function public.td_haftalik_ozet() returns table (uid uuid, bu_hafta int, gecen_hafta int, endpoint text, p256dh text, auth text)
language sql security definer set search_path = public as $$
  with gun as (select td_bugun() as bugun, date_trunc('week', td_bugun()::timestamp)::date as pzt),
  kayit as (
    select o.uid, e.value ->> 'd' as d, least((e.value ->> 'm')::numeric, 960) as m
    from gun, ozel_belgeler o,
      jsonb_each(case when jsonb_typeof(o.veri -> 'entries') = 'object' then o.veri -> 'entries' else '{}'::jsonb end) e
    where o.belge like 'kron-%' and o.belge >= 'kron-' || to_char(gun.pzt - 7, 'YYYY-MM')
      and jsonb_typeof(e.value) = 'object' and not (e.value ? 'del')
      and jsonb_typeof(e.value -> 'm') = 'number' and (e.value ->> 'm')::numeric > 0),
  toplam as (
    select k.uid,
      coalesce(sum(k.m) filter (where k.d >= gun.pzt::text and k.d <= gun.bugun::text), 0)::int as bu,
      coalesce(sum(k.m) filter (where k.d >= (gun.pzt - 7)::text and k.d < gun.pzt::text), 0)::int as gecen
    from kayit k, gun group by k.uid)
  select t.uid, t.bu, t.gecen, a.endpoint, a.p256dh, a.auth
  from toplam t join push_abonelikleri a on a.uid = t.uid
  where t.bu > 0 and not exists (select 1 from engelliler x where x.uid = t.uid)
$$;

-- ---------- Günlük yedek ----------
-- Her gece özel kayıtların bir kopyası alınır; son 14 gün tutulur. Yalnızca sunucu (SQL Editor) okur.
create table if not exists public.ozel_yedek (
  gun date not null,
  uid uuid not null,
  belge text not null,
  veri jsonb not null,
  primary key (gun, uid, belge)
);
alter table public.ozel_yedek enable row level security;
create or replace function public.td_gunluk_yedek() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into ozel_yedek (gun, uid, belge, veri)
    select current_date, uid, belge, veri from ozel_belgeler
    on conflict (gun, uid, belge) do update set veri = excluded.veri;
  get diagnostics n = row_count;
  delete from ozel_yedek where gun < current_date - 14;
  delete from etkilesimler where gun < td_bugun() - 7;
  return n;
end $$;
-- Bir kişinin kayıtlarını belirli bir günün yedeğinden geri getirir (yalnızca SQL Editor'dan, elle).
-- Var olan kayıtlar silinmez: yedekteki kayıtlar mevcut belgelerle birleştirilir.
create or replace function public.td_yedekten_geri_al(p_uid uuid, p_gun date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into ozel_belgeler as o (uid, belge, veri)
    select uid, belge, veri from ozel_yedek where uid = p_uid and gun = p_gun and belge <> 'kronometre'
    on conflict (uid, belge) do update set veri = td_birlestir(excluded.veri, o.veri);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- İzinler ----------
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.profiller, public.son_gunler, public.ozel_belgeler to authenticated;
grant select on public.oda_uyeleri, public.odalarim, public.push_abonelikleri, public.uyarilar to authenticated;
grant all on all tables in schema public to service_role;

revoke all on function public.td_vadesi_gelenler() from public, anon, authenticated;
revoke all on function public.td_gunluk_yedek(), public.td_yedekten_geri_al(uuid, date) from public, anon, authenticated;
revoke all on function public.td_bekleyen_etkilesimler(), public.td_bildirim_tetikle(), public.td_haftalik_ozet() from public, anon, authenticated;
grant execute on function public.td_bekleyen_etkilesimler(), public.td_bildirim_tetikle(), public.td_haftalik_ozet() to service_role;
revoke all on function public.td_etkilesim_gonder(uuid, text), public.td_etkilesim_durum(uuid), public.td_etkilesim_goruldu(bigint[]), public.td_hedef_tebrik() from public, anon;
grant execute on function public.td_etkilesim_gonder(uuid, text), public.td_etkilesim_durum(uuid), public.td_etkilesim_goruldu(bigint[]), public.td_hedef_tebrik() to authenticated, service_role;
grant select on public.etkilesimler, public.tebrik_ozet to authenticated;
revoke all on public.sunucu_ayar from public, anon, authenticated;
grant execute on function public.td_gunluk_yedek(), public.td_yedekten_geri_al(uuid, date) to service_role;
revoke all on function public.td_ozel_birlestir(text, jsonb) from public, anon;
grant execute on function public.td_ozel_birlestir(text, jsonb) to authenticated, service_role;
revoke all on function public.td_olu_abonelikleri_sil(text[]) from public, anon, authenticated;
grant execute on function public.td_vadesi_gelenler() to service_role;
grant execute on function public.td_olu_abonelikleri_sil(text[]) to service_role;
revoke all on function public.td_profil_guncelle(jsonb), public.td_ozel_guncelle(text, jsonb), public.td_odalari_ayarla(text[], text[]),
  public.td_kisi_cikar(uuid), public.td_abonelik_kaydet(text, text, text), public.td_abonelik_sil(text), public.td_uyarilari_ayarla(jsonb),
  public.td_engelli_miyim(), public.td_yonetici_miyim(), public.td_ayni_odada(uuid), public.td_oda_var_mi(text) from public, anon;
grant execute on function public.td_profil_guncelle(jsonb), public.td_ozel_guncelle(text, jsonb), public.td_odalari_ayarla(text[], text[]),
  public.td_kisi_cikar(uuid), public.td_abonelik_kaydet(text, text, text), public.td_abonelik_sil(text), public.td_uyarilari_ayarla(jsonb),
  public.td_engelli_miyim(), public.td_yonetici_miyim(), public.td_ayni_odada(uuid), public.td_oda_var_mi(text) to authenticated, service_role;

-- ---------- Canlı güncelleme ----------
do $$
declare t text;
begin
  foreach t in array array['profiller', 'son_gunler', 'ozel_belgeler', 'oda_uyeleri', 'etkilesimler', 'tebrik_ozet'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
