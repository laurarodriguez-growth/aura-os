import { AlertTriangle, CheckCircle2, CircleHelp, ShieldCheck } from 'lucide-react';

const areaLabels = {
  first_response: 'Respuesta',
  qualification_next_step: 'Consulta y siguiente paso',
  followup: 'Seguimiento',
  appointments_recovery: 'Cita y recuperación',
  measurement_conversion: 'Venta y medición',
  team_responsibilities: 'Capacidad y responsables',
  tools_records: 'Herramientas y registros',
  patient_experience: 'Cliente y oferta',
};
const statusLabels = { green: 'Controlado', yellow: 'Inconsistente', red: 'Pérdida probable', gray: 'Sin evidencia' };

export default function DiagnosisDefinitiveOverview({ data }) {
  const metrics = data?.metrics || { maturity: null, evidence_coverage: 0, areas: [] };
  const readiness = data?.report_readiness || {};
  return (
    <section className="diagnosis-section-stack definitive-overview">
      <section className="panel process-xray-preview aura-journey-overview">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECORRIDO DE CONVERSIÓN</p>
            <h2>Consulta → Respuesta → Seguimiento → Cita → Venta</h2>
            <p>El Diagnóstico AURA confirma con evidencia dónde una oportunidad deja de avanzar, queda sin próximo paso o se pierde.</p>
          </div>
        </div>
        <div>{(data?.process_xray || []).map((stage, index) => <article key={`${stage.label}-${index}`}><span className={`stage-dot ${stage.visual_status}`} /><strong>{stage.label}</strong><small>{statusLabels[stage.visual_status]}</small></article>)}</div>
      </section>

      <div className="definitive-metrics">
        <article><span>Madurez del sistema</span><strong>{metrics.maturity ?? '—'}</strong><small>{metrics.maturity == null ? 'Aún no evaluada' : 'índice interno · no sustituye la evidencia'}</small></article>
        <article><span>Cobertura de evidencia</span><strong>{metrics.evidence_coverage || 0}%</strong><small>Qué parte del proceso ya pudo comprobarse</small></article>
        <article><span>Informe preliminar</span><strong><CheckCircle2 size={24} /></strong><small>Disponible con limitaciones declaradas</small></article>
        <article className={readiness.final_ready ? 'ready' : 'pending'}><span>Diagnóstico confirmado</span><strong>{readiness.final_ready ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}</strong><small>{readiness.final_ready ? 'Evidencia crítica validada' : 'Aún requiere validación'}</small></article>
      </div>

      <section className="panel coverage-panel">
        <div className="section-heading"><div><p className="eyebrow">LECTURA DEL SISTEMA</p><h2>Qué está controlado, qué es inconsistente y qué todavía no sabemos</h2><p>Gris significa sin evidencia suficiente. No debe convertirse en una conclusión negativa.</p></div></div>
        <div className="coverage-list">
          {(metrics.areas || []).map((area) => (
            <article key={area.area}>
              <div><strong>{areaLabels[area.area] || area.area}</strong><small>Peso interno {area.weight}%</small></div>
              <span className={`visual-status ${area.visual_status}`}>{statusLabels[area.visual_status]}</span>
              <span className={area.evidence_covered ? 'evidence-covered' : 'evidence-missing'}>{area.evidence_covered ? 'Con evidencia' : 'Por validar'}</span>
            </article>
          ))}
        </div>
      </section>

      {!readiness.final_ready && (
        <section className="panel readiness-panel">
          <CircleHelp size={22} />
          <div><h3>Qué falta para confirmar el Diagnóstico AURA</h3><ul>{(readiness.reasons || []).map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
        </section>
      )}
    </section>
  );
}
