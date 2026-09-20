import { Bell, Building2, ClipboardList, FileText, LayoutDashboard, LogOut, Menu, MonitorPlay, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';

type DashboardView = 'home' | 'forms' | 'notifications' | 'events' | 'changes' | 'bash' | 'hht' | 'dashboards' | 'tv' | 'integrations' | 'classifications' | 'files' | 'organization' | 'profile';

type DashboardShellProps = {
  children: ReactNode;
  collapsed: boolean;
  identity: { user: { email: string }; organization: { name: string; slug: string }; membership: { role: string }; access: { isPlatformAdmin: boolean } };
  onLogout: () => void;
  onNavigate: (view: DashboardView) => void;
  onToggle: () => void;
  pending: boolean;
  unreadNotifications: number;
  view: DashboardView;
};

const menuGroups: Array<{ label: string; items: Array<{ view: DashboardView; label: string; icon: typeof LayoutDashboard }> }> = [
  { label: 'Workspace', items: [{ view: 'home', label: 'Visão geral', icon: LayoutDashboard }, { view: 'forms', label: 'Formulários', icon: FileText }] },
  { label: 'Operação', items: [{ view: 'events', label: 'Eventos', icon: ClipboardList }, { view: 'changes', label: 'Mudanças', icon: ShieldCheck }, { view: 'bash', label: 'BASH', icon: ClipboardList }, { view: 'hht', label: 'HHT', icon: ClipboardList }] },
  { label: 'Produtos', items: [{ view: 'dashboards', label: 'Painéis', icon: LayoutDashboard }, { view: 'tv', label: 'TV corporativa', icon: MonitorPlay }] },
  { label: 'Administração', items: [{ view: 'integrations', label: 'Integrações', icon: Settings2 }, { view: 'classifications', label: 'Listas', icon: ClipboardList }, { view: 'files', label: 'Arquivos', icon: FileText }, { view: 'organization', label: 'Organização', icon: UsersRound }] }
];

export function DashboardShell({ children, collapsed, identity, onLogout, onNavigate, onToggle, pending, unreadNotifications, view }: DashboardShellProps): React.JSX.Element {
  const initials = identity.user.email.slice(0, 2).toUpperCase();
  return <main className={`dashboard-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
    <aside className="dashboard-sidebar" aria-label="Navegação principal">
      <div className="sidebar-top">
        <div className="sidebar-brand"><span className="sidebar-logo"><Building2 aria-hidden="true" /></span><span className="sidebar-brand-copy"><strong>Builder</strong><small>Solutions</small></span></div>
        <button className="sidebar-toggle" type="button" aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'} onClick={onToggle}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</button>
      </div>
      <nav className="sidebar-nav">{menuGroups.map((group) => <section className="sidebar-group" key={group.label} aria-label={group.label}><p>{group.label}</p>{group.items.map((item) => { const Icon = item.icon; return <button className="sidebar-item" data-active={view === item.view || undefined} key={item.view} type="button" aria-current={view === item.view ? 'page' : undefined} title={collapsed ? item.label : undefined} onClick={() => onNavigate(item.view)}><Icon aria-hidden="true" /><span>{item.label}</span></button>; })}</section>)}</nav>
      <div className="sidebar-account">
        <button className="account-summary" type="button" title={collapsed ? 'Abrir perfil' : undefined} onClick={() => onNavigate('profile')}><span className="account-avatar">{initials}</span><span className="account-copy"><strong>{identity.user.email}</strong><small>{identity.organization.name}</small></span><Menu className="account-menu-icon" aria-hidden="true" /></button>
        <button className="account-overview" type="button" onClick={() => onNavigate('home')}><LayoutDashboard aria-hidden="true" /><span>Visão geral</span></button>
        <button className="account-logout" type="button" onClick={onLogout} disabled={pending}><LogOut aria-hidden="true" /><span>Sair</span></button>
      </div>
    </aside>
    <section className="dashboard-main"><header className="dashboard-topbar"><div><p>{identity.organization.slug}</p><strong>{identity.organization.name}</strong></div><div className="topbar-actions"><button className="sidebar-toggle" type="button" aria-label={`Notificações${unreadNotifications ? `: ${unreadNotifications} não lidas` : ''}`} onClick={() => onNavigate('notifications')}><Bell aria-hidden="true" />{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</button><button className="mobile-menu-toggle" type="button" aria-label="Alternar menu" onClick={onToggle}><Menu aria-hidden="true" /></button></div></header><section className="dashboard-content">{children}</section></section>
  </main>;
}
