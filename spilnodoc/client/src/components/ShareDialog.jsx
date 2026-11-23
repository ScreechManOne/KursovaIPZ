import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, Avatar, ROLE_NAMES } from './common.jsx';

/** Діалог керування доступом до документа (доступний лише власнику для змін). */
export function ShareDialog({ docId, isOwner, onClose }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');

  const load = () => api.listMembers(docId).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [docId]);

  async function invite(e) {
    e.preventDefault();
    setError('');
    try {
      await api.addMember(docId, email.trim(), role);
      setEmail('');
      load();
    } catch (err) {
      setError(err.details?.email || err.message);
    }
  }

  const change = (userId, newRole) => api.changeRole(docId, userId, newRole).then(load).catch((e) => setError(e.message));
  const remove = (userId) => api.removeMember(docId, userId).then(load).catch((e) => setError(e.message));

  return (
    <Modal title="Доступ до документа" onClose={onClose}>
      {isOwner && (
        <form className="invite-row" onSubmit={invite}>
          <input placeholder="Електронна пошта користувача" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Роль">
            <option value="editor">Редактор</option>
            <option value="viewer">Читач</option>
          </select>
          <button className="btn btn-primary">Запросити</button>
        </form>
      )}
      {error && <div className="alert">{error}</div>}
      {data && (
        <ul className="member-list">
          <li>
            <Avatar name={data.owner.name} color="#334155" />
            <div className="member-info"><strong>{data.owner.name}</strong><span className="muted">власник</span></div>
            <span className="badge badge-owner">{ROLE_NAMES.owner}</span>
          </li>
          {data.members.map((m) => (
            <li key={m.id}>
              <Avatar name={m.name} color={m.color} />
              <div className="member-info"><strong>{m.name}</strong><span className="muted">{m.email}</span></div>
              {isOwner ? (
                <>
                  <select value={m.role} onChange={(e) => change(m.id, e.target.value)} aria-label={`Роль ${m.name}`}>
                    <option value="editor">Редактор</option>
                    <option value="viewer">Читач</option>
                  </select>
                  <button className="btn btn-ghost btn-danger" onClick={() => remove(m.id)}>Прибрати</button>
                </>
              ) : (
                <span className={`badge badge-${m.role}`}>{ROLE_NAMES[m.role]}</span>
              )}
            </li>
          ))}
          {data.members.length === 0 && <li className="muted">Документ поки ніхто не редагує, крім власника.</li>}
        </ul>
      )}
    </Modal>
  );
}
