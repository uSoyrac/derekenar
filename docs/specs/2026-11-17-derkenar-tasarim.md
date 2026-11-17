# Derkenar: tasarım kararları

Tarih: 17 Kasım 2026

## Amaç

Farklı cihaz ve uygulamalarda okurken çizilen/seçilen bölümleri ve notları, kaynak ve sayfa
bilgisiyle tek bir veritabanında toplamak; oradan arayıp yazıya aktarmak. Önce tek kullanıcı
(sahibi) için, sonra başkalarına açılabilecek biçimde.

## Kararlar

1. **Her yerden yakala, tek kütüphanede topla.** Kendi okuyucumuz yok; okuma alışkanlığı değişmez.
2. **Çizmek kaydetmektir.** PDF çizimleri dosyanın içinden okunur (sayfa numarasıyla). Seçimi
   anında gönderme (eklenti, paylaş, kısayol) ikinci yoldur.
3. **PDF işleme cihazda yapılır.** Dosya sunucuya yüklenmez; pdf.js ile tarayıcıda okunur,
   taranmış sayfalarda yalnızca çizili bölge tesseract.js ile OCR'dan geçer.
4. **Veri modeli baştan çok kullanıcılı.** Her satır `user_id` taşır; Postgres satır düzeyi
   güvenlik (RLS) yalnızca sahibine erişim verir.
5. **İki sürücü, tek arayüz.** `local` (IndexedDB, hesapsız) ve `cloud` (Supabase). Uygulama tüm
   veriyi belleğe alır, arama/süzme istemcide yapılır; sürücü arayüzü dört işlemden ibarettir
   (`all`, `insert`, `update`, `remove`).
6. **Yinelenme parmak iziyle önlenir.** Kaynak: PDF belge kimliği ya da adres. Alıntı: kaynak +
   sayfa + metin özeti. Aynı PDF'i yeniden içe almak ya da iki cihazdan almak kopya üretmez.
7. **Dış araçlar bağlantı koduyla yazar.** Eklenti ve kısayol oturum açmaz; kullanıcıya bağlı,
   iptal edilebilir bir kodla `capture` fonksiyonunu çağırır. Kodun yalnızca özeti saklanır.
8. **Eklenti gezinti geçmişini sızdırmaz.** Alıntısı olan adreslerin listesi önbelleğe alınır;
   yalnızca o sayfalarda sunucuya soru gider.

## Veri modeli

- `sources`: tür, başlık, yazar, yıl, dergi/yayınevi, adres, dosya adı, parmak izi
- `quotes`: kaynak, metin, not, sayfa, renk, etiketler, projeler, köken, cihaz, parmak izi
- `projects`: ad
- `api_tokens`: bağlantı kodu özeti, ad, son kullanım

## Kapsam dışı (şimdilik)

Kendi PDF okuyucumuz, yerel iOS/Android uygulaması, tarayıcı kapalıyken arka plan taraması,
notlara yapay zekâyla soru sorma, künye bilgisini DOI'den otomatik doldurma.
