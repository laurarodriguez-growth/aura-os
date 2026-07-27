import { useEffect, useState } from 'react';
import { Filter, RefreshCw, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import LeadDrawer from '../components/LeadDrawer';
import { api } from '../lib/api';

export default function Leads() {
  const [data, setData] = useState({ items: [], total: 0 });
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', tier: '' });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page_size: '200' });
      if (filters.search) params.set('search', filters.search);
      if (filters.status) params.set('status', filters.status);
      if (filters.tier) params.set('tier', filters.tier);
      const [leads, profileRows, config] = await Promise.all([
        api(`/api/leads?${params}`), api('/api/profiles'), api('/api/config'),
      ]);
      setData(leads); setProfiles(profileRows); setStatuses(config.statuses || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader title="Base de leads" description="La memoria permanente de clínicas, clasificación, responsables y próximos pasos." actions={<button className="button secondary" onClick={load}><RefreshCw size={16} />Actualizar</button>} />
      <section className="panel table-panel">
        <div className="filters-row">
          <label className="search-field"><Search size={17} /><input placeholder="Buscar clínica, teléfono o dirección" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && load()} /></label>
          <label className="select-filter"><Filter size={16} /><select value={filters.tier} onChange={(e) => setFilters({ ...filters, tier: e.target.value })}><option value="">Todos los tiers</option><option>A</option><option>B</option><option>C</option><option>Descartar</option></select></label>
          <label className="select-filter"><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">Todos los estados</option>{statuses.map((x) => <option key={x}>{x}</option>)}</select></label>
          <button className="button primary" onClick={load}>Aplicar</button>
        </div>
        <div className="table-summary"><strong>{data.total}</strong> leads encontrados</div>
        {error && <div className="form-error">{error}</div>}
        {loading ? <div className="table-loading">Cargando leads…</div> : data.items.length === 0 ? <EmptyState title="No hay leads con estos filtros" text="Genera tu primera búsqueda o cambia los filtros." /> : (
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
      </section>
      {selected && <LeadDrawer leadId={selected} statuses={statuses} profiles={profiles} onClose={() => setSelected(null)} onChanged={load} />}
    </>
  );
}
