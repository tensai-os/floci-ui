import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchAuthStatus } from "@/api/auth.api";
import type { AuthUser } from "@/api/auth.api";
import { AUTH_TOKEN_STORAGE_KEY } from "./constants";

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export type AuthContextValue = {
  authReady: boolean;
  setupRequired: boolean;
  token: string | null;
  user: AuthUser | null;
  setSession: (token: string, user: AuthUser) => void;
  logout: () => void;
  refreshAuthStatus: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [setupRequired, setSetupRequired] = useState(true);
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [user, setUser] = useState<AuthUser | null>(null);

  const refreshAuthStatus = useCallback(async () => {
    const s = await fetchAuthStatus();
    setSetupRequired(s.setupRequired);
    setAuthReady(true);
  }, []);

  useEffect(() => {
    void refreshAuthStatus().catch(() => {
      setAuthReady(true);
    });
  }, [refreshAuthStatus]);

  const setSession = useCallback((t: string, u: AuthUser) => {
    try {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
    setToken(t);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authReady,
      setupRequired,
      token,
      user,
      setSession,
      logout,
      refreshAuthStatus,
    }),
    [authReady, setupRequired, token, user, setSession, logout, refreshAuthStatus],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
