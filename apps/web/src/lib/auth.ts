const TOKEN_KEY = 'tutien2d.apiToken';
const AUTH_REQUIRED_EVENT = 'tutien2d:auth-required';
const AUTH_CHANGED_EVENT = 'tutien2d:auth-changed';

export function getToken(): string {
  try { return window.sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function setToken(value: string): void {
  try {
    const token = value.trim();
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* Storage can be unavailable in restricted browser contexts. */ }
  notifyAuthChanged();
}

export function clearToken(): void {
  try { window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* Storage can be unavailable. */ }
  notifyAuthChanged();
}

export function notifyAuthRequired(): void {
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}

export function notifyAuthChanged(): void {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function onAuthRequired(listener: () => void): () => void {
  window.addEventListener(AUTH_REQUIRED_EVENT, listener);
  return () => window.removeEventListener(AUTH_REQUIRED_EVENT, listener);
}

export function onAuthChanged(listener: () => void): () => void {
  window.addEventListener(AUTH_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AUTH_CHANGED_EVENT, listener);
}
