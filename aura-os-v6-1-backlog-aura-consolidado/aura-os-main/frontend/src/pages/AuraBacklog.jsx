import { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Filter,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from 'lucide-react';
import EmptyState from '../components/EmptyState';
import LeadDrawer from '../components/LeadDrawer';
import MetricCard from '../components/MetricCard';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';


const reviewStatusLabels = {
  pending_review: 'Pendiente de revisar',
  approved_good_example: 'Aprobado como buen ejemplo',
  needs_new_rule: 'Necesita nueva regla',
  rule_updated: 'Regla actualizada',
  discarded: 'Descartado',
};

const evaluationLabels = {
  worked: 'Sirvió',
  needs_adjustment: 'Necesita ajuste',
  incorrect: 'Incorrecta',
};

const problemTypeLabels = {
  incorrect_interpretation: 'Interpretación incorrecta',
  unnatural_text: 'Texto poco natural',
  too_long: 'Respuesta demasiado larga',
  incorrect_classification: 'Clasificación incorrecta',
  incorrect_followup: 'Seguimiento incorrecto',
  context_not_recognized: 'No reconoció el contexto',
  missing_playbook_case: 'Falta una situación en el playbook',
  other: 'Otro',
};

const confidenceLabels = {
  high: 'Alta · 80% o más',
  medium: 'Media · 60% a 79%',
  low: 'Baja · menos de 60%',
};

const emptyFilters = {
  setter_id: '',
  date_from: '',
  date_to: '',
  outcome: '',
  confidence: '',
  review_status: '',
  problem_type: '',
};

function formatDate(value, withTime = true) {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('es-PA', withTime ? {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  } : {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function classificationEntries(value) {
  if (!value || typeof value !== 'object') return [];
  const labels = {
    commercial_status: 'Estado comercial',
    conversation_status_label: 'Conversación',
    conversation_status: 'Conversación',
    outcome: 'Outcome',
    next_step: 'Próximo paso',
    followup_date: 'Seguimiento',
  };
  const preferred = ['commercial_status', 'conversation_status_label', 'outcome', 'next_step', 'followup_date'];
  const entries = [];
  preferred.forEach((key) => {
    if (value[key]) entries.push([labels[key], value[key]]);
  });
  if (!value.conversation_status_label && value.conversation_status) {
    entries.splice(1, 0, [labels.conversation_status, value.conversation_status]);
  }
  return entries;
}

function ReviewForm({ item, evaluation, saving, onCancel, onSave }) {
  const needsCorrection = evaluation === 'needs_adjustment' || evaluation === 'incorrect';
  const availableStatuses = evaluation === 'worked'
    ? ['approved_good_example']
    : ['needs_new_rule', 'rule_updated', 'discarded'];
  const [draft, setDraft] = useState({
    evaluation,
    review_status: evaluation === 'worked'
      ? 'approved_good_example'
      : (item.review_status === 'rule_updated' ? 'rule_updated' : 'needs_new_rule'),
    problem_type: item.problem_type || '',
    expected_interpretation: item.expected_interpretation || '',
    expected_response: item.expected_response || '',
    review_notes: item.review_notes || '',
  });

  const submit = () => {
    if (needsCorrection && !draft.problem_type) return;
    if (
      needsCorrection
      && !draft.expected_interpretation.trim()
      && !draft.expected_response.trim()
    ) return;
    onSave(draft);
  };

  return (
    <section className="backlog-review-form" aria-label="Revisión administrativa">
      <header>
        <div>
          <strong>{evaluationLabels[evaluation]}</strong>
          <small>Esta revisión no cambia el playbook automáticamente.</small>
        </div>
      </header>

      <div className="backlog-review-grid">
        {needsCorrection && (
          <label>Tipo de problema
            <select
              value={draft.problem_type}
              onChange={(event) => setDraft({ ...draft, problem_type: event.target.value })}
            >
              <option value="">Seleccionar</option>
              {Object.entries(problemTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        )}
        <label>Estado del backlog
          <select
            value={draft.review_status}
            onChange={(event) => setDraft({ ...draft, review_status: event.target.value })}
          >
            {availableStatuses.map((value) => (
              <option key={value} value={value}>{reviewStatusLabels[value]}</option>
            ))}
          </select>
        </label>
      </div>

      {needsCorrection && (
        <>
          <label>Qué debió entender Aura
            <textarea
              rows="3"
              value={draft.expected_interpretation}
              onChange={(event) => setDraft({ ...draft, expected_interpretation: event.target.value })}
              placeholder="Escribe la interpretación correcta."
            />
          </label>
          <label>Qué debió responder Aura
            <textarea
              rows="4"
              value={draft.expected_response}
              onChange={(event) => setDraft({ ...draft, expected_response: event.target.value })}
              placeholder="Escribe la respuesta aprobada o la orientación correcta."
            />
          </label>
        </>
      )}

      <label>Nota de revisión
        <textarea
          rows="2"
          value={draft.review_notes}
          onChange={(event) => setDraft({ ...draft, review_notes: event.target.value })}
          placeholder="Opcional: contexto para la próxima actualización de reglas."
        />
      </label>

      {needsCorrection && !draft.problem_type && (
        <small className="backlog-review-validation">Selecciona el tipo de problema.</small>
      )}
      {needsCorrection && !draft.expected_interpretation.trim() && !draft.expected_response.trim() && (
        <small className="backlog-review-validation">Registra qué debió entender o responder Aura.</small>
      )}

      <footer>
        <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button
          type="button"
          className="button primary"
          onClick={submit}
          disabled={
            saving
            || (needsCorrection && !draft.problem_type)
            || (needsCorrection && !draft.expected_interpretation.trim() && !draft.expected_response.trim())
          }
        >
          <ClipboardCheck size={17} />{saving ? 'Guardando…' : 'Guardar revisión'}
        </button>
      </footer>
    </section>
  );
}

function BacklogCase({
  item,
  reviewing,
  reviewEvaluation,
  saving,
  onStartReview,
  onCancelReview,
  onSaveReview,
  onOpenLead,
}) {
  const classifications = classificationEntries(item.classification);
  const confidence = Number(item.confidence || 0);

  return (
    <article className="panel backlog-case-card">
      <header className="backlog-case-header">
        <div>
          <div className="backlog-case-title">
            <span className="backlog-aura-icon"><BrainCircuit size={18} /></span>
            <div>
              <h2>{item.business_name || 'Lead no disponible'}</h2>
              <p>{item.setter_name || 'Usuario'} · {formatDate(item.created_at)}</p>
            </div>
          </div>
          <div className="backlog-tags">
            <span className={`backlog-confidence ${confidence >= 80 ? 'high' : confidence >= 60 ? 'medium' : 'low'}`}>
              {confidence}% confianza
            </span>
            <span className={`backlog-status status-${item.review_status || 'pending_review'}`}>
              {reviewStatusLabels[item.review_status] || item.review_status}
            </span>
            {item.evaluation && (
              <span className={`backlog-evaluation evaluation-${item.evaluation}`}>
                {evaluationLabels[item.evaluation]}
              </span>
            )}
          </div>
        </div>
        {item.lead_id && (
          <button type="button" className="button secondary" onClick={() => onOpenLead(item.lead_id)}>
            <ExternalLink size={16} />Abrir ficha
          </button>
        )}
      </header>

      <div className="backlog-case-grid">
        <section>
          <small>MENSAJE DEL LEAD</small>
          <p>{item.lead_message || 'Sin mensaje guardado.'}</p>
          {item.previous_context && (
            <details>
              <summary>Ver contexto anterior</summary>
              <p>{item.previous_context}</p>
            </details>
          )}
        </section>
        <section>
          <small>INTERPRETACIÓN DE AURA</small>
          <p>{item.interpretation || 'Sin interpretación.'}</p>
        </section>
        <section className="backlog-suggested-response">
          <small>RESPUESTA SUGERIDA</small>
          <p>{item.suggested_response || 'Aura no recomendó enviar una respuesta.'}</p>
          <span>{item.suggestion_used ? 'La sugerencia fue copiada' : 'No hay uso registrado'}</span>
        </section>
        <section>
          <small>CLASIFICACIÓN</small>
          <div className="backlog-classification">
            {classifications.length ? classifications.map(([label, value]) => (
              <div key={label}><span>{label}</span><strong>{value}</strong></div>
            )) : <p>Sin clasificación guardada.</p>}
          </div>
        </section>
      </div>

      <div className="backlog-case-footnotes">
        <span><Sparkles size={15} />Regla: <strong>{item.rule_key || 'Sin regla identificada'}</strong></span>
        <span><ShieldCheck size={15} />Playbook: <strong>{item.playbook_version || 'Sin versión'}</strong></span>
        <span><BarChart3 size={15} />Outcome: <strong>{item.outcome || 'Sin outcome'}</strong></span>
      </div>

      <section className={`backlog-result ${item.result_observed_at ? 'observed' : ''}`}>
        <div>
          {item.result_observed_at ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}
          <div>
            <strong>Resultado posterior</strong>
            <p>{item.result_summary || 'Aún no hay una interacción posterior para evaluar el efecto de la sugerencia.'}</p>
          </div>
        </div>
        {item.result_observed_at && <small>{formatDate(item.result_observed_at)}</small>}
      </section>

      {item.problem_type && (
        <section className="backlog-correction-summary">
          <TriangleAlert size={18} />
          <div>
            <strong>{problemTypeLabels[item.problem_type] || item.problem_type}</strong>
            {item.expected_interpretation && <p><b>Debió entender:</b> {item.expected_interpretation}</p>}
            {item.expected_response && <p><b>Debió responder:</b> {item.expected_response}</p>}
          </div>
        </section>
      )}

      {reviewing ? (
        <ReviewForm
          key={`${item.id}-${reviewEvaluation}`}
          item={item}
          evaluation={reviewEvaluation}
          saving={saving}
          onCancel={onCancelReview}
          onSave={onSaveReview}
        />
      ) : (
        <footer className="backlog-case-actions">
          <span>¿Cómo estuvo este análisis?</span>
          <div>
            <button type="button" className="backlog-review-button worked" onClick={() => onStartReview('worked')}>
              <ThumbsUp size={17} />Sirvió
            </button>
            <button type="button" className="backlog-review-button adjust" onClick={() => onStartReview('needs_adjustment')}>
              <PencilLine size={17} />Necesita ajuste
            </button>
            <button type="button" className="backlog-review-button incorrect" onClick={() => onStartReview('incorrect')}>
              <ThumbsDown size={17} />Incorrecta
            </button>
          </div>
        </footer>
      )}
    </article>
  );
}

export default function AuraBacklog() {
  const [data, setData] = useState(null);
  const [config, setConfig] = useState({ statuses: [] });
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [reviewingId, setReviewingId] = useState('');
  const [reviewEvaluation, setReviewEvaluation] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);

  const load = useCallback(async (activeFilters, targetPage = 1, silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(targetPage), page_size: '25' });
      Object.entries(activeFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const [backlog, appConfig] = await Promise.all([
        api(`/api/admin/aura-backlog?${params.toString()}`),
        api('/api/config'),
      ]);
      setData(backlog);
      setConfig(appConfig || { statuses: [] });
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(appliedFilters, page);
  }, [appliedFilters, page, load]);

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setPage(1);
    setAppliedFilters(emptyFilters);
  };

  const startReview = (item, evaluation) => {
    setReviewingId(item.id);
    setReviewEvaluation(evaluation);
  };

  const saveReview = async (item, payload) => {
    setSavingReview(true);
    setError('');
    try {
      await api(`/api/admin/aura-backlog/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setReviewingId('');
      setReviewEvaluation('');
      await load(appliedFilters, page, true);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingReview(false);
    }
  };

  const metrics = data?.metrics || {};
  const profiles = data?.filter_options?.profiles || [];
  const outcomes = data?.filter_options?.outcomes || [];
  const totalPages = Math.max(1, Math.ceil(Number(data?.total || 0) / Number(data?.page_size || 25)));

  return (
    <>
      <PageHeader
        title="Backlog de Aura"
        description="Revisa qué entendió Aura, qué sugirió y qué ocurrió después. Solo administración puede ver y evaluar estos casos."
        actions={(
          <button
            type="button"
            className="button secondary"
            onClick={() => load(appliedFilters, page, true)}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'spin-icon' : ''} />
            {refreshing ? 'Actualizando' : 'Actualizar'}
          </button>
        )}
      />

      <section className="backlog-guardrail">
        <ShieldCheck size={20} />
        <div>
          <strong>Aprendizaje controlado</strong>
          <span>Las revisiones se guardan como evidencia. Aura no aprende sola ni modifica el playbook sin tu aprobación.</span>
        </div>
      </section>

      <section className="metrics-grid backlog-metrics-grid" aria-label="Métricas del Backlog">
        <MetricCard label="Análisis realizados" value={metrics.analyses || 0} note="Casos con estos filtros" icon={BrainCircuit} />
        <MetricCard label="Aprobados" value={metrics.approved || 0} note="Marcados como Sirvió" icon={BadgeCheck} />
        <MetricCard label="Corregidos" value={metrics.corrected || 0} note="Ajuste o respuesta incorrecta" icon={PencilLine} />
        <MetricCard label="Pendientes" value={metrics.pending || 0} note="Aún sin revisar" icon={Clock3} />
        <MetricCard
          label="Precisión de clasificación"
          value={`${metrics.classification_accuracy || 0}%`}
          note={`${metrics.evaluated || 0} casos evaluados`}
          icon={CheckCircle2}
        />
        <MetricCard
          label="Uso de sugerencias"
          value={`${metrics.suggestion_usage_rate || 0}%`}
          note={`${metrics.suggestions_used || 0} de ${metrics.suggestions_total || 0} copiadas`}
          icon={ClipboardCheck}
        />
      </section>

      <section className="panel backlog-filter-panel">
        <header>
          <div><Filter size={18} /><div><strong>Filtros</strong><small>Las métricas y los casos usan la misma selección.</small></div></div>
          <button type="button" className="text-button" onClick={clearFilters}>Limpiar filtros</button>
        </header>
        <div className="backlog-filter-grid">
          <label>Setter
            <select value={filters.setter_id} onChange={(event) => setFilters({ ...filters, setter_id: event.target.value })}>
              <option value="">Todos</option>
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
            </select>
          </label>
          <label>Desde
            <input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
          </label>
          <label>Hasta
            <input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
          </label>
          <label>Outcome
            <select value={filters.outcome} onChange={(event) => setFilters({ ...filters, outcome: event.target.value })}>
              <option value="">Todos</option>
              {outcomes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>Confianza
            <select value={filters.confidence} onChange={(event) => setFilters({ ...filters, confidence: event.target.value })}>
              <option value="">Todas</option>
              {Object.entries(confidenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Estado
            <select value={filters.review_status} onChange={(event) => setFilters({ ...filters, review_status: event.target.value })}>
              <option value="">Todos</option>
              {Object.entries(reviewStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Tipo de problema
            <select value={filters.problem_type} onChange={(event) => setFilters({ ...filters, problem_type: event.target.value })}>
              <option value="">Todos</option>
              {Object.entries(problemTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button type="button" className="button primary" onClick={applyFilters}>Aplicar</button>
        </div>
      </section>

      {error && <div className="form-error page-error">{error}</div>}

      {loading ? (
        <section className="panel backlog-loading">Cargando Backlog de Aura…</section>
      ) : !(data?.items || []).length ? (
        <EmptyState
          title="No hay casos para estos filtros"
          text="Los nuevos análisis aparecerán aquí automáticamente después de instalar el SQL del Backlog."
        />
      ) : (
        <section className="backlog-case-list">
          {(data.items || []).map((item) => (
            <BacklogCase
              key={item.id}
              item={item}
              reviewing={reviewingId === item.id}
              reviewEvaluation={reviewEvaluation}
              saving={savingReview}
              onStartReview={(evaluation) => startReview(item, evaluation)}
              onCancelReview={() => {
                setReviewingId('');
                setReviewEvaluation('');
              }}
              onSaveReview={(payload) => saveReview(item, payload)}
              onOpenLead={setSelectedLead}
            />
          ))}
        </section>
      )}

      {!loading && Number(data?.total || 0) > 0 && (
        <nav className="table-pagination backlog-pagination" aria-label="Paginación del Backlog">
          <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            Anterior
          </button>
          <span>Página {page} de {totalPages} · {data.total} casos</span>
          <button type="button" className="button secondary" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
            Siguiente
          </button>
        </nav>
      )}

      {selectedLead && (
        <LeadDrawer
          leadId={selectedLead}
          statuses={config.statuses || []}
          profiles={profiles}
          onClose={() => setSelectedLead(null)}
          onChanged={() => load(appliedFilters, page, true)}
        />
      )}
    </>
  );
}
