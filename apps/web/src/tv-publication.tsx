import { MonitorPlay } from 'lucide-react';
import { useEffect, useState } from 'react';

type Display = { name: string; refreshSeconds: number; dashboard: { title: string; description: string | null; widgets: Array<{ type: 'TEXT' | 'METRIC' | 'NOTICE'; title: string; config: Record<string, string | number> }> } };
type Playlist = { title: string; intervalSeconds: number; displays: Array<{ name: string; dashboard: Display['dashboard'] }> };

export function PublicTvDisplayPage({ token }: { token: string }): React.JSX.Element {
  const [display, setDisplay] = useState<Display | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined; let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/v1/public/tv/displays/${token}`, { headers: { 'content-type': 'application/json' } });
        if (!response.ok) throw new Error(); const body = await response.json() as { display: Display }; if (!cancelled) { setDisplay(body.display); setError(null); timer = window.setTimeout(load, Math.max(5, body.display.refreshSeconds) * 1_000); }
      } catch { if (!cancelled) setError('Esta TV não está disponível.'); }
    };
    void load(); return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [token]);
  if (!display && !error) return <main className="shell"><p className="loading">Carregando TV…</p></main>;
  if (!display) return <main className="shell"><section className="panel"><h1>TV indisponível</h1><p className="description">{error}</p></section></main>;
  const dashboard = display.dashboard;
  return <main className="shell"><section className="panel public-dashboard" aria-labelledby="tv-title"><p className="eyebrow"><MonitorPlay aria-hidden="true" /> TV corporativa</p><h1 id="tv-title">{dashboard.title}</h1>{dashboard.description && <p className="description">{dashboard.description}</p>}<div className="overview-grid">{dashboard.widgets.map((widget, index) => <article className="overview-card" key={`${widget.type}-${index}`}><span>{widget.title}</span>{widget.type === 'METRIC' ? <strong>{widget.config.value}</strong> : widget.type === 'TEXT' ? <p>{widget.config.content}</p> : <p>{widget.config.message}</p>}{typeof widget.config.label === 'string' && <small>{widget.config.label}</small>}</article>)}</div><small className="section-note">{display.name} · atualização a cada {display.refreshSeconds}s</small></section></main>;
}

export function PublicTvPlaylistPage({ token }: { token: string }): React.JSX.Element {
  const [playlist, setPlaylist] = useState<Playlist | null>(null); const [index, setIndex] = useState(0); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined; let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/v1/public/tv/playlists/${token}`, { headers: { 'content-type': 'application/json' } });
        if (!response.ok) throw new Error(); const body = await response.json() as { playlist: Playlist }; if (!cancelled) { setPlaylist(body.playlist); setIndex((current) => current >= body.playlist.displays.length ? 0 : current); setError(null); timer = window.setTimeout(load, Math.max(5, body.playlist.intervalSeconds) * 1_000); }
      } catch { if (!cancelled) setError('Esta TV não está disponível.'); }
    };
    void load(); return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [token]);
  useEffect(() => {
    if (!playlist) return; const timer = window.setInterval(() => setIndex((current) => (current + 1) % playlist.displays.length), Math.max(5, playlist.intervalSeconds) * 1_000);
    return () => window.clearInterval(timer);
  }, [playlist]);
  if (!playlist && !error) return <main className="shell"><p className="loading">Carregando TV…</p></main>;
  if (!playlist) return <main className="shell"><section className="panel"><h1>TV indisponível</h1><p className="description">{error}</p></section></main>;
  const display = playlist.displays[index]!; const dashboard = display.dashboard;
  return <main className="shell"><section className="panel public-dashboard" aria-labelledby="playlist-title"><p className="eyebrow"><MonitorPlay aria-hidden="true" /> {playlist.title}</p><h1 id="playlist-title">{dashboard.title}</h1>{dashboard.description && <p className="description">{dashboard.description}</p>}<div className="overview-grid">{dashboard.widgets.map((widget, widgetIndex) => <article className="overview-card" key={`${widget.type}-${widgetIndex}`}><span>{widget.title}</span>{widget.type === 'METRIC' ? <strong>{widget.config.value}</strong> : widget.type === 'TEXT' ? <p>{widget.config.content}</p> : <p>{widget.config.message}</p>}{typeof widget.config.label === 'string' && <small>{widget.config.label}</small>}</article>)}</div><small className="section-note">{display.name} · {index + 1}/{playlist.displays.length} · alternância a cada {playlist.intervalSeconds}s</small></section></main>;
}
