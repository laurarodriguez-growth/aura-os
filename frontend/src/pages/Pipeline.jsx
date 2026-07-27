import { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader';
import LeadDrawer from '../components/LeadDrawer';
import EmptyState from '../components/EmptyState';
import { api } from '../lib/api';

const columns = ['Nuevo', 'Listo para contactar', 'Contactado', 'Seguimiento 1', 'Seguimiento 2', 'Respondió', 'Interesado', 'Reunión agendada', 'Propuesta enviada'];

export default function Pipeline() {
  const [leads, setLeads] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [data, p, c] = await Promise.all([api('/api/leads?page_size=200'), api('/api/profiles'), api('/api/config')]);
      setLeads(data.items); setProfiles(p); setStatuses(c.statuses || []);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader title="Pipeline" description="Una vista por etapa para saber qué oportunidades avanzan y cuáles necesitan acción." />
      {error && <div className="form-error page-error">{error}</div>}
      <div className="kanban-scroll">
        <section className="kanban">
          {columns.map((status) => {
            const items = leads.filter((lead) => lead.status === status);
            return <article className="kanban-column" key={status}><header><span>{status}</span><strong>{items.length}</strong></header><div className="kanban-cards">{items.length === 0 ? <div className="mini-empty">Sin leads</div> : items.map((lead) => <button key={lead.id} className="kanban-card" onClick={() => setSelected(lead.id)}><div><span className={`mini-tier tier-${String(lead.final_tier).toLowerCase()}`}>{lead.final_tier}</span><strong>{lead.business_name}</strong></div><p>{lead.outcome || lead.address || 'Sin notas todavía'}</p><footer><span>{lead.contact_attempts} intentos</span><span>{lead.next_followup_date || 'Sin fecha'}</span></footer></button>)}</div></article>;
          })}
        </section>
      </div>
      {leads.length === 0 && !error && <EmptyState title="El pipeline está vacío" text="Los leads aparecerán aquí después de generarlos." />}
      {selected && <LeadDrawer leadId={selected} statuses={statuses} profiles={profiles} onClose={() => setSelected(null)} onChanged={load} />}
    </>
  );
}
