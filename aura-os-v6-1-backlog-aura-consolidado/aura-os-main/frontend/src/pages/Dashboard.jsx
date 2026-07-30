import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, CalendarClock, Database, Filter, PhoneCall, RefreshCw, Search,
  Target, Trophy, UsersRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import MetricCard from '../components/MetricCard';
import EmptyState from '../components/EmptyState';
import LeadDrawer from '../components/LeadDrawer';

const money = (value) => new Intl.NumberFormat('es-PA', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(value || 0);

const detailViews = {
  saved: { label: 'Leads guardados', empty: 'No hay leads guardados con estos filtros.' },
  worked: { label: 'Leads trabajados', empty: 'Todavía no hay leads trabajados en este periodo.' },
  overdue: { label: 'Seguimientos vencidos', empty: 'No hay seguimientos vencidos.' },
  contacts_period: { label: 'Contactados del periodo', empty: 'No hay primeros contactos registrados en este periodo.' },
  responses: { label: 'Conversión histórica', empty: 'Todavía no hay contactos verificables para medir respuesta.' },
  meetings: { label: 'Reuniones', empty: 'No hay reuniones registradas en este periodo.' },
  sales: { label: 'Ventas', empty: 'No hay ventas registradas en este periodo.' },
};

function localISO(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function datesForPeriod(period) {
  const today = new Date();
  if (period === 'today') {
    const date = localISO(today);
    return { date_from: date, date_to: date };
  }
  if (period === '7') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { date_from: localISO(start), date_to: localISO(today) };
  }
  if (period === '30') {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { date_from: localISO(start), date_to: localISO(today) };
  }
  return { date_from: '', date_to: '' };
}

function formatDate(value, withTime = false) {
  if (!value) return 'Sin fecha';
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-PA', withTime ? {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit',
  } : {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
}

function formatResponseTime(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return 'Tiempo no disponible';
  const total = Number(minutes);
  if (total < 60) return `${Math.max(0, Math.round(total))} min`;
  if (total < 1440) return `${Math.floor(total / 60)} h ${Math.round(total % 60)} min`;
  const days = Math.floor(total / 1440);
  return `${days} día${days === 1 ? '' : 's'}`;
}

function detailDate(row, view) {
  if (view === 'saved') return formatDate(row.capture_date);
  if (view === 'overdue') {
    const delay = Number(row.days_overdue || 0);
    return delay > 0 ? `${delay} día${delay === 1 ? '' : 's'} vencido` : 'Vence hoy';
  }
  return formatDate(row.occurred_at || row.last_activity_at, true);
}

function DetailRow({ row, view, onOpen }) {
  const responseLabel = view === 'responses'
    ? (row.response_status || (row.responded ? 'Verificada' : 'Sin respuesta'))
    : null;
  const value = view === 'sales'
    ? money(row.sale_amount)
    : view === 'responses'
      ? (row.verified_response ? formatResponseTime(row.response_time_minutes) : row.inferred_response ? 'Por normalizar' : 'En espera')
      : detailDate(row, view);

  return (
    <button type="button" className="performance-detail-row" onClick={() => onOpen(row.lead_id)}>
      <span className="performance-lead-cell">
        <strong>{row.business_name}</strong>
        <small>{row.zone || row.channel || 'Sin ubicación'}</small>
      </span>
      <span>
        <strong className="performance-cell-label">Estado</strong>
        <span className="status-tag">{row.status || '—'}</span>
        <small>Tier {row.tier || '—'} · Score {row.score ?? '—'}</small>
      </span>
      <span>
        <strong className="performance-cell-label">Resultado</strong>
        <b>{responseLabel || row.outcome || 'Sin outcome'}</b>
        <small>{view === 'responses' ? `${row.contact_verified ? 'Contacto verificado' : 'Contacto histórico'} · ${formatDate(row.first_contact_at, true)}` : (row.activity_count ? `${row.activity_count} actividad${row.activity_count === 1 ? '' : 'es'}` : row.channel || 'Sin canal')}</small>
      </span>
      <span>
        <strong className="performance-cell-label">Responsable</strong>
        <b>{row.agent_name || row.owner_name || 'Sin asignar'}</b>
        <small>{view === 'responses' ? (row.attribution_verified ? 'Setter del primer contacto' : 'Atribución histórica') : (row.next_followup_date ? `Próximo: ${formatDate(row.next_followup_date)}` : 'Sin próximo seguimiento')}</small>
      </span>
      <span className="performance-value-cell">
        <strong>{value}</strong>
        <small>{view === 'responses' && row.verified_response ? `Respuesta: ${formatDate(row.first_response_at, true)}` : 'Abrir ficha'}</small>
      </span>
    </button>
  );
}

export default function Dashboard() {
  const { profile } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedView, setSelectedView] = useState('saved');
  const [selectedLead, setSelectedLead] = useState(null);
  const [detailStatus, setDetailStatus] = useState('');
  const [detailSearch, setDetailSearch] = useState('');
  const [responseFilter, setResponseFilter] = useState('');
  const [filters, setFilters] = useState({
    period: 'all', date_from: '', date_to: '', agent_id: '', status: '', tier: '', outcome: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const load = useCallback(async (activeFilters, silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      ['date_from', 'date_to', 'agent_id', 'status', 'tier', 'outcome'].forEach((key) => {
        if (activeFilters[key]) params.set(key, activeFilters[key]);
      });
      const response = await api(`/api/dashboard${params.toString() ? `?${params}` : ''}`);
      setData(response);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(appliedFilters);
    const interval = window.setInterval(() => load(appliedFilters, true), 60000);
    return () => window.clearInterval(interval);
  }, [appliedFilters, load]);

  const changePeriod = (period) => {
    const dates = datesForPeriod(period);
    setFilters((current) => ({ ...current, period, ...dates }));
  };

  const applyFilters = () => {
    setDetailStatus('');
    setResponseFilter('');
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    const cleared = { period: 'all', date_from: '', date_to: '', agent_id: '', status: '', tier: '', outcome: '' };
    setFilters(cleared);
    setDetailStatus('');
    setResponseFilter('');
    setAppliedFilters(cleared);
  };

  const chooseMetric = (view) => {
    setSelectedView(view);
    setDetailStatus('');
    setResponseFilter('');
    window.requestAnimationFrame(() => {
      document.getElementById('performance-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const chooseResponseGroup = (group) => {
    setSelectedView('responses');
    setDetailStatus('');
    setResponseFilter(group);
    window.requestAnimationFrame(() => {
      document.getElementById('performance-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const detailItems = useMemo(() => {
    const rows = data?.details?.[selectedView] || [];
    const term = detailSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (detailStatus && row.status !== detailStatus) return false;
      if (selectedView === 'responses' && responseFilter === 'verified' && !row.verified_response) return false;
      if (selectedView === 'responses' && responseFilter === 'inferred' && !row.inferred_response) return false;
      if (selectedView === 'responses' && responseFilter === 'without_response' && row.verified_response) return false;
      if (selectedView === 'responses' && responseFilter === 'over_24h' && !row.over_24h) return false;
      if (!term) return true;
      return [row.business_name, row.zone, row.status, row.tier, row.outcome, row.owner_name, row.agent_name]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [data, selectedView, detailSearch, detailStatus, responseFilter]);

  const firstName = profile?.full_name?.split(' ')[0] || 'Usuario';
  const statuses = data?.filter_options?.statuses || [];
  const profiles = data?.filter_options?.profiles || [];
  const maxActivity = Math.max(1, ...(data?.activity_by_day || []).map((item) => Number(item.count || 0)));
  const updatedAt = data?.generated_at ? formatDate(data.generated_at, true) : '—';

  return (
    <>
      <PageHeader
        title={`Bienvenida, ${firstName}.`}
        description="Rendimiento comercial en vivo. Filtra, abre cualquier indicador y actúa sobre el lead sin salir del panel."
        actions={(
          <div className="performance-header-actions">
            <span className="live-status"><i />En vivo · {updatedAt}</span>
            <button className="button secondary" onClick={() => load(appliedFilters, true)} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? 'spin-icon' : ''} />{refreshing ? 'Actualizando' : 'Actualizar'}
            </button>
          </div>
        )}
      />

      <section className="panel performance-filter-panel">
        <div className="performance-filter-heading">
          <div><Filter size={18} /><div><strong>Filtros del reporte</strong><small>El periodo controla la actividad. La conversión histórica usa contactos y respuestas verificadas, atribuidos al setter del primer contacto.</small></div></div>
          <button type="button" className="text-button" onClick={clearFilters}>Limpiar filtros</button>
        </div>
        <div className="performance-filter-grid">
          <label>Periodo
            <select value={filters.period} onChange={(e) => changePeriod(e.target.value)}>
              <option value="all">Todo el historial</option>
              <option value="today">Hoy</option>
              <option value="7">Últimos 7 días</option>
              <option value="30">Últimos 30 días</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
          <label>Desde<input type="date" value={filters.date_from} disabled={filters.period !== 'custom'} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></label>
          <label>Hasta<input type="date" value={filters.date_to} disabled={filters.period !== 'custom'} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></label>
          <label>Responsable
            <select value={filters.agent_id} onChange={(e) => setFilters({ ...filters, agent_id: e.target.value })}>
              <option value="">Todos</option>
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
            </select>
          </label>
          <label>Estado
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Todos</option>
              {statuses.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Tier
            <select value={filters.tier} onChange={(e) => setFilters({ ...filters, tier: e.target.value })}>
              <option value="">Todos</option>
              {(data?.filter_options?.tiers || ['A', 'B', 'C', 'Descartar']).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Outcome actual
            <select value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}>
              <option value="">Todos</option>
              {(data?.filter_options?.outcomes || []).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button type="button" className="button primary performance-apply-button" onClick={applyFilters}>Aplicar filtros</button>
        </div>
      </section>

      {error && <div className="form-error page-error">{error}</div>}
      {loading && !data ? <div className="panel skeleton-panel">Cargando reporte en vivo…</div> : data && (
        <>
          <div className="performance-section-heading">
            <div><p className="eyebrow">ACTIVIDAD DEL PERIODO</p><h2>Qué se trabajó</h2></div>
            <small>Controlado por el periodo seleccionado</small>
          </div>
          <section className="metrics-grid performance-metrics-grid">
            <MetricCard active={selectedView === 'saved'} onClick={() => chooseMetric('saved')} label="Leads guardados" value={data.total_leads} note={`${data.tier_a} Tier A · ${data.tier_b} Tier B`} icon={Database} />
            <MetricCard active={selectedView === 'worked'} onClick={() => chooseMetric('worked')} label="Leads trabajados" value={data.worked_leads} note={`${data.contact_activities} actividades registradas`} icon={UsersRound} />
            <MetricCard active={selectedView === 'contacts_period'} onClick={() => chooseMetric('contacts_period')} label="Contactados" value={data.contacted_period ?? 0} note={`${data.responded_period ?? 0} respondieron en el periodo`} icon={PhoneCall} />
            <MetricCard active={selectedView === 'overdue'} onClick={() => chooseMetric('overdue')} label="Seguimientos vencidos" value={data.followups_due} note="Acciones que requieren atención" icon={CalendarClock} />
            <MetricCard active={selectedView === 'meetings'} onClick={() => chooseMetric('meetings')} label="Reuniones" value={data.meetings} note={`${data.meeting_rate}% de leads trabajados`} icon={Target} />
            <MetricCard active={selectedView === 'sales'} onClick={() => chooseMetric('sales')} label="Ventas" value={data.sales} note={money(data.revenue)} icon={Trophy} />
          </section>

          <div className="performance-section-heading historical">
            <div><p className="eyebrow">CONVERSIÓN HISTÓRICA VERIFICADA</p><h2>Qué pasó después del contacto</h2></div>
            <small>No mezcla bots ni estados inferidos con la tasa principal</small>
          </div>
          <section className="metrics-grid performance-history-grid">
            <MetricCard active={selectedView === 'responses' && !responseFilter} onClick={() => chooseMetric('responses')} label="Contactos verificables" value={data.verified_contacted ?? 0} note={`${data.legacy_contacts ?? 0} registros históricos por normalizar`} icon={UsersRound} />
            <MetricCard active={selectedView === 'responses' && responseFilter === 'verified'} onClick={() => chooseResponseGroup('verified')} label="Tasa de respuesta verificada" value={`${data.verified_response_rate ?? 0}%`} note={`${data.verified_responded ?? 0} respuestas humanas registradas`} icon={PhoneCall} />
            <MetricCard active={selectedView === 'responses' && responseFilter === 'over_24h'} onClick={() => chooseResponseGroup('over_24h')} label="Sin respuesta +24 h" value={data.no_response_24h ?? 0} note="Contactos que requieren seguimiento" icon={CalendarClock} />
            <MetricCard active={selectedView === 'responses' && responseFilter === 'inferred'} onClick={() => chooseResponseGroup('inferred')} label="Respuestas inferidas" value={data.inferred_responses ?? 0} note="Clasificadas, pero sin interacción entrante" icon={Activity} />
          </section>
          <div className="performance-response-time">
            <span>Tiempo promedio hasta la primera respuesta</span>
            <strong>{formatResponseTime(data.average_response_minutes)}</strong>
          </div>

          <section className="performance-overview-grid">
            <article className="panel performance-panel">
              <div className="panel-heading"><div><p className="eyebrow">RESPUESTA VERIFICADA</p><h2>Contactos y respuestas humanas</h2></div><small>Todo el historial</small></div>
              <div className="status-bars">
                <button type="button" className="status-row performance-status-row" onClick={() => chooseResponseGroup('verified')}>
                  <div><span>Respuestas verificadas</span><strong>{data.response_breakdown?.verified ?? 0}</strong></div>
                  <div className="bar"><i style={{ width: `${Math.max(4, data.verified_response_rate ?? 0)}%` }} /></div>
                </button>
                <button type="button" className="status-row performance-status-row" onClick={() => chooseResponseGroup('without_response')}>
                  <div><span>Sin respuesta verificada</span><strong>{data.response_breakdown?.without_response ?? 0}</strong></div>
                  <div className="bar"><i style={{ width: `${Math.max(4, 100 - (data.verified_response_rate ?? 0))}%` }} /></div>
                </button>
                <button type="button" className="status-row performance-status-row muted" onClick={() => chooseResponseGroup('inferred')}>
                  <div><span>Inferidas por estado</span><strong>{data.response_breakdown?.inferred ?? 0}</strong></div>
                  <small>No participan en la tasa hasta registrar la interacción entrante.</small>
                </button>
              </div>
            </article>

            <article className="panel performance-panel">
              <div className="panel-heading"><div><p className="eyebrow">TENDENCIA</p><h2>Actividad comercial por día</h2></div><Activity size={20} /></div>
              {(data.activity_by_day || []).every((item) => !item.count) ? (
                <EmptyState title="Sin actividad en el periodo" text="Las llamadas, mensajes y respuestas aparecerán aquí." />
              ) : (
                <div className="performance-daily-chart" style={{ '--chart-columns': data.activity_by_day.length }}>
                  {(data.activity_by_day || []).map((item) => (
                    <div key={item.date} className="performance-day-column" title={`${formatDate(item.date)} · ${item.count} actividades`}>
                      <strong>{item.count || ''}</strong>
                      <span><i style={{ height: `${Math.max(item.count ? 9 : 2, (item.count / maxActivity) * 100)}%` }} /></span>
                      <small>{new Date(`${item.date}T12:00:00`).toLocaleDateString('es-PA', { day: '2-digit', month: 'short' })}</small>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="performance-workspace-grid">
            <article id="performance-detail" className="panel performance-detail-panel">
              <div className="performance-detail-header">
                <div>
                  <p className="eyebrow">DRILL-DOWN</p>
                  <h2>{detailViews[selectedView].label}{detailStatus ? ` · ${detailStatus}` : ''}</h2>
                  <p>{detailItems.length} registros visibles{data.detail_totals?.[selectedView] > detailItems.length ? ` de ${data.detail_totals[selectedView]}` : ''}</p>
                </div>
                <label className="performance-detail-search"><Search size={16} /><input value={detailSearch} onChange={(e) => setDetailSearch(e.target.value)} placeholder="Buscar dentro del detalle" /></label>
              </div>

              <nav className="performance-detail-tabs" aria-label="Detalles del rendimiento">
                {Object.entries(detailViews).map(([key, item]) => (
                  <button key={key} type="button" className={selectedView === key ? 'active' : ''} onClick={() => { setSelectedView(key); setDetailStatus(''); setResponseFilter(''); }}>
                    {item.label}<strong>{data.detail_totals?.[key] ?? 0}</strong>
                  </button>
                ))}
              </nav>

              {detailStatus && <div className="performance-active-filter"><span>Estado: <strong>{detailStatus}</strong></span><button type="button" onClick={() => setDetailStatus('')}>Quitar</button></div>}
              {selectedView === 'responses' && responseFilter && <div className="performance-active-filter"><span>Respuesta: <strong>{{ verified: 'Verificada', inferred: 'Inferida', without_response: 'Sin respuesta', over_24h: 'Sin respuesta +24 h' }[responseFilter]}</strong></span><button type="button" onClick={() => setResponseFilter('')}>Quitar</button></div>}

              <div className="performance-detail-list">
                {detailItems.length === 0 ? <EmptyState title="Sin resultados" text={detailViews[selectedView].empty} /> : detailItems.map((row, index) => (
                  <DetailRow key={`${row.activity_id || row.lead_id}-${index}`} row={row} view={selectedView} onOpen={setSelectedLead} />
                ))}
              </div>
            </article>

            <article className="panel performance-live-panel">
              <div className="panel-heading"><div><p className="eyebrow">ACTIVIDAD EN VIVO</p><h2>Últimos movimientos</h2></div><span className="live-dot" /></div>
              {(data.recent_calls || []).length === 0 ? <EmptyState title="Sin actividad todavía" text="El historial aparecerá aquí después del primer contacto." /> : (
                <div className="activity-list performance-activity-list">
                  {data.recent_calls.map((call) => (
                    <button key={call.activity_id} type="button" onClick={() => setSelectedLead(call.lead_id)}>
                      <span className="activity-channel">{call.channel?.[0] || 'A'}</span>
                      <div><strong>{call.business_name}</strong><p>{call.agent_name} · {call.outcome || 'Actividad registrada'}</p><small>{call.notes || 'Abrir ficha del lead'}</small></div>
                      <time>{formatDate(call.occurred_at, true)}</time>
                    </button>
                  ))}
                </div>
              )}
            </article>
          </section>
        </>
      )}

      {selectedLead && (
        <LeadDrawer
          leadId={selectedLead}
          statuses={statuses}
          profiles={profiles}
          onClose={() => setSelectedLead(null)}
          onChanged={() => load(appliedFilters, true)}
        />
      )}
    </>
  );
}
