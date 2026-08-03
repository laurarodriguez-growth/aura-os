import { AlertTriangle, CheckCircle2, CircleHelp, ShieldCheck } from 'lucide-react';

const areaLabels = {
  first_response: 'Primera respuesta',
  qualification_next_step: 'Calificación y siguiente paso',
  followup: 'Seguimiento',
  appointments_recovery: 'Citas y recuperación',
  measurement_conversion: 'Medición y conversión',
  team_responsibilities: 'Equipo y responsabilidades',
  tools_records: 'Herramientas y registros',
  patient_experience: 'Experiencia del paciente',
};
const statusLabels = { green: 'Controlado', yellow: 'Inconsistente', red: 'Pérdida probable', gray: 'Sin evidencia' };

export default function DiagnosisDefinitiveOverview({ data }) {
  const metrics = data?.metrics || { maturity: null, evidence_coverage: 0, areas: [] };
  const readiness = data?.report_readiness || {};
  return (
    <section className="diagnosis-section-stack definitive-overview">
      <div className="definitive-metrics">
        <article><span>Madurez del proceso</span><strong>{metrics.maturity ?? '—'}</strong><small>{metrics.maturity == null ? 'Aún no evaluada' : 'sobre 100 · solo áreas evaluadas'}</small></article>
        <article><span>Cobertura de evidencia</span><strong>{metrics.evidence_coverage || 0}%</strong><small>Separada de la madurez</small></article>
        <article><span>Informe preliminar</span><strong><CheckCircle2 size={24} /></strong><small>Disponible con limitaciones declaradas</small></article>
        <article className={readiness.final_ready ? 'ready' : 'pending'}><span>Informe final</span><strong>{readiness.final_ready ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}</strong><small>{readiness.final_ready ? 'Validaciones completas' : 'Aún requiere validación'}</small></article>
      </div>

      <section className="panel coverage-panel">
        <div className="section-heading"><div><p className="eyebrow">COBERTURA</p><h2>Madurez y evidencia no son lo mismo</h2><p>Gris no reduce la madurez: indica que todavía no hay base suficiente para evaluar.</p></div></div>
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
          <div><h3>Qué falta para cerrar el informe final</h3><ul>{(readiness.reasons || []).map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
        </section>
      )}

      <section className="panel process-xray-preview">
        <p className="eyebrow">RADIOGRAFÍA DEL PROCESO</p>
        <div>{(data?.process_xray || []).map((stage, index) => <article key={`${stage.label}-${index}`}><span className={`stage-dot ${stage.visual_status}`} /><strong>{stage.label}</strong><small>{statusLabels[stage.visual_status]}</small></article>)}</div>
      </section>
    </section>
  );
}
