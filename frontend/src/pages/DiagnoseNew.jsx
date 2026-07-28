import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, Database, Save } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';

const emptyForm = {
  lead_id: '',
  company_name: '',
  industry: '',
  website: '',
  instagram: '',
  whatsapp: '',
  city: 'Ciudad de Panamá',
  contact_name: '',
  contact_title: '',
  objective: '',
  declared_problem: '',
  assigned_to: '',
};

export default function DiagnoseNew() {
  const navigate = useNavigate();
  const [source, setSource] = useState('manual');
  const [form, setForm] = useState(emptyForm);
  const [leads, setLeads] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [search, setSearch] = useState('');
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/api/profiles'), api('/api/leads?view=all&page_size=100')])
      .then(([profileRows, leadData]) => {
        setProfiles(profileRows || []);
        setLeads(leadData.items || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads.slice(0, 20);
    return leads.filter((lead) => `${lead.business_name} ${lead.address || ''} ${lead.phone || ''}`.toLowerCase().includes(term)).slice(0, 20);
  }, [leads, search]);

  const chooseLead = async (lead) => {
    setLoadingLeads(true);
    setError('');
    try {
      const full = await api(`/api/leads/${lead.id}`);
      setForm({
        ...emptyForm,
        lead_id: full.id,
        company_name: full.business_name || '',
        industry: full.niche || '',
        website: full.website || '',
        instagram: full.instagram_url || '',
        whatsapp: full.whatsapp_phone || full.phone || '',
        city: full.zone || 'Ciudad de Panamá',
        contact_name: full.decision_maker_name || '',
        contact_title: full.decision_maker_title || '',
        objective: '',
        declared_problem: full.notes || '',
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingLeads(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!form.company_name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const created = await api('/api/diagnose', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          lead_id: form.lead_id || null,
          assigned_to: form.assigned_to || null,
        }),
      });
      navigate(`/diagnose/${created.id}/summary`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Nuevo diagnóstico"
        description="Registra una empresa nueva o conecta un lead existente de Focus."
        actions={<Link className="button secondary" to="/diagnose"><ArrowLeft size={16} />Volver</Link>}
      />

      <section className="diagnose-source-grid">
        <button className={`diagnose-source-card ${source === 'manual' ? 'active' : ''}`} onClick={() => setSource('manual')}>
          <Building2 size={24} /><strong>Empresa nueva</strong><span>Registra los datos esenciales manualmente.</span>
        </button>
        <button className={`diagnose-source-card ${source === 'lead' ? 'active' : ''}`} onClick={() => setSource('lead')}>
          <Database size={24} /><strong>Lead de Aura Focus</strong><span>Reutiliza los datos que ya existen en la base.</span>
        </button>
      </section>

      {source === 'lead' && (
        <section className="panel diagnose-lead-picker">
          <label>Buscar lead<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, dirección o teléfono" /></label>
          <div className="diagnose-lead-results">
            {filteredLeads.map((lead) => (
              <button key={lead.id} onClick={() => chooseLead(lead)} className={form.lead_id === lead.id ? 'selected' : ''}>
                <div><strong>{lead.business_name}</strong><span>{lead.address || 'Sin dirección'}</span></div>
                <small>Tier {lead.final_tier} · {lead.final_score}</small>
              </button>
            ))}
          </div>
          {loadingLeads && <p className="muted">Cargando información del lead…</p>}
        </section>
      )}

      <form className="panel diagnose-create-form" onSubmit={save}>
        <div className="section-heading"><div><p className="eyebrow">DATOS INICIALES</p><h2>Empresa y objetivo</h2></div></div>
        {error && <div className="form-error">{error}</div>}
        <div className="form-grid two">
          <label>Empresa<input required value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></label>
          <label>Industria<input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Ej. Clínica dental" /></label>
          <label>Website<input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" /></label>
          <label>Instagram<input value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} placeholder="https://instagram.com/" /></label>
          <label>WhatsApp<input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></label>
          <label>Ciudad<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>Contacto principal<input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></label>
          <label>Cargo<input value={form.contact_title} onChange={(e) => setForm({ ...form, contact_title: e.target.value })} /></label>
          <label>Responsable<select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}><option value="">Asignar a Laura</option>{profiles.filter((p) => p.role === 'admin').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        </div>
        <label>Objetivo principal<textarea rows="3" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="¿Qué quiere mejorar o lograr la empresa?" /></label>
        <label>Problema declarado<textarea rows="4" value={form.declared_problem} onChange={(e) => setForm({ ...form, declared_problem: e.target.value })} placeholder="¿Qué problema reconoce actualmente?" /></label>
        <div className="form-actions"><button className="button diagnose-primary" type="submit" disabled={saving || !form.company_name.trim()}><Save size={17} />{saving ? 'Creando…' : 'Crear diagnóstico'}</button></div>
      </form>
    </>
  );
}
