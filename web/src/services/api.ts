import { auth } from "../firebase";

function getBaseUrl(): string {
  const cfg: any = typeof window !== "undefined" ? (window as any).APP_CONFIG : undefined;
  const runtimeBase = (cfg?.SIGNALING_URL as string | undefined)?.trim();
  const env: any = (import.meta as any)?.env || {};
  const envBase = (env.VITE_SIGNALING_URL as string | undefined)?.trim();
  return runtimeBase || envBase || `${window.location.protocol}//${window.location.hostname}:3000`;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const base = getBaseUrl();
  const token = await auth.currentUser?.getIdToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(`${base}${path}`, {
    ...options,
    mode: "cors",
    headers,
  });
}

export { getBaseUrl };
