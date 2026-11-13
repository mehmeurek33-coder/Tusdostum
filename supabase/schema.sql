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
-- Tekrar: kişi çalışmaya dönene kadar uyarı TEKRAR_ARALIK arayla "kalan" kez daha gönderilir; "sira" kaçıncı olduğudur
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
create policy profil_oku on public.profiller for select to authenticated using (true);
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
              case when (x ->> 'tur') = 'sinir' then 0 else least(greatest(coalesce((x ->> 'tekrar')::int, 0), 0), 5) end, 0)
      on conflict (uid, tur) do update set zaman = excluded.zaman, dk = excluded.dk, kalan = excluded.kalan, sira = 0;
  end loop;
end $$;

-- Vakti gelen uyarıları alır ve siler; yalnızca bildirim gönderen işlev (service_role) çağırır
-- Tekrar hakkı kalan uyarı 3 dakika sonrasına yeniden kurulur (kişi çalışmaya dönünce uygulama listeyi siler).
drop function if exists public.td_vadesi_gelenler();
create function public.td_vadesi_gelenler() returns table (uid uuid, tur text, dk int, sira int, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in delete from uyarilar u where u.zaman <= now() + interval '20 seconds'
           returning u.uid, u.tur, u.dk, u.zaman, u.kalan, u.sira loop
    if r.zaman <= now() - interval '15 minutes' then continue; end if;
    if r.kalan > 0 then
      insert into uyarilar (uid, tur, zaman, dk, kalan, sira) values (r.uid, r.tur, now() + interval '3 minutes', r.dk, r.kalan - 1, r.sira + 1)
        on conflict on constraint uyarilar_pkey do nothing;
    end if;
    return query select r.uid, r.tur, r.dk, r.sira, a.endpoint, a.p256dh, a.auth from push_abonelikleri a where a.uid = r.uid;
  end loop;
end $$;
create or replace function public.td_olu_abonelikleri_sil(p_endpointler text[]) returns void
language sql security definer set search_path = public as $$
  delete from push_abonelikleri where endpoint = any (p_endpointler)
$$;

-- ---------- İzinler ----------
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.profiller, public.son_gunler, public.ozel_belgeler to authenticated;
grant select on public.oda_uyeleri, public.odalarim, public.push_abonelikleri, public.uyarilar to authenticated;
grant all on all tables in schema public to service_role;

revoke all on function public.td_vadesi_gelenler() from public, anon, authenticated;
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
  foreach t in array array['profiller', 'son_gunler', 'ozel_belgeler', 'oda_uyeleri'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
