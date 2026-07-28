import { useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ExternalLink,
  FileUp,
  Link2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const empty = { name: '', category: 'General', evidence_type: 'note', external_url: '', notes: '' };

function sizeLabel(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const impactLabels = { low: 'Bajo', medium: 'Medio', high: 'Alto', critical: 'Crítico' };
const sectionLabels = { general: 'General', icp: 'ICP', conversion: 'Conversión', process: 'Procesos', automation: 'Automatización' };

export default function DiagnosisEvidence({ diagnosisId, items, analysis, questions, onChanged }) {
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = new FormData();
      body.append('name', form.name || file?.name || 'Evidencia');
      body.append('category', form.category);
      body.append('evidence_type', file ? 'file' : form.evidence_type);
      body.append('external_url', form.external_url || '');
      body.append('notes', form.notes || '');
      if (file) body.append('file', file);
      await api(`/api/diagnose/${diagnosisId}/evidence`, { method: 'POST', body });
      setForm(empty);
      setFile(null);
      setMessage('Evidencia guardada.');
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    setError('');
    setMessage('');
    try {
      const result = await api(`/api/diagnose/${diagnosisId}/analyze-evidence`, { method: 'POST' });
      setMessage(`Análisis terminado: ${(result.analysis?.signals || []).length} señales y ${(result.questions || []).filter((q) => q.status === 'pending').length} preguntas pendientes.`);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const open = async (item) => {
    try {
      const result = await api(`/api/diagnose/evidence/${item.id}/open`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Eliminar la evidencia “${item.name}”?`)) return;
    try {
      await api(`/api/diagnose/${diagnosisId}/evidence/${item.id}`, { method: 'DELETE' });
      onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  };

  const pendingQuestions = (questions || []).filter((item) => item.status === 'pending').length;
  const signals = analysis?.signals || [];
  const suggestions = analysis?.assessment_suggestions || [];

  return (
    <section className="diagnosis-section-stack">
      <div className="section-heading evidence-heading">
        <div>
          <p className="eyebrow">EVIDENCIAS</p>
          <h2>Capturas, documentos y contexto</h2>
          <p>Guarda hechos observables. Aura los convierte en señales y preguntas para la entrevista.</p>
        </div>
        <button className="button diagnose-primary evidence-analyze-button" onClick={analyze} disabled={analyzing || !(items || []).length}>
          {analyzing ? <RefreshCw className="spin" size={17} /> : <Sparkles size={17} />}
          {analyzing ? 'Analizando…' : analysis ? 'Analizar nuevamente' : 'Analizar evidencias'}
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {message && <div className="diagnose-success"><CheckCircle2 size={17} />{message}</div>}

      <section className="panel diagnose-analysis-explainer">
        <BrainCircuit size={22} />
        <div>
          <strong>Análisis sin costo por consumo</strong>
          <p>Aura procesa las notas y el texto de PDF, DOCX, XLSX, CSV y TXT usando reglas locales. En capturas, escribe en Notas los mensajes, horas y hechos visibles importantes.</p>
        </div>
      </section>

      <form className="panel evidence-form" onSubmit={submit}>
        <div className="form-grid three">
          <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Captura de WhatsApp" /></label>
          <label>Categoría<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>General</option><option>ICP</option><option>Conversión</option><option>Procesos</option><option>Automatización</option><option>Resultados</option></select></label>
          <label>Tipo<select value={form.evidence_type} onChange={(e) => setForm({ ...form, evidence_type: e.target.value })}><option value="note">Nota</option><option value="link">Enlace</option><option value="file">Archivo</option></select></label>
        </div>
        {form.evidence_type === 'link' && <label>URL<input value={form.external_url} onChange={(e) => setForm({ ...form, external_url: e.target.value })} placeholder="https://" /></label>}
        {form.evidence_type === 'file' && <label className="evidence-file-input"><FileUp size={20} /><span>{file?.name || 'Seleccionar archivo (máximo 10 MB)'}</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,.docx,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>}
        <label>Notas<textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Describe hechos visibles: horas, mensajes, herramientas, resultados y por qué importan" /></label>
        <div className="form-actions"><button className="button diagnose-primary" disabled={saving || (!form.name && !file)}><FileUp size={17} />{saving ? 'Guardando…' : 'Agregar evidencia'}</button></div>
      </form>

      {analysis && (
        <section className="panel diagnose-analysis-result">
          <header className="analysis-result-header">
            <div>
              <p className="eyebrow">BORRADOR DE AURA</p>
              <h3>Análisis de evidencias</h3>
              <p>{analysis.summary}</p>
            </div>
            <div className="analysis-mini-metrics">
              <span><strong>{analysis.evidence_count || 0}</strong>Evidencias</span>
              <span><strong>{signals.length}</strong>Señales</span>
              <span><strong>{pendingQuestions}</strong>Preguntas</span>
            </div>
          </header>

          {!!signals.length && (
            <div className="analysis-signal-grid">
              {signals.map((signal) => (
                <article key={signal.key} className={`analysis-signal-card ${signal.kind || 'risk'}`}>
                  <div className="analysis-signal-topline">
                    <span>{sectionLabels[signal.section] || signal.section}</span>
                    <span className={`analysis-impact ${signal.impact}`}>{impactLabels[signal.impact] || signal.impact}</span>
                  </div>
                  <h4>{signal.title}</h4>
                  <p>{signal.description}</p>
                  <blockquote>{signal.evidence}</blockquote>
                  <small>Confianza {signal.confidence}%</small>
                </article>
              ))}
            </div>
          )}

          {!!suggestions.length && (
            <div className="assessment-suggestion-list">
              <h4>Evaluaciones sugeridas para validar</h4>
              {suggestions.map((item) => (
                <div key={`${item.section}-${item.question_id}`}>
                  <span>{sectionLabels[item.section] || item.section}</span>
                  <strong>{item.question_id.replaceAll('_', ' ')}</strong>
                  <em>{item.suggested_score}/4</em>
                  <p>{item.rationale}</p>
                </div>
              ))}
            </div>
          )}

          <div className="analysis-actions">
            <Link className="button diagnose-primary" to={`/diagnose/${diagnosisId}/interview`}><MessageSquareText size={17} />Abrir entrevista ({pendingQuestions})</Link>
            <small>Aura propone. Tú confirmas los scores y hallazgos antes de usarlos en el informe.</small>
          </div>

          {!!(analysis.limitations || []).length && (
            <details className="analysis-limitations">
              <summary><AlertTriangle size={15} />Limitaciones del análisis</summary>
              <ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          )}
        </section>
      )}

      <div className="evidence-grid">
        {(items || []).map((item) => {
          const Icon = item.evidence_type === 'file' ? FileUp : item.evidence_type === 'link' ? Link2 : StickyNote;
          return (
            <article key={item.id} className="evidence-card">
              <header><span className="evidence-icon"><Icon size={18} /></span><div><strong>{item.name}</strong><span>{item.category} · {item.evidence_type}</span></div></header>
              {item.notes && <p>{item.notes}</p>}
              <footer><small>{sizeLabel(item.size_bytes)} {item.created_at ? `· ${new Date(item.created_at).toLocaleDateString('es-PA')}` : ''}</small><div>{(item.storage_path || item.external_url) && <button onClick={() => open(item)} title="Abrir"><ExternalLink size={16} /></button>}<button className="danger-icon" onClick={() => remove(item)} title="Eliminar"><Trash2 size={16} /></button></div></footer>
            </article>
          );
        })}
        {!(items || []).length && <div className="panel diagnose-empty-inline">Todavía no has agregado evidencias.</div>}
      </div>
    </section>
  );
}
