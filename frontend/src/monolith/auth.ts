export interface Principal {
  principalKey: string;
  displayName: string;
  positionId: string;
  positionTitle: string;
  isHuman: boolean;
  canPrepare: boolean;
  canReview: boolean;
  isAdmin: boolean;
  canReadWorkspace: boolean;
  commands: string[];
}
export interface AuthResponse { principal: Principal; csrfToken: string | null }
const base = import.meta.env.VITE_API_BASE_URL || '/api/v1';
let csrfToken: string | null = null;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (csrfToken && init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`${base}${path}`, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('aas:session-expired'));
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}).`);
  }
  return response.json();
}
export async function currentUser() {
  const result = await apiRequest<AuthResponse>('/auth/me');
  csrfToken = result.csrfToken;
  return result.principal;
}
export async function signIn(username: string, password: string) {
  const result = await apiRequest<AuthResponse>('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  csrfToken = result.csrfToken;
  return result.principal;
}
export async function signOut() {
  await apiRequest('/auth/logout', { method: 'POST' });
  csrfToken = null;
}
