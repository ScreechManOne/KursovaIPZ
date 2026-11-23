import { useEffect, useState } from 'react';

/**
 * Маршрутизація на основі hash-частини адреси (#/documents/5).
 * Не потребує налаштувань сервера і зберігає роботу кнопок «Назад»/«Вперед».
 */
export function useRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => setPath(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

export const navigate = (path) => { window.location.hash = path; };

/** Зіставляє шлях із шаблоном, наприклад '/documents/:id'. */
export function matchPath(pattern, path) {
  const p = pattern.split('/');
  const s = path.split('/');
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
