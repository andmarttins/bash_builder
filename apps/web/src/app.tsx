import { Building2, CheckCircle2, LogOut, ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

type Identity = { user: { id: string; email: string }; organization: { id: string; name: string; slug: string }; membership: { id: string; role: string }; access: { isPlatformAdmin: boolean; requiresPasswordChange: boolean } };
type AuthMode = 'loading' | 'bootstrap' | 'login' | 'change-password' | 'signed-in';

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, credentials: 'include', headers: { 'content-type': 'application/json', ...options?.headers } });
  const body = await response.json().catch(() => ({})) as { message?: string | string[] };
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message[0] : body.message ?? 'Não foi possível concluir a solicitação.');
  return body as T;
}

export function App(): React.JSX.Element {
  const [mode, setMode] = useState<AuthMode>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => { void (async () => {
    try {
      const [session, bootstrap] = await Promise.all([api<{ identity: Identity | null }>('/v1/auth/session'), api<{ bootstrapRequired: boolean }>('/v1/auth/bootstrap-status')]);
      if (session.identity) { setIdentity(session.identity); setMode(session.identity.access.requiresPasswordChange ? 'change-password' : 'signed-in'); } else setMode(bootstrap.bootstrapRequired ? 'bootstrap' : 'login');
    } catch { setError('Não foi possível conectar à plataforma. Atualize a página em alguns instantes.'); setMode('login'); }
  })(); }, []);

  async function submitBootstrap(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    await submit('/v1/auth/bootstrap', { email: values.get('email'), password: values.get('password'), organizationName: values.get('organizationName'), organizationSlug: values.get('organizationSlug') }, { 'x-bootstrap-token': String(values.get('bootstrapToken') ?? '') });
  }
  async function submitLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    await submit('/v1/auth/login', { email: values.get('email'), password: values.get('password') });
  }
  async function submitPasswordChange(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    await submit('/v1/auth/change-password', { currentPassword: values.get('currentPassword'), newPassword: values.get('newPassword') });
  }
  async function submit(path: string, payload: Record<string, FormDataEntryValue | null>, headers?: HeadersInit): Promise<void> {
    setPending(true); setError(null);
    try { const result = await api<{ identity: Identity }>(path, { method: 'POST', headers, body: JSON.stringify(payload) }); setIdentity(result.identity); setMode(result.identity.access.requiresPasswordChange ? 'change-password' : 'signed-in'); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível concluir a solicitação.'); }
    finally { setPending(false); }
  }
  async function logout(): Promise<void> {
    setPending(true); try { await api('/v1/auth/logout', { method: 'POST' }); setIdentity(null); setMode('login'); } finally { setPending(false); }
  }

  if (mode === 'loading') return <main className="shell"><p className="loading">Carregando Builder Solutions…</p></main>;
  if (mode === 'signed-in' && identity) return <main className="shell"><section className="panel dashboard" aria-labelledby="dashboard-title">
    <div className="brand"><span className="icon"><Building2 aria-hidden="true" /></span><span>Builder Solutions</span></div><div className="success-icon"><CheckCircle2 aria-hidden="true" /></div>
    <p className="eyebrow">Acesso configurado</p><h1 id="dashboard-title">Olá, {identity.organization.name}.</h1><p className="description">Sua organização está protegida por isolamento multi-tenant e o primeiro administrador já pode iniciar a configuração dos módulos.</p>
    <dl className="identity-card"><div><dt>Conta</dt><dd>{identity.user.email}</dd></div><div><dt>Organização</dt><dd>{identity.organization.slug}</dd></div><div><dt>Permissão</dt><dd>{identity.access.isPlatformAdmin ? 'SUPERADMIN · ' : ''}{identity.membership.role}</dd></div></dl>
    <button className="secondary-button" type="button" onClick={() => void logout()} disabled={pending}><LogOut aria-hidden="true" /> Sair</button>
  </section></main>;

  if (mode === 'change-password') return <main className="shell"><section className="panel" aria-labelledby="title">
    <div className="brand"><span className="icon"><Building2 aria-hidden="true" /></span><span>Builder Solutions</span></div>
    <p className="eyebrow">Senha temporária</p><h1 id="title">Defina uma nova senha segura.</h1>
    <p className="description">Por segurança, a senha temporária só permite este passo. Escolha uma senha exclusiva, com ao menos 12 caracteres.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="auth-form" onSubmit={submitPasswordChange}>
      <label>Senha temporária<input name="currentPassword" type="password" autoComplete="current-password" minLength={12} maxLength={128} required /></label>
      <label>Nova senha<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required placeholder="Mínimo de 12 caracteres" /></label>
      <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Atualizando…' : 'Atualizar senha e continuar'}</button>
    </form><p className="security-note"><ShieldCheck aria-hidden="true" /> A troca encerra as demais sessões ativas desta conta.</p>
  </section></main>;

  const bootstrap = mode === 'bootstrap';
  return <main className="shell"><section className="panel" aria-labelledby="title">
    <div className="brand"><span className="icon"><Building2 aria-hidden="true" /></span><span>Builder Solutions</span></div>
    <p className="eyebrow">{bootstrap ? 'Primeira configuração' : 'Acesso à plataforma'}</p><h1 id="title">{bootstrap ? 'Crie a conta administradora.' : 'Entre na sua organização.'}</h1>
    <p className="description">{bootstrap ? 'Esta etapa acontece uma única vez e cria a organização inicial com permissão de proprietário.' : 'Use o e-mail e a senha definidos pelo administrador da sua organização.'}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="auth-form" onSubmit={bootstrap ? submitBootstrap : submitLogin}>
      {bootstrap && <><label>Código de instalação<input name="bootstrapToken" type="password" autoComplete="off" minLength={32} required placeholder="Definido no Dokploy" /></label><label>Nome da organização<input name="organizationName" autoComplete="organization" minLength={2} maxLength={160} required placeholder="Minha empresa" /></label><label>Identificador da organização<input name="organizationSlug" autoComplete="off" minLength={3} maxLength={63} pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]{3,}" required placeholder="minha-empresa" /></label></>}
      <label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com" /></label><label>Senha<input name="password" type="password" autoComplete={bootstrap ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required placeholder="Mínimo de 12 caracteres" /></label>
      <button className="primary-button" type="submit" disabled={pending}>{pending ? 'Processando…' : bootstrap ? 'Criar acesso seguro' : 'Entrar'}</button>
    </form><p className="security-note"><ShieldCheck aria-hidden="true" /> Sessões seguras, credenciais protegidas com Argon2id e isolamento por organização.</p>
  </section></main>;
}
