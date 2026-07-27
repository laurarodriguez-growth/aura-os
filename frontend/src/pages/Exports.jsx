import { Download, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import PageHeader from '../components/PageHeader';
import { downloadExport } from '../lib/api';

const exports = [
  { path: '/api/export/leads', title: 'Base completa de leads', text: 'Todos los campos extraídos, ICP, estado comercial, notas y responsables.' },
  { path: '/api/export/leads?worked_only=true', title: 'Leads trabajados', text: 'Solo registros que ya tienen intentos de contacto o avance comercial.' },
  { path: '/api/export/call-logs', title: 'Call Log', text: 'Una fila por llamada, WhatsApp, Instagram, email u otro contacto.' },
  { path: '/api/export/consolidated', title: 'Métricas consolidadas', text: 'Una fila por lead con intentos, reuniones, ventas, ingresos y fechas.' },
];

export default function Exports() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const run = async (item) => { setBusy(item.path); setError(''); try { await downloadExport(item.path); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  return (
    <>
      <PageHeader title="Exportaciones" description="Saca copias de trabajo y datasets históricos para analizar rendimiento sin perder la base original." />
      {error && <div className="form-error page-error">{error}</div>}
      <section className="export-grid">{exports.map((item) => <article className="panel export-card" key={item.path}><span className="export-icon"><FileSpreadsheet /></span><div><h2>{item.title}</h2><p>{item.text}</p></div><button className="button primary" onClick={() => run(item)} disabled={busy === item.path}><Download size={16} />{busy === item.path ? 'Preparando…' : 'Descargar CSV'}</button></article>)}</section>
    </>
  );
}
