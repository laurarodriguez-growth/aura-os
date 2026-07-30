import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FilterX,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { conversationLabel } from '../components/ContactComposer';
import { useOutcomes } from '../components/OutcomeSelect';
import { api, downloadExport } from '../lib/api';

const channels = ['Llamada', 'WhatsApp', 'Instagram', 'Email', 'Otro'];

const conversationStatuses = [
  ['not_started', 'No iniciada'],
  ['waiting_response', 'Esperando respuesta'],
  ['response_received', 'Respuesta recibida'],
  ['conversation_active', 'Conversación activa'],
  ['waiting_decision_maker', 'Esperando al decisor'],
  ['waiting_confirmation', 'Esperando confirmación'],
  ['followup_scheduled', 'Seguimiento programado'],
  ['closed', 'Cerrada'],
];

const emptyFilters = {
  search: '',
  date_from: '',
  date_to: '',
  channel: '',
  outcome: '',
  conversation_status: '',
  agent_id: '',
  page_size: 25,
};

export default function CallLog() {
  const [data, setData] = useState({ items: [], total: 0, page: 1, page_size: 25 });
  const [profiles, setProfiles] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const { items: outcomeLibrary } = useOutcomes('all');

  const buildParams = (values, pageNumber = 1, includePagination = true) => {
    const params = new URLSearchParams();
    if (includePagination) {
      params.set('page', String(pageNumber));
      params.set('page_size', String(values.page_size));
    }
    ['search', 'date_from', 'date_to', 'channel', 'outcome', 'conversation_status', 'agent_id'].forEach((key) => {
      if (String(values[key] || '').trim()) params.set(key, String(values[key]).trim());
    });
    return params;
  };

  const load = async (values = applied, pageNumber = page) => {
    setLoading(true);
    setError('');
    try {
      if (values.date_from && values.date_to && values.date_from > values.date_to) {
        throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
      }
      const [result, profileRows] = await Promise.all([
        api(`/api/call-logs?${buildParams(values, pageNumber)}`),
        profiles.length ? Promise.resolve(profiles) : api('/api/profiles'),
      ]);
      setData(result);
      setProfiles(profileRows);
      setPage(pageNumber);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(emptyFilters, 1); }, []);

  const applyFilters = () => {
    const next = { ...filters, page_size: Number(filters.page_size) };
    setApplied(next);
    load(next, 1);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setApplied(emptyFilters);
    load(emptyFilters, 1);
  };

  const totalPages = Math.max(1, Math.ceil(Number(data.total || 0) / Number(data.page_size || 25)));
  const visibleRange = useMemo(() => {
    if (!data.total) return '0';
    const first = ((page - 1) * data.page_size) + 1;
    const last = Math.min(page * data.page_size, data.total);
    return `${first}–${last}`;
  }, [data.total, data.page_size, page]);

  const changePage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    load(applied, nextPage);
  };

  const changePageSize = (value) => {
    const size = Number(value);
    const nextFilters = { ...filters, page_size: size };
    const nextApplied = { ...applied, page_size: size };
    setFilters(nextFilters);
    setApplied(nextApplied);
    load(nextApplied, 1);
  };

  const exportFiltered = async () => {
    setExporting(true);
    setError('');
    try {
      const query = buildParams(applied, 1, false).toString();
      const today = new Date().toISOString().slice(0, 10);
      const hasFilters = query.length > 0;
      await downloadExport(
        `/api/export/call-logs${hasFilters ? `?${query}` : ''}`,
        `aura-grow_call_log_${hasFilters ? 'filtrado_' : ''}${today}.csv`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Call Log"
        description="Cada acción se registra de inmediato. El equipo selecciona qué pasó y Aura calcula internamente el estado del outcome."
        actions={(
          <>
            <Link className="button secondary" to="/leads"><ArrowLeft size={16} />Volver a Base de leads</Link>
            <button className="button secondary" onClick={() => load()}><RefreshCw size={16} />Actualizar</button>
            <button className="button primary" onClick={exportFiltered} disabled={exporting}><Download size={16} />{exporting ? 'Preparando…' : 'Exportar filtrados'}</button>
          </>
        )}
      />

      <section className="panel call-log-filter-panel">
        <div className="call-log-search-row">
          <label className="search-field call-log-search">
            <Search size={17} />
            <input
              placeholder="Buscar clínica, persona, notas, objeción, outcome, conversación o transcripción"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </label>
          <button className="button primary" onClick={applyFilters}>Aplicar filtros</button>
          <button className="button secondary" onClick={clearFilters}><FilterX size={16} />Limpiar</button>
        </div>

        <div className="call-log-filter-grid async-filter-grid">
          <label>Desde<input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} /></label>
          <label>Hasta<input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} /></label>
          <label>Canal<select value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}><option value="">Todos</option>{channels.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Outcome<select value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}><option value="">Todos</option>{outcomeLibrary.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
          <label>Conversación<select value={filters.conversation_status} onChange={(e) => setFilters({ ...filters, conversation_status: e.target.value })}><option value="">Todas</option>{conversationStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Agente<select value={filters.agent_id} onChange={(e) => setFilters({ ...filters, agent_id: e.target.value })}><option value="">Todos</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</select></label>
          <label>Por página<select value={filters.page_size} onChange={(e) => changePageSize(e.target.value)}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
        </div>
      </section>

      {error && <div className="form-error page-error">{error}</div>}

      <section className="panel table-panel">
        <div className="table-summary"><span>Mostrando <strong>{visibleRange}</strong> de <strong>{data.total}</strong> actividades</span><span className="muted">Máximo por página: 100</span></div>

        {loading ? <div className="table-loading">Cargando Call Log…</div> : data.items.length === 0 ? (
          <EmptyState title="No hay actividades con estos filtros" text="Limpia los filtros o registra una acción desde Focus o desde la ficha de un lead." />
        ) : (
          <div className="table-scroll">
            <table className="async-call-log-table">
              <thead><tr><th>Fecha</th><th>Lead</th><th>Actividad</th><th>Conversación</th><th>Outcome</th><th>Agente</th><th>Próximo paso</th></tr></thead>
              <tbody>{data.items.map((call) => (
                <tr key={call.id}>
                  <td>{new Date(call.occurred_at).toLocaleString('es-PA')}</td>
                  <td><strong>{call.business_name}</strong><small>{call.contact_name || 'Sin persona'}{call.contact_title ? ` · ${call.contact_title}` : ''}</small></td>
                  <td>{call.channel}<small>{call.direction} · {call.activity_type || 'contact_attempt'}</small></td>
                  <td><span className={`conversation-pill ${call.conversation_status || 'not_started'}`}>{conversationLabel(call.conversation_status)}</span><small>{call.awaiting_response ? 'En espera' : ''}</small></td>
                  <td><span className="status-tag">{call.outcome}</span><small>{call.objection || call.notes || ''}</small></td>
                  <td>{call.agent_name}</td>
                  <td>{call.followup_date || '—'}<small>{call.next_step || call.notes || ''}</small></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {data.total > data.page_size && (
          <footer className="table-pagination">
            <button type="button" className="button secondary compact" onClick={() => changePage(page - 1)} disabled={page <= 1}><ChevronLeft size={16} />Anterior</button>
            <span>Página <strong>{page}</strong> de <strong>{totalPages}</strong></span>
            <button type="button" className="button secondary compact" onClick={() => changePage(page + 1)} disabled={page >= totalPages}>Siguiente<ChevronRight size={16} /></button>
          </footer>
        )}
      </section>
    </>
  );
}
