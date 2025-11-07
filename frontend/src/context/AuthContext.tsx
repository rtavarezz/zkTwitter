import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';

type AuthUser = {
  id: string;
  handle: string;
  avatarUrl: string | null;
  humanStatus: string;
  disclosed: Record<string, unknown>;
  selfNullifier?: string | null;
  generationId?: number | null;
};

type AuthState = {
  token: string | null;
  user: AuthUser | null;
};

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  isVerified: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  refreshFromStorage: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'token';
const USER_KEY = 'zktwitter_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => loadState());

  useEffect(() => {
    // Sync across tabs
    const handler = () => setState(loadState());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const login = useCallback((token: string, user: AuthUser) => {
    console.log('[AuthContext] login() called for user:', user.handle);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    setState({ token, user });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setState({ token: null, user: null });
  }, []);

  const refreshFromStorage = useCallback(() => setState(loadState()), []);

  const value = useMemo<AuthContextValue>(() => ({
    token: state.token,
    user: state.user,
    isVerified: state.user?.humanStatus === 'verified',
    login,
    logout,
    refreshFromStorage,
  }), [state, login, logout, refreshFromStorage]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

function loadState(): AuthState {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const rawUser = localStorage.getItem(USER_KEY);
    const user = rawUser ? (JSON.parse(rawUser) as AuthUser) : null;
    return { token, user };
  } catch {
    return { token: null, user: null };
  }
}
