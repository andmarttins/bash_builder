import { Building2, CheckCircle2, ClipboardList, FileText, LayoutDashboard, LogOut, Settings2, ShieldCheck, UsersRound } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

type Identity = { user: { id: string; email: string }; organization: { id: string; name: string; slug: string }; membership: { id: string; role: string }; access: { isPlatformAdmin: boolean; requiresPasswordChange: boolean } };
type AuthMode = 'loading' | 'bootstrap' | 'login' | 'change-password' | 'invite' | 'signed-in';
type WorkspaceView = 'home' | 'forms' | 'organization';
type Organization = { id: string; name: string; slug: string; membership: { id: string; role: string } };
type Member = { id: string; userId: string; email: string; role: string; status: string; createdAt: string };
type Invitation = { id: string; email: string; role: string; expiresAt: string; createdAt: string };
type FormSummary = { id: string; publicId: string; title: string; description: string | null; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; version: number; fields: Array<{ key: string }> };

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
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationToken] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('home');
  const [forms, setForms] = useState<FormSummary[]>([]);

  useEffect(() => { void (async () => {
    if (invitationToken) { setMode('invite'); return; }
    try {
      const [session, bootstrap] = await Promise.all([api<{ identity: Identity | null }>('/v1/auth/session'), api<{ bootstrapRequired: boolean }>('/v1/auth/bootstrap-status')]);
      if (session.identity) {
        setIdentity(session.identity);
        setWorkspaceView('home');
        setMode(session.identity.access.requiresPasswordChange ? 'change-password' : 'signed-in');
      } else setMode(bootstrap.bootstrapRequired ? 'bootstrap' : 'login');
    } catch { setError('Não foi possível conectar à plataforma. Atualize a página em alguns instantes.'); setMode('login'); }
  })(); }, [invitationToken]);

  useEffect(() => { void (async () => {
    if (mode !== 'signed-in' || !identity) return;
    try {
      const organizationResponse = await api<{ organizations: Organization[] }>('/v1/organizations');
      setOrganizations(organizationResponse.organizations);
      if (identity.membership.role === 'OWNER' || identity.membership.role === 'ADMIN') {
        const [memberResponse, invitationResponse] = await Promise.all([api<{ members: Member[] }>('/v1/organizations/current/members'), api<{ invitations: Invitation[] }>('/v1/organizations/current/invitations')]);
        setMembers(memberResponse.members);
        setInvitations(invitationResponse.invitations);
      } else { setMembers([]); setInvitations([]); }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar a administração da organização.'); }
  })(); }, [identity, mode]);

  useEffect(() => { void (async () => {
    if (mode !== 'signed-in' || !identity || workspaceView !== 'forms') return;
    try { setForms((await api<{ forms: FormSummary[] }>('/v1/forms')).forms); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar os formulários.'); }
  })(); }, [identity, mode, workspaceView]);

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
    try {
      const result = await api<{ identity: Identity }>(path, { method: 'POST', headers, body: JSON.stringify(payload) });
      setIdentity(result.identity);
      setWorkspaceView('home');
      setMode(result.identity.access.requiresPasswordChange ? 'change-password' : 'signed-in');
    }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível concluir a solicitação.'); }
    finally { setPending(false); }
  }
  async function logout(): Promise<void> {
    setPending(true); try { await api('/v1/auth/logout', { method: 'POST' }); setIdentity(null); setMode('login'); } finally { setPending(false); }
  }
  async function switchOrganization(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setPending(true); setError(null);
    try { const result = await api<{ identity: Identity }>('/v1/organizations/switch', { method: 'POST', body: JSON.stringify({ organizationId: values.get('organizationId') }) }); setIdentity(result.identity); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível trocar a organização.'); }
    finally { setPending(false); }
  }
  async function createOrganization(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setPending(true); setError(null);
    try {
      await api('/v1/organizations', { method: 'POST', body: JSON.stringify({ name: values.get('name'), slug: values.get('slug') }) });
      event.currentTarget.reset();
      const result = await api<{ organizations: Organization[] }>('/v1/organizations'); setOrganizations(result.organizations);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível criar a organização.'); }
    finally { setPending(false); }
  }
  async function updateMember(event: FormEvent<HTMLFormElement>, memberId: string): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setPending(true); setError(null);
    try {
      await api(`/v1/organizations/current/members/${memberId}`, { method: 'PATCH', body: JSON.stringify({ role: values.get('role'), status: values.get('status') }) });
      const result = await api<{ members: Member[] }>('/v1/organizations/current/members'); setMembers(result.members);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar o membro.'); }
    finally { setPending(false); }
  }
  async function createInvitation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setPending(true); setError(null); setInvitationUrl(null);
    try {
      const result = await api<{ invitationToken: string }>('/v1/organizations/current/invitations', { method: 'POST', body: JSON.stringify({ email: values.get('email'), role: values.get('role') }) });
      event.currentTarget.reset(); setInvitationUrl(`${window.location.origin}/?invite=${encodeURIComponent(result.invitationToken)}`);
      const invitationsResponse = await api<{ invitations: Invitation[] }>('/v1/organizations/current/invitations'); setInvitations(invitationsResponse.invitations);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível criar o convite.'); }
    finally { setPending(false); }
  }
  async function acceptInvitation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setPending(true); setError(null);
    try {
      const result = await api<{ identity: Identity }>('/v1/invitations/accept', { method: 'POST', body: JSON.stringify({ token: invitationToken, password: values.get('password') }) });
      window.history.replaceState({}, '', '/'); setIdentity(result.identity); setWorkspaceView('home'); setMode('signed-in');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível aceitar o convite.'); }
    finally { setPending(false); }
  }
  async function acceptInvitationAsExistingUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setPending(true); setError(null);
    try {
      const session = await api<{ identity: Identity }>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: values.get('email'), password: values.get('password') }) });
      await api('/v1/organizations/current/invitations/accept', { method: 'POST', body: JSON.stringify({ token: invitationToken }) });
      window.history.replaceState({}, '', '/'); setIdentity(session.identity); setWorkspaceView('home'); setMode('signed-in');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível associar este convite à conta existente.'); }
    finally { setPending(false); }
  }
  async function revokeInvitation(invitationId: string): Promise<void> {
    setPending(true); setError(null);
    try { await api(`/v1/organizations/current/invitations/${invitationId}`, { method: 'DELETE' }); setInvitations((current) => current.filter((invitation) => invitation.id !== invitationId)); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível revogar o convite.'); }
    finally { setPending(false); }
  }
  async function createForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    setPending(true); setError(null);
    try {
      await api('/v1/forms', { method: 'POST', body: JSON.stringify({ title: values.get('title'), description: values.get('description') || undefined, fields: [{ key: 'descricao', label: 'Descrição', type: 'LONG_TEXT', required: true, options: [] }] }) });
      event.currentTarget.reset(); setForms((await api<{ forms: FormSummary[] }>('/v1/forms')).forms);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Não foi possível criar o formulário.'); }
    finally { setPending(false); }
  }

  if (mode === 'loading') return <main className="shell"><p className="loading">Carregando Builder Solutions…</p></main>;
  if (mode === 'signed-in' && identity) return <main className="shell"><section className="panel dashboard dashboard-wide" aria-labelledby="dashboard-title">
    <div className="brand"><span className="icon"><Building2 aria-hidden="true" /></span><span>Builder Solutions</span></div>
    <nav className="workspace-nav" aria-label="Navegação do workspace"><button className="workspace-nav-item" aria-current={workspaceView === 'home' ? 'page' : undefined} type="button" onClick={() => setWorkspaceView('home')}><LayoutDashboard aria-hidden="true" /> Visão geral</button><button className="workspace-nav-item" aria-current={workspaceView === 'forms' ? 'page' : undefined} type="button" onClick={() => setWorkspaceView('forms')}><FileText aria-hidden="true" /> Formulários</button><button className="workspace-nav-item" aria-current={workspaceView === 'organization' ? 'page' : undefined} type="button" onClick={() => setWorkspaceView('organization')}><Settings2 aria-hidden="true" /> Organização</button></nav>
    {workspaceView === 'home' ? <>
      <p className="eyebrow">Workspace</p><h1 id="dashboard-title">Visão geral da empresa</h1><p className="description">Olá, {identity.organization.name}. Acompanhe a organização ativa e avance pela configuração dos módulos empresariais.</p>
      <section className="overview-grid" aria-label="Resumo da empresa"><article className="overview-card"><Building2 aria-hidden="true" /><span>Organização ativa</span><strong>{identity.organization.name}</strong><small>{identity.organization.slug}</small></article><article className="overview-card"><UsersRound aria-hidden="true" /><span>Seu acesso</span><strong>{identity.membership.role}</strong><small>{identity.access.isPlatformAdmin ? 'Administrador da plataforma' : 'Membro da organização'}</small></article><article className="overview-card"><ClipboardList aria-hidden="true" /><span>Próxima etapa</span><strong>Configurar módulos</strong><small>Formulários já estão disponíveis; os demais entram por entregas isoladas.</small></article></section>
      <section className="admin-section" aria-labelledby="start-title"><h2 id="start-title">Comece por aqui</h2><p className="section-note">Crie e publique formulários, ou gerencie membros, convites e outras organizações.</p><button className="primary-button compact" type="button" onClick={() => setWorkspaceView('forms')}><FileText aria-hidden="true" /> Abrir formulários</button></section>
    </> : workspaceView === 'forms' ? <>
      <p className="eyebrow">Módulo empresarial</p><h1 id="dashboard-title">Formulários</h1><p className="description">Crie formulários isolados por empresa. Cada criação recebe um campo inicial obrigatório, que pode ser configurado pela API nesta primeira entrega.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {(identity.membership.role === 'OWNER' || identity.membership.role === 'ADMIN') && <form className="inline-form admin-section" onSubmit={createForm}><label>Título<input name="title" required minLength={2} maxLength={160} placeholder="Inspeção de segurança" /></label><label>Descrição<input name="description" maxLength={10000} placeholder="Opcional" /></label><button className="primary-button compact" type="submit" disabled={pending}>Criar formulário</button></form>}
      <section className="admin-section" aria-labelledby="forms-title"><h2 id="forms-title">Formulários da organização</h2>{forms.length === 0 ? <p className="section-note">Ainda não há formulários nesta empresa.</p> : <div className="form-list">{forms.map((form) => <article className="form-row" key={form.id}><FileText aria-hidden="true" /><div><strong>{form.title}</strong><small>{form.status} · versão {form.version} · {form.fields.length} campo(s)</small></div><code>{form.publicId}</code></article>)}</div>}</section>
    </> : <>
      <div className="success-icon"><CheckCircle2 aria-hidden="true" /></div><p className="eyebrow">Administração</p><h1 id="dashboard-title">Organização e acesso</h1><p className="description">Gerencie o contexto ativo, membros e convites sem sair do workspace.</p>
      <dl className="identity-card"><div><dt>Conta</dt><dd>{identity.user.email}</dd></div><div><dt>Organização</dt><dd>{identity.organization.slug}</dd></div><div><dt>Permissão</dt><dd>{identity.access.isPlatformAdmin ? 'SUPERADMIN · ' : ''}{identity.membership.role}</dd></div></dl>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="admin-section" aria-labelledby="organizations-title"><h2 id="organizations-title">Organizações</h2><form className="inline-form" onSubmit={switchOrganization}><label>Contexto ativo<select name="organizationId" defaultValue={identity.organization.id} disabled={pending}>{organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name} · {organization.membership.role}</option>)}</select></label><button className="secondary-button compact" type="submit" disabled={pending || organizations.length < 2}>Trocar organização</button></form>
      {identity.access.isPlatformAdmin && <form className="inline-form" onSubmit={createOrganization}><label>Nova organização<input name="name" minLength={2} maxLength={160} required placeholder="Nome da organização" /></label><label>Identificador<input name="slug" minLength={3} maxLength={63} pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]{3,}" required placeholder="empresa-exemplo" /></label><button className="primary-button compact" type="submit" disabled={pending}>Criar organização</button></form>}</section>
      {(identity.membership.role === 'OWNER' || identity.membership.role === 'ADMIN') && <section className="admin-section" aria-labelledby="members-title"><h2 id="members-title">Membros</h2><p className="section-note">Alterações usam o contexto da organização ativa. A própria membership não pode ser alterada nesta tela.</p><form className="inline-form" onSubmit={createInvitation}><label>E-mail do novo membro<input name="email" type="email" required placeholder="pessoa@empresa.com" /></label><label>Papel<select name="role" defaultValue="MEMBER"><option value="OWNER" disabled={identity.membership.role !== 'OWNER'}>OWNER</option><option value="ADMIN" disabled={identity.membership.role !== 'OWNER'}>ADMIN</option><option value="MEMBER">MEMBER</option><option value="VIEWER">VIEWER</option></select></label><button className="primary-button compact" type="submit" disabled={pending}>Gerar convite</button></form>{invitationUrl && <p className="invitation-link">Convite válido por 7 dias: <code>{invitationUrl}</code></p>}{invitations.length > 0 && <div className="invitation-list">{invitations.map((invitation) => <div className="invitation-row" key={invitation.id}><span>{invitation.email} · {invitation.role}</span><button className="secondary-button compact" type="button" disabled={pending} onClick={() => void revokeInvitation(invitation.id)}>Revogar</button></div>)}</div>}<div className="member-list">{members.map((member) => <form className="member-row" key={member.id} onSubmit={(event) => void updateMember(event, member.id)}><span>{member.email}</span><select name="role" defaultValue={member.role} disabled={pending || member.id === identity.membership.id || (identity.membership.role === 'ADMIN' && member.role === 'OWNER')}><option value="OWNER">OWNER</option><option value="ADMIN">ADMIN</option><option value="MEMBER">MEMBER</option><option value="VIEWER">VIEWER</option></select><select name="status" defaultValue={member.status} disabled={pending || member.id === identity.membership.id || (identity.membership.role === 'ADMIN' && member.role === 'OWNER')}><option value="ACTIVE">Ativo</option><option value="SUSPENDED">Suspenso</option></select><button className="secondary-button compact" type="submit" disabled={pending || member.id === identity.membership.id || (identity.membership.role === 'ADMIN' && member.role === 'OWNER')}>Salvar</button></form>)}</div></section>}
    </>}
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

  if (mode === 'invite') return <main className="shell"><section className="panel" aria-labelledby="title"><div className="brand"><span className="icon"><Building2 aria-hidden="true" /></span><span>Builder Solutions</span></div><p className="eyebrow">Convite de organização</p><h1 id="title">Defina seu acesso.</h1><p className="description">Se esta é sua primeira organização, escolha uma senha segura. Se já possui uma conta, entre abaixo para associar o convite sem trocar sua senha.</p>{error && <p className="form-error" role="alert">{error}</p>}<form className="auth-form" onSubmit={acceptInvitation}><label>Nova senha<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required placeholder="Mínimo de 12 caracteres" /></label><button className="primary-button" type="submit" disabled={pending}>{pending ? 'Concluindo…' : 'Criar acesso e aceitar convite'}</button></form><section className="admin-section"><h2>Já possui uma conta?</h2><form className="auth-form" onSubmit={acceptInvitationAsExistingUser}><label>E-mail<input name="email" type="email" autoComplete="email" required /></label><label>Senha atual<input name="password" type="password" autoComplete="current-password" minLength={12} maxLength={128} required /></label><button className="secondary-button" type="submit" disabled={pending}>Entrar e aceitar convite</button></form></section></section></main>;

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
