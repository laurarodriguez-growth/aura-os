import { useMemo, useState } from 'react';
import { AlertTriangle, BrainCircuit, CheckCircle2, ExternalLink, FileUp, Link2, RefreshCw, ShieldCheck, StickyNote, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

const empty = { name: '', category: 'General', evidence_type: 'note', external_url: '', notes: '', requirement_key: '', block_key: '', anonymized: false, provided_by: '', received_at: new Date().toISOString().slice(0, 10), analysis_purpose: 'Diagnóstico del proceso comercial y de atención', validation_status: 'pending_review' };
const validationLabels = { pending_review: 'Pendiente de revisar', validated: 'Validada', requires_information: 'Requiere información', discarded: 'Descartada' };

function sizeLabel(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DiagnosisEvidence({ diagnosisId, items = [], analysis, requirements = [], blocks = [], restricted = false, onChanged }) {
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const activeItems = items.filter((item) => item.deletion_status !== 'deleted');
  const received = useMemo(() => new Set(activeItems.filter((item) => item.requirement_key).map((item) => item.requirement_key)), [items]);

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, String(value ?? '')));
      body.set('name', form.name || file?.name || 'Evidencia');
      body.set('evidence_type', file ? 'file' : form.evidence_type);
      if (file) body.append('file', file);
      await api(`/api/diagnose/${diagnosisId}/evidence`, { method: 'POST', body });
      setForm({ ...empty, received_at: new Date().toISOString().slice(0, 10) }); setFile(null); setMessage('Evidencia guardada con su registro de protección.'); onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const analyze = async () => {
    setAnalyzing(true); setError(''); setMessage('');
    try {
      const result = await api(`/api/diagnose/${diagnosisId}/analyze-evidence`, { method: 'POST' });
      setMessage(`Análisis terminado: ${(result.analysis?.signals || []).length} señales. Las limitaciones quedan declaradas.`); onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setAnalyzing(false); }
  };

  const update = async (item, patch) => {
    try { await api(`/api/diagnose/${diagnosisId}/evidence/${item.id}/governance`, { method: 'PATCH', body: JSON.stringify(patch) }); onChanged?.(); }
    catch (e) { setError(e.message); }
  };
  const open = async (item) => { try { const result = await api(`/api/diagnose/evidence/${item.id}/open`); window.open(result.url, '_blank', 'noopener,noreferrer'); } catch (e) { setError(e.message); } };
  const remove = async (item) => {
    if (!window.confirm(`Eliminar el archivo de “${item.name}” y conservar solo su registro de eliminación?`)) return;
    try { await api(`/api/diagnose/${diagnosisId}/evidence/${item.id}`, { method: 'DELETE' }); onChanged?.(); } catch (e) { setError(e.message); }
  };

  if (restricted) return <section className="panel privacy-notice"><ShieldCheck size={24} /><div><h2>Acceso restringido</h2><p>Las evidencias solo están disponibles para Laura y administradores autorizados.</p></div></section>;

  return (
    <section className="diagnosis-section-stack evidence-definitive">
      <div className="section-heading"><div><p className="eyebrow">EVIDENCIAS</p><h2>Material verificable y protegido</h2><p>Los enlaces públicos se leen de forma segura. Las capturas se analizan con Gemini si la clave está configurada; cualquier fallo queda marcado para revisión.</p></div><button className="button diagnose-primary" onClick={analyze} disabled={analyzing || !activeItems.length}>{analyzing ? <RefreshCw className="spin" size={17} /> : <BrainCircuit size={17} />}{analyzing ? 'Analizando…' : 'Analizar evidencias'}</button></div>
      {error && <div className="form-error">{error}</div>}
      {message && <div className="diagnose-success"><CheckCircle2 size={17} />{message}</div>}

      <section className="panel privacy-notice"><ShieldCheck size={24} /><div><strong>Pueden ocultar nombres, teléfonos y cualquier dato clínico.</strong><p>Necesitamos analizar el proceso, no la información médica del paciente. El acceso queda restringido y el archivo puede eliminarse al concluir el servicio.</p></div></section>

      <section className="panel minimum-evidence"><div className="section-heading"><div><p className="eyebrow">MÍNIMO PARA EL PRIMER DIAGNÓSTICO</p><h3>{received.size} de {requirements.length} evidencias recibidas</h3></div></div><div>{requirements.map((item) => <article key={item.key} className={received.has(item.key) ? 'done' : ''}><CheckCircle2 size={17} /><span>{item.label}</span></article>)}</div></section>

      <form className="panel evidence-form governance-form" onSubmit={submit}>
        <div className="form-grid three">
          <label>Evidencia mínima<select value={form.requirement_key} onChange={(e) => { const requirement = requirements.find((item) => item.key === e.target.value); setForm({ ...form, requirement_key: e.target.value, block_key: requirement?.block_key || form.block_key }); }}><option value="">Material adicional</option>{requirements.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label>Bloque relacionado<select value={form.block_key} onChange={(e) => setForm({ ...form, block_key: e.target.value })}><option value="">General</option>{blocks.map((block) => <option key={block.key} value={block.key}>{block.title}</option>)}</select></label>
          <label>Tipo<select value={form.evidence_type} onChange={(e) => setForm({ ...form, evidence_type: e.target.value })}><option value="note">Nota</option><option value="link">Enlace público</option><option value="file">Archivo o captura</option></select></label>
        </div>
        <div className="form-grid three"><label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Quién la entregó<input value={form.provided_by} onChange={(e) => setForm({ ...form, provided_by: e.target.value })} /></label><label>Fecha de recepción<input type="date" value={form.received_at} onChange={(e) => setForm({ ...form, received_at: e.target.value })} /></label></div>
        {form.evidence_type === 'link' && <label>URL pública<input type="url" value={form.external_url} onChange={(e) => setForm({ ...form, external_url: e.target.value })} placeholder="https://" /></label>}
        {form.evidence_type === 'file' && <label className="evidence-file-input"><FileUp size={20} /><span>{file?.name || 'Seleccionar captura, PDF, DOCX, XLSX, CSV o TXT (máximo 10 MB)'}</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,.docx,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>}
        <label>Descripción o contexto<textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <div className="form-grid two"><label>Finalidad del análisis<input value={form.analysis_purpose} onChange={(e) => setForm({ ...form, analysis_purpose: e.target.value })} /></label><label>Estado inicial<select value={form.validation_status} onChange={(e) => setForm({ ...form, validation_status: e.target.value })}>{Object.entries(validationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <label className="inline-check"><input type="checkbox" checked={form.anonymized} onChange={(e) => setForm({ ...form, anonymized: e.target.checked })} />Confirmo que la evidencia fue anonimizada</label>
        <div className="form-actions"><button className="button diagnose-primary" disabled={saving || (!form.name && !file)}><FileUp size={17} />{saving ? 'Guardando…' : 'Agregar evidencia'}</button></div>
      </form>

      {analysis && <section className="panel analysis-trace"><div><BrainCircuit size={22} /><h3>Último análisis</h3></div><p>{analysis.summary}</p>{(analysis.limitations || []).length > 0 && <details><summary><AlertTriangle size={15} />Limitaciones declaradas</summary><ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>}</section>}

      <div className="evidence-grid">
        {activeItems.map((item) => { const Icon = item.evidence_type === 'file' ? FileUp : item.evidence_type === 'link' ? Link2 : StickyNote; return <article key={item.id} className="evidence-card governed"><header><span className="evidence-icon"><Icon size={18} /></span><div><strong>{item.name}</strong><span>{item.provided_by || 'Proveedor no indicado'} · {item.anonymized ? 'Anonimizada' : 'Por anonimizar'}</span></div></header>{item.notes && <p>{item.notes}</p>}<div className="evidence-governance"><label>Validación<select value={item.validation_status || 'pending_review'} onChange={(e) => update(item, { validation_status: e.target.value })}>{Object.entries(validationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Retención<select value={item.deletion_status || 'retained'} onChange={(e) => update(item, { deletion_status: e.target.value })}><option value="retained">Conservar</option><option value="scheduled">Eliminar al concluir</option></select></label></div><footer><small>{sizeLabel(item.size_bytes)} {item.received_at ? `· ${new Date(item.received_at).toLocaleDateString('es-PA')}` : ''}</small><div>{(item.storage_path || item.external_url) && <button onClick={() => open(item)} title="Abrir"><ExternalLink size={16} /></button>}<button className="danger-icon" onClick={() => remove(item)} title="Eliminar archivo"><Trash2 size={16} /></button></div></footer></article>; })}
      </div>
    </section>
  );
}
