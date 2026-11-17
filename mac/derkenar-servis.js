// Derkenar: Mac'te herhangi bir uygulamada seçili metni kütüphaneye gönderir.
// Automator'da "Hızlı İşlem" (Quick Action) içine, "JavaScript Çalıştır" eylemine yapıştırılır.
// Kurulum adımları: mac/KURULUM.md
//
// Bağlantı kodu ~/.derkenar dosyasından okunur (Derkenar → Ayarlar → Bağlantı kodu oluştur).

function run(input) {
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;

  function notify(message) {
    app.displayNotification(message, { withTitle: 'Derkenar' });
  }
  function shellQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  var text = (Array.isArray(input) ? input.join('\n') : String(input || '')).trim();
  if (!text) { notify('Seçili metin yok'); return; }

  var conn;
  try {
    conn = JSON.parse(app.doShellScript("tr -d '[:space:]' < ~/.derkenar | base64 -D"));
  } catch (e) {
    notify('Bağlantı kodu okunamadı (~/.derkenar)');
    return;
  }

  // Metnin geldiği uygulamadan kaynak bilgisini al.
  var payload = { text: text, origin: 'shortcut', device: 'Mac', kind: 'other' };
  try {
    var events = Application('System Events');
    var front = events.applicationProcesses.whose({ frontmost: true })[0];
    var name = front.name();
    if (name === 'Preview') {
      var doc = Application('Preview').documents[0];
      payload.file_name = doc.name();
      payload.title = doc.name().replace(/\.pdf$/i, '');
      payload.kind = 'pdf';
    } else if (/^(Google Chrome|Brave Browser|Microsoft Edge|Arc|Chromium)$/.test(name)) {
      var tab = Application(name).windows[0].activeTab();
      payload.url = tab.url();
      payload.title = tab.title();
      payload.kind = 'web';
    } else if (name === 'Safari') {
      var page = Application('Safari').documents[0];
      payload.url = page.url();
      payload.title = page.name();
      payload.kind = 'web';
    } else {
      payload.title = front.windows[0].name() || name;
    }
  } catch (e) {
    // Kaynak bilgisi alınamadıysa alıntı kaynaksız kaydedilir.
  }
  if (payload.url) payload.url = String(payload.url).split('#')[0];
  if (payload.url && !/^https?:/.test(payload.url)) delete payload.url;

  var body = JSON.stringify({ p_token: conn.t, p_payload: payload });
  try {
    var out = app.doShellScript(
      'curl -sS -m 20 -X POST ' + shellQuote(conn.u + '/rest/v1/rpc/capture') +
      ' -H ' + shellQuote('apikey: ' + conn.k) +
      ' -H ' + shellQuote('Authorization: Bearer ' + conn.k) +
      " -H 'Content-Type: application/json' --data-binary " + shellQuote(body)
    );
    var res = JSON.parse(out);
    if (res.quote_id) notify(res.duplicate ? 'Bu alıntı zaten kayıtlıydı' : 'Kaydedildi');
    else notify('Kaydedilemedi: ' + (res.message || 'bilinmeyen hata'));
  } catch (e) {
    notify('Sunucuya ulaşılamadı');
  }
}
