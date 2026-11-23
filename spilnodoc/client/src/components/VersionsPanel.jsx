import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate } from './common.jsx';

/** Бічна панель історії версій: створення знімка, перегляд і відновлення. */
export function VersionsPanel({ docId, canEdit, onClose, onPreview }) {
  const [versions, setVersions] = useState([]);
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');

  const load = () => api.listVersions(docId).then((r) => setVersions(r.versions)).catch((e) => setMessage(e.message));
  useEffect(() => { load(); }, [docId]);

  async function save(e) {
    e.preventDefault();
    if (!label.trim()) return;
    try {
      await api.saveVersion(docId, label.trim());
      setLabel('');
      setMessage('Версію збережено');
      load();
    } catch (err) {
      setMessage(err.details?.label || err.message);
    }
  }

  async function preview(v) {
    const { version } = await api.getVersion(docId, v.id);
    onPreview(version);
  }

  async function restore(v) {
    try {
      await api.restoreVersion(docId, v.id);
      setMessage(`Відновлено версію «${v.label}»`);
      load();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <aside className="side-panel">
      <div className="side-head">
        <h2>Історія версій</h2>
        <button className="btn btn-icon" onClick={onClose} aria-label="Закрити">×</button>
      </div>
      {canEdit && (
        <form className="version-form" onSubmit={save}>
          <input placeholder="Назва версії, напр. «Чернетка 1»" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          <button className="btn btn-primary">Зберегти</button>
        </form>
      )}
      {message && <p className="hint">{message}</p>}
      <ol className="version-list">
        {versions.map((v) => (
          <li key={v.id} className={v.is_auto ? 'auto' : ''}>
            <div className="version-title">{v.label}</div>
            <div className="muted small">
              {formatDate(v.created_at)} · ревізія {v.revision} · {v.author || 'система'}
            </div>
            <div className="version-actions">
              <button className="btn btn-ghost" onClick={() => preview(v)}>Переглянути</button>
              {canEdit && <button className="btn btn-ghost" onClick={() => restore(v)}>Відновити</button>}
            </div>
          </li>
        ))}
        {versions.length === 0 && <li className="muted">Збережених версій поки немає.</li>}
      </ol>
    </aside>
  );
}
