"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** JSON API çağrısı. Oturum düştüyse (401) giriş sayfasına yönlendirir. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401 && !location.pathname.startsWith("/login")) {
    location.href = "/login";
    throw new ApiError("Oturum süresi doldu", 401);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error || "HTTP " + res.status, res.status);
  return data as T;
}

export const postJson = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
