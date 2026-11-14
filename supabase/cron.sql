-- TusDostum · bildirim zamanlayıcısı
-- ÖNCE: Supabase panelinde Integrations bölümünden "Cron" (pg_cron) ve Database → Extensions'tan "pg_net" açık olmalı.
-- Sonra aşağıdaki İKİ değeri kendi değerlerinle değiştir ve SQL Editor'da çalıştır:
--   PROJE_ADRESI : https://abcdefgh.supabase.co  (config.js'teki supabaseUrl ile aynı)
--   CRON_GIZLI   : Edge Function gizli değerlerine yazdığın CRON_GIZLI ile aynı metin
-- Her dakika çalışır; yalnızca vakti gelmiş bir uyarı varsa bildirim göndericiyi çağırır.

select cron.unschedule(jobid) from cron.job where jobname = 'tusdostum-uyari';

select cron.schedule('tusdostum-uyari', '* * * * *', $cron$
  select net.http_post(
    url := 'PROJE_ADRESI/functions/v1/uyari-gonder',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-gizli', 'CRON_GIZLI'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
  where exists (select 1 from public.uyarilar where zaman <= now() + interval '20 seconds')
     or exists (select 1 from public.etkilesimler where bildirim_bekliyor);
$cron$);

-- Denetim: son çalışmaları görmek için
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
-- Durdurmak için
--   select cron.unschedule('tusdostum-uyari');
