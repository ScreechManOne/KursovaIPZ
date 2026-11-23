/**
 * Обгортка над fetch для звернення до REST API.
 * Автоматично додає токен авторизації, серіалізує тіло в JSON
 * і перетворює відповіді з помилкою на виключення ApiError.
 */

const TOKEN_KEY = 'spilnodoc_token';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** Викликається, коли сервер повідомляє, що токен недійсний. */
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function request(method, url, body) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Немає з\'єднання із сервером');
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data?.error || 'Помилка запиту', data?.details);
  }
  return data;
}

export const api = {
  register: (data) => request('POST', '/api/auth/register', data),
  login: (data) => request('POST', '/api/auth/login', data),
  me: () => request('GET', '/api/auth/me'),

  listDocuments: () => request('GET', '/api/documents'),
  createDocument: (title) => request('POST', '/api/documents', { title }),
  getDocument: (id) => request('GET', `/api/documents/${id}`),
  renameDocument: (id, title) => request('PATCH', `/api/documents/${id}`, { title }),
  deleteDocument: (id) => request('DELETE', `/api/documents/${id}`),

  listMembers: (id) => request('GET', `/api/documents/${id}/members`),
  addMember: (id, email, role) => request('POST', `/api/documents/${id}/members`, { email, role }),
  changeRole: (id, userId, role) => request('PATCH', `/api/documents/${id}/members/${userId}`, { role }),
  removeMember: (id, userId) => request('DELETE', `/api/documents/${id}/members/${userId}`),

  sendOperation: (id, payload) => request('POST', `/api/documents/${id}/operations`, payload),
  sendCursor: (id, payload) => request('POST', `/api/documents/${id}/cursor`, payload),

  listVersions: (id) => request('GET', `/api/documents/${id}/versions`),
  saveVersion: (id, label) => request('POST', `/api/documents/${id}/versions`, { label }),
  getVersion: (id, vid) => request('GET', `/api/documents/${id}/versions/${vid}`),
  restoreVersion: (id, vid) => request('POST', `/api/documents/${id}/versions/${vid}/restore`),
};
