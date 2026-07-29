import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
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
import ContactComposer, { conversationLabel } from '../components/ContactComposer';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

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

const bucketOptions = [
  ['priority', 'Prioridades'],
  ['active', 'Respondieron'],
  ['followups', 'Seguimientos'],
  ['waiting', 'Esperando'],
];

export default function Focus() {
  const { profile } = useAuth();
  const [queue, setQueue] = useState([]);
  const [diagnoseTasks, setDiagnoseTasks] = useState([]);
  const [summary, setSummary] = useState({ total: 0, overdue: 0, due_today: 0, unassigned: 0 });
  const [scope, setScope] = useState('mine');
  const [bucket, setBucket] = useState('priority');
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [logMode, setLogMode] = useState('action');
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async (nextScope = scope, nextBucket = bucket) => {
    setLoading(true);
    setError('');
    try {
      const [focusData, taskData, profileRows, config] = await Promise.all([
        api(`/api/focus?scope=${nextScope}&bucket=${nextBucket}&limit=100`),
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

  useEffect(() => { load('mine', 'priority'); }, []);

  useEffect(() => {
    document.body.classList.toggle('focus-sheet-open', showLog);
    return () => document.body.classList.remove('focus-sheet-open');
  }, [showLog]);

  useEffect(() => { setShowDetails(false); }, [queue[0]?.id]);

  useEffect(() => {
    if (!success) return undefined;
    const timer = window.setTimeout(() => setSuccess(''), 3000);
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
    load(value, bucket);
  };

  const changeBucket = (value) => {
    setBucket(value);
    setSuccess('');
    setShowLog(false);
    load(scope, value);
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
    setSuccess(message);
  };

  const openLog = (mode) => {
    setLogMode(mode);
    setShowLog(true);
    setSuccess('');
  };

  const saveLog = async (payload) => {
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/leads/${current.id}/call-logs`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const message = payload.activity_type === 'response_received'
        ? 'Respuesta guardada. Focus actualizó la conversación y seleccionó la siguiente acción.'
        : 'Acción guardada. El lead queda esperando respuesta y puedes seguir trabajando.';
      removeCurrent(message);
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
          conversation_status: 'followup_scheduled',
          outcome_stage: 'provisional',
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

  const bucketCount = (key) => ({
    priority: summary.priorities || 0,
    active: summary.active_conversations || 0,
    followups: summary.followups || 0,
    waiting: summary.waiting_responses || 0,
  }[key]);

  return (
    <>
      <PageHeader
        title="Hoy"
        description="Trabaja varias conversaciones sin cerrarlas antes de tiempo: cada acción se guarda y el outcome evoluciona con la respuesta."
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

      <nav className="focus-bucket-tabs" aria-label="Bandejas de Focus">
        {bucketOptions.map(([value, label]) => (
          <button key={value} className={bucket === value ? 'active' : ''} onClick={() => changeBucket(value)}>
            <span>{label}</span><strong>{bucketCount(value)}</strong>
          </button>
        ))}
      </nav>

      <section className="focus-summary-grid async-summary">
        <div><span>Conversaciones activas</span><strong>{summary.active_conversations || 0}</strong></div>
        <div><span>Esperando respuesta</span><strong>{summary.waiting_responses || 0}</strong></div>
        <div><span>Seguimientos</span><strong>{summary.followups || 0}</strong></div>
        <div><span>Vencidas</span><strong>{summary.overdue || 0}</strong></div>
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
          <EmptyState title="Esta bandeja está al día" text="No hay otra acción en esta vista. Cambia de bandeja o actualiza la cola." />
          <button className="button primary" onClick={() => load()}><RotateCcw size={16} />Revisar nuevamente</button>
        </section>
      ) : (
        <section className="focus-workspace">
          <article className="focus-card">
            <header className="focus-card-top">
              <div>
                <p className="eyebrow">FOCUS · {bucketOptions.find(([value]) => value === bucket)?.[1].toUpperCase()} · {progressText}</p>
                <h2>{current.business_name}</h2>
                <p>{current.address || 'Dirección no disponible'}</p>
              </div>
              <div className={`focus-priority ${String(current.priority_level || '').toLowerCase()}`}>
                <span>Momentum</span><strong>{current.priority_score}</strong><small>{current.priority_level}</small>
              </div>
            </header>

            <div className="conversation-state-banner">
              <MessageCircle size={18} />
              <div><small>ESTADO DE CONVERSACIÓN</small><strong>{conversationLabel(current.conversation_status)}</strong></div>
              <span className={`outcome-stage ${current.outcome_stage || 'pending'}`}>{current.outcome_stage === 'final' ? 'Final' : current.outcome_stage === 'provisional' ? 'Provisional' : 'Pendiente'}</span>
            </div>

            <button className="focus-details-toggle" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails}>
              {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showDetails ? 'Ocultar detalles' : 'Ver detalles del lead'}
            </button>

            <div className={`focus-lead-kpis ${showDetails ? 'mobile-open' : ''}`}>
              <div><span>ICP</span><strong>{current.final_score}</strong><small>Tier {current.final_tier}</small></div>
              <div><span>Estado</span><strong>{current.status}</strong><small>{current.outcome || 'Sin outcome'}</small></div>
              <div><span>Intentos</span><strong>{current.contact_attempts || 0}</strong><small>{current.owner_name || 'Sin asignar'}</small></div>
              <div><span>Seguimiento</span><strong>{current.next_followup_date || 'Sin fecha'}</strong><small>{current.response_due_state === 'overdue' ? 'Espera vencida' : current.due_state === 'overdue' ? 'Vencido' : current.due_state === 'today' ? 'Para hoy' : 'Programación actual'}</small></div>
            </div>

            <div className="focus-recommendation">
              <span className="focus-recommendation-icon"><Target size={22} /></span>
              <div><small>ACCIÓN RECOMENDADA</small><h3>{current.recommended_action}</h3><p>Canal sugerido: <strong>{current.recommended_channel}</strong></p></div>
            </div>

            <div className="focus-reasons">{focusReasons.map((reason) => <span key={reason}>{reason}</span>)}</div>

            <div className="focus-primary-actions async-actions">
              {current.phone && <a className="focus-action call" href={`tel:${current.phone}`}><Phone size={21} /><span>Llamar ahora</span><small>{current.phone}</small></a>}
              {wa && <a className="focus-action whatsapp" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={21} /><span>Abrir WhatsApp</span><small>Contactar por mensaje</small></a>}
              <button className="focus-action log" onClick={() => openLog('action')}><ArrowRight size={21} /><span>Registrar envío</span><small>Guardar y seguir con otro lead</small></button>
              <button className="focus-action response" onClick={() => openLog('response')}><MessageCircle size={21} /><span>Registrar respuesta</span><small>Analizar y actualizar outcome</small></button>
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
              <aside className="panel focus-log-panel async-contact-panel">
                <header><div><p className="eyebrow">REGISTRO ASÍNCRONO</p><h3>{logMode === 'response' ? 'Actualizar conversación' : 'Guardar acción'}</h3></div><button className="icon-button" onClick={() => setShowLog(false)}>×</button></header>
                <ContactComposer
                  key={`${current.id}-${logMode}`}
                  initialMode={logMode}
                  initialChannel={current.recommended_channel || 'Llamada'}
                  saving={saving}
                  onSubmit={saveLog}
                  onCancel={() => setShowLog(false)}
                />
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
