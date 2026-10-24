import { useEffect, useState, type FormEvent } from 'react';
import App from './App';
import { apiRequest, currentUser, signIn, signOut, type Principal } from './auth';

interface Governance {
  principals: { principalKey: string; displayName: string; positionId: string; isHuman: boolean; status: string }[];
  events: { eventId: string; timestamp: number; event: string; principalKey: string; detail: string }[];
  credentials: { credentialId: string; prefix: string; expiresAt: number; revokedAt: number | null; lastUsedAt: number | null }[];
  sessions: { sessionId: string }[];
}
function GovernanceView({ principal, onSignOut }: { principal: Principal; onSignOut: () => Promise<void> }) {
  const [data, setData] = useState<Governance | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try { setData(await apiRequest<Governance>('/admin/overview')); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load governance records.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  return <main className="min-h-screen bg-zinc-50 p-6 text-zinc-950 md:p-12">
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-300 pb-6"><div><p className="text-xs font-extrabold tracking-widest">MONOLITH</p><h1 className="mt-3 text-2xl font-semibold">Access & governance</h1><p className="mt-2 text-sm text-zinc-500">{principal.displayName} · {principal.positionTitle}</p></div><button onClick={() => { void onSignOut().catch(reason => setError(String(reason.message))); }} className="border border-zinc-300 px-4 py-2 text-sm">Sign out</button></header>
      <p className="text-sm text-zinc-600">Account and credential changes are managed by the local operator command. This administrator account has no accounting authority.</p>
      {error && <p role="alert" className="border border-red-300 p-4 text-sm text-red-800">{error}</p>}
      <button onClick={() => { void refresh(); }} disabled={loading} className="bg-zinc-950 px-4 py-2 text-sm text-white disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh records'}</button>
      {data && <>
        <p className="text-sm text-zinc-500">{data.principals.length} identities · {data.credentials.filter(c => !c.revokedAt && c.expiresAt * 1000 > Date.now()).length} active agent keys · {data.sessions.length} active sessions</p>
        <section className="overflow-x-auto border border-zinc-200 bg-white"><h2 className="p-4 text-sm font-semibold">Accounts</h2><table className="w-full text-left text-xs"><thead className="border-y border-zinc-200 bg-zinc-50"><tr>{['Identity', 'Position', 'Type', 'Status'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{data.principals.map(row => <tr className="border-b border-zinc-100" key={row.principalKey}><td className="p-3">{row.displayName}<span className="mt-1 block text-zinc-500">{row.principalKey}</span></td><td className="p-3">{row.positionId}</td><td className="p-3">{row.isHuman ? 'Human' : 'Agent'}</td><td className="p-3">{row.status}</td></tr>)}</tbody></table></section>
        <section className="border border-zinc-200 bg-white"><h2 className="p-4 text-sm font-semibold">Authentication activity</h2>{data.events.map(event => <div key={event.eventId} className="flex flex-wrap justify-between gap-2 border-t border-zinc-100 p-4 text-xs"><span>{event.event} · {event.principalKey}{event.detail && ` · ${event.detail}`}</span><time className="text-zinc-500">{new Date(event.timestamp * 1000).toLocaleString()}</time></div>)}</section>
      </>}
    </div>
  </main>;
}

export default function AuthGate() {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    currentUser().then(user => { if (active) setPrincipal(user); }).catch(reason => {
      if (active && reason.message !== 'UNAUTHENTICATED') setError(reason.message);
    }).finally(() => { if (active) setChecking(false); });
    const expired = () => { setPrincipal(null); setPassword(''); setError('Your session has expired. Please sign in again.'); };
    window.addEventListener('aas:session-expired', expired);
    return () => { active = false; window.removeEventListener('aas:session-expired', expired); };
  }, []);
  useEffect(() => {
    if (principal?.canReadWorkspace) return;
    // Unauthenticated/governance screens follow system appearance without reading a workspace.
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    root.style.fontSize = '16px';
    root.lang = 'en';
    root.dataset.font = 'inter';
    const apply = () => root.classList.toggle('dark', media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [principal]);
  const logout = async () => { await signOut(); setPrincipal(null); setPassword(''); setError(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { setPrincipal(await signIn(username, password)); setPassword(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  };
  if (checking) return <main className="min-h-screen bg-zinc-50 p-8 text-sm text-zinc-600" role="status">Checking your session…</main>;
  if (principal?.isAdmin) return <GovernanceView principal={principal} onSignOut={logout} />;
  if (principal?.canReadWorkspace) return <App principal={principal} onSignOut={logout} />;
  if (principal) return <main className="min-h-screen bg-zinc-50 p-8 text-zinc-950"><h1 className="font-semibold">Position-scoped access</h1><p className="mt-4 text-sm">{principal.positionTitle} accounts use their scoped MCP tools. Full workspace access requires a reporting or oversight position.</p><button className="mt-6 border px-4 py-2 text-sm" onClick={() => { void logout().catch(reason => setError(reason.message)); }}>Sign out</button>{error && <p role="alert">{error}</p>}</main>;
  return <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12 text-zinc-950">
    <div className="w-full max-w-sm"><p className="text-sm font-extrabold tracking-widest">MONOLITH</p><h1 className="mt-10 text-3xl font-semibold tracking-tight">Sign in to your books</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Use the human account provisioned for your accounting position.</p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <div><label htmlFor="username" className="mb-2 block text-xs font-semibold">Principal key</label><input id="username" name="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={80} disabled={busy} className="w-full border border-zinc-300 bg-white px-3 py-3 text-sm outline-none focus:border-zinc-950" /></div>
        <div><label htmlFor="password" className="mb-2 block text-xs font-semibold">Password</label><input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={256} disabled={busy} className="w-full border border-zinc-300 bg-white px-3 py-3 text-sm outline-none focus:border-zinc-950" /></div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full bg-zinc-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form><p className="mt-6 text-xs leading-5 text-zinc-400">Account setup and password recovery are handled by your local administrator.</p>
    </div>
  </main>;
}
