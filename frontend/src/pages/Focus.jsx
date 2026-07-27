import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  ExternalLink,
  FileText,
  MessageCircle,
  Phone,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import LeadDrawer from '../components/LeadDrawer';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const outcomes = [
  'No respondió',
  'Buzón de voz',
  'Número incorrecto',
  'Recepción',
  'Respondió',
  'Solicitó información',
  'Interesado',
  'Seguimiento',
  'Reunión agendada',
  'No interesado',
  'No califica',
  'Venta',
];

const emptyLog = {
  channel: 'Llamada',
  outcome: 'No respondió',
  notes: '',
  next_step: '',
  followup_date: '',
  appointment_booked: false,
  sale_amount: '',
};

function localISODate(daysFromToday = 0) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function whatsappLink(lead) {
  if (lead.whatsapp_url) return lead.whatsapp_url;
  const digits = String(lead.whatsapp_phone || lead.phone || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

export default function Focus() {
  const { profile } = useAuth();
  const [queue, setQueue] = useState([]);
  const [summary, setSummary] = useState({ total: 0, overdue: 0, due_today: 0, unassigned: 0 });
  const [scope, setScope] = useState('mine');
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState(emptyLog);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async (nextScope = scope) => {
    setLoading(true);
    setError('');
    try {
      const [focusData, profileRows, config] = await Promise.all([
        api(`/api/focus?scope=${nextScope}&limit=100`),
        profiles.length ? Promise.resolve(profiles) : api('/api/profiles'),
        statuses.length ? Promise.resolve({ statuses }) : api('/api/config'),
      ]);
      setQueue(focusData.items || []);
      setSummary(focusData);
      setProfiles(profileRows);
      setStatuses(config.statuses || statuses);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load('mine'); }, []);

  const current = queue[0] || null;
  const wa = current ? whatsappLink(current) : '';
  const progressText = summary.total
    ? `${Math.max(1, summary.total - queue.length + 1)} de ${summary.total}`
    : '0 de 0';

  const focusReasons = useMemo(() => current?.priority_reasons || [], [current]);

  const changeScope = (value) => {
    setScope(value);
    setSuccess('');
    load(value);
  };

  const rotate = () => {
    if (queue.length <= 1) return;
    setQueue((items) => [...items.slice(1), items[0]]);
    setShowLog(false);
    setSuccess('');
  };

  const removeCurrent = (message) => {
    setQueue((items) => items.slice(1));
    setShowLog(false);
    setLog(emptyLog);
    setSuccess(message);
  };

  const openLog = () => {
    setLog({
      ...emptyLog,
      channel: current?.recommended_channel || 'Llamada',
    });
    setShowLog(true);
    setSuccess('');
  };

  const saveLog = async () => {
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/leads/${current.id}/call-logs`, {
        method: 'POST',
        body: JSON.stringify({
          ...log,
          followup_date: log.followup_date || null,
          sale_amount: log.sale_amount === '' ? null : Number(log.sale_amount),
        }),
      });
      removeCurrent('Resultado guardado. Focus seleccionó la siguiente acción.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const postpone = async (days) => {
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/leads/${current.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          next_followup_date: localISODate(days),
          owner_id: profile.id,
          status: current.status === 'Nuevo' ? 'Seguimiento 1' : current.status,
        }),
      });
      removeCurrent(`Seguimiento pospuesto ${days === 1 ? 'para mañana' : `${days} días`}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Hoy"
        description="Focus convierte la operación en una secuencia clara: una prioridad, una acción y el siguiente paso."
        actions={(
          <>
            {profile?.role === 'admin' && (
              <div className="focus-scope-switch" aria-label="Alcance de la cola">
                <button className={scope === 'mine' ? 'active' : ''} onClick={() => changeScope('mine')}>Mi cola</button>
                <button className={scope === 'all' ? 'active' : ''} onClick={() => changeScope('all')}>Toda la operación</button>
              </div>
            )}
            <button className="button secondary" onClick={() => load()} disabled={loading}><RefreshCw size={16} />Actualizar</button>
          </>
        )}
      />

      <section className="focus-summary-grid">
        <div><span>Acciones activas</span><strong>{summary.total || 0}</strong></div>
        <div><span>Vencidas</span><strong>{summary.overdue || 0}</strong></div>
        <div><span>Para hoy</span><strong>{summary.due_today || 0}</strong></div>
        <div><span>Sin asignar</span><strong>{summary.unassigned || 0}</strong></div>
      </section>

      {error && <div className="form-error page-error">{error}</div>}
      {success && <div className="focus-success"><CheckCircle2 size={18} />{success}</div>}

      {loading ? (
        <section className="panel focus-loading"><Sparkles size={22} />Focus está ordenando tus prioridades…</section>
      ) : !current ? (
        <section className="panel focus-empty">
          <EmptyState title="Tu día está al día" text="No hay otra acción prioritaria en este momento. Puedes actualizar la cola o revisar la Base de leads." />
          <button className="button primary" onClick={() => load()}><RotateCcw size={16} />Revisar nuevamente</button>
        </section>
      ) : (
        <section className="focus-workspace">
          <article className="focus-card">
            <header className="focus-card-top">
              <div>
                <p className="eyebrow">FOCUS · SIGUIENTE MEJOR ACCIÓN · {progressText}</p>
                <h2>{current.business_name}</h2>
                <p>{current.address || 'Dirección no disponible'}</p>
              </div>
              <div className={`focus-priority ${String(current.priority_level || '').toLowerCase()}`}>
                <span>Momentum</span>
                <strong>{current.priority_score}</strong>
                <small>{current.priority_level}</small>
              </div>
            </header>

            <div className="focus-lead-kpis">
              <div><span>ICP</span><strong>{current.final_score}</strong><small>Tier {current.final_tier}</small></div>
              <div><span>Estado</span><strong>{current.status}</strong><small>{current.outcome || 'Sin resultado previo'}</small></div>
              <div><span>Intentos</span><strong>{current.contact_attempts || 0}</strong><small>{current.owner_name || 'Sin asignar'}</small></div>
              <div><span>Seguimiento</span><strong>{current.next_followup_date || 'Sin fecha'}</strong><small>{current.due_state === 'overdue' ? 'Vencido' : current.due_state === 'today' ? 'Para hoy' : 'Programación actual'}</small></div>
            </div>

            <div className="focus-recommendation">
              <span className="focus-recommendation-icon"><Target size={22} /></span>
              <div>
                <small>ACCIÓN RECOMENDADA</small>
                <h3>{current.recommended_action}</h3>
                <p>Canal sugerido: <strong>{current.recommended_channel}</strong></p>
              </div>
            </div>

            <div className="focus-reasons">
              {focusReasons.map((reason) => <span key={reason}>{reason}</span>)}
            </div>

            <div className="focus-primary-actions">
              {current.phone && <a className="focus-action call" href={`tel:${current.phone}`}><Phone size={21} /><span>Llamar ahora</span><small>{current.phone}</small></a>}
              {wa && <a className="focus-action whatsapp" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={21} /><span>Abrir WhatsApp</span><small>Contactar por mensaje</small></a>}
              <button className="focus-action log" onClick={openLog}><FileText size={21} /><span>Registrar resultado</span><small>Guardar lo ocurrido</small></button>
            </div>

            <div className="focus-secondary-actions">
              <button onClick={() => setSelected(current.id)}><ExternalLink size={15} />Ver ficha completa</button>
              <button onClick={rotate}><ArrowRight size={15} />Saltar por ahora</button>
            </div>

            <div className="focus-postpone">
              <span><AlarmClock size={16} />Posponer:</span>
              <button disabled={saving} onClick={() => postpone(1)}>Mañana</button>
              <button disabled={saving} onClick={() => postpone(3)}>3 días</button>
              <button disabled={saving} onClick={() => postpone(7)}>7 días</button>
            </div>
          </article>

          {showLog && (
            <aside className="panel focus-log-panel">
              <header><div><p className="eyebrow">REGISTRO RÁPIDO</p><h3>¿Qué ocurrió?</h3></div><button className="icon-button" onClick={() => setShowLog(false)}>×</button></header>
              <div className="form-grid two">
                <label>Canal<select value={log.channel} onChange={(e) => setLog({ ...log, channel: e.target.value })}><option>Llamada</option><option>WhatsApp</option><option>Instagram</option><option>Email</option><option>Otro</option></select></label>
                <label>Resultado<select value={log.outcome} onChange={(e) => setLog({ ...log, outcome: e.target.value })}>{outcomes.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label>Próximo seguimiento<input type="date" value={log.followup_date} onChange={(e) => setLog({ ...log, followup_date: e.target.value })} /></label>
                <label>Próximo paso<input value={log.next_step} onChange={(e) => setLog({ ...log, next_step: e.target.value })} placeholder="Ej. llamar a la administradora" /></label>
              </div>
              <label>Notas<textarea rows="4" value={log.notes} onChange={(e) => setLog({ ...log, notes: e.target.value })} placeholder="Contexto útil para el siguiente contacto" /></label>
              <div className="focus-log-options">
                <label className="check-row"><input type="checkbox" checked={log.appointment_booked} onChange={(e) => setLog({ ...log, appointment_booked: e.target.checked })} />Reunión agendada</label>
                <label>Monto de venta<input type="number" min="0" step="0.01" value={log.sale_amount} onChange={(e) => setLog({ ...log, sale_amount: e.target.value })} placeholder="0.00" /></label>
              </div>
              <button className="button primary full" onClick={saveLog} disabled={saving || !log.outcome}><CheckCircle2 size={17} />{saving ? 'Guardando…' : 'Guardar y mostrar siguiente'}</button>
            </aside>
          )}
        </section>
      )}

      {selected && (
        <LeadDrawer
          leadId={selected}
          statuses={statuses}
          profiles={profiles}
          onClose={() => setSelected(null)}
          onChanged={() => load()}
        />
      )}
    </>
  );
}
