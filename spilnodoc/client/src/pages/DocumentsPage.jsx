import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { Header, Modal, Field, ROLE_NAMES, formatDate } from '../components/common.jsx';

const FILTERS = [
  { key: 'all', label: 'Усі' },
  { key: 'own', label: 'Мої' },
  { key: 'shared', label: 'Надані мені' },
];

export function DocumentsPage() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = () => api.listDocuments().then((r) => setDocs(r.documents)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (!docs) return [];
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter === 'own' && d.role !== 'owner') return false;
      if (filter === 'shared' && d.role === 'owner') return false;
      return !q || d.title.toLowerCase().includes(q);
    });
  }, [docs, filter, search]);

  async function confirmDelete() {
    try {
      await api.deleteDocument(toDelete.id);
      setDocs(docs.filter((d) => d.id !== toDelete.id));
    } catch (e) {
      setError(e.message);
    }
    setToDelete(null);
  }

  return (
    <>
      <Header />
      <main className="page">
        <div className="page-head">
          <div>
            <h1>Документи</h1>
            <p className="muted">Ваші документи та документи, до яких вам надали доступ</p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Новий документ</button>
        </div>

        <div className="toolbar">
          <div className="tabs" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'tab active' : 'tab'} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <input className="search" placeholder="Пошук за назвою…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {error && <div className="alert">{error}</div>}
        {!docs && !error && <p className="muted">Завантаження…</p>}
        {docs && visible.length === 0 && (
          <div className="empty">
            <p>{docs.length === 0 ? 'У вас ще немає документів.' : 'Нічого не знайдено.'}</p>
            {docs.length === 0 && <button className="btn btn-primary" onClick={() => setCreating(true)}>Створити перший документ</button>}
          </div>
        )}

        <div className="doc-grid">
          {visible.map((d) => (
            <article key={d.id} className="doc-card" onClick={() => navigate(`/documents/${d.id}`)}>
              <div className="doc-card-top">
                <span className={`badge badge-${d.role}`}>{ROLE_NAMES[d.role]}</span>
                {d.online > 0 && <span className="online-dot" title="Зараз редагують">● {d.online} онлайн</span>}
              </div>
              <h3>{d.title}</h3>
              <dl className="doc-meta">
                <div><dt>Власник</dt><dd>{d.owner_name}</dd></div>
                <div><dt>Змінено</dt><dd>{formatDate(d.updated_at)}</dd></div>
                <div><dt>Обсяг</dt><dd>{d.length} симв. · ревізія {d.revision}</dd></div>
              </dl>
              {d.role === 'owner' && (
                <button className="btn btn-ghost btn-danger doc-delete" onClick={(e) => { e.stopPropagation(); setToDelete(d); }}>
                  Видалити
                </button>
              )}
            </article>
          ))}
        </div>
      </main>

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      {toDelete && (
        <Modal title="Видалити документ?" onClose={() => setToDelete(null)}>
          <p>Документ «{toDelete.title}» буде видалено разом з історією версій. Цю дію не можна скасувати.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setToDelete(null)}>Скасувати</button>
            <button className="btn btn-primary btn-danger-fill" onClick={confirmDelete}>Видалити</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function CreateDialog({ onClose }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) { setError('Вкажіть назву документа'); return; }
    try {
      const { document } = await api.createDocument(title);
      navigate(`/documents/${document.id}`);
    } catch (err) {
      setError(err.details?.title || err.message);
    }
  }

  return (
    <Modal title="Новий документ" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Назва" value={title} onChange={(e) => setTitle(e.target.value)} error={error} maxLength={120} autoFocus />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn btn-primary">Створити</button>
        </div>
      </form>
    </Modal>
  );
}
