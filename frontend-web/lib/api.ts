import type {
  ApiError,
  AuthBootstrap,
  AuthToken,
  FlashcardListResponse,
  UserProfile,
  UserSettings,
  UserStats,
} from "@/lib/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const payload = (await response.json()) as ApiError;
      detail = payload.detail ?? detail;
    } catch {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  register(email: string, password: string, displayName: string) {
    return apiFetch<UserProfile>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        display_name: displayName || null,
      }),
    });
  },
  login(email: string, password: string) {
    return apiFetch<AuthToken>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  logout(token: string) {
    return apiFetch<{ detail: string }>(
      "/api/v1/auth/logout",
      {
        method: "POST",
      },
      token,
    );
  },
  bootstrap(token: string) {
    return apiFetch<AuthBootstrap>(
      "/api/v1/auth/bootstrap",
      {
        method: "POST",
      },
      token,
    );
  },
  getMe(token: string) {
    return apiFetch<UserProfile>("/api/v1/auth/me", {}, token);
  },
  getStats(token: string) {
    return apiFetch<UserStats>("/api/v1/stats", {}, token);
  },
  getSettings(token: string) {
    return apiFetch<UserSettings>("/api/v1/settings", {}, token);
  },
  listFlashcards(token: string, limit = 100) {
    return apiFetch<FlashcardListResponse>(`/api/v1/flashcards?limit=${limit}&offset=0`, {}, token);
  },
};
