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
  contacts: { label: 'Detalle de contacto', empty: 'No hay actividad de contacto para analizar.' },
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

function detailDate(row, view) {
  if (view === 'saved') return formatDate(row.capture_date);
  if (view === 'overdue') {
    const delay = Number(row.days_overdue || 0);
    return delay > 0 ? `${delay} día${delay === 1 ? '' : 's'} vencido` : 'Vence hoy';
  }
  return formatDate(row.occurred_at || row.last_activity_at, true);
}

function DetailRow({ row, view, onOpen }) {
  const contactLabel = view === 'contacts'
    ? (row.contacted ? 'Contacto efectivo' : 'Sin contacto efectivo')
    : null;
  const value = view === 'sales' ? money(row.sale_amount) : detailDate(row, view);

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
        <b>{contactLabel || row.outcome || 'Sin outcome'}</b>
        <small>{row.activity_count ? `${row.activity_count} actividad${row.activity_count === 1 ? '' : 'es'}` : row.channel || 'Sin canal'}</small>
      </span>
      <span>
        <strong className="performance-cell-label">Responsable</strong>
        <b>{row.agent_name || row.owner_name || 'Sin asignar'}</b>
        <small>{row.next_followup_date ? `Próximo: ${formatDate(row.next_followup_date)}` : 'Sin próximo seguimiento'}</small>
      </span>
      <span className="performance-value-cell">
        <strong>{value}</strong>
        <small>Abrir ficha</small>
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
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    const cleared = { period: 'all', date_from: '', date_to: '', agent_id: '', status: '', tier: '', outcome: '' };
    setFilters(cleared);
    setDetailStatus('');
    setAppliedFilters(cleared);
  };

  const chooseMetric = (view) => {
    setSelectedView(view);
    setDetailStatus('');
    window.requestAnimationFrame(() => {
      document.getElementById('performance-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const choosePipelineStatus = (status) => {
    setSelectedView('saved');
    setDetailStatus(status);
    window.requestAnimationFrame(() => {
      document.getElementById('performance-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const detailItems = useMemo(() => {
    const rows = data?.details?.[selectedView] || [];
    const term = detailSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (detailStatus && row.status !== detailStatus) return false;
      if (!term) return true;
      return [row.business_name, row.zone, row.status, row.tier, row.outcome, row.owner_name, row.agent_name]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [data, selectedView, detailSearch, detailStatus]);

  const firstName = profile?.full_name?.split(' ')[0] || 'Laura';
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
          <div><Filter size={18} /><div><strong>Filtros del reporte</strong><small>El periodo controla altas y actividades. Los vencidos siempre reflejan la cartera actual.</small></div></div>
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
          <section className="metrics-grid performance-metrics-grid">
            <MetricCard active={selectedView === 'saved'} onClick={() => chooseMetric('saved')} label="Leads guardados" value={data.total_leads} note={`${data.tier_a} Tier A · ${data.tier_b} Tier B`} icon={Database} />
            <MetricCard active={selectedView === 'worked'} onClick={() => chooseMetric('worked')} label="Leads trabajados" value={data.worked_leads} note={`${data.contact_activities} actividades registradas`} icon={UsersRound} />
            <MetricCard active={selectedView === 'overdue'} onClick={() => chooseMetric('overdue')} label="Seguimientos vencidos" value={data.followups_due} note="Acciones que requieren atención" icon={CalendarClock} />
            <MetricCard active={selectedView === 'contacts'} onClick={() => chooseMetric('contacts')} label="Tasa de contacto" value={`${data.contact_rate}%`} note={`${data.connected} contactos efectivos`} icon={PhoneCall} />
            <MetricCard active={selectedView === 'meetings'} onClick={() => chooseMetric('meetings')} label="Reuniones" value={data.meetings} note={`${data.meeting_rate}% de leads trabajados`} icon={Target} />
            <MetricCard active={selectedView === 'sales'} onClick={() => chooseMetric('sales')} label="Ventas" value={data.sales} note={money(data.revenue)} icon={Trophy} />
          </section>

          <section className="performance-overview-grid">
            <article className="panel performance-panel">
              <div className="panel-heading"><div><p className="eyebrow">PIPELINE</p><h2>Estado actual de los leads</h2></div><small>{data.portfolio_total} en cartera</small></div>
              <div className="status-bars">
                {Object.entries(data.status_counts || {}).filter(([, count]) => count > 0).map(([name, count]) => {
                  const pct = data.portfolio_total ? Math.max(4, (count / data.portfolio_total) * 100) : 0;
                  return (
                    <button type="button" className="status-row performance-status-row" key={name} onClick={() => choosePipelineStatus(name)}>
                      <div><span>{name}</span><strong>{count}</strong></div>
                      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                    </button>
                  );
                })}
                {Object.values(data.status_counts || {}).every((count) => count === 0) && <EmptyState title="El pipeline está vacío" text="Genera o importa leads para comenzar." />}
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
                  <button key={key} type="button" className={selectedView === key ? 'active' : ''} onClick={() => { setSelectedView(key); setDetailStatus(''); }}>
                    {item.label}<strong>{data.detail_totals?.[key] ?? 0}</strong>
                  </button>
                ))}
              </nav>

              {detailStatus && <div className="performance-active-filter"><span>Estado: <strong>{detailStatus}</strong></span><button type="button" onClick={() => setDetailStatus('')}>Quitar</button></div>}

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
