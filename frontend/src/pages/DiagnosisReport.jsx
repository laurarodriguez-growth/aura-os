import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import AuraLogo from '../components/AuraLogo';

const sectionLabels = { icp: 'ICP Assessment', conversion: 'Conversion Audit', process: 'Process Analysis', automation: 'Automation Score' };
const phaseLabels = { '7_days': 'Primeros 7 días', '30_days': 'Próximos 30 días', '90_days': 'Próximos 90 días' };
const impactLabels = { low: 'Bajo', medium: 'Medio', high: 'Alto', critical: 'Crítico' };

export default function DiagnosisReport() {
  const { diagnosisId } = useParams();
  const [diagnosis, setDiagnosis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/api/diagnose/${diagnosisId}`)
      .then(setDiagnosis)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [diagnosisId]);

  const assessmentMap = useMemo(() => Object.fromEntries((diagnosis?.assessments || []).map((item) => [item.section, item])), [diagnosis]);

  if (loading) return <main className="report-loading">Preparando informe…</main>;
  if (!diagnosis) return <main className="report-loading">{error || 'Informe no disponible'}</main>;

  return (
    <main className="diagnosis-report-page">
      <div className="report-toolbar no-print"><Link className="button secondary" to={`/diagnose/${diagnosisId}/report`}><ArrowLeft size={16} />Volver a Diagnose</Link><button className="button diagnose-primary" onClick={() => window.print()}><Printer size={17} />Guardar como PDF</button></div>

      <article className="diagnosis-report-sheet">
        <header className="report-cover">
          <div className="report-brand"><span className="report-brand-logo"><AuraLogo /></span><div><strong>AURA GROW</strong><small>Diagnose · by Laura Rodriguez</small></div></div>
          <p>DIAGNÓSTICO DE CRECIMIENTO</p>
          <h1>{diagnosis.company_name}</h1>
          <h2>{diagnosis.industry || 'Evaluación estratégica'}</h2>
          <div className="report-cover-score"><strong>{diagnosis.overall_score}</strong><span>/100</span><small>{diagnosis.overall_level}</small></div>
          <footer><span>{diagnosis.city || 'Panamá'}</span><span>{new Date().toLocaleDateString('es-PA', { year: 'numeric', month: 'long', day: 'numeric' })}</span></footer>
        </header>

        <section className="report-section">
          <p className="report-kicker">01 · RESUMEN EJECUTIVO</p>
          <h2>Situación actual</h2>
          <p className="report-lead-copy">{diagnosis.executive_summary || diagnosis.declared_problem || 'Completa el resumen ejecutivo dentro de Diagnose para personalizar esta sección.'}</p>
          <div className="report-context-grid"><div><span>Objetivo</span><p>{diagnosis.objective || 'No definido'}</p></div><div><span>Problema declarado</span><p>{diagnosis.declared_problem || 'No definido'}</p></div></div>
        </section>

        <section className="report-section">
          <p className="report-kicker">02 · SCORES</p>
          <h2>Lectura del sistema de crecimiento</h2>
          <div className="report-score-grid">
            {Object.entries(sectionLabels).map(([key, label]) => <div key={key}><span>{label}</span><strong>{assessmentMap[key]?.score || 0}</strong><small>{assessmentMap[key]?.level || 'Sin evaluar'}</small></div>)}
          </div>
        </section>

        <section className="report-section report-page-break">
          <p className="report-kicker">03 · HALLAZGOS PRIORITARIOS</p>
          <h2>Qué está frenando el crecimiento</h2>
          <div className="report-findings">
            {(diagnosis.findings || []).filter((item) => item.status !== 'dismissed').map((item, index) => (
              <article key={item.id}><header><span>{String(index + 1).padStart(2, '0')}</span><strong>{impactLabels[item.impact] || item.impact}</strong></header><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}{item.evidence && <blockquote>{item.evidence}</blockquote>}{item.recommendation && <div><small>RECOMENDACIÓN</small><p>{item.recommendation}</p></div>}</article>
            ))}
            {!(diagnosis.findings || []).length && <p>No hay hallazgos registrados.</p>}
          </div>
        </section>

        <section className="report-section report-page-break">
          <p className="report-kicker">04 · GROWTH ROADMAP</p>
          <h2>Qué corregir primero</h2>
          {Object.entries(phaseLabels).map(([phase, label]) => (
            <div key={phase} className="report-roadmap-phase"><h3>{label}</h3>{(diagnosis.roadmap || []).filter((item) => item.phase === phase && item.status !== 'cancelled').map((item) => <article key={item.id}><span>{item.priority}</span><div><strong>{item.title}</strong><p>{item.description || ''}</p><small>{item.owner_name || 'Sin asignar'} · {item.due_date || 'Sin fecha'}</small></div></article>)}</div>
          ))}
        </section>

        <section className="report-section report-closing">
          <p className="report-kicker">05 · PRÓXIMO PASO</p>
          <h2>Diagnose piensa. Focus ejecuta.</h2>
          <p>El roadmap debe convertirse en responsables, fechas, acciones y métricas dentro de Aura Focus. El diagnóstico permanece vivo para comparar avances y actualizar prioridades.</p>
          <div className="report-signature"><strong>Laura Rodriguez</strong><span>Growth Strategist · AI · Automation · Marketing</span></div>
        </section>
      </article>
    </main>
  );
}
