import { useEffect, useState } from 'react';
import { ArrowRight, FileText, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { api } from '../lib/api';

export default function DiagnoseReports() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { const data = await api('/api/diagnose/reports'); setItems(data.items || []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHeader title="Informes" description="Historial de versiones generadas desde los diagnósticos vivos." actions={<button className="button secondary" onClick={load}><RefreshCw size={16} />Actualizar</button>} />
      {error && <div className="form-error page-error">{error}</div>}
      {loading ? <section className="panel diagnose-loading">Cargando informes…</section> : !items.length ? <section className="panel"><EmptyState title="Todavía no hay informes" text="Genera el primero desde el workspace de un diagnóstico." /></section> : (
        <section className="report-history-list">
          {items.map((item) => <Link key={item.id} to={`/diagnose/${item.diagnosis_id}/report/print`} className="report-history-card"><FileText size={21} /><div><strong>{item.diagnosis?.company_name || 'Diagnóstico'}</strong><span>Versión {item.report_version} · {new Date(item.created_at).toLocaleString('es-PA')}</span></div><div><strong>{item.diagnosis?.overall_score ?? 0}</strong><small>{item.diagnosis?.overall_level || ''}</small></div><ArrowRight size={17} /></Link>)}
        </section>
      )}
    </>
  );
}
