#!/usr/bin/env bash
# Sunucu (veritabanı şeması) güncellemesi — kayıtlara dokunulmadığını denetleyerek uygular.
#  1) bütün kullanıcıların özel kayıtlarının parmak izini alır
#  2) günlük yedeği hemen çalıştırır (geri dönüş için)
#  3) supabase/schema.sql'i uygular
#  4) parmak izini yeniden alır; farklıysa ALARM verir (yedekten geri alma komutu KURULUM.md'de)
# Gerekli: REF=<supabase proje kimliği>, api.supabase.com için erişim anahtarı (Claude ortamında vekil ekler;
# kendi bilgisayarında: export SUPABASE_ACCESS_TOKEN=... ).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${REF:?REF gerekli (ör. REF=abcdefgh)}"
yetki=(); [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && yetki=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
q() { python3 -c 'import json,sys;print(json.dumps({"query":sys.stdin.read()}))' | curl -sS --fail-with-body --max-time 180 -X POST "https://api.supabase.com/v1/projects/$REF/database/query" "${yetki[@]}" -H 'Content-Type: application/json' --data-binary @-; }
IZ="select md5(coalesce(string_agg(uid::text || '/' || belge || ':' || veri::text, '|' order by uid, belge), '')) as iz, count(*) as belge from public.ozel_belgeler where belge <> 'kronometre';"
once=$(echo "$IZ" | q); echo "önce : $once"
echo "yedek: $(echo 'select public.td_gunluk_yedek() as yedeklenen;' | q)"
echo "şema : $(q < supabase/schema.sql)"
sonra=$(echo "$IZ" | q); echo "sonra: $sonra"
if [ "$once" != "$sonra" ]; then
  echo "ALARM: kayıtlar değişti! Bugünün yedeğinden geri al (KURULUM.md → Kayıtların güvenliği)." >&2; exit 1
fi
echo "TAMAM: kayıtlar birebir aynı."
