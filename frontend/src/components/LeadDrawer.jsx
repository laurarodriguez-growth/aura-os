import { useEffect, useState } from 'react';
import { CalendarClock, ExternalLink, Phone, Save, X } from 'lucide-react';
import { api } from '../lib/api';

const defaultCall = {
  channel: 'Llamada',
  direction: 'Saliente',
  outcome: 'No respondió',
  contact_name: '',
  contact_title: '',
  objection: '',
  notes: '',
  next_step: '',
  followup_date: '',
  appointment_booked: false,
  sale_amount: '',
};

export default function LeadDrawer({ leadId, statuses, profiles, onClose, onChanged }) {
  const [lead, setLead] = useState(null);
  const [form, setForm] = useState({});
  const [call, setCall] = useState(defaultCall);
  const [tab, setTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const data = await api(`/api/leads/${leadId}`);
      setLead(data);
      setForm({
        status: data.status || 'Nuevo',
        owner_id: data.owner_id || '',
        outcome: data.outcome || '',
        notes: data.notes || '',
        next_followup_date: data.next_followup_date || '',
        decision_maker_name: data.decision_maker_name || '',
        decision_maker_title: data.decision_maker_title || '',
        decision_maker_link: data.decision_maker_link || '',
        manual_ads_score: data.manual_ads_score || 0,
        manual_volume_score: data.manual_volume_score || 0,
        manual_followup_score: data.manual_followup_score || 0,
        manual_decision_maker_score: data.manual_decision_maker_score || 0,
        do_not_contact: Boolean(data.do_not_contact),
      });
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [leadId]);

  const save = async () => {
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
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveCall = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...call,
        followup_date: call.followup_date || null,
        sale_amount: call.sale_amount === '' ? null : Number(call.sale_amount),
      };
      await api(`/api/leads/${leadId}/call-logs`, { method: 'POST', body: JSON.stringify(payload) });
      setCall(defaultCall);
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

  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Cerrar" />
      <aside className="lead-drawer">
        <header className="drawer-header">
          <div>
            <p className="eyebrow">FICHA DEL LEAD</p>
            <h2>{lead.business_name}</h2>
            <p>{lead.address || 'Dirección no disponible'}</p>
          </div>
          <button className="icon-button" onClick={onClose}><X /></button>
        </header>

        <div className="lead-score-strip">
          <div><span>Score</span><strong>{lead.final_score}</strong></div>
          <div><span>Tier</span><strong>{lead.final_tier}</strong></div>
          <div><span>Intentos</span><strong>{lead.contact_attempts}</strong></div>
          <div><span>Reseñas</span><strong>{lead.review_count}</strong></div>
        </div>

        <nav className="drawer-tabs">
          <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Clasificación</button>
          <button className={tab === 'contact' ? 'active' : ''} onClick={() => setTab('contact')}>Registrar contacto</button>
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
              <div className="form-grid two">
                <label>Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label>
                <label>Responsable<select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}><option value="">Sin asignar</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
                <label>Resultado<input value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} placeholder="Ej. Solicitó información" /></label>
                <label>Próximo seguimiento<input type="date" value={form.next_followup_date} onChange={(e) => setForm({ ...form, next_followup_date: e.target.value })} /></label>
                <label>Decisor<input value={form.decision_maker_name} onChange={(e) => setForm({ ...form, decision_maker_name: e.target.value })} /></label>
                <label>Cargo<input value={form.decision_maker_title} onChange={(e) => setForm({ ...form, decision_maker_title: e.target.value })} /></label>
              </div>
              <label>Notas<textarea rows="5" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Información útil para el próximo contacto" /></label>
              <h3 className="form-section-title">Validación manual del ICP</h3>
              <div className="form-grid four">
                <label>Anuncios 0–8<input type="number" min="0" max="8" value={form.manual_ads_score} onChange={(e) => setForm({ ...form, manual_ads_score: e.target.value })} /></label>
                <label>Volumen 0–6<input type="number" min="0" max="6" value={form.manual_volume_score} onChange={(e) => setForm({ ...form, manual_volume_score: e.target.value })} /></label>
                <label>Seguimiento 0–8<input type="number" min="0" max="8" value={form.manual_followup_score} onChange={(e) => setForm({ ...form, manual_followup_score: e.target.value })} /></label>
                <label>Decisor 0–8<input type="number" min="0" max="8" value={form.manual_decision_maker_score} onChange={(e) => setForm({ ...form, manual_decision_maker_score: e.target.value })} /></label>
              </div>
              <label className="check-row"><input type="checkbox" checked={form.do_not_contact} onChange={(e) => setForm({ ...form, do_not_contact: e.target.checked })} />No volver a contactar</label>
              <button className="button primary full" onClick={save} disabled={saving}><Save size={17} />{saving ? 'Guardando…' : 'Guardar cambios'}</button>
            </>
          )}

          {tab === 'contact' && (
            <>
              <div className="form-grid two">
                <label>Canal<select value={call.channel} onChange={(e) => setCall({ ...call, channel: e.target.value })}>{['Llamada', 'WhatsApp', 'Instagram', 'Email', 'Otro'].map((x) => <option key={x}>{x}</option>)}</select></label>
                <label>Resultado<select value={call.outcome} onChange={(e) => setCall({ ...call, outcome: e.target.value })}>{['No respondió','Buzón de voz','Número incorrecto','Recepción','Respondió','Solicitó información','Interesado','Seguimiento','Reunión agendada','No interesado','No califica','Venta'].map((x) => <option key={x}>{x}</option>)}</select></label>
                <label>Persona contactada<input value={call.contact_name} onChange={(e) => setCall({ ...call, contact_name: e.target.value })} /></label>
                <label>Cargo<input value={call.contact_title} onChange={(e) => setCall({ ...call, contact_title: e.target.value })} /></label>
                <label>Próxima fecha<input type="date" value={call.followup_date} onChange={(e) => setCall({ ...call, followup_date: e.target.value })} /></label>
                <label>Venta atribuida ($)<input type="number" min="0" step="0.01" value={call.sale_amount} onChange={(e) => setCall({ ...call, sale_amount: e.target.value })} /></label>
              </div>
              <label>Objeción<input value={call.objection} onChange={(e) => setCall({ ...call, objection: e.target.value })} /></label>
              <label>Notas<textarea rows="4" value={call.notes} onChange={(e) => setCall({ ...call, notes: e.target.value })} /></label>
              <label>Próximo paso<input value={call.next_step} onChange={(e) => setCall({ ...call, next_step: e.target.value })} /></label>
              <label className="check-row"><input type="checkbox" checked={call.appointment_booked} onChange={(e) => setCall({ ...call, appointment_booked: e.target.checked })} />Se agendó una reunión</label>
              <button className="button primary full" onClick={saveCall} disabled={saving}><CalendarClock size={17} />{saving ? 'Registrando…' : 'Registrar contacto'}</button>
            </>
          )}

          {tab === 'history' && (
            <div className="timeline">
              {(lead.call_logs || []).length === 0 && <p className="muted">Todavía no hay contactos registrados.</p>}
              {(lead.call_logs || []).map((item) => (
                <article key={item.id}>
                  <span className="timeline-dot" />
                  <div><strong>{item.channel} · {item.outcome}</strong><small>{new Date(item.occurred_at).toLocaleString('es-PA')}</small><p>{item.notes || item.next_step || 'Sin notas'}</p></div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
