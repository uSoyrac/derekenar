// Ayarlar: hesap ve eşitleme, klasör izleme, bağlantı kodları, sesli not dili, yedek.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui.jsx';
import {
  mode, user, cloudConfig, localLeftover, quotes, getDriver, signOut, showAuth, saveCloudConfig,
  migrateLocalToCloud, exportBackup, importBackup, notify, categoryNames, settingsRow, saveCategoryNames,
} from '../state.js';
import { PALETTE } from '../lib/categories.js';
import { watch, watchSupported, chooseFolder, regrant, scanNow, stopWatch } from '../lib/watch.js';
import { speechLang, setSpeechLang, speechSupported } from '../lib/speech.js';
import { copyText, dateLabel, download, timeLabel } from '../lib/util.js';

function Account() {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [working, setWorking] = useState(false);
  const migrate = async () => {
    setWorking(true);
    try { notify(`${await migrateLocalToCloud()} alıntı hesabına aktarıldı`); } catch (err) { notify(`Aktarılamadı: ${err.message}`, 'error'); }
    setWorking(false);
  };
  if (mode.value === 'cloud') {
    return (
      <section class="card">
        <h3>Hesap ve eşitleme</h3>
        <p><strong>{user.value?.email}</strong> hesabıyla giriş yaptın. Alıntıların bu hesaba bağlı; giriş yaptığın her cihazda aynı kütüphaneyi görürsün.</p>
        {localLeftover.value > 0 && (
          <p class="status info">Bu cihazda hesapsız kaydedilmiş {localLeftover.value} alıntı var.{' '}
            <button class="btn small primary" disabled={working} onClick={migrate}>Hesabıma aktar</button></p>
        )}
        <button class="btn" onClick={signOut}>Çıkış yap</button>
      </section>
    );
  }
  return (
    <section class="card">
      <h3>Hesap ve eşitleme</h3>
      <p class="status warn">Şu an hesapsız kullanıyorsun: {quotes.value.length} alıntı yalnızca bu tarayıcıda duruyor ve diğer cihazlarında görünmez.</p>
      {cloudConfig.value ? (
        <button class="btn primary" onClick={showAuth}>Giriş yap ya da hesap oluştur</button>
      ) : (
        <form class="quote-form" onSubmit={(e) => { e.preventDefault(); saveCloudConfig(url.trim(), key.trim()); }}>
          <p>Cihazlar arası eşitleme için Supabase projenin bilgilerini gir (Project Settings → API).</p>
          <label>Proje adresi<input required type="url" value={url} placeholder="https://xxxx.supabase.co" onInput={(e) => setUrl(e.currentTarget.value)} /></label>
          <label>Yayınlanabilir anahtar (anon / publishable key)<input required value={key} onInput={(e) => setKey(e.currentTarget.value)} /></label>
          <button class="btn primary" type="submit">Bulutu bağla</button>
        </form>
      )}
    </section>
  );
}

function Watch() {
  const w = watch.value;
  if (!watchSupported) {
    return (
      <section class="card"><h3>Klasör izleme</h3>
        <p class="dim">Bu tarayıcı klasör izlemeyi desteklemiyor. Masaüstünde Chrome ya da Edge ile açarsan PDF klasörünü kendiliğinden tarayabilirim; burada PDF'leri “Ekle” ile seçebilirsin.</p>
      </section>
    );
  }
  const pick = async () => {
    try { await chooseFolder(); } catch (err) { if (err?.name !== 'AbortError') notify('Klasör açılamadı', 'error'); }
  };
  const r = w.lastResult;
  return (
    <section class="card">
      <h3>Klasör izleme</h3>
      <p>PDF'lerini tuttuğun klasörü seç. Preview'da ya da başka bir okuyucuda bir yerin altını çizip dosyayı kaydettiğinde, yeni çizimler bu pencere açıkken kendiliğinden kütüphaneye düşer.</p>
      {w.state === 'off' && <button class="btn primary" onClick={pick}><Icon name="folder" /> Klasör seç</button>}
      {w.state !== 'off' && (
        <div class="stack">
          <p><Icon name="folder" size={15} /> <strong>{w.name}</strong>{' '}
            {w.state === 'scanning' && <span class="badge">taranıyor{w.progress ? `: ${w.progress}` : '…'}</span>}
            {w.state === 'needs-permission' && <span class="badge warn">izin gerekiyor</span>}
            {w.state === 'idle' && <span class="badge ok">izleniyor</span>}
          </p>
          {w.lastScan && r && (
            <p class="dim">Son tarama {timeLabel(w.lastScan)}: {r.files} PDF, {r.changed} değişen dosya, {r.added} yeni alıntı{r.errors ? `, ${r.errors} dosya okunamadı` : ''}.</p>
          )}
          <div class="row">
            {w.state === 'needs-permission'
              ? <button class="btn primary" onClick={regrant}>Klasör iznini yenile</button>
              : <button class="btn" disabled={w.state === 'scanning'} onClick={scanNow}>Şimdi tara</button>}
            <button class="btn" onClick={pick}>Klasörü değiştir</button>
            <button class="btn danger" onClick={stopWatch}>İzlemeyi bırak</button>
          </div>
          <p class="dim">Tarayıcı, yeniden açıldığında klasör iznini sorabilir. Uygulamayı yükleyip (adres çubuğundaki kur simgesi) izin sorusunda “Her ziyarette izin ver”i seçersen bir daha sormaz.</p>
        </div>
      )}
    </section>
  );
}

function Tokens() {
  const [tokens, setTokens] = useState(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const driver = getDriver();
  const load = async () => { try { setTokens(await driver.listTokens()); } catch (err) { notify(err.message, 'error'); } };
  useEffect(() => { if (mode.value === 'cloud') load(); }, [mode.value]);
  if (mode.value !== 'cloud') {
    return (
      <section class="card"><h3>Eklenti ve kısayol bağlantısı</h3>
        <p class="dim">Tarayıcı eklentisi ve Mac kısayolu alıntıları hesabına gönderir; bu yüzden önce giriş yapman gerekiyor.</p>
      </section>
    );
  }
  const create = async (e) => {
    e.preventDefault();
    try {
      const token = await driver.createToken(label.trim() || 'Bağlantı');
      const cfg = cloudConfig.value;
      setCode(btoa(JSON.stringify({ u: cfg.url, k: cfg.key, t: token, a: location.origin + location.pathname })));
      setLabel('');
      load();
    } catch (err) { notify(err.message, 'error'); }
  };
  // Mac uygulaması: kod kopyalamadan, derkenar:// adresiyle bağlanır.
  const fromMac = new URLSearchParams(location.search).get('baglan') === 'mac';
  const connectMac = async () => {
    try {
      const token = await driver.createToken('Mac uygulaması');
      const cfg = cloudConfig.value;
      const code = btoa(JSON.stringify({ u: cfg.url, k: cfg.key, t: token, a: location.origin + location.pathname }));
      load();
      history.replaceState(null, '', location.pathname + location.hash);
      location.href = `derkenar://connect?code=${encodeURIComponent(code)}`;
    } catch (err) { notify(err.message, 'error'); }
  };
  const revoke = async (id) => {
    if (!confirm('Bu bağlantı kodu iptal edilsin mi? Onu kullanan eklenti ya da kısayol artık kaydedemez.')) return;
    await driver.revokeToken(id);
    load();
  };
  return (
    <section class="card">
      <h3>Eklenti ve kısayol bağlantısı</h3>
      <div class={`status ${fromMac ? 'info' : ''}`}>
        <p><strong>Mac uygulaması:</strong> Derkenar Mac'inde kuruluysa tek tıkla bağla. Tarayıcı “Derkenar açılsın mı?” diye sorar; izin ver.</p>
        <button class="btn primary" onClick={connectMac}>Mac uygulamasını bağla</button>
      </div>
      <p>Chrome eklentisini bağlamak için bir bağlantı kodu oluştur ve eklentinin ayarına yapıştır.</p>
      <form class="row" onSubmit={create}>
        <input class="grow" value={label} placeholder="Ad (örn. Mac'teki Chrome)" onInput={(e) => setLabel(e.currentTarget.value)} aria-label="Bağlantı adı" />
        <button class="btn primary" type="submit">Bağlantı kodu oluştur</button>
      </form>
      {code && (
        <div class="status info">
          <p>Kod bir kez gösterilir; şimdi kopyala:</p>
          <textarea class="code" readOnly rows={4} value={code} onFocus={(e) => e.currentTarget.select()} data-testid="connection-code" />
          <button class="btn small" onClick={async () => notify((await copyText(code)) ? 'Kod kopyalandı' : 'Kopyalanamadı')}><Icon name="copy" size={14} /> Kopyala</button>
        </div>
      )}
      {tokens?.length > 0 && (
        <ul class="token-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <span><strong>{t.label || 'Bağlantı'}</strong> <span class="dim">· {dateLabel(t.created_at)} · {t.last_used_at ? `son kullanım ${dateLabel(t.last_used_at)}` : 'henüz kullanılmadı'}</span></span>
              <button class="btn small danger" onClick={() => revoke(t.id)}>İptal et</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Categories() {
  const [names, setNames] = useState(() => ({ ...(settingsRow.value?.categories || {}) }));
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await saveCategoryNames(names); notify('Kategori adları kaydedildi'); } catch (err) { notify(`Kaydedilemedi: ${err.message}`, 'error'); }
    setSaving(false);
  };
  return (
    <section class="card">
      <h3>Renk kategorileri</h3>
      <p>Her çizim rengi bir kategoridir. Renklere kendi adını ver (örneğin yeşil için “Yöntem”, pembe için “Eleştiri”). Preview'da o renkle çizdiğin ya da eklentide o rengi seçtiğin her alıntı bu kategoriye düşer.</p>
      <form class="cat-form" onSubmit={save}>
        {PALETTE.map((p) => (
          <label key={p.key}><span class="dot" style={`background:${p.hex}`} /><span class="sr">{p.name}</span>
            <input value={names[p.key] || ''} placeholder={p.name} aria-label={`${p.name} rengin kategori adı`}
              onInput={(e) => setNames({ ...names, [p.key]: e.currentTarget.value })} />
          </label>
        ))}
        <button class="btn primary" type="submit" disabled={saving}>Adları kaydet</button>
      </form>
    </section>
  );
}

function Misc() {
  const [lang, setLang] = useState(speechLang());
  const file = useRef(null);
  const restore = async (e) => {
    const input = e.currentTarget;
    const f = input.files[0];
    if (!f) return;
    try { notify(`${await importBackup(await f.text())} alıntı geri yüklendi`); } catch (err) { notify(err.message, 'error'); }
    input.value = '';
  };
  return (
    <>
      <section class="card">
        <h3>Sesli not</h3>
        {speechSupported ? (
          <label>Konuşma dili
            <select value={lang} onChange={(e) => { setLang(e.currentTarget.value); setSpeechLang(e.currentTarget.value); }}>
              <option value="tr-TR">Türkçe</option><option value="en-US">İngilizce (ABD)</option><option value="en-GB">İngilizce (BK)</option>
              <option value="de-DE">Almanca</option><option value="fr-FR">Fransızca</option>
            </select>
          </label>
        ) : <p class="dim">Bu tarayıcı sesle yazmayı desteklemiyor. Chrome, Edge ya da Safari'de mikrofon düğmeleri görünür.</p>}
        <p class="dim">Ses tanımayı tarayıcın yapar; Chrome'da konuşma, yazıya çevrilmek üzere Google'a gönderilir.</p>
      </section>
      <section class="card">
        <h3>Yedek</h3>
        <p>Bütün kaynaklarını ve alıntılarını tek dosya olarak indirebilir, sonra geri yükleyebilirsin.</p>
        <div class="row">
          <button class="btn" onClick={() => download(`derkenar-yedek-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(), 'application/json')}><Icon name="download" /> Yedeği indir</button>
          <button class="btn" onClick={() => file.current.click()}><Icon name="upload" /> Yedekten geri yükle</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={restore} />
        </div>
      </section>
    </>
  );
}

export function SettingsView() {
  return (
    <div class="settings">
      <Account />
      <Categories />
      <Watch />
      <Tokens />
      <Misc />
    </div>
  );
}
