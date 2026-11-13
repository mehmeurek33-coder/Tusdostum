#!/usr/bin/env bash
# UYGULAMA GÜNCELLEMESİ ÖNCESİ DENETİM: yayındaki sürüm (GitHub deposunun son hali) ile yeni sürüm aynı kayıtlarla açılır;
# kullanıcının gördüğü bütün istatistikler ve kayıtlar birebir aynı olmalı, sunucudaki veri değişmemeli.
# Kullanım: araclar/yayin-oncesi.sh <yayındaki_sürümün_klasörü>
set -euo pipefail
cd "$(dirname "$0")/.."
ESKI="${1:?yayındaki sürümün klasörü gerekli}"
python3 yap.py
node test/surum-karsilastir.js "$ESKI" .
