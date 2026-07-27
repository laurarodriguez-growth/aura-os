import { useEffect, useRef, useState } from 'react';
import { Play, Search, Square } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';

export default function LeadFinder() {
  const [form, setForm] = useState({ niche: 'Dental', city: 'Ciudad de Panamá', zones: 'San Francisco, Obarrio', services: 'Implantes dentales, Ortodoncia', max_results: 20, api_request_budget: 5 });
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [error, setError] = useState('');
  const stopRef = useRef(false);

  useEffect(() => () => { stopRef.current = true; }, []);

  const createJob = async () => {
    setBusy(true); setError(''); setJob(null);
    try {
      const payload = {
        niche: form.niche,
        city: form.city.trim(),
        zones: form.zones.split(',').map((x) => x.trim()).filter(Boolean),
        services: form.services.split(',').map((x) => x.trim()).filter(Boolean),
        max_results: Number(form.max_results),
        api_request_budget: Number(form.api_request_budget),
      };
      const created = await api('/api/search-jobs', { method: 'POST', body: JSON.stringify(payload) });
      setJob(created);
      await runJob(created.id);
    } catch (e) {
      setError(e.message); setBusy(false);
    }
  };

  const runJob = async (id) => {
    stopRef.current = false;
    setAutoRun(true);
    setBusy(true);
    try {
      let current;
      for (let step = 0; step < 500 && !stopRef.current; step += 1) {
        current = await api(`/api/search-jobs/${id}/step`, { method: 'POST' });
        setJob(current);
        if (['completed', 'failed', 'cancelled'].includes(current.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false); setAutoRun(false);
    }
  };

  const stop = () => { stopRef.current = true; setAutoRun(false); };
  const progress = job?.phase === 'audit'
    ? (job.total_discovered ? Math.round((job.total_audited / job.total_discovered) * 100) : 0)
    : (job?.max_results ? Math.round((job.total_discovered / job.max_results) * 100) : 0);

  return (
    <>
      <PageHeader title="Generar leads" description="Busca negocios con tu API, reutiliza el caché y guarda cada resultado en la base permanente." />
      <section className="finder-layout">
        <article className="panel form-panel">
          <p className="eyebrow">NUEVA BÚSQUEDA</p>
          <h2>Define el mercado</h2>
          <div className="form-grid two">
            <label>Nicho<select value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })}><option>Dental</option><option>Medicina estética</option></select></label>
            <label>Ciudad<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          </div>
          <label>Zonas, separadas por coma<input value={form.zones} onChange={(e) => setForm({ ...form, zones: e.target.value })} /></label>
          <label>Servicios prioritarios, separados por coma<input value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} /></label>
          <div className="form-grid two">
            <label>Máximo de leads<input type="number" min="10" max="500" value={form.max_results} onChange={(e) => setForm({ ...form, max_results: e.target.value })} /></label>
            <label>Límite de solicitudes Google<input type="number" min="1" max="60" value={form.api_request_budget} onChange={(e) => setForm({ ...form, api_request_budget: e.target.value })} /></label>
          </div>
          <div className="hint-box"><strong>Primera prueba recomendada</strong><p>20 leads y límite Google de 5. Así validamos el flujo sin consumir de más.</p></div>
          {error && <div className="form-error">{error}</div>}
          <button className="button primary full" onClick={createJob} disabled={busy}><Search size={17} />{busy ? 'Procesando…' : 'Iniciar búsqueda'}</button>
        </article>

        <article className="panel progress-panel">
          <p className="eyebrow">PROGRESO</p>
          <h2>{job ? 'Búsqueda en ejecución' : 'Lista para comenzar'}</h2>
          {!job ? <div className="finder-placeholder"><div className="search-orbit"><Search /></div><p>Los avances, caché y resultados aparecerán aquí.</p></div> : (
            <>
              <div className="job-status"><span className={`status-pill ${job.status}`}>{job.status}</span><small>Fase: {job.phase}</small></div>
              <div className="large-progress"><div style={{ width: `${Math.min(100, progress)}%` }} /></div>
              <div className="job-kpis">
                <div><span>Descubiertos</span><strong>{job.total_discovered}</strong></div>
                <div><span>Auditados</span><strong>{job.total_audited}</strong></div>
                <div><span>API usada</span><strong>{job.api_requests_used}/{job.api_request_budget}</strong></div>
                <div><span>Caché Google</span><strong>{job.cache_hits_google}</strong></div>
                <div><span>Caché web</span><strong>{job.cache_hits_web}</strong></div>
              </div>
              {job.error_message && <div className="form-error">{job.error_message}</div>}
              {!busy && !['completed', 'failed', 'cancelled'].includes(job.status) && <button className="button secondary full" onClick={() => runJob(job.id)}><Play size={16} />Continuar procesamiento</button>}
              {autoRun && <button className="button ghost full" onClick={stop}><Square size={15} />Pausar después de este paso</button>}
              {job.status === 'completed' && <div className="success-box">La búsqueda terminó. Los leads ya están en la Base de leads.</div>}
            </>
          )}
        </article>
      </section>
    </>
  );
}
