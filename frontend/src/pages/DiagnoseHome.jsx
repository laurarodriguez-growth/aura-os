import { useEffect, useState } from 'react';
import { ArrowRight, BrainCircuit, ClipboardPlus, FileSearch, FileText, RefreshCw, Route, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { api } from '../lib/api';

const statusLabels = {
  draft: 'Borrador',
  in_progress: 'En progreso',
  completed: 'Completado',
  archived: 'Archivado',
};

export default function DiagnoseHome() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api('/api/diagnose/summary'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader
        title="Diagnose"
        description="Detecta señales, confirma con evidencia dónde se rompe el recorrido comercial y prepara una intervención priorizada."
        actions={<button className="button secondary" onClick={load} disabled={loading}><RefreshCw size={16} />Actualizar</button>}
      />

      <section className="diagnose-hero panel">
        <div>
          <p className="eyebrow">DIAGNOSE PIENSA · FOCUS EJECUTA</p>
          <h2>De una señal preliminar a una fuga comercial confirmada.</h2>
          <p>Diagnose separa lo que el negocio cree que ocurre de lo que la evidencia demuestra. El recorrido oficial es Consulta → Respuesta → Seguimiento → Cita → Venta.</p>
          <div className="diagnose-hero-actions">
            <Link className="button diagnose-primary" to="/diagnose/new"><ClipboardPlus size={17} />Nuevo Diagnóstico AURA</Link>
            <Link className="button secondary" to="/diagnose/prediagnoses"><FileSearch size={17} />Ver Pre-Diagnósticos</Link>
          </div>
        </div>
        <div className="diagnose-cycle" aria-label="Ciclo de Aura Grow">
          <span>Encontrar</span><ArrowRight size={15} /><span>Confirmar</span><ArrowRight size={15} /><span>Priorizar</span><ArrowRight size={15} /><span>Medir</span>
        </div>
      </section>

      <section className="diagnose-architecture-grid" aria-label="Arquitectura de Diagnose">
        <Link to="/diagnose/prediagnoses" className="panel diagnose-architecture-card">
          <small>01 · SEÑALES</small><h3>Pre-Diagnósticos</h3><p>Lecturas preliminares de la web para elegibilidad, segmentación y remarketing.</p><span>Ver Pre-Diagnósticos <ArrowRight size={15} /></span>
        </Link>
        <Link to="/diagnose/list" className="panel diagnose-architecture-card active">
          <small>02 · EVIDENCIA</small><h3>Diagnósticos AURA</h3><p>Reconstruyen el recorrido real, validan evidencia y confirman la fuga que debe corregirse primero.</p><span>Ver Diagnósticos AURA <ArrowRight size={15} /></span>
        </Link>
        <article className="panel diagnose-architecture-card future" aria-disabled="true">
          <small>03 · SIGUIENTE FASE</small><h3>Prescripciones</h3><p>Convertirán el diagnóstico confirmado en una intervención aprobada. No está activado en esta versión.</p><span>Próximamente</span>
        </article>
      </section>

      {error && <div className="form-error page-error">{error}</div>}

      <section className="diagnose-metric-grid">
        <article><BrainCircuit size={19} /><span>Diagnósticos activos</span><strong>{data?.active ?? '—'}</strong></article>
        <article><TriangleAlert size={19} /><span>Hallazgos críticos</span><strong>{data?.critical_findings ?? '—'}</strong></article>
        <article><Route size={19} /><span>Acciones enviadas a Focus</span><strong>{data?.focus_actions ?? '—'}</strong></article>
        <article><FileText size={19} /><span>Informes generados</span><strong>{data?.reports ?? '—'}</strong></article>
      </section>

      <section className="panel diagnose-recent">
        <header className="section-heading">
          <div><p className="eyebrow">TRABAJO RECIENTE</p><h2>Diagnósticos AURA activos</h2></div>
          <Link className="text-link" to="/diagnose/list">Ver todos <ArrowRight size={15} /></Link>
        </header>
        {loading ? (
          <div className="diagnose-loading">Cargando diagnósticos…</div>
        ) : !(data?.recent || []).length ? (
          <EmptyState title="Todavía no hay Diagnósticos AURA" text="Crea el primero cuando necesites confirmar con evidencia qué parte del sistema comercial debe corregirse primero." />
        ) : (
          <div className="diagnose-list-compact">
            {data.recent.map((item) => (
              <Link key={item.id} to={`/diagnose/${item.id}/summary`} className="diagnose-compact-row">
                <div>
                  <strong>{item.company_name}</strong>
                  <span>{item.industry || 'Sector sin definir'} · {statusLabels[item.status] || item.status}</span>
                </div>
                <div className="diagnose-score-mini"><strong>{item.overall_score}</strong><span>{item.overall_level}</span></div>
                <ArrowRight size={17} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
