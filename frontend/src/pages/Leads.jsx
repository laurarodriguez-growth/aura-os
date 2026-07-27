import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter, RefreshCw, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import LeadDrawer from '../components/LeadDrawer';
import { api } from '../lib/api';

const PAGE_SIZE = 50;

const quickViews = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'worked', label: 'Trabajados' },
  { id: 'contacted', label: 'Contactados' },
  { id: 'followup', label: 'Con seguimiento' },
  { id: 'do_not_contact', label: 'No contactar' },
  { id: 'discarded', label: 'Descartados' },
];

export default function Leads() {
  const [data, setData] = useState({ items: [], total: 0, page: 1, page_size: PAGE_SIZE });
  const [viewCounts, setViewCounts] = useState({});
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', tier: '', view: 'all' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (nextFilters = filters, nextPage = page) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        page_size: String(PAGE_SIZE),
        view: nextFilters.view,
      });
      if (nextFilters.search.trim()) params.set('search', nextFilters.search.trim());
      if (nextFilters.status) params.set('status', nextFilters.status);
      if (nextFilters.tier) params.set('tier', nextFilters.tier);
      const [leads, counts, profileRows, config] = await Promise.all([
        api(`/api/leads?${params}`),
        api('/api/leads/view-counts'),
        api('/api/profiles'),
        api('/api/config'),
      ]);
      setData(leads);
      setViewCounts(counts);
      setProfiles(profileRows);
      setStatuses(config.statuses || []);
      setPage(nextPage);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(filters, 1); }, []);

  const totalPages = Math.max(1, Math.ceil(Number(data.total || 0) / PAGE_SIZE));
  const range = useMemo(() => {
    if (!data.total) return '0';
    const first = ((page - 1) * PAGE_SIZE) + 1;
    const last = Math.min(page * PAGE_SIZE, data.total);
    return `${first}–${last}`;
  }, [data.total, page]);

  const chooseView = (view) => {
    const next = { ...filters, view };
    setFilters(next);
    load(next, 1);
  };

  const applyFilters = () => load(filters, 1);

  const changePage = (nextPage) => {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    load(filters, nextPage);
  };

  return (
    <>
      <PageHeader
        title="Base de leads"
        description="La memoria permanente de Aura Grow. Los leads nunca desaparecen: cambia la vista para revisar pendientes, trabajados, seguimientos y cierres."
        actions={<button className="button secondary" onClick={() => load()}><RefreshCw size={16} />Actualizar</button>}
      />

      <section className="lead-view-tabs" aria-label="Vistas rápidas de la base de leads">
        {quickViews.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filters.view === item.id ? 'active' : ''}
            onClick={() => chooseView(item.id)}
          >
            <span>{item.label}</span>
            <strong>{viewCounts[item.id] ?? 0}</strong>
          </button>
        ))}
      </section>

      <section className="panel table-panel">
        <div className="filters-row">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Buscar clínica, teléfono, email, decisor o notas"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </label>
          <label className="select-filter"><Filter size={16} /><select value={filters.tier} onChange={(e) => setFilters({ ...filters, tier: e.target.value })}><option value="">Todos los tiers</option><option>A</option><option>B</option><option>C</option><option>Descartar</option></select></label>
          <label className="select-filter"><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">Todos los estados</option>{statuses.map((x) => <option key={x}>{x}</option>)}</select></label>
          <button className="button primary" onClick={applyFilters}>Aplicar</button>
        </div>

        <div className="table-summary">
          <span>Mostrando <strong>{range}</strong> de <strong>{data.total}</strong> leads</span>
          <span className="muted">Vista: {quickViews.find((item) => item.id === filters.view)?.label}</span>
        </div>

        {error && <div className="form-error">{error}</div>}
        {loading ? <div className="table-loading">Cargando leads…</div> : data.items.length === 0 ? (
          <EmptyState title="No hay leads en esta vista" text="Cambia la vista o limpia los filtros para consultar otros registros." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Score</th><th>Negocio</th><th>Nicho</th><th>Contacto</th><th>Estado</th><th>Seguimiento</th><th /></tr></thead>
              <tbody>{data.items.map((lead) => (
                <tr key={lead.id} onClick={() => setSelected(lead.id)}>
                  <td><div className={`tier-badge tier-${String(lead.final_tier).toLowerCase()}`}><strong>{lead.final_score}</strong><span>{lead.final_tier}</span></div></td>
                  <td><strong>{lead.business_name}</strong><small>{lead.zone || lead.address || 'Sin ubicación'}</small></td>
                  <td>{lead.niche}<small>{lead.review_count} reseñas · {lead.rating || '—'} ★</small></td>
                  <td>{lead.phone || 'Sin teléfono'}<small>{lead.website ? 'Web disponible' : 'Sin web detectada'}</small></td>
                  <td><span className="status-tag">{lead.status}</span><small>{lead.outcome || 'Sin resultado'}</small></td>
                  <td>{lead.next_followup_date || 'Sin fecha'}<small>{lead.contact_attempts} intentos</small></td>
                  <td><button className="text-button">Abrir</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {data.total > PAGE_SIZE && (
          <footer className="table-pagination">
            <button type="button" className="button secondary compact" onClick={() => changePage(page - 1)} disabled={page <= 1}><ChevronLeft size={16} />Anterior</button>
            <span>Página <strong>{page}</strong> de <strong>{totalPages}</strong></span>
            <button type="button" className="button secondary compact" onClick={() => changePage(page + 1)} disabled={page >= totalPages}>Siguiente<ChevronRight size={16} /></button>
          </footer>
        )}
      </section>

      {selected && <LeadDrawer leadId={selected} statuses={statuses} profiles={profiles} onClose={() => setSelected(null)} onChanged={() => load()} />}
    </>
  );
}
