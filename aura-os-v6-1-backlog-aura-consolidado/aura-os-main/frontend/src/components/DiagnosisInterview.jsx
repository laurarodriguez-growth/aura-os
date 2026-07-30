import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCopy,
  MessageSquarePlus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';

const sectionLabels = { general: 'Dirección y objetivos', icp: 'ICP', conversion: 'Conversión', process: 'Procesos', automation: 'Automatización' };
const priorityLabels = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };
const sectionOrder = ['general', 'icp', 'conversion', 'process', 'automation'];

export default function DiagnosisInterview({ diagnosisId, items, analysis, onChanged }) {
  const [drafts, setDrafts] = useState({});
  const [dirty, setDirty] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newQuestion, setNewQuestion] = useState({ question: '', rationale: '', section: 'general', priority: 'medium' });

  useEffect(() => {
    setDrafts(Object.fromEntries((items || []).map((item) => [item.id, { answer: item.answer || '', status: item.status || 'pending' }])));
    setDirty(new Set());
  }, [items]);

  const grouped = useMemo(() => Object.fromEntries(sectionOrder.map((section) => [section, (items || []).filter((item) => item.section === section)])), [items]);
  const answered = (items || []).filter((item) => item.status === 'answered').length;
  const pending = (items || []).filter((item) => item.status === 'pending').length;

  const change = (id, field, value) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
    setDirty((current) => new Set([...current, id]));
    setMessage('');
  };

  const saveAll = async () => {
    if (!dirty.size) return;
    setSaving(true); setError('');
    try {
      await Promise.all([...dirty].map((id) => {
        const draft = drafts[id];
        const status = draft.status === 'not_applicable' ? 'not_applicable' : draft.answer.trim() ? 'answered' : 'pending';
        return api(`/api/diagnose/${diagnosisId}/interview-questions/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ answer: draft.answer, status }),
        });
      }));
      setMessage('Respuestas guardadas.');
      setDirty(new Set());
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const reanalyze = async () => {
    if (dirty.size) {
      setError('Guarda las respuestas antes de volver a analizar.');
      return;
    }
    setAnalyzing(true); setError('');
    try {
      await api(`/api/diagnose/${diagnosisId}/analyze-evidence`, { method: 'POST' });
      setMessage('Aura reanalizó las evidencias junto con las respuestas de la entrevista.');
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setAnalyzing(false); }
  };

  const copyScript = async () => {
    const text = (items || []).filter((item) => item.status === 'pending').map((item, index) => `${index + 1}. ${item.question}\n   Motivo: ${item.rationale || ''}`).join('\n\n');
    await navigator.clipboard.writeText(text || 'No hay preguntas pendientes.');
    setMessage('Guion copiado.');
  };

  const addQuestion = async (event) => {
    event.preventDefault();
    if (!newQuestion.question.trim()) return;
    setSaving(true); setError('');
    try {
      await api(`/api/diagnose/${diagnosisId}/interview-questions`, { method: 'POST', body: JSON.stringify(newQuestion) });
      setNewQuestion({ question: '', rationale: '', section: 'general', priority: 'medium' });
      setMessage('Pregunta agregada.');
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Eliminar la pregunta “${item.question}”?`)) return;
    try {
      await api(`/api/diagnose/${diagnosisId}/interview-questions/${item.id}`, { method: 'DELETE' });
      onChanged?.();
    } catch (e) { setError(e.message); }
  };

  return (
    <section className="diagnosis-section-stack interview-page">
      <div className="section-heading interview-heading">
        <div>
          <p className="eyebrow">ENTREVISTA AL DECISOR</p>
          <h2>Completa lo que la evidencia no puede confirmar</h2>
          <p>Aura ordena las preguntas por área y prioridad. Guarda las respuestas durante o después de la entrevista.</p>
        </div>
        <div className="interview-heading-actions">
          <button className="button secondary" onClick={copyScript}><ClipboardCopy size={17} />Copiar guion</button>
          <button className="button diagnose-primary" onClick={reanalyze} disabled={analyzing}><Sparkles size={17} />{analyzing ? 'Reanalizando…' : 'Reanalizar con respuestas'}</button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      {message && <div className="diagnose-success"><CheckCircle2 size={17} />{message}</div>}

      <div className="interview-metrics">
        <article><span>Total</span><strong>{(items || []).length}</strong></article>
        <article><span>Respondidas</span><strong>{answered}</strong></article>
        <article><span>Pendientes</span><strong>{pending}</strong></article>
        <article><span>Último análisis</span><strong>{analysis?.created_at ? new Date(analysis.created_at).toLocaleDateString('es-PA') : '—'}</strong></article>
      </div>

      {!items?.length && (
        <section className="panel interview-empty">
          <Sparkles size={28} />
          <h3>Primero analiza las evidencias</h3>
          <p>Ve a Evidencias, agrega contexto y pulsa Analizar evidencias. Aura generará el guion inicial.</p>
        </section>
      )}

      {sectionOrder.map((section) => grouped[section]?.length ? (
        <section key={section} className="interview-section">
          <header><p className="eyebrow">{sectionLabels[section]}</p><span>{grouped[section].filter((item) => item.status === 'pending').length} pendientes</span></header>
          <div className="interview-question-list">
            {grouped[section].map((item, index) => {
              const draft = drafts[item.id] || { answer: '', status: item.status };
              return (
                <article key={item.id} className={`interview-question-card ${item.status}`}>
                  <div className="interview-question-number">{index + 1}</div>
                  <div className="interview-question-body">
                    <div className="interview-question-topline">
                      <span className={`interview-priority ${item.priority}`}>{priorityLabels[item.priority]}</span>
                      <span>{item.source === 'manual' ? 'Manual' : 'Sugerida por Aura'}</span>
                    </div>
                    <h3>{item.question}</h3>
                    {item.rationale && <p>{item.rationale}</p>}
                    <textarea rows="4" value={draft.answer} onChange={(e) => change(item.id, 'answer', e.target.value)} placeholder="Escribe la respuesta del decisor, cifras, herramientas y ejemplos concretos…" />
                    <div className="interview-question-footer">
                      <label>Estado<select value={draft.status} onChange={(e) => change(item.id, 'status', e.target.value)}><option value="pending">Pendiente</option><option value="answered">Respondida</option><option value="not_applicable">No aplica</option></select></label>
                      <button className="danger-icon" onClick={() => remove(item)} title="Eliminar pregunta"><Trash2 size={16} /></button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null)}

      <form className="panel interview-add-form" onSubmit={addQuestion}>
        <div className="section-heading"><div><p className="eyebrow">PREGUNTA PERSONALIZADA</p><h3>Agrega una pregunta propia</h3></div></div>
        <div className="form-grid two">
          <label>Área<select value={newQuestion.section} onChange={(e) => setNewQuestion({ ...newQuestion, section: e.target.value })}>{sectionOrder.map((section) => <option key={section} value={section}>{sectionLabels[section]}</option>)}</select></label>
          <label>Prioridad<select value={newQuestion.priority} onChange={(e) => setNewQuestion({ ...newQuestion, priority: e.target.value })}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
        </div>
        <label>Pregunta<input value={newQuestion.question} onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })} placeholder="¿Qué necesito confirmar con el decisor?" /></label>
        <label>Por qué importa<textarea rows="2" value={newQuestion.rationale} onChange={(e) => setNewQuestion({ ...newQuestion, rationale: e.target.value })} /></label>
        <div className="form-actions"><button className="button diagnose-primary" disabled={saving || !newQuestion.question.trim()}><MessageSquarePlus size={17} />Agregar pregunta</button></div>
      </form>

      <div className="diagnosis-savebar interview-savebar">
        <span>{dirty.size ? `${dirty.size} respuestas con cambios sin guardar.` : 'Todas las respuestas están guardadas.'}</span>
        <button className={`button ${dirty.size ? 'diagnose-primary' : 'disabled-save'}`} onClick={saveAll} disabled={!dirty.size || saving}><Save size={17} />{saving ? 'Guardando…' : dirty.size ? 'Guardar respuestas' : 'Guardado'}</button>
      </div>
    </section>
  );
}
