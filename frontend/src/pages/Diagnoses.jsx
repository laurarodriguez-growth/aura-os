import { useEffect, useState } from 'react';
import { ArrowRight, ClipboardPlus, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { api } from '../lib/api';

const statusLabels = { draft: 'Borrador', in_progress: 'En progreso', completed: 'Completado', archived: 'Archivado' };

export default function Diagnoses() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page_size: '100' });
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      const data = await api(`/api/diagnose?${params.toString()}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
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
        title="Diagnósticos"
        description="Consulta, continúa y compara los diagnósticos vivos de Aura Grow."
        actions={<Link className="button diagnose-primary" to="/diagnose/new"><ClipboardPlus size={17} />Nuevo diagnóstico</Link>}
      />

      <section className="panel diagnose-filters">
        <label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Empresa, industria, contacto o problema" /></label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="in_progress">En progreso</option>
          <option value="completed">Completado</option>
          <option value="archived">Archivado</option>
        </select>
        <button className="button secondary" onClick={load}><RefreshCw size={16} />Aplicar</button>
      </section>

      {error && <div className="form-error page-error">{error}</div>}
      <p className="diagnose-count">{total} diagnósticos encontrados</p>

      {loading ? (
        <section className="panel diagnose-loading">Cargando diagnósticos…</section>
      ) : !items.length ? (
        <section className="panel"><EmptyState title="No encontramos diagnósticos" text="Cambia los filtros o crea un diagnóstico nuevo." /></section>
      ) : (
        <section className="diagnose-card-grid">
          {items.map((item) => (
            <Link key={item.id} to={`/diagnose/${item.id}/summary`} className="diagnose-company-card">
              <header><span className={`diagnose-status ${item.status}`}>{statusLabels[item.status] || item.status}</span><span>{new Date(item.updated_at).toLocaleDateString('es-PA')}</span></header>
              <h2>{item.company_name}</h2>
              <p>{item.industry || 'Industria sin definir'}</p>
              <div className="diagnose-company-meta">
                <div><span>Score general</span><strong>{item.overall_score}</strong></div>
                <div><span>Nivel</span><strong>{item.overall_level}</strong></div>
              </div>
              <footer><span>Abrir workspace</span><ArrowRight size={17} /></footer>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
