import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, tokenStore, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

/**
 * Зберігає стан автентифікації. Токен лежить у localStorage, тому після
 * перезавантаження сторінки користувач лишається в системі; дані профілю
 * повторно запитуються через /api/auth/me, що одночасно перевіряє токен.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const authenticate = useCallback(({ token, user }) => {
    tokenStore.set(token);
    setUser(user);
  }, []);

  const value = {
    user,
    loading,
    login: async (email, password) => authenticate(await api.login({ email, password })),
    register: async (data) => authenticate(await api.register(data)),
    logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
