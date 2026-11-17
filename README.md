# Derkenar

Okurken altını çizdiklerin ve notların, bütün cihazlarında tek bir hafızada.

Derkenar, okuma alışkanlığını değiştirmeden çalışır: PDF'i Preview'da çizmeye, web sayfasını
Chrome'da okumaya devam edersin. Çizdiğin ve seçtiğin yerler kaynak ve sayfa bilgisiyle
tek bir kütüphaneye düşer; oradan arar, etiketler, projelere ayırır ve Word'e aktarırsın.

## Parçalar

| Parça | Klasör | Ne yapar |
|---|---|---|
| Web uygulaması | `web/` | Kütüphane. PDF'ten çizimleri alır (taranmış sayfalarda OCR), klasör izler, sesle not alır, Word/Markdown'a aktarır. Telefona ve bilgisayara uygulama olarak kurulabilir. |
| Veritabanı | `supabase/` | Supabase (Postgres) şeması, erişim kuralları ve yakalama fonksiyonları. |
| Chrome eklentisi | `extension/` | Web sayfasında ya da Chrome'da açılan PDF'te seçimi kaydeder; yan panelde o sayfanın alıntılarını gösterir. |
| Mac kısayolu | `mac/` | Herhangi bir Mac uygulamasında seçili metni tek tuşla gönderir. |
| Testler | `tests/` | Şema, web uygulaması, eklenti ve Mac betiği için otomatik testler. |

## Nasıl yakalanır

| Nerede okuyorsun | Ne yaparsın | Sayfa no |
|---|---|---|
| Mac/PC'de PDF (Preview, Acrobat vb.) | Her zamanki gibi altını çiz, kaydet. İzlenen klasördeyse kendiliğinden düşer; değilse PDF'i uygulamaya sürükle. | Var |
| Chrome'da web sayfası | Kenardaki Derkenar düğmesiyle çizim kipini aç; seçtiğin her yer kendiliğinden kaydedilir. Kip kapalıyken: seç → sağ tık → "Derkenar'a kaydet" (ya da Alt+Shift+S, ya da yan panel). | Yok |
| Chrome'da açılan PDF | Seç → sağ tık → "Derkenar'a kaydet". | Yok |
| Android, web ya da herhangi bir uygulama | Seç → Paylaş → Derkenar. | Elle |
| Android, çizim yapabilen bir PDF uygulaması | Okurken çiz; sonra dosyayı Paylaş → Derkenar. Çizimler içe alınır. | Var |
| Mac'te başka uygulama | Seç → kısayol tuşu (bkz. `mac/KURULUM.md`). | Yok |
| Basılı kitap | Uygulamada "Ekle" → yaz ya da mikrofonla söyle. | Elle |

## Renk kategorileri

Beş çizim rengi (sarı, yeşil, mavi, pembe, mor) beş kategoridir; adlarını Ayarlar → Renk
kategorileri'nden verirsin. Preview'da o renkle çizdiğin, eklentide o rengi seçtiğin ya da elle
o rengi işaretlediğin her alıntı o kategoriye düşer. Akışta renge göre süzüp dışa aktarabilirsin.

## Kurulum

### 1. Veritabanı (Supabase)

1. [supabase.com](https://supabase.com) panelinde yeni bir proje oluştur (bölge: Frankfurt önerilir).
2. **SQL Editor**'ı aç; `supabase/migrations/` altındaki dosyaları sırayla (`0001_init.sql`, `0002_categories.sql`) yapıştırıp çalıştır.
3. **Project Settings → API** sayfasından iki değeri not al: proje adresi (`https://xxxx.supabase.co`)
   ve yayınlanabilir anahtar (publishable / anon key). Bu anahtar gizli değildir; veriyi satır
   düzeyindeki erişim kuralları korur.

### 2. Web uygulamasını yayınla

```bash
cd web
npm install
npm run build
```

`web/dist/config.json` dosyasına 1. adımdaki iki değeri yaz:

```json
{ "supabaseUrl": "https://xxxx.supabase.co", "supabaseKey": "sb_publishable_..." }
```

`web/dist` klasörünü HTTPS sunan herhangi bir statik barındırıcıya yükle (Netlify, Cloudflare Pages,
Vercel, GitHub Pages). En kısa yol: klasörü [app.netlify.com/drop](https://app.netlify.com/drop)
sayfasına sürüklemek.

**GitHub Pages ile:** depo GitHub'daysa `.github/workflows/deploy.yml` her gönderimde uygulamayı
derleyip yayınlar. Bir kez Settings → Pages → Source = "GitHub Actions" seç; Supabase bilgilerini
depo değişkenleri olarak gir (`SUPABASE_URL`, `SUPABASE_KEY`). Ücretsiz planda Pages için deponun
herkese açık olması gerekir.

Sonra Supabase'de **Authentication → URL Configuration → Site URL** alanına uygulamanın adresini yaz;
hesap onay e-postasındaki bağlantı doğru yere dönsün.

`config.json` boş bırakılırsa uygulama hesapsız kipte çalışır: veriler yalnızca o tarayıcıda durur.

### 3. Cihazlar

- **Mac / PC:** Uygulamayı Chrome'da aç, hesap oluştur. Adres çubuğundaki kur simgesiyle uygulama
  olarak yükle. **Ayarlar → Klasör izleme**'den PDF klasörünü seç.
- **Android:** Uygulamayı Chrome'da aç, giriş yap, menüden "Uygulamayı yükle"yi seç. Bundan sonra
  herhangi bir uygulamada metni seçip **Paylaş → Derkenar** diyebilirsin.
- **Chrome eklentisi:** `chrome://extensions` → Geliştirici modu → "Paketlenmemiş öğe yükle" →
  `extension/` klasörü. Derkenar'da **Ayarlar → Bağlantı kodu oluştur**, kodu eklentinin ayar
  sayfasına yapıştır. Bilgisayardaki PDF dosyaları için eklenti ayrıntılarında
  "Dosya URL'lerine erişime izin ver"i aç.
- **Mac kısayolu:** `mac/KURULUM.md`.
- **iPad / iPhone:** Uygulama Safari'de çalışır ve ana ekrana eklenebilir. iOS, web uygulamalarını
  Paylaş menüsüne almadığı için seçimi doğrudan gönderme yoktur; PDF'i "Ekle" ile seçip çizimlerini
  alabilir, notu elle ya da sesle ekleyebilirsin.

## Bilinen sınırlar

- **Klasör izleme, Derkenar açıkken çalışır.** Pencere arkada ya da simge durumunda olabilir;
  tarama dakikada bir sürer, pencere öne gelince hemen yenilenir. Derkenar tamamen kapalıyken
  tarama yapılmaz; yeniden açıldığında aradaki çizimler alınır. Yalnızca masaüstü Chrome ve
  Edge'de vardır.
- **OCR, çizilen bölgeyi okur.** Taranmış sayfada yalnızca çizimin altındaki satırlar metne
  çevrilir (Türkçe ve İngilizce). Düşük çözünürlüklü taramalarda hata olabilir; alıntıyı
  "Düzenle" ile düzeltebilirsin.
- **Sayfa numarası yalnızca PDF çizimlerinde otomatik gelir.** PDF kendi sayfa etiketlerini
  taşıyorsa (ör. dergi makalesinde 233) o kullanılır, yoksa sıra numarası.
- **Sesli not, tarayıcının ses tanımasına dayanır.** Chrome'da konuşma yazıya çevrilmek üzere
  Google'a gider. Firefox'ta yoktur.
- **Mac kısayolu Mac üzerinde henüz denenmedi**; sunucuyla konuşan kısmı test edildi.
- **Çizim uzatılırsa** eski ve yeni hali iki ayrı alıntı olarak durur; eskisini elle silebilirsin.

## Geliştirme ve test

```bash
cd web && npm install && npm run dev      # geliştirme sunucusu
cd tests && npm install && npm install -D playwright && npx playwright install chromium && npm test   # bütün testler
```

Gerçek Supabase projesine karşı duman testi ayrıdır ve onaylı bir deneme hesabı ister:
`LIVE_URL=... LIVE_KEY=... LIVE_EMAIL=... LIVE_PASSWORD=... node tests/live.mjs`

Testler gerçek bir Chromium'da çalışır. Bulut tarafı, `supabase/migrations` altındaki SQL'i
gerçek Postgres (PGlite) üzerinde çalıştıran yerel bir taklide karşı sınanır; böylece erişim
kuralları ve yakalama fonksiyonları ağ olmadan doğrulanır.
