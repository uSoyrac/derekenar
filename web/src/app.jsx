import { useEffect, useState } from 'preact/hooks';
import { Icon } from './ui.jsx';
import { phase, mode, toast, quotes, sources, projects, refresh, init, notify } from './state.js';
import { QuoteList } from './views/feed.jsx';
import { SourcesView, SourceDetail } from './views/sources.jsx';
import { ProjectsView, ProjectDetail } from './views/projects.jsx';
import { SettingsView } from './views/settings.jsx';
import { AuthView } from './views/auth.jsx';
import { ShareView, shareData, sharedFileCount, takeSharedFiles } from './views/share.jsx';
import { AddDialog, addOpen, runImport } from './views/add.jsx';
import { initWatch, watch } from './lib/watch.js';

const parse = () => {
  const [, name = '', id = ''] = location.hash.replace(/^#/, '').split('/');
  return { name, id: decodeURIComponent(id) };
};

const NAV = [
  ['', 'Akış', 'feed'],
  ['kaynaklar', 'Kaynaklar', 'book'],
  ['projeler', 'Projeler', 'folder'],
  ['ayarlar', 'Ayarlar', 'gear'],
];
const SECTION = { '': '', kaynaklar: 'kaynaklar', kaynak: 'kaynaklar', projeler: 'projeler', proje: 'projeler', ayarlar: 'ayarlar' };

export function App() {
  const [route, setRoute] = useState(parse());
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    init().then(() => initWatch()).catch((err) => { console.error(err); notify(`Başlatılamadı: ${err.message}`, 'error'); });
    const onHash = () => { setRoute(parse()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    // Başka cihazdan eklenenleri görmek için pencere öne gelince yenile.
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && phase.value === 'ready' && mode.value === 'cloud' && Date.now() - last > 15000) {
        last = Date.now();
        refresh().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = (e) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); } };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDragging(false);
      if (phase.value === 'ready') runImport(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  // Telefonda başka bir uygulamadan paylaşılan PDF'ler: giriş tamamlanınca içe alınır.
  const ready = phase.value === 'ready';
  useEffect(() => {
    if (!ready || !sharedFileCount.value) return;
    takeSharedFiles().then((files) => {
      if (files.length) runImport(files);
      else notify('Paylaşılan dosya bulunamadı; PDF\'i “Ekle” ile seçebilirsin', 'error');
    });
  }, [ready]);

  const toastEl = toast.value && <div class={`toast ${toast.value.kind}`} role="status">{toast.value.message}</div>;

  if (phase.value === 'boot') return <div class="boot" role="status">Yükleniyor…</div>;
  if (phase.value === 'auth') return <><AuthView />{toastEl}</>;
  if (shareData.value) return <><ShareView />{toastEl}</>;

  const section = SECTION[route.name] ?? '';
  let view;
  if (route.name === 'kaynaklar') view = <SourcesView />;
  else if (route.name === 'kaynak') view = <SourceDetail id={route.id} key={route.id} />;
  else if (route.name === 'projeler') view = <ProjectsView />;
  else if (route.name === 'proje') view = <ProjectDetail id={route.id} key={route.id} />;
  else if (route.name === 'ayarlar') view = <SettingsView />;
  else view = <QuoteList />;

  const counts = { '': quotes.value.length, kaynaklar: sources.value.length, projeler: projects.value.length };

  return (
    <div class="shell">
      <aside class="side">
        <a class="brand" href="#/">Derkenar</a>
        <nav aria-label="Ana menü">
          {NAV.map(([name, label, icon]) => (
            <a key={name} href={`#/${name}`} class={section === name ? 'on' : ''} aria-current={section === name ? 'page' : undefined}>
              <Icon name={icon} /><span>{label}</span>
              {counts[name] !== undefined && <span class="n">{counts[name]}</span>}
            </a>
          ))}
        </nav>
        <div class="side-foot">
          {mode.value === 'local'
            ? <a href="#/ayarlar" class="pill warn">Yalnızca bu cihazda</a>
            : <span class="pill ok">Eşitleniyor</span>}
          {watch.value.state === 'scanning' && <span class="pill">Klasör taranıyor…</span>}
          {watch.value.state === 'needs-permission' && <a href="#/ayarlar" class="pill warn">Klasör izni gerekiyor</a>}
        </div>
      </aside>
      <main class="content">
        <header class="top">
          <h1>{NAV.find(([n]) => n === section)?.[1]}</h1>
          <div class="row">
            <button class="btn" onClick={() => { addOpen.value = 'pdf'; }}><Icon name="upload" /> <span class="hide-sm">PDF içe aktar</span></button>
            <button class="btn primary" onClick={() => { addOpen.value = 'note'; }}><Icon name="plus" /> Ekle</button>
          </div>
        </header>
        {view}
      </main>
      <AddDialog />
      {dragging && <div class="drop-overlay"><div><Icon name="upload" size={40} /><p>PDF'i bırak, çizimlerini alayım</p></div></div>}
      {toastEl}
    </div>
  );
}
