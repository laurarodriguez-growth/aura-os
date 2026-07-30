import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MessageCircle,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  UserCheck,
  UsersRound,
  X,
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

function formatWorkDate(value) {
  if (!value) return 'Sin fecha';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return String(value);
  return new Date(year, month - 1, day).toLocaleDateString('es-PA', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function whatsappLink(lead) {
  if (lead.whatsapp_url) return lead.whatsapp_url;
  const digits = String(lead.whatsapp_phone || lead.phone || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : '';
}

function followupReason(lead) {
  return lead.followup_reason
    || lead.next_step
    || lead.outcome
    || lead.notes
    || 'Retomar la conversación y definir el próximo paso.';
}

const bucketOptions = [
  ['new', 'Nuevos'],
  ['followups', 'Seguimientos del día'],
  ['waiting', 'Esperando primer contacto'],
  ['active', 'Conversaciones activas'],
];

export default function Focus() {
  const { profile } = useAuth();
  const [queue, setQueue] = useState([]);
  const [diagnoseTasks, setDiagnoseTasks] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    new_leads: 0,
    active_conversations: 0,
    waiting_responses: 0,
    followups: 0,
  });
  const [scope, setScope] = useState('mine');
  const [bucket, setBucket] = useState('new');
  const [followupDate, setFollowupDate] = useState(() => localISODate(0));
  const [followupSearch, setFollowupSearch] = useState('');
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
  const [showAssignment, setShowAssignment] = useState(false);
  const [assignment, setAssignment] = useState({ unassigned_count: 0, unassigned: [], setters: [] });
  const [selectedSetters, setSelectedSetters] = useState([]);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const firstName = String(profile?.full_name || '').trim().split(/\s+/)[0] || 'Usuario';

  const load = async (nextScope = scope, nextBucket = bucket, nextFollowupDate = followupDate) => {
    setLoading(true);
    setError('');
    try {
      const focusParams = new URLSearchParams({
        scope: nextScope,
        bucket: nextBucket,
        limit: '200',
        work_date: nextFollowupDate,
      });
      const [focusData, taskData, profileRows, config] = await Promise.all([
        api(`/api/focus?${focusParams.toString()}`),
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

  useEffect(() => { load('mine', 'new', localISODate(0)); }, []);

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

  const current = bucket === 'followups' ? null : (queue[0] || null);
  const wa = current ? whatsappLink(current) : '';
  const progressText = summary.total
    ? `${Math.max(1, summary.total - queue.length + 1)} de ${summary.total}`
    : '0 de 0';
  const focusReasons = useMemo(() => current?.priority_reasons || [], [current]);
  const visibleFollowups = useMemo(() => {
    const term = followupSearch.trim().toLocaleLowerCase('es');
    if (!term) return queue;
    return queue.filter((lead) => [
      lead.business_name,
      lead.address,
      lead.outcome,
      lead.notes,
      lead.followup_reason,
      lead.owner_name,
    ].some((value) => String(value || '').toLocaleLowerCase('es').includes(term)));
  }, [queue, followupSearch]);

  const currentOwnerId = String(current?.owner_id || '');
  const canWorkCurrent = Boolean(current && currentOwnerId && currentOwnerId === String(profile?.id || ''));
  const supervisionOnly = Boolean(current && !canWorkCurrent);

  const openAssignment = async () => {
    setShowAssignment(true);
    setAssignmentLoading(true);
    setError('');
    try {
      const data = await api('/api/focus/assignment');
      setAssignment(data);
      setSelectedSetters((current) => {
        const activeIds = new Set((data.setters || []).map((item) => item.id));
        const preserved = current.filter((id) => activeIds.has(id));
        return preserved.length ? preserved : (data.setters || []).map((item) => item.id);
      });
    } catch (e) {
      setError(e.message);
      setShowAssignment(false);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const toggleSetter = (setterId) => {
    setSelectedSetters((current) => current.includes(setterId)
      ? current.filter((id) => id !== setterId)
      : [...current, setterId]);
  };

  const distributeLeads = async () => {
    if (!selectedSetters.length) {
      setError('Selecciona al menos un setter para repartir los leads.');
      return;
    }
    setAssignmentSaving(true);
    setError('');
    try {
      const result = await api('/api/focus/assignment', {
        method: 'POST',
        body: JSON.stringify({ setter_ids: selectedSetters, strategy: 'round_robin' }),
      });
      const detail = (result.distribution || [])
        .filter((item) => item.assigned > 0)
        .map((item) => `${item.setter_name}: ${item.assigned}`)
        .join(' · ');
      setSuccess(`${result.assigned} leads repartidos${detail ? ` · ${detail}` : ''}.`);
      const refreshed = await api('/api/focus/assignment');
      setAssignment(refreshed);
      if (!refreshed.unassigned_count) setShowAssignment(false);
      await load(scope, bucket, followupDate);
    } catch (e) {
      setError(e.message);
    } finally {
      setAssignmentSaving(false);
    }
  };

  const changeScope = (value) => {
    setScope(value);
    setSuccess('');
    load(value, bucket, followupDate);
  };

  const changeBucket = (value) => {
    setBucket(value);
    setSuccess('');
    setShowLog(false);
    load(scope, value, followupDate);
  };

  const changeFollowupDate = (value) => {
    const nextDate = value || localISODate(0);
    setFollowupDate(nextDate);
    setSuccess('');
    if (bucket === 'followups') load(scope, 'followups', nextDate);
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
        ? 'Respuesta guardada. El lead pasó a Conversaciones activas y Aura definió el siguiente paso.'
        : bucket === 'new'
          ? 'Primer contacto guardado. El lead pasó a Esperando.'
          : 'Acción guardada. Focus actualizó la conversación y el próximo seguimiento.';
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
    new: summary.new_leads || 0,
    active: summary.active_conversations || 0,
    followups: summary.followups || 0,
    waiting: summary.waiting_responses || 0,
  }[key]);

  const renderFollowups = () => (
    <section className="panel focus-followup-panel">
      <header className="focus-followup-header">
        <div>
          <p className="eyebrow">SEGUIMIENTOS DEL DÍA</p>
          <h2>{formatWorkDate(followupDate)}</h2>
          <p>Solo aparecen los leads programados para esta fecha.</p>
        </div>
        <strong>{visibleFollowups.length}</strong>
      </header>

      <div className="focus-followup-toolbar">
        <label className="focus-followup-search">
          <Search size={17} />
          <input
            value={followupSearch}
            onChange={(event) => setFollowupSearch(event.target.value)}
            placeholder="Buscar por nombre"
          />
        </label>
        <label className="focus-followup-date-filter">
          <CalendarDays size={17} />
          <span>Fecha</span>
          <input
            type="date"
            value={followupDate}
            onChange={(event) => changeFollowupDate(event.target.value)}
          />
        </label>
        {followupDate !== localISODate(0) && (
          <button type="button" className="button secondary" onClick={() => changeFollowupDate(localISODate(0))}>
            Volver a hoy
          </button>
        )}
      </div>

      {visibleFollowups.length === 0 ? (
        <EmptyState
          title={followupSearch ? 'No encontramos ese lead' : 'No hay seguimientos para esta fecha'}
          text={followupSearch
            ? 'Prueba con otra parte del nombre o limpia la búsqueda.'
            : 'Cambia la fecha para revisar otro día.'}
        />
      ) : (
        <div className="focus-followup-grid">
          {visibleFollowups.map((lead) => (
            <article key={lead.id} className="focus-followup-card">
              <button type="button" className="focus-followup-main" onClick={() => setSelected(lead.id)}>
                <span className="focus-followup-icon"><AlarmClock size={19} /></span>
                <span className="focus-followup-copy">
                  <small>{formatWorkDate(lead.next_followup_date)}</small>
                  <strong>{lead.business_name}</strong>
                  <p>{followupReason(lead)}</p>
                </span>
                <span className="focus-followup-meta">
                  <b>{lead.status || 'Seguimiento'}</b>
                  <small>{lead.owner_name || 'Sin asignar'}</small>
                </span>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      <PageHeader
        title={`Hola, ${firstName}!`}
        description="Esto es lo que tienes para hoy."
        actions={(
          <>
            {profile?.role === 'admin' && (
              <button type="button" className="button focus-assignment-trigger" onClick={openAssignment}>
                <UsersRound size={17} />Repartir leads
                <strong>{summary.unassigned || 0}</strong>
              </button>
            )}
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

      {showAssignment && (
        <div className="focus-assignment-layer" role="dialog" aria-modal="true" aria-label="Repartir leads nuevos">
          <button type="button" className="focus-assignment-backdrop" onClick={() => !assignmentSaving && setShowAssignment(false)} aria-label="Cerrar reparto" />
          <aside className="panel focus-assignment-panel">
            <header>
              <div><p className="eyebrow">PRE-REPARTO</p><h2>Repartir leads nuevos</h2><p>Los leads no aparecen en la cola de trabajo hasta tener un responsable.</p></div>
              <button type="button" className="icon-button" onClick={() => setShowAssignment(false)} disabled={assignmentSaving}><X size={20} /></button>
            </header>

            {assignmentLoading ? (
              <div className="focus-assignment-loading"><Sparkles size={19} />Preparando el reparto…</div>
            ) : (
              <>
                <div className="focus-assignment-total">
                  <span>Sin asignar</span><strong>{assignment.unassigned_count || 0}</strong><small>leads nuevos listos para repartir</small>
                </div>

                <section className="focus-assignment-section">
                  <div className="focus-assignment-section-title">
                    <div><strong>¿Quiénes trabajarán esta cola?</strong><small>El reparto equilibra la cantidad actual de nuevos.</small></div>
                    <button type="button" onClick={() => setSelectedSetters((assignment.setters || []).map((item) => item.id))}>Seleccionar todos</button>
                  </div>
                  <div className="focus-setter-grid">
                    {(assignment.setters || []).map((setter) => {
                      const checked = selectedSetters.includes(setter.id);
                      return (
                        <label key={setter.id} className={`focus-setter-option ${checked ? 'selected' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleSetter(setter.id)} />
                          <span><UserCheck size={18} /></span>
                          <div><strong>{setter.full_name}</strong><small>{setter.new_leads || 0} nuevos asignados ahora</small></div>
                        </label>
                      );
                    })}
                  </div>
                </section>

                {!!assignment.unassigned?.length && (
                  <section className="focus-assignment-section preview">
                    <div className="focus-assignment-section-title"><div><strong>Primeros leads del reparto</strong><small>Se ordenan por score para mezclarlos de forma equilibrada.</small></div></div>
                    <div className="focus-unassigned-preview">
                      {assignment.unassigned.slice(0, 8).map((lead) => (
                        <div key={lead.id}><span>{lead.business_name}</span><small>Tier {lead.final_tier || '—'} · {lead.final_score || 0} pts</small></div>
                      ))}
                    </div>
                  </section>
                )}

                <footer>
                  <button type="button" className="button secondary" onClick={() => setShowAssignment(false)} disabled={assignmentSaving}>Cancelar</button>
                  <button type="button" className="button primary" onClick={distributeLeads} disabled={assignmentSaving || !assignment.unassigned_count || !selectedSetters.length}>
                    <UsersRound size={18} />{assignmentSaving ? 'Repartiendo…' : `Repartir ${assignment.unassigned_count || 0} leads`}
                  </button>
                </footer>
              </>
            )}
          </aside>
        </div>
      )}

      <section className="focus-summary-grid async-summary" aria-label="Bandejas de trabajo de Focus">
        {bucketOptions.map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={bucket === value ? 'active' : ''}
            onClick={() => changeBucket(value)}
            aria-pressed={bucket === value}
          >
            <span>{label}</span>
            <strong>{bucketCount(value)}</strong>
          </button>
        ))}
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
        <section className="panel focus-loading"><Sparkles size={22} />Focus está organizando la cola de trabajo…</section>
      ) : bucket === 'followups' ? (
        renderFollowups()
      ) : !current ? (
        <section className="panel focus-empty">
          <EmptyState
            title={profile?.role === 'admin' && bucket === 'new' && summary.unassigned ? 'Primero reparte los leads nuevos' : 'Esta bandeja está al día'}
            text={profile?.role === 'admin' && bucket === 'new' && summary.unassigned
              ? `${summary.unassigned} leads están sin responsable y todavía no pertenecen a ninguna cola.`
              : 'No hay otro lead en esta vista. Cambia de bandeja o actualiza la cola.'}
          />
          {profile?.role === 'admin' && bucket === 'new' && summary.unassigned > 0 && (
            <button className="button primary" onClick={openAssignment}><UsersRound size={16} />Repartir ahora</button>
          )}
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

            {supervisionOnly && (
              <div className="focus-owner-lock">
                <UsersRound size={18} />
                <div><strong>Solo supervisión</strong><span>{currentOwnerId ? `Este lead está asignado a ${current.owner_name || 'otro setter'}.` : 'Este lead todavía está sin asignar.'}</span></div>
                {profile?.role === 'admin' && <button type="button" onClick={openAssignment}>Abrir reparto</button>}
              </div>
            )}

            <div className="conversation-state-banner">
              <MessageCircle size={18} />
              <div><small>ESTADO DE CONVERSACIÓN</small><strong>{conversationLabel(current.conversation_status)}</strong></div>
              <span className="conversation-current-outcome">{current.outcome || 'Pendiente'}</span>
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

            {canWorkCurrent ? (
              <div className="focus-primary-actions async-actions">
                {current.phone && <a className="focus-action call" href={`tel:${current.phone}`}><Phone size={21} /><span>Llamar ahora</span><small>{current.phone}</small></a>}
                {wa && <a className="focus-action whatsapp" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={21} /><span>Abrir WhatsApp</span><small>Contactar por mensaje</small></a>}
                <button className="focus-action log" onClick={() => openLog('action')}><ArrowRight size={21} /><span>Registrar envío</span><small>{bucket === 'new' ? 'Guardar y mover a Esperando' : 'Guardar y actualizar el seguimiento'}</small></button>
                <button className="focus-action response" onClick={() => openLog('response')}><MessageCircle size={21} /><span>Registrar respuesta</span><small>Analizar y mover a Conversaciones activas</small></button>
              </div>
            ) : (
              <div className="focus-supervision-message">Este lead no puede trabajarse desde tu cola. Reasígnalo primero para evitar contactos duplicados.</div>
            )}

            <div className="focus-secondary-actions">
              <button onClick={() => setSelected(current.id)}><ExternalLink size={15} />Ver ficha completa</button>
              <button onClick={rotate}><ArrowRight size={15} />Saltar por ahora</button>
            </div>

            {canWorkCurrent && (
              <div className="focus-postpone">
                <span><AlarmClock size={16} />Posponer:</span>
                <button disabled={saving} onClick={() => postpone(1)}>Mañana</button>
                <button disabled={saving} onClick={() => postpone(3)}>3 días</button>
                <button disabled={saving} onClick={() => postpone(7)}>7 días</button>
              </div>
            )}
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
          onChanged={() => load(scope, bucket, followupDate)}
        />
      )}
    </>
  );
}
