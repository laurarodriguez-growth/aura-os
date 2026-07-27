import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { api, downloadExport } from '../lib/api';

export default function CallLog() {
  const [calls, setCalls] = useState([]);
  const [error, setError] = useState('');
  const load = () => api('/api/call-logs?limit=1000').then(setCalls).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  return (
    <>
      <PageHeader title="Call Log" description="Una fila por intento de contacto para medir actividad, conexión, reuniones y ventas." actions={<><button className="button secondary" onClick={load}><RefreshCw size={16} />Actualizar</button><button className="button primary" onClick={() => downloadExport('/api/export/call-logs').catch((e) => setError(e.message))}><Download size={16} />Exportar CSV</button></>} />
      {error && <div className="form-error page-error">{error}</div>}
      <section className="panel table-panel">
        {calls.length === 0 ? <EmptyState title="Todavía no hay contactos registrados" text="Abre un lead y usa la pestaña Registrar contacto." /> : <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Lead</th><th>Canal</th><th>Resultado</th><th>Agente</th><th>Próximo paso</th><th>Venta</th></tr></thead><tbody>{calls.map((call) => <tr key={call.id}><td>{new Date(call.occurred_at).toLocaleString('es-PA')}</td><td><strong>{call.business_name}</strong><small>{call.contact_name || 'Sin contacto'}</small></td><td>{call.channel}<small>{call.direction}</small></td><td><span className="status-tag">{call.outcome}</span><small>{call.objection || ''}</small></td><td>{call.agent_name}</td><td>{call.followup_date || '—'}<small>{call.next_step || call.notes || ''}</small></td><td>{call.sale_amount ? `$${Number(call.sale_amount).toFixed(2)}` : '—'}</td></tr>)}</tbody></table></div>}
      </section>
    </>
  );
}
