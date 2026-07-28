import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  FileText,
  FolderOpen,
  MessageSquareText,
  RefreshCw,
  Route,
  Save,
  SearchCheck,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { Link, NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import AssessmentEditor from '../components/AssessmentEditor';
import DiagnosisEvidence from '../components/DiagnosisEvidence';
import DiagnosisInterview from '../components/DiagnosisInterview';
import DiagnosisFindings from '../components/DiagnosisFindings';
import DiagnosisRoadmap from '../components/DiagnosisRoadmap';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';

const sections = [
  { id: 'summary', label: 'Resumen', icon: BrainCircuit },
  { id: 'evidence', label: 'Evidencias', icon: FolderOpen },
  { id: 'interview', label: 'Entrevista', icon: MessageSquareText },
  { id: 'icp', label: 'ICP', icon: SearchCheck },
  { id: 'conversion', label: 'Conversión', icon: ClipboardCheck },
  { id: 'process', label: 'Procesos', icon: Settings2 },
  { id: 'automation', label: 'Automatización', icon: Bot },
  { id: 'findings', label: 'Hallazgos', icon: FileSearch },
  { id: 'roadmap', label: 'Roadmap', icon: Route },
  { id: 'report', label: 'Informe', icon: FileText },
];

const statusLabels = { draft: 'Borrador', in_progress: 'En progreso', completed: 'Completado', archived: 'Archivado' };

function ScoreCard({ label, score, level }) {
  return <article className="diagnosis-score-card"><span>{label}</span><strong>{score ?? 0}</strong><small>{level || 'Sin evaluar'}</small></article>;
}

export default function DiagnosisWorkspace() {
  const { diagnosisId, section = 'summary' } = useParams();
  const navigate = useNavigate();
  const validSection = sections.some((item) => item.id === section);
  const [diagnosis, setDiagnosis] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [data, templateData, profileRows] = await Promise.all([
        api(`/api/diagnose/${diagnosisId}`),
        templates ? Promise.resolve(templates) : api('/api/diagnose/templates'),
        profiles.length ? Promise.resolve(profiles) : api('/api/profiles'),
      ]);
      setDiagnosis(data);
      setTemplates(templateData);
      setProfiles(profileRows || []);
      setForm({
        company_name: data.company_name || '',
        industry: data.industry || '',
        website: data.website || '',
        instagram: data.instagram || '',
        whatsapp: data.whatsapp || '',
        city: data.city || '',
        contact_name: data.contact_name || '',
        contact_title: data.contact_title || '',
        objective: data.objective || '',
        declared_problem: data.declared_problem || '',
        executive_summary: data.executive_summary || '',
        assigned_to: data.assigned_to || '',
        status: data.status || 'draft',
      });
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [diagnosisId]);
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);

  const assessmentMap = useMemo(() => Object.fromEntries((diagnosis?.assessments || []).map((item) => [item.section, item])), [diagnosis]);

  if (!validSection) return <Navigate to={`/diagnose/${diagnosisId}/summary`} replace />;

  const change = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setDirty(true); setMessage(''); };

  const saveSummary = async () => {
    setSaving(true); setError('');
    try {
      const updated = await api(`/api/diagnose/${diagnosisId}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...form, assigned_to: form.assigned_to || null }),
      });
      setDiagnosis((current) => ({ ...current, ...updated }));
      setDirty(false); setMessage('Cambios guardados.');
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const assessmentSaved = () => { setMessage('Evaluación actualizada.'); load(); };

  const reportSnapshot = async () => {
    setSaving(true); setError('');
    try {
      await api(`/api/diagnose/${diagnosisId}/reports`, { method: 'POST' });
      navigate(`/diagnose/${diagnosisId}/report/print`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <section className="panel diagnose-loading">Cargando workspace de Diagnose…</section>;
  if (!diagnosis || !form) return <section className="panel"><h2>Diagnóstico no disponible</h2><p>{error}</p></section>;

  const renderSummary = () => (
    <section className="diagnosis-section-stack">
      <div className="diagnosis-score-overview">
        <ScoreCard label="Score general" score={diagnosis.overall_score} level={diagnosis.overall_level} />
        {['icp', 'conversion', 'process', 'automation'].map((key) => <ScoreCard key={key} label={templates.sections[key].title} score={assessmentMap[key]?.score || 0} level={assessmentMap[key]?.level || 'Sin evaluar'} />)}
      </div>

      <section className="panel diagnosis-summary-form">
        <div className="section-heading"><div><p className="eyebrow">RESUMEN</p><h2>Contexto del diagnóstico</h2></div><span className={`diagnose-status ${form.status}`}>{statusLabels[form.status]}</span></div>
        <div className="form-grid two">
          <label>Empresa<input value={form.company_name} onChange={(e) => change('company_name', e.target.value)} /></label>
          <label>Industria<input value={form.industry} onChange={(e) => change('industry', e.target.value)} /></label>
          <label>Website<input value={form.website} onChange={(e) => change('website', e.target.value)} /></label>
          <label>Instagram<input value={form.instagram} onChange={(e) => change('instagram', e.target.value)} /></label>
          <label>WhatsApp<input value={form.whatsapp} onChange={(e) => change('whatsapp', e.target.value)} /></label>
          <label>Ciudad<input value={form.city} onChange={(e) => change('city', e.target.value)} /></label>
          <label>Contacto<input value={form.contact_name} onChange={(e) => change('contact_name', e.target.value)} /></label>
          <label>Cargo<input value={form.contact_title} onChange={(e) => change('contact_title', e.target.value)} /></label>
          <label>Responsable<select value={form.assigned_to} onChange={(e) => change('assigned_to', e.target.value)}><option value="">Sin asignar</option>{profiles.filter((p) => p.role === 'admin').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
          <label>Estado<select value={form.status} onChange={(e) => change('status', e.target.value)}><option value="draft">Borrador</option><option value="in_progress">En progreso</option><option value="completed">Completado</option><option value="archived">Archivado</option></select></label>
        </div>
        <label>Objetivo principal<textarea rows="3" value={form.objective} onChange={(e) => change('objective', e.target.value)} /></label>
        <label>Problema declarado<textarea rows="4" value={form.declared_problem} onChange={(e) => change('declared_problem', e.target.value)} /></label>
        <label>Resumen ejecutivo<textarea rows="6" value={form.executive_summary} onChange={(e) => change('executive_summary', e.target.value)} placeholder="Síntesis estratégica que aparecerá en el informe premium" /></label>
        <div className="diagnosis-savebar"><span>{dirty ? 'Tienes cambios sin guardar.' : 'Todo está guardado.'}</span><button className={`button ${dirty ? 'diagnose-primary' : 'disabled-save'}`} disabled={!dirty || saving} onClick={saveSummary}><Save size={17} />{saving ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Guardado'}</button></div>
      </section>

      {diagnosis.lead && (
        <section className="panel linked-focus-lead"><div><p className="eyebrow">CONECTADO CON FOCUS</p><h3>{diagnosis.lead.business_name}</h3><p>{diagnosis.lead.status} · Tier {diagnosis.lead.final_tier} · {diagnosis.lead.final_score} puntos</p></div><Link className="button secondary" to="/leads">Abrir Base de leads</Link></section>
      )}
    </section>
  );

  const renderReport = () => (
    <section className="diagnosis-section-stack">
      <div className="report-ready-card panel">
        <FileText size={34} />
        <p className="eyebrow">INFORME PREMIUM</p>
        <h2>Convierte el diagnóstico vivo en un documento presentable.</h2>
        <p>El informe reúne el resumen ejecutivo, scores, hallazgos y roadmap. El navegador permite guardarlo como PDF sin pagar otra herramienta.</p>
        <button className="button diagnose-primary" onClick={reportSnapshot} disabled={saving}><FileText size={17} />{saving ? 'Preparando…' : 'Generar informe y abrir PDF'}</button>
      </div>
      <div className="report-checklist panel">
        <h3>Antes de generar</h3>
        <ul><li className={diagnosis.executive_summary ? 'done' : ''}>Resumen ejecutivo</li><li className={(diagnosis.assessments || []).length === 4 ? 'done' : ''}>Cuatro evaluaciones</li><li className={(diagnosis.findings || []).length ? 'done' : ''}>Hallazgos priorizados</li><li className={(diagnosis.roadmap || []).length ? 'done' : ''}>Growth Roadmap</li></ul>
      </div>
    </section>
  );

  let content = null;
  if (section === 'summary') content = renderSummary();
  else if (section === 'evidence') content = <DiagnosisEvidence diagnosisId={diagnosisId} items={diagnosis.evidence} analysis={diagnosis.latest_analysis} questions={diagnosis.interview_questions} onChanged={load} />;
  else if (section === 'interview') content = <DiagnosisInterview diagnosisId={diagnosisId} items={diagnosis.interview_questions} analysis={diagnosis.latest_analysis} onChanged={load} />;
  else if (['icp', 'conversion', 'process', 'automation'].includes(section)) content = <AssessmentEditor diagnosisId={diagnosisId} section={section} template={templates.sections[section]} assessment={assessmentMap[section]} scoreOptions={templates.score_options} onSaved={assessmentSaved} />;
  else if (section === 'findings') content = <DiagnosisFindings diagnosisId={diagnosisId} items={diagnosis.findings} onChanged={load} />;
  else if (section === 'roadmap') content = <DiagnosisRoadmap diagnosisId={diagnosisId} items={diagnosis.roadmap} profiles={profiles} onChanged={load} />;
  else if (section === 'report') content = renderReport();

  return (
    <>
      <PageHeader
        title={diagnosis.company_name}
        description={`${diagnosis.industry || 'Empresa'} · ${diagnosis.overall_score}/100 · ${diagnosis.overall_level}`}
        actions={<><Link className="button secondary" to="/diagnose/list"><ArrowLeft size={16} />Diagnósticos</Link><button className="button secondary" onClick={load}><RefreshCw size={16} />Actualizar</button></>}
      />
      {error && <div className="form-error page-error">{error}</div>}
      {message && <div className="diagnose-success page-message"><CheckCircle2 size={17} />{message}</div>}

      <div className="diagnosis-workspace">
        <aside className="diagnosis-workspace-nav">
          <p className="eyebrow">WORKSPACE</p>
          {sections.map(({ id, label, icon: Icon }) => <NavLink key={id} to={`/diagnose/${diagnosisId}/${id}`} className={({ isActive }) => isActive ? 'active' : ''}><Icon size={17} /><span>{label}</span>{['icp', 'conversion', 'process', 'automation'].includes(id) && <small>{assessmentMap[id]?.score ?? 0}</small>}{id === 'interview' && <small>{(diagnosis.interview_questions || []).filter((item) => item.status === 'pending').length}</small>}</NavLink>)}
        </aside>
        <main className="diagnosis-workspace-content">{content}</main>
      </div>
    </>
  );
}
