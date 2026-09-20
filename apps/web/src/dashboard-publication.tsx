import { CheckCircle2, Copy, ExternalLink, RotateCcw, ShieldAlert } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';

type Dashboard = { id: string; title: string; description: string | null; published: boolean; version: number; publicExpiresAt?: string | null; publicRevokedAt?: string | null };
type PublicDashboard = { title: string; description: string | null; widgets: Array<{ type: 'TEXT' | 'METRIC' | 'NOTICE'; title: string; config: Record<string, string | number> }> };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, credentials: 'include', headers: { 'content-type': 'application/json', ...options?.headers } });
  const body = await response.json().catch(() => ({})) as { message?: string | string[] };
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message[0] : body.message ?? 'Não foi possível concluir a solicitação.');
  return body as T;
}

export function DashboardsModulePage({ canManage }: { canManage: boolean }): React.JSX.Element {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicationUrl, setPublicationUrl] = useState<string | null>(null);
  const load = useCallback(async () => { try { setDashboards((await request<{ dashboards: Dashboard[] }>('/v1/dashboards')).dashboards); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os painéis.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setPending(true); setError(null);
    const title = String(new FormData(event.currentTarget).get('title') ?? '').trim();
    try { await request('/v1/dashboards', { method: 'POST', body: JSON.stringify({ title, widgets: [{ type: 'NOTICE', title: 'Painel em configuração', config: { message: 'Este painel está pronto para receber indicadores autorizados.', tone: 'INFO' } }] }) }); event.currentTarget.reset(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o painel.'); } finally { setPending(false); }
  }
  async function publish(dashboard: Dashboard, regenerate = false): Promise<void> {
    const expiresAt = (document.getElementById(`dashboard-expiry-${dashboard.id}`) as HTMLInputElement | null)?.value;
    setPending(true); setError(null); setPublicationUrl(null);
    try {
      const response = await request<{ dashboard: Dashboard; publication: { token: string; expiresAt: string | null } | null }>(`/v1/dashboards/${dashboard.id}/publish`, { method: 'POST', body: JSON.stringify({ published: true, expectedVersion: dashboard.version, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }) });
      if (response.publication) setPublicationUrl(`${window.location.origin}/p/${response.publication.token}`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Não foi possível ${regenerate ? 'regenerar' : 'publicar'} o painel.`); } finally { setPending(false); }
  }
  async function revoke(dashboard: Dashboard): Promise<void> {
    if (!window.confirm('Revogar este link público? Quem já possui a URL perderá acesso imediatamente.')) return;
    setPending(true); setError(null); setPublicationUrl(null);
    try { await request(`/v1/dashboards/${dashboard.id}/publish`, { method: 'POST', body: JSON.stringify({ published: false, expectedVersion: dashboard.version }) }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível revogar a publicação.'); } finally { setPending(false); }
  }
  return <><p className="eyebrow">Módulo empresarial</p><h1 id="dashboard-title">Painéis</h1><p className="description">Publique somente conteúdo estático autorizado. Cada publicação gera uma URL secreta, revogável e opcionalmente expirada.</p>{error && <p className="form-error" role="alert">{error}</p>}{publicationUrl && <section className="admin-section publication-success"><CheckCircle2 aria-hidden="true" /><div><strong>URL pública criada — copie agora.</strong><p>Por segurança, este token não é armazenado em texto e não poderá ser exibido novamente.</p><code>{publicationUrl}</code><span className="action-row"><button className="secondary-button compact" type="button" onClick={() => void navigator.clipboard.writeText(publicationUrl)}><Copy aria-hidden="true" /> Copiar</button><a className="secondary-button compact" href={publicationUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Abrir</a></span></div></section>}{canManage && <form className="inline-form admin-section" onSubmit={create}><label>Novo painel<input name="title" required minLength={2} maxLength={160} placeholder="Indicadores operacionais" /></label><button className="primary-button compact" type="submit" disabled={pending}>Criar painel</button></form>}<section className="admin-section"><h2>Painéis da organização</h2>{dashboards.length === 0 ? <p className="section-note">Nenhum painel criado.</p> : <div className="form-list">{dashboards.map((dashboard) => <article className="form-row event-detail" key={dashboard.id}><ShieldAlert aria-hidden="true" /><div><strong>{dashboard.title}</strong><small>{dashboard.published ? `Publicado${dashboard.publicExpiresAt ? ` · expira em ${new Date(dashboard.publicExpiresAt).toLocaleString('pt-BR')}` : ''}` : dashboard.publicRevokedAt ? 'Link revogado' : 'Rascunho'} · versão {dashboard.version}</small>{canManage && <div className="action-row"><label>Expira em (opcional)<input id={`dashboard-expiry-${dashboard.id}`} type="datetime-local" disabled={pending} /></label><button className="primary-button compact" type="button" disabled={pending} onClick={() => void publish(dashboard, dashboard.published)}>{dashboard.published ? <><RotateCcw aria-hidden="true" /> Gerar novo link</> : 'Publicar'}</button>{dashboard.published && <button className="secondary-button compact" type="button" disabled={pending} onClick={() => void revoke(dashboard)}>Revogar</button>}</div>}</div></article>)}</div>}</section></>;
}

export function PublicDashboardPage({ token }: { token: string }): React.JSX.Element {
  const [dashboard, setDashboard] = useState<PublicDashboard | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void request<{ dashboard: PublicDashboard }>(`/v1/public/dashboards/${token}`).then((response) => setDashboard(response.dashboard)).catch(() => setError('Este painel não está disponível.')); }, [token]);
  if (!dashboard && !error) return <main className="shell"><p className="loading">Carregando painel…</p></main>;
  if (!dashboard) return <main className="shell"><section className="panel"><h1>Painel indisponível</h1><p className="description">{error}</p></section></main>;
  return <main className="shell"><section className="panel public-dashboard" aria-labelledby="public-dashboard-title"><p className="eyebrow">Painel compartilhado</p><h1 id="public-dashboard-title">{dashboard.title}</h1>{dashboard.description && <p className="description">{dashboard.description}</p>}<div className="overview-grid">{dashboard.widgets.map((widget, index) => <article className="overview-card" key={`${widget.type}-${index}`}><span>{widget.title}</span>{widget.type === 'METRIC' ? <strong>{widget.config.value}</strong> : widget.type === 'TEXT' ? <p>{widget.config.content}</p> : <p>{widget.config.message}</p>}{typeof widget.config.label === 'string' && <small>{widget.config.label}</small>}</article>)}</div></section></main>;
}
