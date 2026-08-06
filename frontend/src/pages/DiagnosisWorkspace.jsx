import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, BrainCircuit, CheckCircle2, FileSearch, FileText, FolderOpen, MessageSquareText, RefreshCw, Route, Save } from 'lucide-react';
import { Link, NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import DiagnosisConversation from '../components/DiagnosisConversation';
import DiagnosisDefinitiveOverview from '../components/DiagnosisDefinitiveOverview';
import DiagnosisEvidence from '../components/DiagnosisEvidence';
import DiagnosisFindings from '../components/DiagnosisFindings';
import DiagnosisRoadmap from '../components/DiagnosisRoadmap';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';

const sections = [
  { id: 'summary', label: 'Resumen', icon: BrainCircuit },
  { id: 'interview', label: 'Entrevista', icon: MessageSquareText },
  { id: 'evidence', label: 'Evidencias', icon: FolderOpen },
  { id: 'findings', label: 'Hallazgos', icon: FileSearch },
  { id: 'roadmap', label: 'Roadmap', icon: Route },
  { id: 'report', label: 'Informe', icon: FileText },
];
const statusLabels = { draft: 'Borrador', in_progress: 'En progreso', completed: 'Completado', archived: 'Archivado' };

function diagnoseModuleError(reason) {
  const detail = reason?.message || String(reason || 'Error desconocido');
  if (/failed to fetch|networkerror|load failed/i.test(detail)) {
    return 'Diagnose 2.0 no respondió. Verifica que la migración 19 esté instalada y que Render tenga la versión actual.';
  }
  return `Diagnose 2.0 no está disponible: ${detail}`;
}

const definitiveSections = new Set(['interview', 'evidence', 'report']);

export default function DiagnosisWorkspace() {
  const { diagnosisId, section = 'summary' } = useParams();
  const navigate = useNavigate();
  const [diagnosis, setDiagnosis] = useState(null);
  const [definitive, setDefinitive] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(null);
  const [implementation, setImplementation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await api(`/api/diagnose/${diagnosisId}`);
      const [definitiveResult, profilesResult] = await Promise.allSettled([
        api(`/api/diagnose/${diagnosisId}/definitive`),
        profiles.length ? Promise.resolve(profiles) : api('/api/profiles'),
      ]);
      setDiagnosis(data);
      if (definitiveResult.status === 'fulfilled') {
        setDefinitive(definitiveResult.value);
      } else {
        setDefinitive(null);
        setError(diagnoseModuleError(definitiveResult.reason));
      }
      if (profilesResult.status === 'fulfilled') {
        setProfiles(profilesResult.value || []);
      } else {
        setProfiles([]);
        setError((current) => current || `No se pudo cargar el equipo: ${profilesResult.reason?.message || 'error desconocido'}`);
      }
      setImplementation({
        implementation_recommended: Boolean(data.implementation_recommended),
        implementation_scope: data.implementation_scope || '', implementation_exclusions: data.implementation_exclusions || '',
        implementation_timeline: data.implementation_timeline || '', implementation_deliverables: data.implementation_deliverables || '',
        client_responsibilities: data.client_responsibilities || '', implementation_metric: data.implementation_metric || '',
      });
      setForm({
        company_name: data.company_name || '', industry: data.industry || '', website: data.website || '', instagram: data.instagram || '', whatsapp: data.whatsapp || '', city: data.city || '',
        contact_name: data.contact_name || '', contact_title: data.contact_title || '', objective: data.objective || '', declared_problem: data.declared_problem || '', executive_summary: data.executive_summary || '',
        assigned_to: data.assigned_to || '', status: data.status || 'draft',
      });
      setDirty(false);
    } catch (e) {
      setDiagnosis(null); setDefinitive(null);
      setError(`No se pudo cargar el diagnóstico base: ${e.message}`);
    }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [diagnosisId]);
  useEffect(() => { if (!message) return undefined; const timer = window.setTimeout(() => setMessage(''), 3000); return () => window.clearTimeout(timer); }, [message]);

  if (!sections.some((item) => item.id === section)) return <Navigate to={`/diagnose/${diagnosisId}/summary`} replace />;
  const change = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setDirty(true); setMessage(''); };
  const saveSummary = async () => {
    setSaving(true); setError('');
    try { const updated = await api(`/api/diagnose/${diagnosisId}`, { method: 'PATCH', body: JSON.stringify({ ...form, assigned_to: form.assigned_to || null }) }); setDiagnosis((current) => ({ ...current, ...updated })); setDirty(false); setMessage('Cambios guardados.'); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  const createReport = async (reportType) => {
    setSaving(true); setError('');
    try { await api(`/api/diagnose/${diagnosisId}/reports/${reportType}`, { method: 'POST' }); navigate(`/diagnose/${diagnosisId}/report/print?type=${reportType}`); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  const saveImplementation = async () => {
    setSaving(true); setError('');
    try { await api(`/api/diagnose/${diagnosisId}/implementation`, { method: 'PATCH', body: JSON.stringify(implementation) }); setMessage('Recomendación de implementación guardada.'); await load(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <section className="panel diagnose-loading">Cargando Diagnose…</section>;
  if (!diagnosis || !form || !implementation) return <section className="panel"><h2>Diagnóstico no disponible</h2><p>{error}</p><button className="button secondary" onClick={load}><RefreshCw size={16} />Reintentar</button></section>;

  const definitiveUnavailable = (
    <section className="panel diagnosis-module-unavailable">
      <AlertTriangle size={28} />
      <div><p className="eyebrow">DIAGNOSE 2.0 REQUIERE ATENCIÓN</p><h2>El diagnóstico base está disponible</h2><p>{error || 'Las funciones avanzadas no respondieron.'}</p><p>Comprueba <code>database/20_verify_diagnose_definitive.sql</code> en Supabase. Este archivo solo consulta la estructura y no modifica datos.</p></div>
      <button className="button secondary" onClick={load}><RefreshCw size={16} />Reintentar</button>
    </section>
  );

  const summary = (
    <section className="diagnosis-section-stack">
      {definitive ? <DiagnosisDefinitiveOverview data={definitive} /> : definitiveUnavailable}
      <section className="panel diagnosis-summary-form">
        <div className="section-heading"><div><p className="eyebrow">CONTEXTO</p><h2>Base del diagnóstico</h2></div><span className={`diagnose-status ${form.status}`}>{statusLabels[form.status]}</span></div>
        <div className="form-grid two">
          <label>Empresa<input value={form.company_name} onChange={(e) => change('company_name', e.target.value)} /></label><label>Industria<input value={form.industry} onChange={(e) => change('industry', e.target.value)} /></label>
          <label>Website<input value={form.website} onChange={(e) => change('website', e.target.value)} /></label><label>Instagram<input value={form.instagram} onChange={(e) => change('instagram', e.target.value)} /></label>
          <label>WhatsApp<input value={form.whatsapp} onChange={(e) => change('whatsapp', e.target.value)} /></label><label>Ciudad<input value={form.city} onChange={(e) => change('city', e.target.value)} /></label>
          <label>Contacto<input value={form.contact_name} onChange={(e) => change('contact_name', e.target.value)} /></label><label>Cargo<input value={form.contact_title} onChange={(e) => change('contact_title', e.target.value)} /></label>
          <label>Responsable<select value={form.assigned_to} onChange={(e) => change('assigned_to', e.target.value)}><option value="">Sin asignar</option>{profiles.filter((p) => p.role === 'admin').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
          <label>Estado<select value={form.status} onChange={(e) => change('status', e.target.value)}><option value="draft">Borrador</option><option value="in_progress">En progreso</option><option value="completed">Completado</option><option value="archived">Archivado</option></select></label>
        </div>
        <label>Objetivo principal<textarea rows="3" value={form.objective} onChange={(e) => change('objective', e.target.value)} /></label>
        <label>Problema declarado<textarea rows="3" value={form.declared_problem} onChange={(e) => change('declared_problem', e.target.value)} /></label>
        <label>Resumen ejecutivo<textarea rows="5" value={form.executive_summary} onChange={(e) => change('executive_summary', e.target.value)} /></label>
        <div className="diagnosis-savebar"><span>{dirty ? 'Tienes cambios sin guardar.' : 'Todo está guardado.'}</span><button className={`button ${dirty ? 'diagnose-primary' : 'disabled-save'}`} disabled={!dirty || saving} onClick={saveSummary}><Save size={17} />{saving ? 'Guardando…' : 'Guardar cambios'}</button></div>
      </section>
      {diagnosis.lead && <section className="panel linked-focus-lead"><div><p className="eyebrow">CONECTADO CON FOCUS</p><h3>{diagnosis.lead.business_name}</h3><p>{diagnosis.lead.status} · Tier {diagnosis.lead.final_tier} · {diagnosis.lead.final_score} puntos</p></div><Link className="button secondary" to="/leads">Abrir Base de leads</Link></section>}
    </section>
  );

  const report = definitive ? (
    <section className="diagnosis-section-stack">
      <section className="panel report-ready-card"><FileText size={34} /><p className="eyebrow">INFORME PREMIUM</p><h2>De la evidencia a una prescripción clara</h2><p>Incluye radiografía, puntos de pérdida, prioridades, roadmap, límites y una implementación inicial opcional de $150.</p><div className="report-type-actions"><button className="button secondary" onClick={() => createReport('preliminary')} disabled={saving}>Informe preliminar</button><button className="button diagnose-primary" onClick={() => createReport('final')} disabled={saving || !definitive.report_readiness.final_ready}>Informe final</button></div></section>
      <section className="panel report-checklist"><h3>Validaciones</h3><ul><li className={diagnosis.executive_summary ? 'done' : ''}>Resumen ejecutivo</li><li className={definitive.evaluations.length >= 8 ? 'done' : ''}>Áreas evaluadas</li><li className={diagnosis.findings.length ? 'done' : ''}>Hallazgos priorizados</li><li className={diagnosis.roadmap.length ? 'done' : ''}>Roadmap</li>{definitive.report_readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>
      <section className="panel implementation-editor"><div className="section-heading"><div><p className="eyebrow">DESPUÉS DEL DIAGNÓSTICO</p><h3>Implementación inicial opcional · $150</h3><p>Se muestra separada de los hallazgos para conservar la credibilidad del diagnóstico.</p></div></div><label className="inline-check"><input type="checkbox" checked={implementation.implementation_recommended} onChange={(e) => setImplementation({ ...implementation, implementation_recommended: e.target.checked })} />Incluir esta opción en el informe</label>{implementation.implementation_recommended && <><div className="form-grid two"><label>Qué incluye<textarea rows="3" value={implementation.implementation_scope} onChange={(e) => setImplementation({ ...implementation, implementation_scope: e.target.value })} /></label><label>Qué no incluye<textarea rows="3" value={implementation.implementation_exclusions} onChange={(e) => setImplementation({ ...implementation, implementation_exclusions: e.target.value })} /></label><label>Plazo<input value={implementation.implementation_timeline} onChange={(e) => setImplementation({ ...implementation, implementation_timeline: e.target.value })} /></label><label>Métrica inicial<input value={implementation.implementation_metric} onChange={(e) => setImplementation({ ...implementation, implementation_metric: e.target.value })} /></label><label>Entregables<textarea rows="3" value={implementation.implementation_deliverables} onChange={(e) => setImplementation({ ...implementation, implementation_deliverables: e.target.value })} /></label><label>Responsabilidades del cliente<textarea rows="3" value={implementation.client_responsibilities} onChange={(e) => setImplementation({ ...implementation, client_responsibilities: e.target.value })} /></label></div></>}<div className="form-actions"><button className="button secondary" onClick={saveImplementation} disabled={saving}><Save size={17} />Guardar opción</button></div></section>
    </section>
  ) : definitiveUnavailable;

  let content = summary;
  if (section === 'interview') content = definitive ? <DiagnosisConversation diagnosisId={diagnosisId} data={definitive} onChanged={load} /> : definitiveUnavailable;
  if (section === 'evidence') content = definitive ? <DiagnosisEvidence diagnosisId={diagnosisId} items={definitive.evidence} analysis={diagnosis.latest_analysis} requirements={definitive.evidence_requirements} blocks={definitive.blocks} restricted={definitive.evidence_restricted} onChanged={load} /> : definitiveUnavailable;
  if (section === 'findings') content = <DiagnosisFindings diagnosisId={diagnosisId} items={diagnosis.findings} onChanged={load} />;
  if (section === 'roadmap') content = <DiagnosisRoadmap diagnosisId={diagnosisId} items={diagnosis.roadmap} profiles={profiles} onChanged={load} />;
  if (section === 'report') content = report;

  const headerDescription = definitive
    ? `${diagnosis.industry || 'Empresa'} · Madurez ${definitive.metrics.maturity ?? 'sin evaluar'} · Cobertura ${definitive.metrics.evidence_coverage}%`
    : `${diagnosis.industry || 'Empresa'} · Diagnóstico base disponible`;

  return (
    <>
      <PageHeader
        title={diagnosis.company_name}
        description={headerDescription}
        actions={<><Link className="button secondary" to="/diagnose/list"><ArrowLeft size={16} />Diagnósticos</Link><button className="button secondary" onClick={load}><RefreshCw size={16} />Actualizar</button></>}
      />
      {error && definitive && <div className="form-error page-error">{error}</div>}
      {message && <div className="diagnose-success page-message"><CheckCircle2 size={17} />{message}</div>}
      <div className="diagnosis-workspace">
        <aside className="diagnosis-workspace-nav">
          <p className="eyebrow">WORKSPACE</p>
          {sections.map(({ id, label, icon: Icon }) => {
            const unavailable = !definitive && definitiveSections.has(id);
            return (
              <NavLink
                key={id}
                to={`/diagnose/${diagnosisId}/${id}`}
                title={unavailable ? 'Requiere Diagnose 2.0' : undefined}
                className={({ isActive }) => `${isActive ? 'active' : ''}${unavailable ? ' unavailable' : ''}`.trim()}
              >
                <Icon size={17} /><span>{label}</span>
                {id === 'interview' && definitive && <small>{definitive.questions.filter((item) => item.status === 'pending').length}</small>}
                {id === 'evidence' && definitive && <small>{definitive.metrics.evidence_coverage}%</small>}
              </NavLink>
            );
          })}
        </aside>
        <main className="diagnosis-workspace-content">{content}</main>
      </div>
    </>
  );
}
