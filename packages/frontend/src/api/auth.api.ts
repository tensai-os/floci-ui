const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type AuthUser = { id: string; email: string };

export async function fetchAuthStatus(): Promise<{ setupRequired: boolean }> {
  const res = await fetch(`${API_BASE}/auth/status`);
  if (!res.ok) {
    throw new Error("Failed to load auth status");
  }
  return res.json() as Promise<{ setupRequired: boolean }>;
}

export async function postRegister(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    token?: string;
    user?: AuthUser;
  };
  if (!res.ok) {
    throw new Error(body.error ?? "Registration failed");
  }
  if (!body.token || !body.user) {
    throw new Error("Invalid response from server");
  }
  return { token: body.token, user: body.user };
}

export async function postLogin(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    token?: string;
    user?: AuthUser;
  };
  if (!res.ok) {
    throw new Error(body.error ?? "Login failed");
  }
  if (!body.token || !body.user) {
    throw new Error("Invalid response from server");
  }
  return { token: body.token, user: body.user };
}
