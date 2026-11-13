// TusDostum · yapılandırma
// Buradaki değerler GİZLİ DEĞİLDİR; tarayıcıya gönderilir. Gizli anahtarları (service_role, VAPID özel anahtarı) buraya yazma.
// Değerlerin nereden alınacağı KURULUM.md dosyasında anlatılıyor.
window.TUSDOSTUM_AYAR = {
  supabaseUrl: "https://eodvumyhmgerifphkkfp.supabase.co",        // ör. https://abcdefgh.supabase.co
  supabaseAnahtar: "sb_publishable_R9bTqqAlk-wflZj_gaZdrA_BqXlO6ny",    // "anon" ya da "publishable" anahtar
  vapidAcikAnahtar: "BKGF6C0V8QQ7iDuU7mdmFNWLFR6jOT-lx0nmPvqTZF1qvMWlEWifUPVrTU66QAZD0YtTM1TlAWgRWw0foV1-cTE",                      // bildirimler için; anahtar.html sayfası üretir (boşsa bildirim kapalı)
  google: false,                             // Google ile giriş düğmesi (Supabase'de Google sağlayıcısı açıldıysa true)
  epostaGonderimi: false,                    // "Şifremi unuttum" düğmesi (Supabase'e kendi e-posta sunucun bağlandıysa true)
};
