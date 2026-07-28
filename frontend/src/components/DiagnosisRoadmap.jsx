import { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

const phases = [
  { id: '7_days', label: 'Primeros 7 días', description: 'Acciones urgentes que reducen pérdidas inmediatas.' },
  { id: '30_days', label: 'Próximos 30 días', description: 'Estructura, disciplina y visibilidad operativa.' },
  { id: '90_days', label: 'Próximos 90 días', description: 'Automatización, optimización y escalamiento.' },
];
const empty = { phase: '7_days', title: '', description: '', priority: 'high', owner_id: '', due_date: '' };

export default function DiagnosisRoadmap({ diagnosisId, items, profiles, onChanged }) {
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const grouped = useMemo(() => Object.fromEntries(phases.map((phase) => [phase.id, (items || []).filter((item) => item.phase === phase.id)])), [items]);

  const generate = async () => {
    setBusy(true); setError(''); setMessage('');
    try { const result = await api(`/api/diagnose/${diagnosisId}/generate-roadmap`, { method: 'POST' }); setMessage(`${result.created} acciones agregadas al roadmap.`); onChanged?.(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const create = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/api/diagnose/${diagnosisId}/roadmap`, {
        method: 'POST',
        body: JSON.stringify({ ...form, owner_id: form.owner_id || null, due_date: form.due_date || null }),
      });
      setForm(empty); setShowForm(false); onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const update = async (item, patch) => {
    try { await api(`/api/diagnose/${diagnosisId}/roadmap/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); onChanged?.(); }
    catch (e) { setError(e.message); }
  };

  const send = async (item) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/api/diagnose/${diagnosisId}/roadmap/${item.id}/send-to-focus`, {
        method: 'POST',
        body: JSON.stringify({ assigned_to: item.owner_id || null, due_date: item.due_date || null }),
      });
      setMessage('Acción enviada a Focus.'); onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Eliminar la acción “${item.title}”?`)) return;
    try { await api(`/api/diagnose/${diagnosisId}/roadmap/${item.id}`, { method: 'DELETE' }); onChanged?.(); }
    catch (e) { setError(e.message); }
  };

  return (
    <section className="diagnosis-section-stack">
      <div className="section-heading">
        <div><p className="eyebrow">GROWTH ROADMAP</p><h2>Qué corregir primero</h2><p>Convierte los hallazgos en una secuencia realista de ejecución.</p></div>
        <div className="section-actions"><button className="button secondary" onClick={generate} disabled={busy}><Sparkles size={16} />Generar desde hallazgos</button><button className="button diagnose-primary" onClick={() => setShowForm((value) => !value)}><Plus size={16} />Acción manual</button></div>
      </div>
      {error && <div className="form-error">{error}</div>}
      {message && <div className="diagnose-success"><CheckCircle2 size={17} />{message}</div>}

      {showForm && (
        <form className="panel roadmap-form" onSubmit={create}>
          <div className="form-grid three">
            <label>Fase<select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}>{phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.label}</option>)}</select></label>
            <label>Prioridad<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="critical">Crítica</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja</option></select></label>
            <label>Responsable<select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}><option value="">Sin asignar</option>{(profiles || []).map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</select></label>
          </div>
          <label>Acción<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>Descripción<textarea rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>Fecha objetivo<input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
          <div className="form-actions"><button className="button diagnose-primary" disabled={busy}>Guardar acción</button></div>
        </form>
      )}

      <div className="roadmap-timeline">
        {phases.map((phase) => (
          <section key={phase.id} className="roadmap-phase">
            <header><span className="roadmap-dot" /><div><h3>{phase.label}</h3><p>{phase.description}</p></div><strong>{grouped[phase.id]?.length || 0}</strong></header>
            <div className="roadmap-items">
              {(grouped[phase.id] || []).map((item) => (
                <article key={item.id} className={`roadmap-card ${item.priority}`}>
                  <div className="roadmap-card-main">
                    <header><span className={`severity-pill ${item.priority}`}>{item.priority}</span><span>{item.due_date || 'Sin fecha'}</span></header>
                    <h4>{item.title}</h4>
                    {item.description && <p>{item.description}</p>}
                    <small>{item.owner_name || 'Sin asignar'}</small>
                  </div>
                  <div className="roadmap-card-actions">
                    <select value={item.status} onChange={(e) => update(item, { status: e.target.value })}><option value="planned">Planificada</option><option value="sent_to_focus">En Focus</option><option value="in_progress">En progreso</option><option value="completed">Completada</option><option value="cancelled">Cancelada</option></select>
                    <button className="button small diagnose-outline" onClick={() => send(item)} disabled={busy || item.status === 'completed'}><Send size={15} />Enviar a Focus</button>
                    <button className="danger-icon" onClick={() => remove(item)}><Trash2 size={16} /></button>
                  </div>
                </article>
              ))}
              {!(grouped[phase.id] || []).length && <div className="roadmap-empty">Sin acciones en esta fase.</div>}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
