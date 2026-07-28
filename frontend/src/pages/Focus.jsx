import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  BrainCircuit,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
  const [diagnoseTasks, setDiagnoseTasks] = useState([]);
  const [summary, setSummary] = useState({ total: 0, overdue: 0, due_today: 0, unassigned: 0 });
  const [scope, setScope] = useState('mine');
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [log, setLog] = useState(emptyLog);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async (nextScope = scope) => {
    setLoading(true);
    setError('');
    try {
      const [focusData, taskData, profileRows, config] = await Promise.all([
        api(`/api/focus?scope=${nextScope}&limit=100`),
        api(`/api/focus/diagnose-tasks?scope=${nextScope}&limit=20`),
        profiles.length ? Promise.resolve(profiles) : api('/api/profiles'),
        statuses.length ? Promise.resolve({ statuses }) : api('/api/config'),
      ]);
      setQueue(focusData.items || []);
      setDiagnoseTasks(taskData.items || []);
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

  useEffect(() => {
    document.body.classList.toggle('focus-sheet-open', showLog);
    return () => document.body.classList.remove('focus-sheet-open');
  }, [showLog]);

  useEffect(() => { setShowDetails(false); }, [queue[0]?.id]);

  useEffect(() => {
    if (!success) return undefined;
    const timer = window.setTimeout(() => setSuccess(''), 2600);
    return () => window.clearTimeout(timer);
  }, [success]);

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
    setShowDetails(false);
    setSuccess('');
  };

  const removeCurrent = (message) => {
    setQueue((items) => items.slice(1));
    setShowLog(false);
    setShowDetails(false);
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

  const updateDiagnoseTask = async (task, patch, confirmation) => {
    setSaving(true);
    setError('');
    try {
      await api(`/api/focus/diagnose-tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setDiagnoseTasks((items) => items.filter((item) => item.id !== task.id));
      setSuccess(confirmation);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const postponeDiagnoseTask = (task, days) => {
    updateDiagnoseTask(task, { due_date: localISODate(days), status: 'pending' }, `Acción de Diagnose pospuesta ${days === 1 ? 'para mañana' : `${days} días`}.`);
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

      {!!diagnoseTasks.length && (
        <section className="focus-diagnose-actions">
          <header><div><p className="eyebrow">DESDE DIAGNOSE</p><h2>Acciones estratégicas</h2></div><strong>{diagnoseTasks.length}</strong></header>
          {diagnoseTasks.slice(0, 3).map((task) => (
            <article key={task.id} className={`focus-diagnose-task ${task.priority}`}>
              <span className="focus-diagnose-icon"><BrainCircuit size={19} /></span>
              <div className="focus-diagnose-copy"><small>{task.diagnosis?.company_name || 'Diagnóstico'} · {task.due_state === 'overdue' ? 'Vencida' : task.due_state === 'today' ? 'Para hoy' : task.due_date || 'Sin fecha'}</small><h3>{task.title}</h3>{task.description && <p>{task.description}</p>}</div>
              <div className="focus-diagnose-controls">
                {profile?.role === 'admin' && <a className="button small diagnose-outline" href={`#/diagnose/${task.diagnosis_id}/roadmap`}>Ver contexto</a>}
                <button className="button small secondary" onClick={() => postponeDiagnoseTask(task, 1)} disabled={saving}>Mañana</button>
                <button className="button small diagnose-primary" onClick={() => updateDiagnoseTask(task, { status: 'completed' }, 'Acción de Diagnose completada.')} disabled={saving}><CheckCircle2 size={15} />Completar</button>
              </div>
            </article>
          ))}
        </section>
      )}

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

            <button className="focus-details-toggle" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails}>
              {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showDetails ? 'Ocultar detalles' : 'Ver detalles del lead'}
            </button>

            <div className={`focus-lead-kpis ${showDetails ? 'mobile-open' : ''}`}>
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
              <button className="focus-action log" onClick={openLog}><FileText size={21} /><span>Ya contacté · Registrar</span><small>Guardar lo ocurrido</small></button>
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
            <>
              <button className="focus-log-backdrop" onClick={() => setShowLog(false)} aria-label="Cerrar registro rápido" />
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
              <div className="focus-log-savebar">
                <button className="button primary full" onClick={saveLog} disabled={saving || !log.outcome}><CheckCircle2 size={17} />{saving ? 'Guardando…' : 'Guardar y mostrar siguiente'}</button>
              </div>
              </aside>
            </>
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
