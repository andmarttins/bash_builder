import { useEffect, useState } from 'react';

type PublicHhtReport = {
  year: number;
  month: number;
  closedAt: string | null;
  companies: number;
  hhtWorked: number;
  hhtMeal: number;
  workforce: number;
  lostDays: number;
  lti: number;
  rates: { trifr: number; ltifr: number; ltisr: number };
};

async function requestPublicHht(token: string): Promise<PublicHhtReport> {
  const response = await fetch(`/api/v1/public/hht/${token}`, {
    credentials: 'omit',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Consolidado indisponível.');
  const body = await response.json() as { report: PublicHhtReport };
  return body.report;
}

function number(value: number, digits = 2): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);
}

export function PublicHhtPage({ token }: { token: string }): React.JSX.Element {
  const [report, setReport] = useState<PublicHhtReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void requestPublicHht(token).then(setReport).catch(() => setError('Este consolidado HHT não está disponível.'));
  }, [token]);

  if (!report && !error) return <main className="shell"><p className="loading">Carregando consolidado HHT…</p></main>;
  if (!report) return <main className="shell"><section className="panel"><h1>Consolidado HHT indisponível</h1><p className="description">{error}</p></section></main>;

  const period = `${String(report.month).padStart(2, '0')}/${report.year}`;
  return <main className="shell"><section className="panel public-dashboard" aria-labelledby="public-hht-title"><p className="eyebrow">Consolidado compartilhado</p><h1 id="public-hht-title">HHT e taxas — {period}</h1><p className="description">Período encerrado{report.closedAt ? ` em ${new Date(report.closedAt).toLocaleDateString('pt-BR')}` : ''}.</p><div className="overview-grid"><article className="overview-card"><span>Empresas/unidades</span><strong>{number(report.companies, 0)}</strong></article><article className="overview-card"><span>HHT trabalhadas</span><strong>{number(report.hhtWorked)}</strong></article><article className="overview-card"><span>HHT refeição</span><strong>{number(report.hhtMeal)}</strong></article><article className="overview-card"><span>Efetivo</span><strong>{number(report.workforce, 0)}</strong></article><article className="overview-card"><span>Dias perdidos</span><strong>{number(report.lostDays, 0)}</strong></article><article className="overview-card"><span>Acidentes LTI</span><strong>{number(report.lti, 0)}</strong></article><article className="overview-card"><span>TRIFR</span><strong>{number(report.rates.trifr, 4)}</strong></article><article className="overview-card"><span>LTIFR</span><strong>{number(report.rates.ltifr, 4)}</strong></article><article className="overview-card"><span>LTISR</span><strong>{number(report.rates.ltisr, 4)}</strong></article></div></section></main>;
}
