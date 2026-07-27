import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck2, CalendarClock } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import LeadDrawer from '../components/LeadDrawer';
import { api } from '../lib/api';

function isoLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function FollowupList({ items, icon: Icon, emptyTitle, emptyText, onOpen }) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} text={emptyText} />;
  }

  return (
    <div className="followup-list">
      {items.map((lead) => (
        <button key={lead.id} onClick={() => onOpen(lead.id)}>
          <span className="followup-icon"><Icon size={18} /></span>
          <div>
            <strong>{lead.business_name}</strong>
            <p>{lead.outcome || lead.notes || 'Revisar próximo paso'}</p>
          </div>
          <div className="followup-date">
            <strong>{lead.next_followup_date}</strong>
            <small>{lead.status}</small>
          </div>
        </button>
      ))}
    </div>
  );
}

export default function Followups() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [activeTab, setActiveTab] = useState('today');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const today = isoLocal(new Date());
  const horizon = isoLocal(addDays(new Date(), 90));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [f, p, c] = await Promise.all([
        api(`/api/followups?through=${horizon}`),
        api('/api/profiles'),
        api('/api/config'),
      ]);
      setItems(f);
      setProfiles(p);
      setStatuses(c.statuses || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const groups = useMemo(() => ({
    overdue: items.filter((lead) => lead.next_followup_date && lead.next_followup_date < today),
    today: items.filter((lead) => lead.next_followup_date === today),
    upcoming: items.filter((lead) => lead.next_followup_date && lead.next_followup_date > today),
  }), [items, today]);

  const tabs = [
    { id: 'overdue', label: 'Vencidos', count: groups.overdue.length },
    { id: 'today', label: 'Para hoy', count: groups.today.length },
    { id: 'upcoming', label: 'Próximos', count: groups.upcoming.length },
  ];

  const tabContent = {
    overdue: {
      items: groups.overdue,
      icon: AlertTriangle,
      emptyTitle: 'No tienes seguimientos vencidos',
      emptyText: 'Excelente. No hay conversaciones atrasadas que requieran atención.',
    },
    today: {
      items: groups.today,
      icon: CalendarCheck2,
      emptyTitle: 'No tienes seguimientos para hoy',
      emptyText: 'Los seguimientos programados para la fecha actual aparecerán aquí.',
    },
    upcoming: {
      items: groups.upcoming,
      icon: CalendarClock,
      emptyTitle: 'No tienes próximos seguimientos',
      emptyText: 'Programa una fecha futura desde la ficha de un lead para verla aquí.',
    },
  }[activeTab];

  return (
    <>
      <PageHeader
        title="Seguimientos"
        description="La bandeja de trabajo para no depender de la memoria ni dejar conversaciones olvidadas."
      />
      {error && <div className="form-error page-error">{error}</div>}

      <section className="panel followup-panel">
        <div className="followup-tabs" role="tablist" aria-label="Tipos de seguimiento">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              <strong>{tab.count}</strong>
            </button>
          ))}
          <button type="button" className="followup-refresh" onClick={load}>Actualizar</button>
        </div>

        {loading ? (
          <div className="followup-loading">Cargando seguimientos...</div>
        ) : (
          <FollowupList {...tabContent} onOpen={setSelected} />
        )}
      </section>

      {selected && (
        <LeadDrawer
          leadId={selected}
          statuses={statuses}
          profiles={profiles}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </>
  );
}
