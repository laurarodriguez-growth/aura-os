import { useState } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

const empty = { title: '', description: '', evidence: '', impact: 'high', urgency: 'high', recommendation: '', priority: 75 };
const labels = { low: 'Bajo', medium: 'Medio', high: 'Alto', critical: 'Crítico' };

export default function DiagnosisFindings({ diagnosisId, items, onChanged }) {
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setBusy(true); setError('');
    try { await api(`/api/diagnose/${diagnosisId}/generate-findings`, { method: 'POST' }); onChanged?.(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/api/diagnose/${diagnosisId}/findings`, { method: 'POST', body: JSON.stringify(form) });
      setForm(empty); setShowForm(false); onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const update = async (item, patch) => {
    try { await api(`/api/diagnose/${diagnosisId}/findings/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); onChanged?.(); }
    catch (e) { setError(e.message); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Eliminar el hallazgo “${item.title}”?`)) return;
    try { await api(`/api/diagnose/${diagnosisId}/findings/${item.id}`, { method: 'DELETE' }); onChanged?.(); }
    catch (e) { setError(e.message); }
  };

  return (
    <section className="diagnosis-section-stack">
      <div className="section-heading">
        <div><p className="eyebrow">HALLAZGOS</p><h2>Qué está frenando el crecimiento</h2><p>Genera hallazgos desde las evaluaciones y agrega el criterio estratégico de Laura.</p></div>
        <div className="section-actions"><button className="button secondary" onClick={generate} disabled={busy}><Sparkles size={16} />Generar desde scores</button><button className="button diagnose-primary" onClick={() => setShowForm((value) => !value)}><Plus size={16} />Hallazgo manual</button></div>
      </div>
      {error && <div className="form-error">{error}</div>}

      {showForm && (
        <form className="panel finding-form" onSubmit={create}>
          <label>Título<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <div className="form-grid three">
            <label>Impacto<select value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Urgencia<select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Prioridad<input type="number" min="0" max="100" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></label>
          </div>
          <label>Descripción<textarea rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>Evidencia<textarea rows="2" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} /></label>
          <label>Recomendación<textarea rows="3" value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} /></label>
          <div className="form-actions"><button className="button diagnose-primary" disabled={busy}>Guardar hallazgo</button></div>
        </form>
      )}

      <div className="finding-list">
        {(items || []).map((item) => (
          <article key={item.id} className={`finding-card ${item.impact}`}>
            <header><div><span className={`severity-pill ${item.impact}`}>{labels[item.impact]}</span><span className={`severity-pill urgency ${item.urgency}`}>Urgencia {labels[item.urgency]}</span></div><strong>{item.priority}</strong></header>
            <h3>{item.title}</h3>
            {item.description && <p>{item.description}</p>}
            {item.evidence && <blockquote>{item.evidence}</blockquote>}
            {item.recommendation && <div className="finding-recommendation"><small>RECOMENDACIÓN</small><p>{item.recommendation}</p></div>}
            <footer><select value={item.status} onChange={(e) => update(item, { status: e.target.value })}><option value="open">Abierto</option><option value="sent_to_focus">Enviado a Focus</option><option value="resolved">Resuelto</option><option value="dismissed">Descartado</option></select><button className="danger-icon" onClick={() => remove(item)}><Trash2 size={16} /></button></footer>
          </article>
        ))}
        {!(items || []).length && <div className="panel diagnose-empty-inline">Guarda evaluaciones y pulsa “Generar desde scores”.</div>}
      </div>
    </section>
  );
}
