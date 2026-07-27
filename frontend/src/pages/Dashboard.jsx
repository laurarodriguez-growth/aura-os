import { useEffect, useState } from 'react';
import { CalendarClock, CircleDollarSign, Database, PhoneCall, Target, Trophy, UsersRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import MetricCard from '../components/MetricCard';
import EmptyState from '../components/EmptyState';

const money = (value) => new Intl.NumberFormat('es-PA', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);

export default function Dashboard() {
  const { profile } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  const firstName = profile?.full_name?.split(' ')[0] || 'Laura';
  return (
    <>
      <PageHeader title={`Bienvenida, ${firstName}.`} description="Aquí tienes una lectura rápida del sistema comercial y de lo que requiere atención." />
      {error && <div className="form-error page-error">{error}</div>}
      {!data ? <div className="panel skeleton-panel">Cargando métricas…</div> : (
        <>
          <section className="metrics-grid">
            <MetricCard label="Leads guardados" value={data.total_leads} note={`${data.tier_a} Tier A · ${data.tier_b} Tier B`} icon={Database} />
            <MetricCard label="Leads trabajados" value={data.worked_leads} note={`${data.contact_activities} contactos registrados`} icon={UsersRound} />
            <MetricCard label="Seguimientos vencidos" value={data.followups_due} note="Acciones que requieren atención" icon={CalendarClock} />
            <MetricCard label="Tasa de contacto" value={`${data.contact_rate}%`} note={`${data.connected} contactos efectivos`} icon={PhoneCall} />
            <MetricCard label="Reuniones" value={data.meetings} note={`${data.meeting_rate}% de leads trabajados`} icon={Target} />
            <MetricCard label="Ventas" value={data.sales} note={money(data.revenue)} icon={Trophy} />
          </section>

          <section className="dashboard-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">PIPELINE</p><h2>Estado de los leads</h2></div></div>
              <div className="status-bars">
                {Object.entries(data.status_counts || {}).filter(([, count]) => count > 0).map(([name, count]) => {
                  const pct = data.total_leads ? Math.max(4, (count / data.total_leads) * 100) : 0;
                  return <div className="status-row" key={name}><div><span>{name}</span><strong>{count}</strong></div><div className="bar"><i style={{ width: `${pct}%` }} /></div></div>;
                })}
                {Object.values(data.status_counts || {}).every((count) => count === 0) && <EmptyState title="El pipeline está vacío" text="Genera o importa leads para comenzar." />}
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading"><div><p className="eyebrow">ACTIVIDAD</p><h2>Contactos recientes</h2></div><CircleDollarSign size={21} /></div>
              {(data.recent_calls || []).length === 0 ? <EmptyState title="Sin contactos todavía" text="El Call Log aparecerá aquí después del primer intento." /> : (
                <div className="activity-list">
                  {data.recent_calls.map((call) => <div key={call.id}><span className="activity-channel">{call.channel?.[0]}</span><div><strong>{call.outcome}</strong><p>{call.notes || call.next_step || 'Contacto registrado'}</p></div><small>{new Date(call.occurred_at).toLocaleDateString('es-PA')}</small></div>)}
                </div>
              )}
            </article>
          </section>
        </>
      )}
    </>
  );
}
