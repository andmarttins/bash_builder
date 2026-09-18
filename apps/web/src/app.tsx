import { Building2, ShieldCheck } from 'lucide-react';

export function App(): React.JSX.Element {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="title">
        <div className="icon"><Building2 aria-hidden="true" /></div>
        <p className="eyebrow">Builder Solutions</p>
        <h1 id="title">A nova plataforma multi-tenant está preparada.</h1>
        <p className="description">
          A fundação técnica está ativa. Os módulos de identidade, organizações e formulários serão
          habilitados nas próximas entregas.
        </p>
        <div className="status"><ShieldCheck aria-hidden="true" /> Base isolada por organização</div>
      </section>
    </main>
  );
}

