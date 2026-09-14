import { createContext, useContext, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { api, clearAuth, getStoredUser, storeAuth } from './api';
import type { User } from './types';

interface AuthCtx {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({ user: null, login: async () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser());

  const login = async (username: string, password: string) => {
    const r = await api.login(username, password);
    storeAuth(r.token, r.user);
    setUser(r.user);
  };
  const logout = () => {
    api.logout().catch(() => {});
    clearAuth();
    setUser(null);
  };
  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
