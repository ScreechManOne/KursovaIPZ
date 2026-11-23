import { useEffect } from 'react';
import { useAuth } from '../auth.jsx';
import { navigate } from '../router.js';

export function Header({ children }) {
  const { user, logout } = useAuth();
  return (
    <header className="topbar">
      <a className="logo" href="#/documents">
        <span className="logo-mark">S</span> SpilnoDoc
      </a>
      <div className="topbar-center">{children}</div>
      {user && (
        <div className="topbar-user">
          <Avatar name={user.name} color={user.color} />
          <span className="topbar-name">{user.name}</span>
          <button className="btn btn-ghost" onClick={() => { logout(); navigate('/login'); }}>
            Вийти
          </button>
        </div>
      )}
    </header>
  );
}

export function Avatar({ name, color, title, size = 32 }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className="avatar" title={title || name} style={{ background: color, width: size, height: size }}>
      {initials}
    </span>
  );
}

/** Модальне вікно: закривається клавішею Escape або кліком поза ним. */
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-icon" onClick={onClose} aria-label="Закрити">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, error, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} className={error ? 'invalid' : ''} aria-invalid={Boolean(error)} />
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export const ROLE_NAMES = { owner: 'Власник', editor: 'Редактор', viewer: 'Читач' };

export function formatDate(sqlDate) {
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
