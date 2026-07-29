import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Phone, Save, X } from 'lucide-react';
import { api } from '../lib/api';
import ContactComposer, { conversationLabel, outcomeStageLabel } from './ContactComposer';

function formFromLead(data) {
  return {
    status: data.status || 'Nuevo',
    owner_id: data.owner_id || '',
    outcome: data.outcome || '',
    notes: data.notes || '',
    next_followup_date: data.next_followup_date || '',
    decision_maker_name: data.decision_maker_name || '',
    decision_maker_title: data.decision_maker_title || '',
    decision_maker_link: data.decision_maker_link || '',
    manual_ads_score: Number(data.manual_ads_score || 0),
    manual_volume_score: Number(data.manual_volume_score || 0),
    manual_followup_score: Number(data.manual_followup_score || 0),
    manual_decision_maker_score: Number(data.manual_decision_maker_score || 0),
    conversation_status: data.conversation_status || 'not_started',
    outcome_stage: data.outcome_stage || 'pending',
    do_not_contact: Boolean(data.do_not_contact),
  };
}

function normalizedSnapshot(value) {
  return JSON.stringify({
    ...value,
    owner_id: value.owner_id || '',
    next_followup_date: value.next_followup_date || '',
    manual_ads_score: Number(value.manual_ads_score || 0),
    manual_volume_score: Number(value.manual_volume_score || 0),
    manual_followup_score: Number(value.manual_followup_score || 0),
    manual_decision_maker_score: Number(value.manual_decision_maker_score || 0),
    do_not_contact: Boolean(value.do_not_contact),
  });
}

export default function LeadDrawer({ leadId, statuses, profiles, onClose, onChanged }) {
  const [lead, setLead] = useState(null);
  const [form, setForm] = useState({});
  const [baseline, setBaseline] = useState({});
  const [tab, setTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = async ({ markSaved = false } = {}) => {
    setError('');
    try {
      const data = await api(`/api/leads/${leadId}`);
      const nextForm = formFromLead(data);
      setLead(data);
      setForm(nextForm);
      setBaseline(nextForm);
      setSaved(markSaved);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [leadId]);

  const dirty = useMemo(
    () => normalizedSnapshot(form) !== normalizedSnapshot(baseline),
    [form, baseline],
  );

  const changeForm = (changes) => {
    setSaved(false);
    setForm((current) => ({ ...current, ...changes }));
  };

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        owner_id: form.owner_id || null,
        next_followup_date: form.next_followup_date || null,
        manual_ads_score: Number(form.manual_ads_score || 0),
        manual_volume_score: Number(form.manual_volume_score || 0),
        manual_followup_score: Number(form.manual_followup_score || 0),
        manual_decision_maker_score: Number(form.manual_decision_maker_score || 0),
      };
      await api(`/api/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      await load({ markSaved: true });
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveContact = async (payload) => {
    setSaving(true);
    setError('');
    try {
      await api(`/api/leads/${leadId}/call-logs`, { method: 'POST', body: JSON.stringify(payload) });
      await load();
      onChanged?.();
      setTab('history');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!lead) {
    return (
      <div className="drawer-layer">
        <button className="drawer-backdrop" onClick={onClose} aria-label="Cerrar" />
        <aside className="lead-drawer"><div className="drawer-loading">Cargando ficha…</div></aside>
      </div>
    );
  }

  const links = [
    ['Web', lead.website],
    ['Google Maps', lead.maps_url],
    ['Instagram', lead.instagram_url],
    ['WhatsApp', lead.whatsapp_url],
  ].filter(([, url]) => url);

  const saveLabel = saving ? 'Guardando…' : dirty ? 'Guardar cambios' : saved ? 'Cambios guardados' : 'Sin cambios';

  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Cerrar" />
      <aside className="lead-drawer">
        <header className="drawer-header">
          <div><p className="eyebrow">FICHA DEL LEAD</p><h2>{lead.business_name}</h2><p>{lead.address || 'Dirección no disponible'}</p></div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </header>

        <div className="lead-score-strip">
          <div><span>Score</span><strong>{lead.final_score}</strong></div>
          <div><span>Tier</span><strong>{lead.final_tier}</strong></div>
          <div><span>Intentos</span><strong>{lead.contact_attempts}</strong></div>
          <div><span>Conversación</span><strong className="conversation-mini">{conversationLabel(lead.conversation_status)}</strong></div>
        </div>

        <nav className="drawer-tabs">
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Clasificación</button>
          <button className={tab === 'contact' ? 'active' : ''} onClick={() => setTab('contact')}>Registrar actividad</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Historial</button>
        </nav>

        {error && <div className="form-error">{error}</div>}

        <div className="drawer-body">
          {tab === 'profile' && (
            <>
              <div className="quick-links">
                {lead.phone && <a href={`tel:${lead.phone}`}><Phone size={16} />{lead.phone}</a>}
                {links.map(([label, url]) => <a key={label} href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={14} /></a>)}
              </div>
              <div className="conversation-profile-card">
                <div><small>Estado de conversación</small><strong>{conversationLabel(form.conversation_status)}</strong></div>
                <div><small>Outcome</small><strong>{form.outcome || 'Pendiente'}</strong></div>
                <div><small>Madurez</small><strong>{outcomeStageLabel(form.outcome_stage)}</strong></div>
              </div>
              <div className="form-grid two">
                <label>Estado comercial<select value={form.status} onChange={(e) => changeForm({ status: e.target.value })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label>Responsable<select value={form.owner_id} onChange={(e) => changeForm({ owner_id: e.target.value })}><option value="">Sin asignar</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</select></label>
                <label>Estado de conversación
                  <select value={form.conversation_status} onChange={(e) => changeForm({ conversation_status: e.target.value })}>
                    <option value="not_started">No iniciada</option>
                    <option value="waiting_response">Esperando respuesta</option>
                    <option value="response_received">Respuesta recibida</option>
                    <option value="conversation_active">Conversación activa</option>
                    <option value="waiting_decision_maker">Esperando al decisor</option>
                    <option value="waiting_confirmation">Esperando confirmación</option>
                    <option value="followup_scheduled">Seguimiento programado</option>
                    <option value="closed">Cerrada</option>
                  </select>
                </label>
                <label>Madurez del outcome
                  <select value={form.outcome_stage} onChange={(e) => changeForm({ outcome_stage: e.target.value })}>
                    <option value="pending">Pendiente</option><option value="provisional">Provisional</option><option value="final">Final</option>
                  </select>
                </label>
                <label>Outcome<input value={form.outcome} onChange={(e) => changeForm({ outcome: e.target.value })} placeholder="Ej. Solicitó información" /></label>
                <label>Próximo seguimiento<input type="date" value={form.next_followup_date} onChange={(e) => changeForm({ next_followup_date: e.target.value })} /></label>
                <label>Decisor<input value={form.decision_maker_name} onChange={(e) => changeForm({ decision_maker_name: e.target.value })} /></label>
                <label>Cargo<input value={form.decision_maker_title} onChange={(e) => changeForm({ decision_maker_title: e.target.value })} /></label>
              </div>
              <label>Notas<textarea rows="5" value={form.notes} onChange={(e) => changeForm({ notes: e.target.value })} placeholder="Información útil para el próximo contacto" /></label>
              <h3 className="form-section-title">Validación manual del ICP</h3>
              <div className="form-grid four">
                <label>Anuncios 0–8<input type="number" min="0" max="8" value={form.manual_ads_score} onChange={(e) => changeForm({ manual_ads_score: e.target.value })} /></label>
                <label>Volumen 0–6<input type="number" min="0" max="6" value={form.manual_volume_score} onChange={(e) => changeForm({ manual_volume_score: e.target.value })} /></label>
                <label>Seguimiento 0–8<input type="number" min="0" max="8" value={form.manual_followup_score} onChange={(e) => changeForm({ manual_followup_score: e.target.value })} /></label>
                <label>Decisor 0–8<input type="number" min="0" max="8" value={form.manual_decision_maker_score} onChange={(e) => changeForm({ manual_decision_maker_score: e.target.value })} /></label>
              </div>
              <label className="check-row"><input type="checkbox" checked={form.do_not_contact} onChange={(e) => changeForm({ do_not_contact: e.target.checked })} />No volver a contactar</label>
              <button className={`button full ${dirty ? 'primary' : 'save-idle'}`} onClick={save} disabled={saving || !dirty}>
                {saved && !dirty ? <CheckCircle2 size={17} /> : <Save size={17} />}{saveLabel}
              </button>
            </>
          )}

          {tab === 'contact' && (
            <ContactComposer
              key={`${lead.id}-${lead.updated_at}`}
              initialChannel={lead.whatsapp_url ? 'WhatsApp' : 'Llamada'}
              saving={saving}
              onSubmit={saveContact}
              submitLabel="Guardar actividad"
            />
          )}

          {tab === 'history' && (
            <div className="timeline">
              {(lead.call_logs || []).length === 0 && <p className="muted">Todavía no hay actividades registradas.</p>}
              {(lead.call_logs || []).map((item) => (
                <article key={item.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{item.channel} · {item.outcome}</strong>
                    <small>{new Date(item.occurred_at).toLocaleString('es-PA')} · {conversationLabel(item.conversation_status)} · {outcomeStageLabel(item.outcome_stage)}</small>
                    <p>{item.notes || item.next_step || item.transcript || 'Sin notas'}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
