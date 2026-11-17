# Mac kısayolu: her uygulamada seç ve kaydet

Bu araç, Mac'te herhangi bir uygulamada (Preview, Word, Kitaplar, Safari) seçtiğin metni
tek tuşla Derkenar'a gönderir. macOS'in "Servisler" özelliğini kullanır; ek bir program kurmaz.

> **Durum:** Bu betik Mac üzerinde denenmedi (geliştirme ortamı Linux'tu). Sunucu tarafı
> otomatik testlerle doğrulandı; Mac tarafındaki ilk denemeyi sen yapacaksın. Sorun çıkarsa
> hata bildirimini ilet, düzeltelim.

Preview'da PDF okurken bu kısayola çoğu zaman ihtiyacın olmaz: altını çiz, dosyayı kaydet,
Derkenar'ın **klasör izleme** özelliği çizimi sayfa numarasıyla kendiliğinden alır.
Kısayol, çizim yapılamayan yerler ve anında kaydetmek istediğin durumlar içindir.

## 1. Bağlantı kodunu kaydet

1. Derkenar'da **Ayarlar → Eklenti ve kısayol bağlantısı → Bağlantı kodu oluştur**'a bas, kodu kopyala.
2. Terminal'i aç ve şunu çalıştır (panodaki kodu `~/.derkenar` dosyasına yazar):

```bash
pbpaste > ~/.derkenar && chmod 600 ~/.derkenar
```

## 2. Hızlı İşlem oluştur

1. **Automator**'ı aç → **Yeni Belge** → **Hızlı İşlem** (Quick Action).
2. Üstte: "İş akışının aldığı:" → **metin**, "şurada:" → **herhangi bir uygulama**.
3. Soldaki listeden **JavaScript Çalıştır** eylemini sağa sürükle.
4. Kutudaki örnek kodu sil, `derkenar-servis.js` dosyasının tamamını yapıştır.
5. **Dosya → Kaydet**, ad: `Derkenar'a kaydet`.

## 3. Tuş ata

**Sistem Ayarları → Klavye → Klavye Kestirmeleri → Servisler → Metin** altında
"Derkenar'a kaydet"i bul ve bir kestirme ata (örnek: ⌃⌥S).

## Kullanım

Metni seç, kestirmeye bas (ya da sağ tık → Servisler → Derkenar'a kaydet).
Sağ üstte "Kaydedildi" bildirimi çıkar. İlk kullanımda macOS, Automator'ın diğer
uygulamaları denetlemesine izin isteyebilir; kaynak adını okuyabilmesi için izin ver.

Kaynak bilgisi şöyle belirlenir:

| Uygulama | Kaydedilen kaynak |
|---|---|
| Preview | PDF'in dosya adı (aynı PDF içe aktarıldıysa onun kaynağına bağlanır) |
| Chrome, Edge, Brave, Arc, Safari | Sayfanın adresi ve başlığı |
| Diğer | Pencere başlığı |

Kısayolla gelen alıntıda sayfa numarası olmaz; sayfa numarası için çizip klasör izlemeyi kullan.
