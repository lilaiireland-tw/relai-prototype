"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { apiClient } from "@/lib/api";
import type { AuthBootstrap, UserProfile } from "@/lib/types";

type AuthContextValue = {
  token: string | null;
  user: UserProfile | null;
  bootstrap: AuthBootstrap | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshBootstrap: () => Promise<void>;
};

const AUTH_TOKEN_KEY = "relai_access_token";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [bootstrap, setBootstrap] = useState<AuthBootstrap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const clearAuth = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setToken(null);
    setUser(null);
    setBootstrap(null);
  }, []);

  const refreshBootstrap = useCallback(async () => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!storedToken) {
      clearAuth();
      setIsLoading(false);
      return;
    }

    try {
      const payload = await apiClient.bootstrap(storedToken);
      setToken(storedToken);
      setBootstrap(payload);
      setUser(payload.profile);
    } catch {
      clearAuth();
    } finally {
      setIsLoading(false);
    }
  }, [clearAuth]);

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  const login = useCallback(
    async (email: string, password: string) => {
      const payload = await apiClient.login(email, password);
      localStorage.setItem(AUTH_TOKEN_KEY, payload.access_token);
      setIsLoading(true);
      await refreshBootstrap();
      router.push("/home");
    },
    [refreshBootstrap, router],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      await apiClient.register(email, password, displayName);
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (storedToken) {
      try {
        await apiClient.logout(storedToken);
      } catch {
        // Ignore logout transport failures and clear local auth anyway.
      }
    }
    clearAuth();
    router.push("/");
  }, [clearAuth, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      bootstrap,
      isLoading,
      login,
      register,
      logout,
      refreshBootstrap,
    }),
    [bootstrap, isLoading, login, logout, refreshBootstrap, register, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
