import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import LeadDrawer from '../components/LeadDrawer';
import { api } from '../lib/api';

export default function Followups() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const [f, p, c] = await Promise.all([api('/api/followups'), api('/api/profiles'), api('/api/config')]);
      setItems(f); setProfiles(p); setStatuses(c.statuses || []);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);
  return (
    <>
      <PageHeader title="Seguimientos" description="La bandeja de trabajo para no depender de la memoria ni dejar conversaciones olvidadas." />
      {error && <div className="form-error page-error">{error}</div>}
      <section className="panel followup-panel">
        {items.length === 0 ? <EmptyState title="No tienes seguimientos vencidos" text="Cuando programes una fecha desde la ficha de un lead, aparecerá aquí." /> : (
          <div className="followup-list">{items.map((lead) => <button key={lead.id} onClick={() => setSelected(lead.id)}><span className="followup-icon"><CalendarClock size={18} /></span><div><strong>{lead.business_name}</strong><p>{lead.outcome || lead.notes || 'Revisar próximo paso'}</p></div><div className="followup-date"><strong>{lead.next_followup_date}</strong><small>{lead.status}</small></div></button>)}</div>
        )}
      </section>
      {selected && <LeadDrawer leadId={selected} statuses={statuses} profiles={profiles} onClose={() => setSelected(null)} onChanged={load} />}
    </>
  );
}
