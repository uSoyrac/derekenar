// Projeler: bir yazı için kullanılacak alıntıları toplamak.
import { useState } from 'preact/hooks';
import { Empty, Icon } from '../ui.jsx';
import { QuoteList } from './feed.jsx';
import { projects, quotes, projectById, addProject, deleteProject, notify } from '../state.js';

export function ProjectsView() {
  const [name, setName] = useState('');
  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const p = await addProject(name);
    setName('');
    location.hash = `#/proje/${p.id}`;
  };
  const counts = new Map();
  for (const q of quotes.value) for (const id of q.project_ids || []) counts.set(id, (counts.get(id) || 0) + 1);
  return (
    <section>
      <form class="toolbar" onSubmit={create}>
        <input class="grow" value={name} placeholder="Yeni proje adı (örn. Öz-yeterlik makalesi)" onInput={(e) => setName(e.currentTarget.value)} aria-label="Yeni proje adı" />
        <button class="btn primary" type="submit"><Icon name="plus" /> Proje oluştur</button>
      </form>
      {projects.value.length === 0 && (
        <Empty title="Henüz proje yok">Proje, bir yazıda kullanacağın alıntıları bir araya getirir. Oluşturduktan sonra akıştaki klasör simgesiyle alıntı ekleyebilirsin.</Empty>
      )}
      <ul class="source-list">
        {[...projects.value].sort((a, b) => a.name.localeCompare(b.name, 'tr')).map((p) => (
          <li key={p.id}><a href={`#/proje/${p.id}`}>
            <span class="kind"><Icon name="folder" size={14} /></span>
            <span class="title">{p.name}</span><span class="sub" />
            <span class="num">{counts.get(p.id) || 0} alıntı</span><span class="sub date" />
          </a></li>
        ))}
      </ul>
    </section>
  );
}

export function ProjectDetail({ id }) {
  const project = projectById.value.get(id);
  if (!project) return <Empty title="Proje bulunamadı"><a href="#/projeler">Projelere dön</a></Empty>;
  const list = quotes.value.filter((q) => (q.project_ids || []).includes(id));
  const remove = async () => {
    if (!confirm(`“${project.name}” projesi silinsin mi? Alıntılar silinmez.`)) return;
    await deleteProject(id);
    notify('Proje silindi');
    location.hash = '#/projeler';
  };
  return (
    <section>
      <a class="back" href="#/projeler"><Icon name="back" /> Projeler</a>
      <header class="source-head">
        <h2 class="page-title">{project.name}</h2>
        <button class="btn danger" onClick={remove}><Icon name="trash" /> Projeyi sil</button>
      </header>
      <QuoteList base={list} title={project.name}
        emptyText="Akışta bir alıntının klasör simgesine basıp bu projeyi işaretle." />
    </section>
  );
}
