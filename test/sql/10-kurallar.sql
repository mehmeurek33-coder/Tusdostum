-- Gizlilik ve veri kuralları testi. Her satır "GEÇTİ"/"KALDI" yazar.
\set ON_ERROR_STOP on
\set A '''11111111-1111-1111-1111-111111111111'''
\set B '''22222222-2222-2222-2222-222222222222'''
\set C '''33333333-3333-3333-3333-333333333333'''
insert into auth.users (id, email) values (:A, 'a@x'), (:B, 'b@x'), (:C, 'c@x') on conflict do nothing;

create schema if not exists tdt;
create or replace function tdt.yaz(ad text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'GEÇTİ ' else 'KALDI ' end, ad; end $$;
-- Bir ifadenin hata verip vermediğini dener (yetkisiz işlem reddedilmeli)
create or replace function tdt.reddedilir(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;
grant usage on schema tdt to authenticated, anon, service_role;

-- ===== A: profil, özel belge, son günler =====
set role authenticated; set request.jwt.claim.sub = :A;
insert into profiller (uid, veri) values (:A, '{"nick":"Ayşe","timer":null,"day":{"d":"2026-11-13","e":[]}}');
insert into ozel_belgeler (uid, belge, veri) values (:A, 'kron-2026-11', '{"ym":"2026-11","entries":{"a1":{"m":30,"s":"anatomi"}}}');
insert into son_gunler (uid, son) values (:A, '[{"d":"2026-11-12","t":[120,0,0,0]}]');
select tdt.yaz('İç içe birleştirme: yeni kayıt eklenir, eskisi kalır',
  (select td_ozel_guncelle('kron-2026-11', '{"entries":{"a2":{"m":45}}}') -> 'entries') = '{"a1":{"m":30,"s":"anatomi"},"a2":{"m":45}}'::jsonb);
select tdt.yaz('Mezar taşı kaydın üstüne yazılır',
  (select td_ozel_guncelle('kron-2026-11', '{"entries":{"a1":{"del":1,"ts":5}}}') #> '{entries,a1}') = '{"m":30,"s":"anatomi","del":1,"ts":5}'::jsonb);
select tdt.yaz('Olmayan belgede güncelleme null döner', td_ozel_guncelle('yok', '{"a":1}') is null);
select tdt.yaz('Profil yaması: dizi değişir, null alanı siler',
  td_profil_guncelle('{"av":3,"timer":{"s":"anatomi"},"day":{"e":[{"id":"x"}]},"nick":null}') = '{"av":3,"timer":{"s":"anatomi"},"day":{"d":"2026-11-13","e":[{"id":"x"}]}}'::jsonb);
select td_profil_guncelle('{"nick":"Ayşe"}') is not null;
select tdt.yaz('Oda adı doğrudan yazılamaz (oda_uyeleri)', tdt.reddedilir($$insert into oda_uyeleri (uid, oda) values ('11111111-1111-1111-1111-111111111111', 'x')$$));
select tdt.yaz('Geçersiz oda anahtarı reddedilir', tdt.reddedilir($$select td_odalari_ayarla(array['Genel'], array['genel'])$$));
select tdt.yaz('6 oda reddedilir', tdt.reddedilir($$select td_odalari_ayarla(array['a','b','c','d','e','f'], array['a','b','c','d','e','f'])$$));
select tdt.yaz('Oda kurulur, özet döner', array_length(td_odalari_ayarla(array['Kızlar 2027', 'Dönem 6'], array['ki_zlar-2027', 'do_nem-6']), 1) = 2);

-- ===== B: başkasının verisine erişim =====
set request.jwt.claim.sub = :B;
insert into profiller (uid, veri) values (:B, '{"nick":"Burak"}');
select tdt.yaz('B, A''nın profilini (bugün) görür', (select count(*) from profiller where uid = :A) = 1);
select tdt.yaz('B, A''nın özel kayıtlarını GÖREMEZ', (select count(*) from ozel_belgeler where uid = :A) = 0);
select tdt.yaz('B, ortak odası yokken A''nın son 10 gününü GÖREMEZ', (select count(*) from son_gunler where uid = :A) = 0);
select tdt.yaz('B, A''nın oda adlarını GÖREMEZ', (select count(*) from odalarim where uid = :A) = 0);
select tdt.yaz('B, oda özetlerini görür (ad değil)', (select count(*) from oda_uyeleri where uid = :A) = 2);
update profiller set veri = '{"nick":"hack"}' where uid = :A;
select tdt.yaz('B, A''nın profilini DEĞİŞTİREMEZ', (select veri ->> 'nick' from profiller where uid = :A) = 'Ayşe');
delete from profiller where uid = :A;
select tdt.yaz('B, A''nın profilini SİLEMEZ', (select count(*) from profiller where uid = :A) = 1);
select tdt.yaz('B, A adına özel belge YAZAMAZ', tdt.reddedilir($$insert into ozel_belgeler (uid, belge, veri) values ('11111111-1111-1111-1111-111111111111', 'z', '{}')$$));
select tdt.yaz('B, A adına son gün YAZAMAZ', tdt.reddedilir($$insert into son_gunler (uid, son) values ('11111111-1111-1111-1111-111111111111', '[]')$$));
select tdt.yaz('B, yönetici değilken kişi çıkaramaz', tdt.reddedilir($$select td_kisi_cikar('11111111-1111-1111-1111-111111111111')$$));
select tdt.yaz('B, bildirim kuyruğunu çağıramaz', tdt.reddedilir($$select * from td_vadesi_gelenler()$$));
select tdt.yaz('B, yönetici listesini göremez', tdt.reddedilir($$select count(*) from yoneticiler$$));
-- Aynı odaya girince son 10 gün açılır
select td_odalari_ayarla(array['kızlar 2027'], array['ki_zlar-2027']) is not null;
select tdt.yaz('B, aynı odaya girince A''nın son 10 gününü görür', (select count(*) from son_gunler where uid = :A) = 1);
select tdt.yaz('Aynı odada olmak özel kayıtları AÇMAZ', (select count(*) from ozel_belgeler where uid = :A) = 0);
select td_odalari_ayarla(array['Başka'], array['bas_ka']) is not null;
select tdt.yaz('B odadan çıkınca son 10 gün yine kapanır', (select count(*) from son_gunler where uid = :A) = 0);
insert into ozel_belgeler (uid, belge, veri) values (:B, 'ayar', '{"goalMin":300}');

-- Oda var mı denetimi (B şu an 'bas_ka' odasında, A 'ki_zlar-2027' ve 'do_nem-6' odalarında)
select tdt.yaz('Oda var mı: başkasının odası "var" görünür', td_oda_var_mi('ki_zlar-2027'));
select tdt.yaz('Oda var mı: uydurma ad "yok" görünür', not td_oda_var_mi('uydurma-oda'));
select tdt.yaz('Oda var mı: yalnızca benim olduğum oda "yok" sayılır (ad boşta)', not td_oda_var_mi('bas_ka'));

-- ===== C: farklı odadaki kişi =====
set request.jwt.claim.sub = :C;
select td_odalari_ayarla(array['Dönem 5'], array['do_nem-5']) is not null;
select tdt.yaz('Farklı odadaki C, A''nın son 10 gününü GÖREMEZ', (select count(*) from son_gunler where uid = :A) = 0);

-- ===== Giriş yapmamış ziyaretçi =====
reset request.jwt.claim.sub; set role anon;
select tdt.yaz('Giriş yapmayan profilleri okuyamaz', tdt.reddedilir($$select count(*) from profiller$$));
select tdt.yaz('Giriş yapmayan özel belgeleri okuyamaz', tdt.reddedilir($$select count(*) from ozel_belgeler$$));

-- ===== Yönetici: kişi çıkarma =====
reset role;
insert into yoneticiler (uid) values (:A) on conflict do nothing;
set role authenticated; set request.jwt.claim.sub = :A;
select tdt.yaz('A yönetici olarak tanınır', td_yonetici_miyim());
select td_kisi_cikar(:B) is null;
select tdt.yaz('Çıkarılan kişinin profili ve oda üyeliği silinir', (select count(*) from profiller where uid = :B) = 0 and (select count(*) from oda_uyeleri where uid = :B) = 0);
set request.jwt.claim.sub = :B;
select tdt.yaz('Çıkarılan kişi engelli görünür', td_engelli_miyim());
select tdt.yaz('Çıkarılan kişi yeniden profil açamaz', tdt.reddedilir($$insert into profiller (uid, veri) values ('22222222-2222-2222-2222-222222222222', '{}')$$));
select tdt.yaz('Çıkarılan kişi odaya giremez', tdt.reddedilir($$select td_odalari_ayarla(array['x'], array['x'])$$));
select tdt.yaz('Çıkarılan kişinin özel kayıtlarına dokunulmaz', (select veri ->> 'goalMin' from ozel_belgeler where uid = :B and belge = 'ayar') = '300');

-- ===== Uyarılar ve bildirim kuyruğu =====
set request.jwt.claim.sub = :A;
select td_abonelik_kaydet('https://push.example/abc', 'p256', 'auth') is null;
select tdt.yaz('http adresli abonelik reddedilir', tdt.reddedilir($$select td_abonelik_kaydet('http://x', 'p', 'a')$$));
select td_uyarilari_ayarla(jsonb_build_array(
  jsonb_build_object('tur', 'mola', 'zaman', (extract(epoch from now()) * 1000)::bigint + 5000, 'dk', 10),
  jsonb_build_object('tur', 'sinir', 'zaman', (extract(epoch from now()) * 1000)::bigint + 3 * 3600 * 1000, 'dk', 180),
  jsonb_build_object('tur', 'uydurma', 'zaman', 1, 'dk', 1))) is null;
select tdt.yaz('Uyarılar kaydedilir, geçersiz tür atlanır', (select count(*) from uyarilar where uid = :A) = 2);
reset request.jwt.claim.sub; set role service_role;
select tdt.yaz('Kuyruk yalnızca vakti gelen uyarıyı, cihaz bilgisiyle verir',
  (select count(*) = 1 and min(tur) = 'mola' and min(dk) = 10 and min(endpoint) = 'https://push.example/abc' from td_vadesi_gelenler()));
select tdt.yaz('Verilen uyarı kuyruktan silinir, gelecekteki kalır', (select count(*) = 1 and min(tur) = 'sinir' from uyarilar));
-- Tekrar: mola uyarısı 2 tekrarla kurulur; her gönderimden sonra 3 dk sonrasına yeniden kurulur, sonra biter
set role authenticated; set request.jwt.claim.sub = :A;
select td_uyarilari_ayarla(jsonb_build_array(
  jsonb_build_object('tur', 'mola', 'zaman', (extract(epoch from now()) * 1000)::bigint + 5000, 'dk', 5, 'tekrar', 2),
  jsonb_build_object('tur', 'sinir', 'zaman', (extract(epoch from now()) * 1000)::bigint + 5000, 'dk', 180, 'tekrar', 4))) is null;
select tdt.yaz('Tekrar hakkı kaydedilir; 3 saat sınırı tekrarlanmaz', (select kalan from uyarilar where uid = :A and tur = 'mola') = 2 and (select kalan from uyarilar where uid = :A and tur = 'sinir') = 0);
reset request.jwt.claim.sub; set role service_role;
create temp table t1 as select * from td_vadesi_gelenler();
select tdt.yaz('İlk gönderim: sıra 0', (select count(*) = 2 and max(sira) = 0 from t1));
select tdt.yaz('Mola uyarısı 5 dk sonrasına yeniden kuruldu (sıra 1, kalan 1); sınır kurulmadı',
  (select count(*) = 1 and min(tur) = 'mola' and min(sira) = 1 and min(kalan) = 1 and min(zaman) between now() + interval '290 seconds' and now() + interval '310 seconds' from uyarilar));
update uyarilar set zaman = now();
create temp table t2 as select * from td_vadesi_gelenler();
update uyarilar set zaman = now();
create temp table t3 as select * from td_vadesi_gelenler();
select tdt.yaz('Toplam 3 bildirim (sıra 0, 1, 2), sonra kuyruk boş', (select count(*) = 1 and min(sira) = 1 from t2) and (select count(*) = 1 and min(sira) = 2 from t3) and (select count(*) from uyarilar) = 0);
set role authenticated; set request.jwt.claim.sub = :A;
select td_uyarilari_ayarla('[]'::jsonb) is null;
select tdt.yaz('Boş liste bekleyen uyarıları siler', (select count(*) from uyarilar where uid = :A) = 0);
-- Çalışma uyarısı: tekrar yok; gönderilmeden önce son oturum kronometreden yeniden hesaplanır (en az 1 saat)
create temp table calisma_kur (n int);
create or replace function pg_temp.calisma_dene(p_run_dk int, p_mola boolean, p_dk int) returns int language plpgsql as $f$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform td_profil_guncelle(jsonb_build_object('timer', jsonb_build_object('s', 'anatomi', 't', 'konu', 'st', extract(epoch from now()) * 1000 - 5 * 3600000,
    'runStart', case when p_mola then null else extract(epoch from now()) * 1000 - p_run_dk * 60000 end,
    'breakStart', case when p_mola then extract(epoch from now()) * 1000 - 60000 else null end, 'workMs', 120 * 60000)));
  perform td_uyarilari_ayarla(jsonb_build_array(jsonb_build_object('tur', 'calisma', 'zaman', (extract(epoch from now()) * 1000)::bigint + 5000, 'dk', p_dk, 'tekrar', 30)));
  reset role; set local role service_role;
  select count(*) into n from td_vadesi_gelenler() v where v.tur = 'calisma';
  reset role; set local role authenticated;
  return n;
end $f$;
select tdt.yaz('Çalışma uyarısı tekrar hakkıyla kaydedilmez', (select pg_temp.calisma_dene(61, false, 60)) = 1 and (select count(*) from uyarilar where uid = :A and tur = 'calisma') = 0);
select tdt.yaz('Çalışma uyarısı: son oturum 61 dk → gönderilir, tekrar kurulmaz', (select pg_temp.calisma_dene(61, false, 60)) = 1 and (select count(*) from uyarilar where uid = :A) = 0);
select tdt.yaz('Çalışma uyarısı: son oturum 40 dk (önceki 2 saat sayılmaz) → gönderilmez', (select pg_temp.calisma_dene(40, false, 60)) = 0);
select tdt.yaz('Çalışma uyarısı: 30 dk seçilmiş, son oturum 31 dk → gönderilir', (select pg_temp.calisma_dene(31, false, 30)) = 1);
select tdt.yaz('Çalışma uyarısı: 45 dk seçilmiş, son oturum 40 dk → gönderilmez', (select pg_temp.calisma_dene(40, false, 45)) = 0);
select tdt.yaz('Çalışma uyarısı: 90 dk seçilmiş, son oturum 70 dk → gönderilmez', (select pg_temp.calisma_dene(70, false, 90)) = 0);
select tdt.yaz('Çalışma uyarısı: kişi moladaysa gönderilmez', (select pg_temp.calisma_dene(61, true, 60)) = 0);
set role authenticated; set request.jwt.claim.sub = :A;
select td_profil_guncelle('{"timer":null}') is not null;

-- ===== Birleştirerek yazma (asla üzerine yazmaz) =====
set role authenticated; set request.jwt.claim.sub = :A;
select td_ozel_birlestir('elle-2026-01', '{"entries":{"x1":{"m":10}}}') is not null;
select td_ozel_birlestir('elle-2026-01', '{"entries":{"x2":{"m":20}}}') is not null;
select tdt.yaz('Birleştir: belge yoksa oluşturur, varsa iki kayıt da kalır',
  (select veri from ozel_belgeler where uid = :A and belge = 'elle-2026-01') = '{"entries":{"x1":{"m":10},"x2":{"m":20}}}'::jsonb);
select tdt.yaz('Birleştir: geçersiz yama reddedilir', tdt.reddedilir($$select td_ozel_birlestir('elle-2026-01', '[1]')$$));
set request.jwt.claim.sub = :C;
select td_ozel_birlestir('elle-2026-01', '{"entries":{"c1":{"m":5}}}') is not null;
select tdt.yaz('Birleştir: başkasının belgesine dokunamaz (kendi belgesini oluşturur)',
  (select count(*) from ozel_belgeler where belge = 'elle-2026-01' and uid = :A and veri::text like '%c1%') = 0);
-- ===== Günlük yedek =====
reset request.jwt.claim.sub; set role service_role;
select tdt.yaz('Günlük yedek alınıyor', td_gunluk_yedek() >= 3);
reset role;
create or replace function tdt.bos_ya_da_yasak(q text) returns boolean language plpgsql as $f$
declare n int; begin execute q into n; return n = 0; exception when others then return true; end $f$;
set role authenticated; set request.jwt.claim.sub = :A;
select tdt.yaz('Kullanıcı yedek tablosunu okuyamaz', tdt.bos_ya_da_yasak('select count(*) from ozel_yedek'));
select tdt.yaz('Kullanıcı yedekten geri alma işlevini çağıramaz', tdt.reddedilir($$select td_yedekten_geri_al('11111111-1111-1111-1111-111111111111', current_date)$$));
select td_ozel_birlestir('elle-2026-01', '{"entries":{"x1":null}}') is not null;
reset request.jwt.claim.sub; set role service_role;
select td_yedekten_geri_al('11111111-1111-1111-1111-111111111111', current_date) is not null;
select tdt.yaz('Yedekten geri alma: kaybolan kayıt döner, sonradan eklenen kalır',
  (select (veri #> '{entries,x1,m}')::int = 10 and (veri #> '{entries,x2,m}')::int = 20 from ozel_belgeler where uid = '11111111-1111-1111-1111-111111111111' and belge = 'elle-2026-01'));
set role authenticated; set request.jwt.claim.sub = :A;

-- ===== Tebrik ve dürtme =====
reset role; reset request.jwt.claim.sub;
insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444','d@x'), ('55555555-5555-5555-5555-555555555555','e@x'),
  ('66666666-6666-6666-6666-666666666666','f@x'), ('77777777-7777-7777-7777-777777777777','g@x'),
  ('88888888-8888-8888-8888-888888888888','h@x') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; insert into profiller (uid, veri) values (auth.uid(), '{"nick":"Deniz"}'); select td_odalari_ayarla(array['Etk Odası'], array['etk-odasi']) is not null;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555'; select td_odalari_ayarla(array['Etk Odası'], array['etk-odasi']) is not null;
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666'; insert into profiller (uid, veri) values (auth.uid(), '{"nick":"Fatma"}'); select td_odalari_ayarla(array['etk odası'], array['etk-odasi']) is not null;
set request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888'; insert into profiller (uid, veri) values (auth.uid(), '{"nick":"Hakan"}'); select td_odalari_ayarla(array['Etk Odası'], array['etk-odasi']) is not null;
set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777'; select td_odalari_ayarla(array['Başka'], array['bas_ka-2']) is not null;
-- Deniz → Emre (Emre'nin profili yok: çalışmıyor sayılır)
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select tdt.yaz('Tebrik: ortak odadakine gider', td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'tebrik') = 'tamam');
select tdt.yaz('Tebrik: aynı kişiye günde 1', td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'tebrik') = 'zaten');
select tdt.yaz('Ortak odası olmayana gönderilemez', td_etkilesim_gonder('77777777-7777-7777-7777-777777777777', 'tebrik') = 'ortak_oda_yok');
select tdt.yaz('Kendine gönderilemez', tdt.reddedilir($$select td_etkilesim_gonder('44444444-4444-4444-4444-444444444444', 'tebrik')$$));
select tdt.yaz('Geçersiz tür reddedilir', tdt.reddedilir($$select td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'kalp')$$));
select tdt.yaz('Çalışmayana tebrik: bildirim gidecek', (select bildirim_bekliyor from etkilesimler where gonderen = auth.uid() and tur = 'tebrik' limit 1));
select tdt.yaz('Etkileşim tablosuna doğrudan yazılamaz', tdt.reddedilir($$insert into etkilesimler (gonderen, alici, tur, oda, gun) values ('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','tebrik','x', current_date)$$));
-- Emre çalışmaya başlar
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
insert into profiller (uid, veri) values (auth.uid(), '{"nick":"Emre","timer":{"s":"anatomi","t":"konu","st":1,"runStart":1,"workMs":0,"breakStart":null,"breakMs":0}}');
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select tdt.yaz('Çalışana tebrik gider', td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'tebrik') = 'tamam');
select tdt.yaz('Çalışana tebrik bildirimi GİTMEZ (molada uygulamada görür)', not (select bildirim_bekliyor from etkilesimler where gonderen = auth.uid() and tur = 'tebrik' limit 1));
select tdt.yaz('Çalışan dürtülemez', td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'durt') = 'calisiyor');
select tdt.yaz('Oda arkadaşı tebrik sayısını görür (bugün 2, toplam 2)', (select bugun = 2 and toplam = 2 from tebrik_ozet where uid = '55555555-5555-5555-5555-555555555555'));
select tdt.yaz('Gönderen yalnızca kendi gönderdiğini görür (Deniz''inkini görmez)', (select count(*) from etkilesimler) = 1);
-- Emre bırakır; dürtme sınırı
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
update profiller set veri = jsonb_set(veri, '{timer}', 'null') where uid = auth.uid();
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select tdt.yaz('Çalışmayan dürtülür (1. dürtme)', td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'durt') = 'tamam');
select tdt.yaz('Aynı kişi aynı kişiyi günde 1 kez dürter', td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'durt') = 'zaten');
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select tdt.yaz('2. dürtme (başka kişiden) gider', td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'durt') = 'tamam');
set request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';
select tdt.yaz('Bir kişi günde en çok 2 dürtme alır (3. reddedilir)', td_etkilesim_gonder('55555555-5555-5555-5555-555555555555', 'durt') = 'hak_doldu');
select tdt.yaz('Durum: Hakan için dürtme sayısı 2, kendi tebriği yok', (select (d ->> 'durtSayisi')::int = 2 and not (d ->> 'tebrik')::boolean and (d ->> 'ortak')::boolean from (select td_etkilesim_durum('55555555-5555-5555-5555-555555555555') d) x));
-- Fatma dürtmeleri kapatır
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select td_ozel_birlestir('ayar', '{"durtmeKapali":true}') is not null;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select tdt.yaz('Dürtmeleri kapatan dürtülemez', td_etkilesim_gonder('66666666-6666-6666-6666-666666666666', 'durt') = 'kapali');
select tdt.yaz('Durum: dürtmeleri kapalı görünür', (select (td_etkilesim_durum('66666666-6666-6666-6666-666666666666') ->> 'durtmeKapali')::boolean));
-- Başka odadaki kişi
set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
select tdt.yaz('Başka odadaki kişi tebrik sayısını göremez', (select count(*) from tebrik_ozet where uid = '55555555-5555-5555-5555-555555555555') = 0);
select tdt.yaz('Başka odadaki kişi etkileşimleri göremez', (select count(*) from etkilesimler) = 0);
-- Alıcı: gelenleri görür ve görüldü yapar
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select tdt.yaz('Alıcı gelen 4 etkileşimi görür (2 tebrik, 2 dürtme)', (select count(*) from etkilesimler where alici = auth.uid()) = 4);
select td_etkilesim_goruldu((select array_agg(id) from etkilesimler where alici = auth.uid() and tur = 'tebrik')) is null;
select tdt.yaz('Görüldü işaretlenir', (select count(*) from etkilesimler where alici = auth.uid() and goruldu) = 2);
select td_abonelik_kaydet('https://push.example/emre', 'p256', 'auth') is null;
select tdt.yaz('Kullanıcı bildirim kuyruğunu çağıramaz', tdt.reddedilir($$select * from td_bekleyen_etkilesimler()$$));
reset request.jwt.claim.sub; set role service_role;
create temp table eb as select * from td_bekleyen_etkilesimler();
select tdt.yaz('Bildirim kuyruğu: gönderen adı ve alıcının oda adıyla, yalnızca bildirimi bekleyenler',
  (select count(*) >= 2 and bool_and(gonderen_ad in ('Deniz', 'Fatma')) and bool_and(oda_ad = 'Etk Odası') and bool_and(endpoint = 'https://push.example/emre') from eb)
  and not exists (select 1 from eb where tur = 'tebrik' and gonderen_ad = 'Fatma'));
select tdt.yaz('Gönderilen bildirim kuyruktan düşer', (select count(*) from td_bekleyen_etkilesimler()) = 0);
set role authenticated; set request.jwt.claim.sub = :A;

-- ===== Günde 5 saat: uygulamanın tebriki =====
set request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
insert into profiller (uid, veri) values ('77777777-7777-7777-7777-777777777777', '{"nick":"Gül"}') on conflict do nothing;
select td_ozel_birlestir('kron-' || to_char(td_bugun(), 'YYYY-MM'), jsonb_build_object('entries', jsonb_build_object(
  'h1', jsonb_build_object('d', td_bugun()::text, 'm', 120, 's', 'anatomi', 't', 'konu'),
  'h2', jsonb_build_object('d', td_bugun()::text, 'm', 80, 's', 'anatomi', 't', 'konu'),
  'h3', jsonb_build_object('d', (td_bugun() - 1)::text, 'm', 400, 's', 'anatomi', 't', 'konu'),
  'h4', jsonb_build_object('d', td_bugun()::text, 'm', 200, 's', 'anatomi', 't', 'konu', 'del', 1),
  'h5', jsonb_build_object('d', td_bugun()::text, 'm', 'çok', 's', 'anatomi', 't', 'konu')))) is not null;
select tdt.yaz('5 saat: 200 dk (dünkü, silinen ve bozuk kayıt sayılmaz) → verilmez', td_hedef_tebrik() = 'yetersiz' and not exists (select 1 from etkilesimler where alici = auth.uid()));
select td_profil_guncelle(jsonb_build_object('timer', jsonb_build_object('s', 'anatomi', 't', 'konu', 'st', extract(epoch from now()) * 1000 - 60 * 60000, 'runStart', extract(epoch from now()) * 1000 - 60 * 60000, 'workMs', 0))) is not null;
select tdt.yaz('5 saat: 200 dk + işleyen kronometrede 60 dk → yine verilmez', td_hedef_tebrik() = 'yetersiz');
select td_profil_guncelle(jsonb_build_object('timer', jsonb_build_object('s', 'anatomi', 't', 'konu', 'st', extract(epoch from now()) * 1000 - 130 * 60000, 'runStart', extract(epoch from now()) * 1000 - 30 * 60000, 'workMs', 72 * 60000))) is not null;
select tdt.yaz('5 saat: 200 dk + kronometrede 102 dk → tebrik verilir', td_hedef_tebrik() = 'tamam');
select tdt.yaz('5 saat: aynı gün ikinci kez verilmez', td_hedef_tebrik() = 'zaten' and (select count(*) from etkilesimler where alici = auth.uid()) = 1);
select tdt.yaz('5 saat tebriki: gönderen yok, bildirim kuyruğuna girmez, toplam ve bugün 1 artar',
  (select gonderen is null and tur = 'tebrik' and not bildirim_bekliyor from etkilesimler where alici = auth.uid())
  and (select toplam = 1 and bugun = 1 from tebrik_ozet where uid = auth.uid()));
select tdt.yaz('5 saat tebriki kayıtlara dokunmaz', (select count(*) from jsonb_object_keys((select veri -> 'entries' from ozel_belgeler where uid = auth.uid() and belge = 'kron-' || to_char(td_bugun(), 'YYYY-MM')))) = 5);
select tdt.yaz('Uygulama tebriki elle eklenemez', tdt.reddedilir($$insert into etkilesimler (gonderen, alici, tur, oda, gun) values (null, '77777777-7777-7777-7777-777777777777', 'tebrik', '', td_bugun())$$));
set role authenticated; set request.jwt.claim.sub = :A;

-- ===== Boyut sınırı =====
select tdt.yaz('Aşırı büyük profil reddedilir',
  tdt.reddedilir($$update profiller set veri = jsonb_build_object('x', (select string_agg(md5(i::text), '') from generate_series(1, 4000) i)) where uid = auth.uid()$$));
reset role;
