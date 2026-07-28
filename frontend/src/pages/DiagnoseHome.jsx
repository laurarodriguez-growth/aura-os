import { useEffect, useState } from 'react';
import { ArrowRight, BrainCircuit, ClipboardPlus, FileText, RefreshCw, Route, TriangleAlert } from 'lucide-react';
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
        description="Detecta qué está frenando el crecimiento, prioriza las mejoras y conviértelas en un roadmap ejecutable."
        actions={<button className="button secondary" onClick={load} disabled={loading}><RefreshCw size={16} />Actualizar</button>}
      />

      <section className="diagnose-hero panel">
        <div>
          <p className="eyebrow">DIAGNOSE PIENSA · FOCUS EJECUTA</p>
          <h2>¿Qué está frenando el crecimiento?</h2>
          <p>Evalúa el ICP, la conversión, los procesos y la preparación para automatizar. Después transforma los hallazgos en acciones concretas.</p>
          <div className="diagnose-hero-actions">
            <Link className="button diagnose-primary" to="/diagnose/new"><ClipboardPlus size={17} />Nuevo diagnóstico</Link>
            <Link className="button secondary" to="/diagnose/list"><BrainCircuit size={17} />Ver diagnósticos</Link>
          </div>
        </div>
        <div className="diagnose-cycle" aria-label="Ciclo de Aura Grow">
          <span>Diagnosticar</span><ArrowRight size={15} /><span>Priorizar</span><ArrowRight size={15} /><span>Ejecutar</span><ArrowRight size={15} /><span>Medir</span>
        </div>
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
          <div><p className="eyebrow">TRABAJO RECIENTE</p><h2>Diagnósticos vivos</h2></div>
          <Link className="text-link" to="/diagnose/list">Ver todos <ArrowRight size={15} /></Link>
        </header>
        {loading ? (
          <div className="diagnose-loading">Cargando diagnósticos…</div>
        ) : !(data?.recent || []).length ? (
          <EmptyState title="Todavía no hay diagnósticos" text="Crea el primero para comenzar a construir la capa estratégica de Aura Grow." />
        ) : (
          <div className="diagnose-list-compact">
            {data.recent.map((item) => (
              <Link key={item.id} to={`/diagnose/${item.id}/summary`} className="diagnose-compact-row">
                <div>
                  <strong>{item.company_name}</strong>
                  <span>{item.industry || 'Industria sin definir'} · {statusLabels[item.status] || item.status}</span>
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
