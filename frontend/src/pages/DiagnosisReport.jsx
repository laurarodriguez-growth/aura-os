import { useEffect, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import AuraLogo from '../components/AuraLogo';
import { api } from '../lib/api';

const statusLabels = { green: 'Controlado', yellow: 'Inconsistente', red: 'Pérdida probable', gray: 'Sin evidencia' };
const priorityLabels = { immediate: 'Corregir inmediatamente', '30_days': 'Organizar durante los próximos 30 días', later: 'Automatizar después', do_not_touch: 'No tocar todavía' };

export default function DiagnosisReport() {
  const { diagnosisId } = useParams();
  const [params] = useSearchParams();
  const reportType = params.get('type') === 'final' ? 'final' : 'preliminary';
  const [diagnosis, setDiagnosis] = useState(null);
  const [definitive, setDefinitive] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { Promise.all([api(`/api/diagnose/${diagnosisId}`), api(`/api/diagnose/${diagnosisId}/definitive`)]).then(([base, detail]) => { setDiagnosis(base); setDefinitive(detail); }).catch((e) => setError(e.message)); }, [diagnosisId]);
  if (!diagnosis || !definitive) return <main className="report-loading">{error || 'Preparando informe…'}</main>;

  return <main className="diagnosis-report-page"><div className="report-toolbar no-print"><Link className="button secondary" to={`/diagnose/${diagnosisId}/report`}><ArrowLeft size={16} />Volver a Diagnose</Link><button className="button diagnose-primary" onClick={() => window.print()}><Printer size={17} />Guardar como PDF</button></div><article className="diagnosis-report-sheet">
    <header className="report-cover"><div className="report-brand"><span className="report-brand-logo"><AuraLogo /></span><div><strong>AURA GROW</strong><small>Diagnose · by Laura Rodriguez</small></div></div><p>{reportType === 'final' ? 'INFORME FINAL VALIDADO' : 'INFORME PRELIMINAR'}</p><h1>{diagnosis.company_name}</h1><h2>{diagnosis.industry || 'Diagnóstico del proceso comercial y de atención'}</h2><div className="report-cover-score"><strong>{definitive.metrics.maturity ?? '—'}</strong><span>/100</span><small>Madurez · cobertura {definitive.metrics.evidence_coverage}%</small></div><footer><span>{diagnosis.city || 'Panamá'}</span><span>{new Date().toLocaleDateString('es-PA', { year: 'numeric', month: 'long', day: 'numeric' })}</span></footer></header>

    {reportType === 'preliminary' && <section className="report-section report-limitations"><p className="report-kicker">ALCANCE PRELIMINAR</p><h2>Validaciones y límites pendientes</h2><p>Este documento puede orientar decisiones, pero no presenta como comprobado lo que aún carece de evidencia.</p><ul>{definitive.report_readiness.reasons.map((item) => <li key={item}>{item}</li>)}</ul></section>}

    <section className="report-section"><p className="report-kicker">01 · RESUMEN EJECUTIVO</p><h2>Situación actual</h2><p className="report-lead-copy">{diagnosis.executive_summary || diagnosis.declared_problem || 'Resumen pendiente de completar.'}</p><div className="report-context-grid"><div><span>Objetivo</span><p>{diagnosis.objective || 'No definido'}</p></div><div><span>Problema declarado</span><p>{diagnosis.declared_problem || 'No definido'}</p></div></div></section>

    <section className="report-section report-page-break"><p className="report-kicker">02 · RADIOGRAFÍA DEL PROCESO</p><h2>De la consulta al resultado</h2><div className="report-process-xray">{definitive.process_xray.map((stage) => <article key={stage.label}><span className={`stage-dot ${stage.visual_status}`} /><div><strong>{stage.label}</strong><small>{statusLabels[stage.visual_status]}</small>{stage.finding && <p>{stage.finding}</p>}</div></article>)}</div></section>

    <section className="report-section report-page-break"><p className="report-kicker">03 · PUNTOS DE PÉRDIDA</p><h2>Dónde se escapan oportunidades</h2><div className="report-loss-points">{definitive.loss_points.map((item, index) => <article key={`${item.block_key}-${index}`}><header><span>{String(index + 1).padStart(2, '0')}</span><strong>{statusLabels[item.visual_status]}</strong></header><h3>{item.finding || 'Hallazgo pendiente de redactar'}</h3><dl><div><dt>Evidencia</dt><dd>{item.evidence || 'Pendiente de validar'}</dd></div><div><dt>Riesgo</dt><dd>{item.risk || 'No documentado'}</dd></div><div><dt>Impacto comercial</dt><dd>{item.commercial_impact || 'No documentado'}</dd></div><div><dt>Confianza</dt><dd>{item.confidence}</dd></div></dl></article>)}{!definitive.loss_points.length && <p>No hay puntos de pérdida evaluados todavía.</p>}</div></section>

    <section className="report-section report-page-break"><p className="report-kicker">04 · PRIORIDADES</p><h2>Qué corregir y cuándo</h2>{Object.entries(priorityLabels).map(([key, label]) => <div className="report-priority-group" key={key}><h3>{label}</h3>{(definitive.priorities[key] || []).map((item) => <article key={item.id}><strong>{item.finding || item.block_key}</strong><p>{item.recommendation || 'Recomendación pendiente'}</p></article>)}</div>)}</section>

    <section className="report-section report-page-break"><p className="report-kicker">05 · ROADMAP</p><h2>Responsables, plazos y verificación</h2><div className="report-roadmap-table">{diagnosis.roadmap.filter((item) => item.status !== 'cancelled').map((item) => <article key={item.id}><h3>{item.title}</h3><dl><div><dt>Responsable</dt><dd>{item.owner_name || 'Sin asignar'}</dd></div><div><dt>Plazo</dt><dd>{item.due_date || 'Sin fecha'}</dd></div><div><dt>Métrica</dt><dd>{item.metric || 'Pendiente'}</dd></div><div><dt>Herramienta</dt><dd>{item.tool || 'Pendiente'}</dd></div><div><dt>Evidencia de cumplimiento</dt><dd>{item.compliance_evidence || 'Pendiente'}</dd></div><div><dt>Dependencia</dt><dd>{item.dependency || 'Ninguna documentada'}</dd></div></dl></article>)}</div></section>

    {diagnosis.implementation_recommended && <section className="report-section report-page-break implementation-offer"><p className="report-kicker">06 · OPCIONAL</p><h2>Implementación inicial · $150 adicionales</h2><p>Esta opción se presenta después del diagnóstico y no altera los hallazgos.</p><dl><div><dt>Incluye</dt><dd>{diagnosis.implementation_scope || 'Mejoras iniciales acordadas'}</dd></div><div><dt>No incluye</dt><dd>{diagnosis.implementation_exclusions || 'Trabajo fuera del alcance acordado'}</dd></div><div><dt>Plazo</dt><dd>{diagnosis.implementation_timeline || 'Por acordar'}</dd></div><div><dt>Entregables</dt><dd>{diagnosis.implementation_deliverables || 'Por acordar'}</dd></div><div><dt>Responsabilidades del cliente</dt><dd>{diagnosis.client_responsibilities || 'Por acordar'}</dd></div><div><dt>Métrica inicial</dt><dd>{diagnosis.implementation_metric || 'Por acordar'}</dd></div></dl></section>}

    <section className="report-section report-closing"><p className="report-kicker">CIERRE</p><h2>Diagnose prescribe. Focus ejecuta.</h2><p>El roadmap se convierte en responsables, fechas, acciones y métricas dentro de Aura Focus. La evidencia permanece restringida y puede eliminarse al concluir el servicio.</p><div className="report-signature"><strong>Laura Rodriguez</strong><span>Growth Strategist · AI · Automation · Marketing</span></div></section>
  </article></main>;
}
