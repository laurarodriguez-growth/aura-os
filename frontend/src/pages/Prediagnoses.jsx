import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Filter, RefreshCw, Search } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { api } from '../lib/api';

const eligibilityLabels = {
  eligible: 'Elegible',
  needs_more_info: 'Falta información',
  not_ready: 'No listo',
};

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function Prediagnoses() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [zone, setZone] = useState('');
  const [selected, setSelected] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page_size: '250' });
      if (search.trim()) params.set('search', search.trim());
      if (eligibility) params.set('eligibility', eligibility);
      if (zone) params.set('zone', zone);
      const data = await api(`/api/diagnose/prediagnoses?${params.toString()}`);
      setItems(data.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const zones = useMemo(() => [...new Set(items.map((item) => item.probable_leak_area).filter(Boolean))].sort(), [items]);

  return (
    <>
      <PageHeader
        title="Pre-Diagnósticos AURA"
        description="Señales preliminares de fuga comercial captadas desde la web. Sirven para segmentar, priorizar y preparar el Diagnóstico AURA completo."
        actions={<button className="button secondary" onClick={load} disabled={loading}><RefreshCw size={16} />Actualizar</button>}
      />

      <section className="panel diagnose-filters prediagnosis-filters">
        <label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Empresa, contacto, sector, correo o teléfono" /></label>
        <select value={eligibility} onChange={(e) => setEligibility(e.target.value)}>
          <option value="">Toda elegibilidad</option>
          <option value="eligible">Elegible</option>
          <option value="needs_more_info">Falta información</option>
          <option value="not_ready">No listo</option>
        </select>
        <select value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">Todas las zonas</option>
          {zones.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="button secondary" onClick={load}><Filter size={16} />Aplicar</button>
      </section>

      {error && <div className="form-error page-error">{error}</div>}
      <p className="diagnose-count">{items.length} pre-diagnósticos encontrados</p>

      {loading ? (
        <section className="panel diagnose-loading">Cargando Pre-Diagnósticos…</section>
      ) : !items.length ? (
        <section className="panel"><EmptyState title="Todavía no hay Pre-Diagnósticos" text="Cuando alguien complete el formulario público aparecerá aquí y quedará vinculado a su lead en Focus." /></section>
      ) : (
        <section className="diagnose-card-grid prediagnosis-card-grid">
          {items.map((item) => (
            <button key={item.id} type="button" className="diagnose-company-card prediagnosis-card" onClick={() => setSelected(item)}>
              <header>
                <span className={`prediagnosis-eligibility ${item.eligibility}`}>{eligibilityLabels[item.eligibility] || item.eligibility}</span>
                <span>{formatDate(item.created_at)}</span>
              </header>
              <h2>{item.company}</h2>
              <p>{item.sector || 'Sector sin definir'}</p>
              <div className="diagnose-company-meta">
                <div><span>Señal principal</span><strong>{item.probable_leak_area}</strong></div>
                <div><span>Pre-Diagnóstico</span><strong>Sí</strong></div>
              </div>
              <footer><span>Ver lectura</span><ArrowRight size={17} /></footer>
            </button>
          ))}
        </section>
      )}

      {selected && (
        <div className="prediagnosis-modal-layer" role="dialog" aria-modal="true" aria-label={`Pre-Diagnóstico de ${selected.company}`}>
          <button className="drawer-backdrop" onClick={() => setSelected(null)} aria-label="Cerrar" />
          <aside className="prediagnosis-detail-panel">
            <header>
              <div><p className="eyebrow">PRE-DIAGNÓSTICO AURA</p><h2>{selected.company}</h2><p>{selected.name} · {selected.sector}</p></div>
              <button className="icon-button" onClick={() => setSelected(null)}>×</button>
            </header>
            <div className="prediagnosis-detail-grid">
              <div><small>Fecha</small><strong>{formatDate(selected.created_at)}</strong></div>
              <div><small>Elegibilidad</small><strong>{eligibilityLabels[selected.eligibility] || selected.eligibility}</strong></div>
              <div><small>Señal principal</small><strong>{selected.probable_leak_area}</strong></div>
              <div><small>Segunda zona</small><strong>{selected.secondary_area || '—'}</strong></div>
              <div><small>Evidencia</small><strong>Preliminar</strong></div>
              <div><small>Origen inicial del lead</small><strong>{selected.leads?.source || 'Pre-Diagnóstico AURA'}</strong></div>
            </div>
            <section className="panel prediagnosis-answers">
              <h3>Contexto comercial</h3>
              <dl>
                <div><dt>Modelo de venta</dt><dd>{selected.sales_model}</dd></div>
                <div><dt>Canales</dt><dd>{(selected.channels || []).join(', ') || '—'}</dd></div>
                <div><dt>Consultas/mes</dt><dd>{selected.monthly_inquiries}</dd></div>
                <div><dt>Primera respuesta</dt><dd>{selected.first_response_time}</dd></div>
                <div><dt>Registro</dt><dd>{selected.current_record_method}</dd></div>
                <div><dt>Seguimiento</dt><dd>{selected.follow_up_method}</dd></div>
                <div><dt>Responsable + próximo paso</dt><dd>{selected.has_owner_and_next_step}</dd></div>
                <div><dt>Medición</dt><dd>{selected.knows_conversion}</dd></div>
                <div><dt>Capacidad</dt><dd>{selected.capacity}</dd></div>
                <div><dt>Urgencia</dt><dd>{selected.urgency}</dd></div>
                <div><dt>Intención de inversión</dt><dd>{selected.investment_intent}</dd></div>
              </dl>
            </section>
            <section className="panel prediagnosis-answers">
              <h3>Lectura preliminar</h3>
              <p><strong>Problema percibido:</strong> {selected.perceived_problem}</p>
              <p><strong>Resultado deseado:</strong> {selected.desired_result}</p>
              <p><strong>Próxima acción:</strong> {selected.next_action}</p>
              <p className="muted">Esta información proviene únicamente del formulario. No sustituye el Diagnóstico AURA completo.</p>
            </section>
            {selected.lead_id && <a className="button diagnose-primary full" href={`/leads?lead=${selected.lead_id}`}>Abrir lead en Focus</a>}
          </aside>
        </div>
      )}
    </>
  );
}
