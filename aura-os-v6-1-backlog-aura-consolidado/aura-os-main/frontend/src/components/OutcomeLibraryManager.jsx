import { useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Plus,
  RefreshCw,
  Save,
  Target,
} from 'lucide-react';
import { api } from '../lib/api';
import { useOutcomes } from './OutcomeSelect';

const conversationOptions = [
  ['', 'Sin recomendación'],
  ['not_started', 'No iniciada'],
  ['waiting_response', 'Esperando respuesta'],
  ['response_received', 'Respuesta recibida'],
  ['conversation_active', 'Conversación activa'],
  ['waiting_decision_maker', 'Esperando al decisor'],
  ['waiting_confirmation', 'Esperando confirmación'],
  ['followup_scheduled', 'Seguimiento programado'],
  ['closed', 'Cerrada'],
];

const commercialStatusOptions = [
  ['', 'Sin recomendación'],
  ['Nuevo', 'Nuevo'],
  ['Investigando', 'Investigando'],
  ['Listo para contactar', 'Listo para contactar'],
  ['Contactado', 'Contactado'],
  ['Seguimiento 1', 'Seguimiento 1'],
  ['Seguimiento 2', 'Seguimiento 2'],
  ['Respondió', 'Respondió'],
  ['Interesado', 'Interesado'],
  ['Reunión agendada', 'Reunión agendada'],
  ['Propuesta enviada', 'Propuesta enviada'],
  ['Diagnóstico vendido', 'Diagnóstico vendido'],
  ['Implementación vendida', 'Implementación vendida'],
  ['No interesado', 'No interesado'],
  ['No califica', 'No califica'],
  ['Descartado', 'Descartado'],
];

const emptyOutcome = {
  name: '',
  category: 'General',
  description: '',
  color: '#B6FF2E',
  recommended_conversation_status: '',
  recommended_commercial_status: '',
  followup_delay_days: '',
  recommended_next_step: '',
  priority_adjustment: 0,
  is_terminal: false,
  available_for_action: false,
  available_for_response: true,
  available_for_classification: true,
  is_active: true,
  sort_order: 100,
};

function toDraft(item) {
  return {
    ...item,
    recommended_conversation_status: item.recommended_conversation_status || '',
    recommended_commercial_status: item.recommended_commercial_status || '',
    followup_delay_days: item.followup_delay_days ?? '',
    recommended_next_step: item.recommended_next_step || '',
    description: item.description || '',
  };
}

function payloadFromDraft(draft) {
  return {
    name: draft.name.trim(),
    category: draft.category.trim() || 'General',
    description: draft.description?.trim() || null,
    color: draft.color || '#B6FF2E',
    recommended_conversation_status: draft.recommended_conversation_status || null,
    recommended_commercial_status: draft.recommended_commercial_status?.trim() || null,
    followup_delay_days: draft.followup_delay_days === '' ? null : Number(draft.followup_delay_days),
    recommended_next_step: draft.recommended_next_step?.trim() || null,
    priority_adjustment: Number(draft.priority_adjustment || 0),
    is_terminal: Boolean(draft.is_terminal),
    available_for_action: Boolean(draft.available_for_action),
    available_for_response: Boolean(draft.available_for_response),
    available_for_classification: Boolean(draft.available_for_classification),
    is_active: Boolean(draft.is_active),
    sort_order: Number(draft.sort_order || 100),
  };
}

export default function OutcomeLibraryManager() {
  const { items, loading, error: loadError, reload } = useOutcomes('all', true, false);
  const [drafts, setDrafts] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [newOutcome, setNewOutcome] = useState(emptyOutcome);
  const [expanded, setExpanded] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const sorted = useMemo(
    () => [...items].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.name.localeCompare(b.name)),
    [items],
  );

  const draftFor = (item) => drafts[item.id] || toDraft(item);
  const updateDraft = (id, field, value) => {
    const item = items.find((row) => row.id === id);
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] || toDraft(item)), [field]: value },
    }));
  };

  const saveExisting = async (item) => {
    const draft = draftFor(item);
    setBusy(item.id);
    setMessage('');
    setError('');
    try {
      await api(`/api/outcomes/admin/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payloadFromDraft(draft)),
      });
      setMessage(`Outcome “${draft.name}” actualizado.`);
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await reload();
    } catch (saveError) {
      setError(saveError.message || 'No se pudo actualizar el outcome.');
    } finally {
      setBusy('');
    }
  };

  const createOutcome = async (event) => {
    event.preventDefault();
    setBusy('create');
    setMessage('');
    setError('');
    try {
      await api('/api/outcomes/admin', {
        method: 'POST',
        body: JSON.stringify(payloadFromDraft(newOutcome)),
      });
      setNewOutcome(emptyOutcome);
      setShowCreate(false);
      setMessage('Outcome agregado a la biblioteca.');
      await reload();
    } catch (createError) {
      setError(createError.message || 'No se pudo crear el outcome.');
    } finally {
      setBusy('');
    }
  };

  const toggleActive = async (item) => {
    setBusy(item.id);
    setMessage('');
    setError('');
    try {
      await api(`/api/outcomes/admin/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      setMessage(item.is_active ? 'Outcome desactivado. El historial se conserva.' : 'Outcome reactivado.');
      await reload();
    } catch (toggleError) {
      setError(toggleError.message || 'No se pudo cambiar el estado del outcome.');
    } finally {
      setBusy('');
    }
  };

  const formFields = (draft, setField, prefix = '') => (
    <>
      <div className="outcome-editor-grid primary-fields">
        <label>Nombre
          <input required minLength="2" value={draft.name || ''} onChange={(e) => setField('name', e.target.value)} placeholder="Ej. No respondió al primer mensaje" />
        </label>
        <label>Categoría
          <input required value={draft.category || ''} onChange={(e) => setField('category', e.target.value)} placeholder="Ej. Sin respuesta" />
        </label>
        <label>Color
          <input type="color" value={draft.color || '#B6FF2E'} onChange={(e) => setField('color', e.target.value)} />
        </label>
        <label>Orden
          <input type="number" min="0" max="10000" value={draft.sort_order ?? 100} onChange={(e) => setField('sort_order', e.target.value)} />
        </label>
      </div>

      <details className="advanced-options outcome-advanced" open={prefix === 'create'}>
        <summary>Reglas automáticas y detalles</summary>
        <div className="outcome-editor-grid">
          <label>Estado de conversación sugerido
            <select value={draft.recommended_conversation_status || ''} onChange={(e) => setField('recommended_conversation_status', e.target.value)}>
              {conversationOptions.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Estado comercial sugerido
            <select value={draft.recommended_commercial_status || ''} onChange={(e) => setField('recommended_commercial_status', e.target.value)}>
              {commercialStatusOptions.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Días hasta seguimiento
            <input type="number" min="0" max="3650" value={draft.followup_delay_days ?? ''} onChange={(e) => setField('followup_delay_days', e.target.value)} placeholder="Vacío si no aplica" />
          </label>
          <label>Ajuste de prioridad
            <select value={draft.priority_adjustment ?? 0} onChange={(e) => setField('priority_adjustment', Number(e.target.value))}>
              <option value="-100">Cerrar / retirar de Focus</option>
              <option value="-20">Bajar mucho</option>
              <option value="-10">Bajar</option>
              <option value="0">Sin ajuste</option>
              <option value="10">Subir</option>
              <option value="20">Prioridad alta</option>
              <option value="35">Prioridad crítica</option>
              <option value="50">Atender inmediatamente</option>
            </select>
          </label>
          <label>Próximo paso sugerido
            <input value={draft.recommended_next_step || ''} onChange={(e) => setField('recommended_next_step', e.target.value)} placeholder="Ej. Follow-up en 24 horas" />
          </label>
          <label className="outcome-wide">Descripción
            <textarea rows="3" value={draft.description || ''} onChange={(e) => setField('description', e.target.value)} placeholder="Qué significa este outcome" />
          </label>
        </div>
        <div className="outcome-rule-checks">
          <label><input type="checkbox" checked={Boolean(draft.available_for_action)} onChange={(e) => setField('available_for_action', e.target.checked)} />Disponible al registrar acción</label>
          <label><input type="checkbox" checked={Boolean(draft.available_for_response)} onChange={(e) => setField('available_for_response', e.target.checked)} />Disponible al registrar respuesta</label>
          <label><input type="checkbox" checked={Boolean(draft.available_for_classification)} onChange={(e) => setField('available_for_classification', e.target.checked)} />Disponible en clasificación</label>
          <label><input type="checkbox" checked={Boolean(draft.is_terminal)} onChange={(e) => setField('is_terminal', e.target.checked)} />Outcome final: cierra la conversación</label>
        </div>
      </details>
    </>
  );

  return (
    <section className="panel outcome-library-panel">
      <header className="outcome-library-heading">
        <div className="user-management-title">
          <span className="password-icon"><Target size={20} /></span>
          <div>
            <p className="eyebrow">CONFIGURACIÓN COMERCIAL</p>
            <h2>Biblioteca de outcomes</h2>
            <p>Maikol selecciona qué pasó. Aura completa estado, próximo paso, seguimiento y prioridad; la clasificación interna se calcula automáticamente.</p>
          </div>
        </div>
        <div className="user-management-actions">
          <button className="button secondary" onClick={reload} disabled={loading}><RefreshCw size={16} />Actualizar</button>
          <button className="button primary" onClick={() => setShowCreate((value) => !value)}><Plus size={16} />Crear outcome</button>
        </div>
      </header>

      {(error || loadError) && <div className="form-error user-feedback">{error || loadError}</div>}
      {message && <div className="success-box user-feedback"><CheckCircle2 size={16} />{message}</div>}

      {showCreate && (
        <form className="outcome-create-form" onSubmit={createOutcome}>
          <div className="outcome-create-heading"><strong>Nuevo outcome</strong><span>Configúralo una vez; el equipo lo usa desde el dropdown.</span></div>
          {formFields(newOutcome, (field, value) => setNewOutcome((current) => ({ ...current, [field]: value })), 'create')}
          <button className="button primary outcome-save-button" type="submit" disabled={busy === 'create' || !newOutcome.name.trim()}><Save size={16} />{busy === 'create' ? 'Creando…' : 'Guardar outcome'}</button>
        </form>
      )}

      <div className="outcome-library-list">
        {loading ? <div className="user-loading">Cargando outcomes…</div> : sorted.map((item) => {
          const draft = draftFor(item);
          const isExpanded = expanded === item.id;
          return (
            <article className={`outcome-library-card ${item.is_active ? '' : 'inactive'}`} key={item.id}>
              <button type="button" className="outcome-card-summary" onClick={() => setExpanded(isExpanded ? '' : item.id)}>
                <span className="outcome-color-dot" style={{ backgroundColor: item.color || '#B6FF2E' }} />
                <span className="outcome-card-copy"><strong>{item.name}</strong><small>{item.category} · {item.recommended_next_step || 'Sin próximo paso automático'}</small></span>
                <span className={`user-status ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? 'Activo' : 'Inactivo'}</span>
                {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {isExpanded && (
                <div className="outcome-card-editor">
                  {formFields(draft, (field, value) => updateDraft(item.id, field, value))}
                  <div className="outcome-card-actions">
                    <button type="button" className="button secondary" onClick={() => saveExisting(item)} disabled={busy === item.id}><Save size={15} />Guardar cambios</button>
                    <button type="button" className="button ghost" onClick={() => toggleActive(item)} disabled={busy === item.id}><Archive size={15} />{item.is_active ? 'Desactivar' : 'Reactivar'}</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
