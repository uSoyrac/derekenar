# Derkenar (Mac): her uygulamada seç, renk ver, kaydet

Menü çubuğunda ve ekranın kenarında duran küçük bir programdır. Sabah bir kez açarsın, arkada
çalışır. Preview'da, Chrome'da, Word'de ya da başka bir uygulamada okurken:

1. Metni seç.
2. Ekranın kenarındaki Derkenar düğmesine (ya da menü çubuğundaki simgeye) bas.
3. Bir renk seç.

Bölüm o rengin kategorisiyle, kaynağıyla (dosya adı ya da sayfa adresi) ve Preview'da sayfa
numarasıyla kütüphanene kaydedilir. Dosya taşımak ya da klasör seçmek gerekmez.

> **Durum:** Uygulama GitHub'ın Mac makinesinde derlenip otomatik sınamalardan geçiyor.
> Başka uygulamadaki seçimi okuma ve sayfa numarasını bulma kısmı ise ancak gerçek bir Mac'te,
> izin verildikten sonra denenebilir; ilk gerçek denemeyi sen yapacaksın.

## Kurulum

1. İndir: <https://github.com/uSoyrac/derekenar/releases/download/mac-latest/Derkenar-mac.zip>
2. Zip'e çift tıkla, çıkan **Derkenar** uygulamasını **Uygulamalar** klasörüne sürükle.
3. İlk açılış: uygulama Apple'a kayıtlı bir geliştirici imzası taşımadığı için macOS uyarır.
   - Derkenar'a çift tıkla, uyarıda **Bitti**'ye bas.
   - **Sistem Ayarları → Gizlilik ve Güvenlik** sayfasının altında "Derkenar engellendi" satırının
     yanındaki **Yine de Aç**'a bas.
   - Bu yalnızca ilk açılışta gerekir.
4. Açılan pencereye **bağlantı kodunu** yapıştır: Derkenar web uygulamasında Ayarlar →
   "Eklenti ve kısayol bağlantısı" → Bağlantı kodu oluştur.
5. macOS **Erişilebilirlik izni** ister: Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik
   listesinde Derkenar'ı aç. Bu izin, başka uygulamadaki seçili metni okuyabilmek için gerekir.
6. Tarayıcıda ilk kayıtta macOS "Derkenar, Google Chrome'u denetlemek istiyor" diye sorar;
   **İzin Ver** de. Bu, sayfanın adresini kaynak olarak yazabilmek içindir.

## Kullanım

| Ne yapmak istiyorsun | Nasıl |
|---|---|
| Seçili metni kaydetmek | Kenar düğmesine bas → renk seç |
| Aynısını menü çubuğundan yapmak | Menü çubuğundaki Derkenar simgesi → renk seç |
| Son kullandığın renkle hemen kaydetmek | ⌃⌥D (Control + Option + D) |
| Düğmeyi taşımak | Sürükle; yeri hatırlanır |
| Düğmeyi gizlemek | Menü çubuğu simgesi → "Kenar düğmesini gizle" |
| Her açılışta kendiliğinden başlatmak | Menü çubuğu simgesi → "Oturum açılışında başlat" |

Renklerin kategori adlarını web uygulamasında Ayarlar → Renk kategorileri'nden verirsin;
Mac uygulaması adları oradan alır.

## Bilinen sınırlar

- Sayfa numarası, Preview'ın pencere başlığındaki "Page 106 of 185" bilgisinden okunur. Bu,
  PDF'in sıra numarasıdır; kitabın basılı sayfa numarasından farklı olabilir.
- Çizim PDF dosyasının içine yazılmaz; alıntı Derkenar'a kaydedilir. Dosyada da renkli iz kalsın
  istersen Preview'ın kendi çizim kalemini kullanıp web uygulamasındaki klasör izlemeyi açabilirsin.
- Uygulama her güncellendiğinde macOS Erişilebilirlik iznini yeniden isteyebilir.
- Seçim okunamayan nadir uygulamalarda Derkenar kısa bir an "Kopyala" komutunu kullanır ve
  panoyu eski haline getirir.
