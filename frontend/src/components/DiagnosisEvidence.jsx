import { useState } from 'react';
import { ExternalLink, FileUp, Link2, StickyNote, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

const empty = { name: '', category: 'General', evidence_type: 'note', external_url: '', notes: '' };

function sizeLabel(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DiagnosisEvidence({ diagnosisId, items, onChanged }) {
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
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

  return (
    <section className="diagnosis-section-stack">
      <div className="section-heading"><div><p className="eyebrow">EVIDENCIAS</p><h2>Capturas, documentos y contexto</h2><p>Organiza lo que sustenta cada evaluación y hallazgo.</p></div></div>
      {error && <div className="form-error">{error}</div>}

      <form className="panel evidence-form" onSubmit={submit}>
        <div className="form-grid three">
          <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Captura de WhatsApp" /></label>
          <label>Categoría<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>General</option><option>ICP</option><option>Conversión</option><option>Procesos</option><option>Automatización</option><option>Resultados</option></select></label>
          <label>Tipo<select value={form.evidence_type} onChange={(e) => setForm({ ...form, evidence_type: e.target.value })}><option value="note">Nota</option><option value="link">Enlace</option><option value="file">Archivo</option></select></label>
        </div>
        {form.evidence_type === 'link' && <label>URL<input value={form.external_url} onChange={(e) => setForm({ ...form, external_url: e.target.value })} placeholder="https://" /></label>}
        {form.evidence_type === 'file' && <label className="evidence-file-input"><FileUp size={20} /><span>{file?.name || 'Seleccionar archivo (máximo 10 MB)'}</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv,.docx,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>}
        <label>Notas<textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Qué demuestra esta evidencia y por qué importa" /></label>
        <div className="form-actions"><button className="button diagnose-primary" disabled={saving || (!form.name && !file)}><FileUp size={17} />{saving ? 'Guardando…' : 'Agregar evidencia'}</button></div>
      </form>

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
