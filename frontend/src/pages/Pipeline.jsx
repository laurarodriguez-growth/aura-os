import { useEffect, useMemo, useState } from 'react';
import { LockKeyhole, RefreshCw, Search, UsersRound } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import LeadDrawer from '../components/LeadDrawer';
import EmptyState from '../components/EmptyState';
import { api } from '../lib/api';

const fallbackStages = [
  { key: 'new', label: 'Nuevos', description: 'Sin primer contacto' },
  { key: 'contacted', label: 'Contactados', description: 'Primer mensaje enviado' },
  { key: 'responded', label: 'Respondieron', description: 'Conversación abierta' },
  { key: 'interested', label: 'Interesados', description: 'Necesidad confirmada' },
  { key: 'meeting_booked', label: 'Reunión agendada', description: 'Llamada de 15 minutos' },
  { key: 'diagnosis_sold', label: 'Diagnóstico vendido', description: 'Diagnóstico Premium cerrado' },
  { key: 'proposal_sent', label: 'Propuesta enviada', description: 'Implementación presentada' },
  { key: 'implementation_sold', label: 'Implementación vendida', description: 'Cliente ganado' },
  { key: 'closed', label: 'Cerrados', description: 'No interesado, no califica o descartado' },
];

function formatDate(value) {
  if (!value) return 'Sin fecha';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Pipeline() {
  const [data, setData] = useState({ items: [], stages: fallbackStages, stage_counts: {} });
  const [profiles, setProfiles] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [pipeline, profileRows, config] = await Promise.all([
        api('/api/pipeline'),
        api('/api/profiles'),
        api('/api/config'),
      ]);
      setData(pipeline);
      setProfiles(profileRows || []);
      setStatuses(config.statuses || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return (data.items || []).filter((lead) => {
      if (owner && String(lead.owner_id || '') !== owner) return false;
      if (!term) return true;
      return [lead.business_name, lead.address, lead.owner_name, lead.status, lead.outcome]
        .some((value) => String(value || '').toLocaleLowerCase('es').includes(term));
    });
  }, [data.items, owner, search]);

  const counts = useMemo(() => {
    const result = {};
    for (const stage of data.stages || fallbackStages) result[stage.key] = 0;
    for (const lead of filtered) result[lead.pipeline_stage] = (result[lead.pipeline_stage] || 0) + 1;
    return result;
  }, [data.stages, filtered]);

  const activeTotal = filtered.filter((lead) => lead.pipeline_stage !== 'closed').length;
  const conversations = (counts.responded || 0) + (counts.interested || 0);
  const meetings = counts.meeting_booked || 0;
  const sales = (counts.diagnosis_sold || 0) + (counts.implementation_sold || 0);

  return (
    <>
      <PageHeader
        title="Pipeline comercial"
        description="Vista privada de administración con el recorrido comercial real de Growth by Laura."
        actions={<button className="button secondary" onClick={load} disabled={loading}><RefreshCw size={16} />Actualizar</button>}
      />

      <div className="pipeline-admin-banner">
        <LockKeyhole size={18} />
        <div><strong>Vista privada</strong><span>Solo la administradora puede abrir este pipeline y ver toda la operación.</span></div>
      </div>

      <section className="pipeline-summary-grid" aria-label="Resumen del pipeline">
        <article><span>Oportunidades activas</span><strong>{activeTotal}</strong></article>
        <article><span>Conversaciones con respuesta</span><strong>{conversations}</strong></article>
        <article><span>Reuniones agendadas</span><strong>{meetings}</strong></article>
        <article><span>Ventas cerradas</span><strong>{sales}</strong></article>
      </section>

      <section className="panel pipeline-toolbar">
        <label className="pipeline-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar lead, estado u outcome" /></label>
        <label className="pipeline-owner-filter"><UsersRound size={17} /><select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Todos los responsables</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</select></label>
      </section>

      {error && <div className="form-error page-error">{error}</div>}

      {loading ? (
        <section className="panel pipeline-loading">Cargando pipeline comercial…</section>
      ) : filtered.length === 0 ? (
        <EmptyState title="No hay leads para estos filtros" text="Limpia la búsqueda o selecciona otro responsable." />
      ) : (
        <div className="pipeline-board-scroll">
          <section className="pipeline-board">
            {(data.stages || fallbackStages).map((stage) => {
              const items = filtered.filter((lead) => lead.pipeline_stage === stage.key);
              return (
                <article className={`pipeline-stage pipeline-stage-${stage.key}`} key={stage.key}>
                  <header>
                    <div><strong>{stage.label}</strong><span>{stage.description}</span></div>
                    <b>{counts[stage.key] || 0}</b>
                  </header>
                  <div className="pipeline-stage-cards">
                    {items.length === 0 ? <div className="pipeline-stage-empty">Sin leads</div> : items.map((lead) => (
                      <button type="button" key={lead.id} className="pipeline-lead-card" onClick={() => setSelected(lead.id)}>
                        <div className="pipeline-lead-heading"><span className={`mini-tier tier-${String(lead.final_tier || 'c').toLowerCase()}`}>{lead.final_tier || '—'}</span><strong>{lead.business_name}</strong></div>
                        <p>{lead.outcome || lead.next_step || lead.address || 'Sin nota registrada'}</p>
                        <div className="pipeline-lead-meta"><span>{lead.owner_name || 'Sin asignar'}</span><span>{lead.next_followup_date ? formatDate(lead.next_followup_date) : lead.status}</span></div>
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      )}

      {selected && <LeadDrawer leadId={selected} statuses={statuses} profiles={profiles} onClose={() => setSelected(null)} onChanged={load} />}
    </>
  );
}
