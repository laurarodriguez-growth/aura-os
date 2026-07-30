import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CopyPlus,
  Database,
  Lock,
  Play,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Unlock,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const DEFAULT_THRESHOLDS = { A: 70, B: 50, C: 30 };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyRule(catalog) {
  const item = catalog[0] || {
    key: 'review_count',
    label: 'Cantidad de reseñas',
    category: 'capacity',
    operators: ['gte'],
    value_type: 'number',
    default_value: 100,
  };
  return {
    criterion: item.key,
    label: item.label,
    category: item.category,
    operator: item.operators?.[0] || 'is_true',
    value: item.value_type === 'none' ? null : (item.default_value ?? ''),
    points: 5,
    enabled: true,
  };
}

export default function LeadFinder() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [form, setForm] = useState({
    niche: 'Dental',
    city: 'Ciudad de Panamá',
    zones: 'San Francisco, Obarrio',
    services: 'Implantes dentales, Ortodoncia, Odontopediatría',
    max_results: 20,
    api_request_budget: 5,
  });
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [error, setError] = useState('');
  const stopRef = useRef(false);
  const [capacity, setCapacity] = useState({
    pending_leads: 0,
    capacity_max: 100,
    unlock_at: 50,
    available_slots: 100,
    generation_enabled: true,
    max_new_leads: 100,
    message: 'Calculando capacidad…',
  });
  const [capacityBusy, setCapacityBusy] = useState(true);

  const [scoringOpen, setScoringOpen] = useState(true);
  const [scoringMode, setScoringMode] = useState('automatic');
  const [catalog, setCatalog] = useState([]);
  const [operatorLabels, setOperatorLabels] = useState({});
  const [rules, setRules] = useState([]);
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [presetName, setPresetName] = useState('Dental Panamá · Recomendada');
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [scoringBusy, setScoringBusy] = useState(true);
  const [scoringMessage, setScoringMessage] = useState('');
  const [scoringError, setScoringError] = useState('');

  useEffect(() => () => { stopRef.current = true; }, []);

  const loadCapacity = async () => {
    setCapacityBusy(true);
    try {
      const snapshot = await api('/api/lead-capacity');
      setCapacity(snapshot);
      if (snapshot.generation_enabled) {
        setForm((current) => ({
          ...current,
          max_results: Math.min(Number(current.max_results || 20), Number(snapshot.max_new_leads || 1)),
        }));
      }
      return snapshot;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setCapacityBusy(false);
    }
  };

  const loadTemplates = async (niche = form.niche) => {
    const rows = await api(`/api/scoring/templates?niche=${encodeURIComponent(niche)}`);
    setTemplates(rows);
    return rows;
  };

  const loadPreset = async (niche = form.niche) => {
    setScoringBusy(true);
    setScoringError('');
    try {
      const preset = await api(`/api/scoring/preset?niche=${encodeURIComponent(niche)}`);
      setRules(clone(preset.rules || []));
      setThresholds(clone(preset.thresholds || DEFAULT_THRESHOLDS));
      setPresetName(preset.name || `${niche} Panamá · Recomendada`);
      setSelectedTemplateId('');
    } catch (e) {
      setScoringError(e.message);
    } finally {
      setScoringBusy(false);
    }
  };

  useEffect(() => {
    const start = async () => {
      setScoringBusy(true);
      try {
        const [catalogData, rows] = await Promise.all([
          api('/api/scoring/catalog'),
          loadTemplates('Dental'),
          loadCapacity(),
        ]);
        setCatalog(catalogData.catalog || []);
        setOperatorLabels(catalogData.operators || {});
        const defaultTemplate = rows.find((item) => item.is_default);
        if (defaultTemplate) {
          setScoringMode('template');
          applyTemplateData(defaultTemplate);
        } else {
          await loadPreset('Dental');
        }
      } catch (e) {
        setScoringError(e.message);
      } finally {
        setScoringBusy(false);
      }
    };
    start();
  }, []);

  const changeNiche = async (niche) => {
    setForm((current) => ({ ...current, niche }));
    setScoringMessage('');
    setScoringError('');
    try {
      const rows = await loadTemplates(niche);
      if (scoringMode !== 'manual') {
        const defaultTemplate = rows.find((item) => item.is_default);
        if (defaultTemplate) {
          setScoringMode('template');
          applyTemplateData(defaultTemplate);
        } else {
          setScoringMode('automatic');
          await loadPreset(niche);
        }
      }
    } catch (e) {
      setScoringError(e.message);
    }
  };

  const chooseMode = async (mode) => {
    if (!isAdmin && mode === 'manual') return;
    setScoringMode(mode);
    setScoringMessage('');
    setScoringError('');
    if (mode === 'automatic') {
      await loadPreset(form.niche);
    } else if (mode === 'manual') {
      setSelectedTemplateId('');
      setPresetName('Scoring manual');
      setRules([]);
      setThresholds(DEFAULT_THRESHOLDS);
    } else {
      setRules([]);
      setSelectedTemplateId('');
      setPresetName('Plantilla guardada');
    }
  };

  const applyTemplateData = (template) => {
    if (!template) return;
    setSelectedTemplateId(template.id || '');
    setRules(clone(template.rules || []));
    setThresholds(clone(template.thresholds || DEFAULT_THRESHOLDS));
    setPresetName(template.name);
    setTemplateName(template.name);
    setMakeDefault(Boolean(template.is_default));
  };

  const chooseTemplate = (templateId) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      setRules([]);
      return;
    }
    applyTemplateData(template);
  };

  const addRule = () => setRules((current) => [...current, emptyRule(catalog)]);

  const updateRule = (index, changes) => {
    setRules((current) => current.map((rule, position) => (
      position === index ? { ...rule, ...changes } : rule
    )));
  };

  const changeCriterion = (index, criterion) => {
    const item = catalog.find((entry) => entry.key === criterion);
    if (!item) return;
    updateRule(index, {
      criterion,
      label: item.label,
      category: item.category,
      operator: item.operators?.[0] || 'is_true',
      value: item.value_type === 'none' ? null : (item.default_value ?? ''),
    });
  };

  const removeRule = (index) => setRules((current) => current.filter((_, position) => position !== index));

  const saveTemplate = async () => {
    if (!isAdmin) {
      setScoringError('Solo la administradora puede guardar o modificar plantillas.');
      return;
    }
    if (!templateName.trim()) {
      setScoringError('Escribe un nombre para la plantilla.');
      return;
    }
    if (!rules.length) {
      setScoringError('Agrega al menos una regla antes de guardar la plantilla.');
      return;
    }
    setScoringBusy(true);
    setScoringError('');
    setScoringMessage('');
    try {
      const saved = await api('/api/scoring/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: templateName.trim(),
          niche: form.niche,
          country: 'Panamá',
          rules,
          thresholds,
          is_default: makeDefault,
        }),
      });
      const refreshed = await loadTemplates(form.niche);
      setSelectedTemplateId(saved.id || refreshed.find((item) => item.name === templateName.trim())?.id || '');
      setPresetName(templateName.trim());
      setScoringMessage(`Plantilla “${templateName.trim()}” guardada.`);
    } catch (e) {
      setScoringError(e.message);
    } finally {
      setScoringBusy(false);
    }
  };

  const deleteTemplate = async () => {
    if (!isAdmin) return;
    if (!selectedTemplateId) return;
    const selected = templates.find((item) => item.id === selectedTemplateId);
    if (!window.confirm(`¿Eliminar la plantilla “${selected?.name || ''}”?`)) return;
    setScoringBusy(true);
    setScoringError('');
    try {
      await api(`/api/scoring/templates/${selectedTemplateId}`, { method: 'DELETE' });
      await loadTemplates(form.niche);
      setSelectedTemplateId('');
      setRules([]);
      setTemplateName('');
      setScoringMessage('Plantilla eliminada.');
    } catch (e) {
      setScoringError(e.message);
    } finally {
      setScoringBusy(false);
    }
  };

  const maxPositive = useMemo(
    () => rules.filter((rule) => rule.enabled && Number(rule.points) > 0)
      .reduce((total, rule) => total + Number(rule.points || 0), 0),
    [rules],
  );
  const activeRules = rules.filter((rule) => rule.enabled).length;
  const tierWarning = maxPositive > 0 && Number(thresholds.A) > Math.min(100, maxPositive);

  const createJob = async () => {
    const currentCapacity = await loadCapacity();
    if (!currentCapacity?.generation_enabled) {
      setError(currentCapacity?.message || 'El generador está bloqueado por capacidad operativa.');
      return;
    }
    if (!rules.length) {
      setScoringError('El scoring necesita al menos una regla activa.');
      setScoringOpen(true);
      return;
    }
    if (!(Number(thresholds.A) > Number(thresholds.B) && Number(thresholds.B) > Number(thresholds.C))) {
      setScoringError('Los tiers deben cumplir: A mayor que B y B mayor que C.');
      setScoringOpen(true);
      return;
    }
    setBusy(true);
    setError('');
    setScoringError('');
    setJob(null);
    try {
      const selectedTemplate = templates.find((item) => item.id === selectedTemplateId);
      const payload = {
        niche: form.niche,
        city: form.city.trim(),
        zones: form.zones.split(',').map((x) => x.trim()).filter(Boolean),
        services: form.services.split(',').map((x) => x.trim()).filter(Boolean),
        max_results: Math.min(Number(form.max_results), Number(currentCapacity.max_new_leads)),
        api_request_budget: Number(form.api_request_budget),
        scoring_mode: scoringMode,
        scoring_template_id: scoringMode === 'template' ? selectedTemplateId : null,
        scoring_template_name: scoringMode === 'template'
          ? selectedTemplate?.name
          : (presetName || templateName || 'Scoring personalizado'),
        scoring_rules: rules.map((rule) => ({ ...rule, points: Number(rule.points || 0) })),
        scoring_thresholds: {
          A: Number(thresholds.A),
          B: Number(thresholds.B),
          C: Number(thresholds.C),
        },
      };
      const created = await api('/api/search-jobs', { method: 'POST', body: JSON.stringify(payload) });
      setJob(created);
      await runJob(created.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
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
      await loadCapacity();
      setBusy(false);
      setAutoRun(false);
    }
  };

  const stop = () => { stopRef.current = true; setAutoRun(false); };
  const progress = job?.phase === 'audit'
    ? (job.total_discovered ? Math.round((job.total_audited / job.total_discovered) * 100) : 0)
    : (job?.max_results ? Math.round(((job.new_leads_added ?? job.total_discovered) / job.max_results) * 100) : 0);

  return (
    <>
      <PageHeader title="Generar leads" description="Busca negocios con tu API y guarda cada resultado en la base permanente. Los setters pueden generar usando el scoring aprobado." />
      <section className="finder-layout">
        <article className="panel form-panel">
          <p className="eyebrow">NUEVA BÚSQUEDA</p>
          <h2>Define el mercado</h2>

          <section className={`capacity-card ${capacity.generation_enabled ? 'enabled' : 'blocked'}`}>
            <div className="capacity-heading">
              <span className="capacity-icon">{capacity.generation_enabled ? <Unlock size={18} /> : <Lock size={18} />}</span>
              <div>
                <strong>{capacity.generation_enabled ? 'Generador habilitado' : 'Generador bloqueado'}</strong>
                <small>{capacity.message}</small>
              </div>
              <button type="button" className="icon-button" onClick={loadCapacity} disabled={capacityBusy} title="Actualizar capacidad"><Database size={17} /></button>
            </div>
            <div className="capacity-kpis">
              <div><span>Pendientes actuales</span><strong>{capacity.pending_leads}</strong></div>
              <div><span>Capacidad máxima</span><strong>{capacity.capacity_max}</strong></div>
              <div><span>Espacios disponibles</span><strong>{capacity.available_slots}</strong></div>
              <div><span>Nuevos permitidos</span><strong>{capacity.max_new_leads}</strong></div>
            </div>
            <div className="capacity-progress"><span style={{ width: `${Math.min(100, (capacity.pending_leads / capacity.capacity_max) * 100)}%` }} /></div>
            <p>Para abrir una nueva generación, la base debe tener <strong>{capacity.unlock_at} pendientes o menos</strong>.</p>
          </section>

          <div className="form-grid two">
            <label>Nicho
              <select value={form.niche} onChange={(e) => changeNiche(e.target.value)}>
                <option>Dental</option>
                <option>Medicina estética</option>
              </select>
            </label>
            <label>Ciudad<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          </div>
          <label>Zonas, separadas por coma<input value={form.zones} onChange={(e) => setForm({ ...form, zones: e.target.value })} /></label>
          <label>Servicios prioritarios, separados por coma<input value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} /></label>
          <div className="form-grid two">
            <label>Máximo de leads<input type="number" min="1" max={Math.max(1, capacity.max_new_leads)} value={form.max_results} disabled={!capacity.generation_enabled} onChange={(e) => setForm({ ...form, max_results: Math.min(Number(e.target.value), Math.max(1, capacity.max_new_leads)) })} /><small>Puedes solicitar hasta {capacity.max_new_leads} en esta ronda.</small></label>
            <label>Límite de solicitudes Google<input type="number" min="1" max="60" value={form.api_request_budget} onChange={(e) => setForm({ ...form, api_request_budget: e.target.value })} /></label>
          </div>

          <section className="scoring-box">
            <button type="button" className="scoring-toggle" onClick={() => setScoringOpen((value) => !value)}>
              <span className="scoring-toggle-icon"><SlidersHorizontal size={18} /></span>
              <span>
                <strong>Configuración de scoring</strong>
                <small>{activeRules} criterios activos · {presetName}</small>
              </span>
              {scoringOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {scoringOpen && (
              <div className="scoring-editor">
                <div className={`scoring-mode-grid ${isAdmin ? '' : 'setter-mode'}`}>
                  <button type="button" className={scoringMode === 'automatic' ? 'active' : ''} onClick={() => chooseMode('automatic')}>
                    <Sparkles size={17} /><strong>Automático</strong><small>{isAdmin ? `Preestablecido para ${form.niche} en Panamá y editable.` : `Scoring aprobado para ${form.niche} en Panamá.`}</small>
                  </button>
                  {isAdmin && (
                    <button type="button" className={scoringMode === 'manual' ? 'active' : ''} onClick={() => chooseMode('manual')}>
                      <Plus size={17} /><strong>Manual</strong><small>Empieza vacío y crea tus propios filtros.</small>
                    </button>
                  )}
                  <button type="button" className={scoringMode === 'template' ? 'active' : ''} onClick={() => chooseMode('template')}>
                    <CopyPlus size={17} /><strong>Plantilla</strong><small>Usa una configuración guardada anteriormente.</small>
                  </button>
                </div>

                {scoringMode === 'template' && (
                  <div className="template-picker">
                    <label>Plantilla guardada
                      <select value={selectedTemplateId} onChange={(e) => chooseTemplate(e.target.value)}>
                        <option value="">Selecciona una plantilla</option>
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}{template.is_default ? ' · Predeterminada' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {isAdmin && selectedTemplateId && <button type="button" className="button ghost danger-button" onClick={deleteTemplate}><Trash2 size={15} />Eliminar</button>}
                  </div>
                )}

                {scoringBusy ? <div className="scoring-loading">Cargando configuración…</div> : (
                  <>
                    <div className="rules-header">
                      <div><strong>Criterios</strong><small>Pueden sumar o restar puntos.</small></div>
                      {isAdmin && <button type="button" className="button secondary compact" onClick={addRule}><Plus size={15} />Agregar criterio</button>}
                    </div>

                    {rules.length === 0 ? (
                      <div className="rules-empty">No hay criterios. Pulsa <strong>Agregar criterio</strong> para comenzar.</div>
                    ) : (
                      <div className="scoring-rules">
                        {rules.map((rule, index) => {
                          const meta = catalog.find((item) => item.key === rule.criterion);
                          const operators = meta?.operators || ['is_true'];
                          const needsValue = meta?.value_type !== 'none';
                          return (
                            <div className={`scoring-rule ${rule.enabled ? '' : 'disabled'}`} key={`${rule.criterion}-${index}`}>
                              <label className="rule-enabled" title="Activar o desactivar criterio">
                                <input type="checkbox" checked={rule.enabled} disabled={!isAdmin} onChange={(e) => updateRule(index, { enabled: e.target.checked })} />
                              </label>
                              <label>Criterio
                                <select value={rule.criterion} disabled={!isAdmin} onChange={(e) => changeCriterion(index, e.target.value)}>
                                  {catalog.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                                </select>
                              </label>
                              <label>Condición
                                <select value={rule.operator} disabled={!isAdmin} onChange={(e) => updateRule(index, { operator: e.target.value })}>
                                  {operators.map((operator) => <option key={operator} value={operator}>{operatorLabels[operator] || operator}</option>)}
                                </select>
                              </label>
                              <label>Valor
                                <input
                                  type={meta?.value_type === 'number' ? 'number' : 'text'}
                                  disabled={!needsValue || !isAdmin}
                                  value={needsValue ? (rule.value ?? '') : ''}
                                  placeholder={needsValue ? 'Valor' : 'No aplica'}
                                  onChange={(e) => updateRule(index, { value: meta?.value_type === 'number' ? Number(e.target.value) : e.target.value })}
                                />
                              </label>
                              <label>Puntos
                                <input type="number" min="-100" max="100" value={rule.points} disabled={!isAdmin} onChange={(e) => updateRule(index, { points: Number(e.target.value) })} />
                              </label>
                              {isAdmin && <button type="button" className="icon-button rule-delete" onClick={() => removeRule(index)} title="Eliminar criterio"><Trash2 size={16} /></button>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="tier-editor">
                      <div>
                        <strong>Límites de tiers</strong>
                        <small>El score final se limita a 100 puntos.</small>
                      </div>
                      <label>Tier A desde<input type="number" min="0" max="100" disabled={!isAdmin} value={thresholds.A} onChange={(e) => setThresholds({ ...thresholds, A: Number(e.target.value) })} /></label>
                      <label>Tier B desde<input type="number" min="0" max="100" disabled={!isAdmin} value={thresholds.B} onChange={(e) => setThresholds({ ...thresholds, B: Number(e.target.value) })} /></label>
                      <label>Tier C desde<input type="number" min="0" max="100" disabled={!isAdmin} value={thresholds.C} onChange={(e) => setThresholds({ ...thresholds, C: Number(e.target.value) })} /></label>
                    </div>

                    <div className={`score-balance ${tierWarning ? 'warning' : ''}`}>
                      <span>Puntos positivos posibles: <strong>{maxPositive}</strong></span>
                      <span>Máximo efectivo: <strong>{Math.min(100, maxPositive)}</strong></span>
                      {tierWarning && <span>Tier A no sería alcanzable con estas reglas.</span>}
                    </div>

                    {isAdmin ? (
                      <div className="template-save-box">
                        <label>Guardar esta configuración con un nombre personalizado
                          <input placeholder="Ej. Dental alto valor · Panamá Oeste" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                        </label>
                        <label className="check-row"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />Usar como predeterminada para {form.niche}</label>
                        <button type="button" className="button secondary" onClick={saveTemplate} disabled={scoringBusy || !rules.length}><Save size={16} />Guardar plantilla</button>
                      </div>
                    ) : (
                      <div className="setter-scoring-note">
                        <Lock size={16} />
                        <div><strong>Scoring protegido</strong><span>Puedes generar leads con el modelo automático o una plantilla aprobada. Solo la administradora modifica las reglas.</span></div>
                      </div>
                    )}
                  </>
                )}

                {scoringError && <div className="form-error">{scoringError}</div>}
                {scoringMessage && <div className="success-box">{scoringMessage}</div>}
              </div>
            )}
          </section>

          <div className="hint-box"><strong>Primera prueba recomendada</strong><p>20 leads y límite Google de 5. Así validamos el flujo sin consumir de más.</p></div>
          {error && <div className="form-error">{error}</div>}
          <button className="button primary full" onClick={createJob} disabled={busy || scoringBusy || capacityBusy || !capacity.generation_enabled}><Search size={17} />{busy ? 'Procesando…' : capacity.generation_enabled ? 'Iniciar búsqueda' : 'Trabaja la base para habilitar'}</button>
        </article>

        <article className="panel progress-panel">
          <p className="eyebrow">PROGRESO</p>
          <h2>{job ? 'Búsqueda en ejecución' : 'Lista para comenzar'}</h2>
          {!job ? <div className="finder-placeholder"><div className="search-orbit"><Search /></div><p>Los avances, caché, scoring y resultados aparecerán aquí.</p></div> : (
            <>
              <div className="job-status"><span className={`status-pill ${job.status}`}>{job.status}</span><small>Fase: {job.phase}</small></div>
              <div className="search-scoring-summary"><SlidersHorizontal size={15} /><span>{job.scoring_template_name || 'Scoring personalizado'}</span></div>
              <div className="large-progress"><div style={{ width: `${Math.min(100, progress)}%` }} /></div>
              <div className="job-kpis">
                <div><span>Nuevos guardados</span><strong>{job.new_leads_added ?? job.total_discovered}</strong></div>
                <div><span>Descubiertos</span><strong>{job.total_discovered}</strong></div>
                <div><span>Auditados</span><strong>{job.total_audited}</strong></div>
                <div><span>API usada</span><strong>{job.api_requests_used}/{job.api_request_budget}</strong></div>
                <div><span>Caché Google</span><strong>{job.cache_hits_google}</strong></div>
                <div><span>Caché web</span><strong>{job.cache_hits_web}</strong></div>
              </div>
              {job.error_message && <div className="form-error">{job.error_message}</div>}
              {!busy && !['completed', 'failed', 'cancelled'].includes(job.status) && <button className="button secondary full" onClick={() => runJob(job.id)}><Play size={16} />Continuar procesamiento</button>}
              {autoRun && <button className="button ghost full" onClick={stop}><Square size={15} />Pausar después de este paso</button>}
              {job.status === 'completed' && <div className="success-box">La búsqueda terminó. Los leads quedaron guardados permanentemente en la Base de leads.</div>}
            </>
          )}
        </article>
      </section>
    </>
  );
}
