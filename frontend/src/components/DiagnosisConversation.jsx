import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Save, Sparkles } from 'lucide-react';
import { api } from '../lib/api';

const statusLabels = { green: 'Verde · Controlado', yellow: 'Amarillo · Inconsistente', red: 'Rojo · Pérdida probable', gray: 'Gris · Sin evidencia' };
const confidenceLabels = { low: 'Baja', medium: 'Media', high: 'Alta' };
const priorityLabels = { immediate: 'Corregir inmediatamente', '30_days': 'Organizar en 30 días', later: 'Automatizar después', do_not_touch: 'No tocar todavía' };
const blankEvaluation = { finding: '', evidence_summary: '', confidence: 'low', risk: '', commercial_impact: '', priority: '30_days', recommendation: '', requires_validation: true, next_best_question: '', visual_status: 'gray' };

export default function DiagnosisConversation({ diagnosisId, data, onChanged }) {
  const blocks = data?.blocks || [];
  const questions = data?.questions || [];
  const evaluationMap = useMemo(() => Object.fromEntries((data?.evaluations || []).map((item) => [item.block_key, item])), [data?.evaluations]);
  const [openBlock, setOpenBlock] = useState(blocks[0]?.key || 'objective_direction');
  const [answers, setAnswers] = useState({});
  const [evaluations, setEvaluations] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setAnswers(Object.fromEntries(questions.map((item) => [item.id, { answer: item.answer || '', status: item.status || 'pending', evidence_status: item.evidence_status || 'pending', private_note: item.private_note || '' }])));
    setEvaluations(Object.fromEntries(blocks.map((block) => [block.key, { ...blankEvaluation, ...(evaluationMap[block.key] || {}) }])));
  }, [data]);

  const changeAnswer = (id, field, value) => setAnswers((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const changeEvaluation = (key, field, value) => setEvaluations((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));

  const saveBlock = async (block) => {
    setBusy(block.key); setError(''); setMessage('');
    try {
      const blockQuestions = questions.filter((item) => item.block_key === block.key);
      await Promise.all(blockQuestions.map((item) => {
        const draft = answers[item.id] || {};
        const status = draft.evidence_status === 'not_applicable' || draft.status === 'not_applicable' ? 'not_applicable' : String(draft.answer || '').trim() ? 'answered' : 'pending';
        return api(`/api/diagnose/${diagnosisId}/interview-questions/${item.id}`, { method: 'PATCH', body: JSON.stringify({ ...draft, status }) });
      }));
      const evaluation = { ...evaluations[block.key] };
      delete evaluation.id; delete evaluation.diagnosis_id; delete evaluation.block_key; delete evaluation.score_area; delete evaluation.internal_score; delete evaluation.updated_by; delete evaluation.created_at; delete evaluation.updated_at;
      await api(`/api/diagnose/${diagnosisId}/block-evaluations/${block.key}`, { method: 'PUT', body: JSON.stringify(evaluation) });
      setMessage(`${block.title} guardado y evaluado.`);
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  return (
    <section className="diagnosis-section-stack conversation-interview">
      <div className="section-heading"><div><p className="eyebrow">ENTREVISTA CONVERSACIONAL</p><h2>Una conversación guiada, bloque por bloque</h2><p>La respuesta del cliente queda separada de la interpretación de Aura y de tu nota privada.</p></div></div>
      {error && <div className="form-error">{error}</div>}
      {message && <div className="diagnose-success"><CheckCircle2 size={17} />{message}</div>}

      <div className="conversation-block-list">
        {blocks.map((block, index) => {
          const isOpen = openBlock === block.key;
          const blockQuestions = questions.filter((item) => item.block_key === block.key);
          const evaluation = evaluations[block.key] || blankEvaluation;
          const answered = blockQuestions.filter((item) => answers[item.id]?.answer || answers[item.id]?.status === 'not_applicable').length;
          return (
            <article key={block.key} className={`conversation-block ${isOpen ? 'open' : ''}`}>
              <button className="conversation-block-toggle" onClick={() => setOpenBlock(isOpen ? '' : block.key)}>
                <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{block.title}</strong><small>{answered}/{blockQuestions.length} respuestas · {statusLabels[evaluation.visual_status]}</small></div>{isOpen ? <ChevronUp /> : <ChevronDown />}
              </button>
              {isOpen && (
                <div className="conversation-block-body">
                  <div className="conversation-intro"><Sparkles size={18} /><p>{block.intro}</p></div>
                  {blockQuestions.map((question) => {
                    const draft = answers[question.id] || {};
                    return (
                      <section className={`conversation-question ${question.question_type}`} key={question.id}>
                        <header><span>{question.question_type === 'core' ? 'Pregunta núcleo' : question.question_type === 'conditional' ? 'Pregunta complementaria' : 'Generada por Aura'}</span><small>{question.rationale}</small></header>
                        <h3>{question.question}</h3>
                        <label>Respuesta del cliente<textarea rows="4" value={draft.answer || ''} onChange={(e) => changeAnswer(question.id, 'answer', e.target.value)} /></label>
                        <div className="form-grid two">
                          <label>Estado<select value={draft.evidence_status || 'pending'} onChange={(e) => changeAnswer(question.id, 'evidence_status', e.target.value)}><option value="pending">Pendiente</option><option value="answered">Respondida</option><option value="answered_with_evidence">Respondida con evidencia</option><option value="requires_validation">Requiere validación</option><option value="not_applicable">No aplica</option></select></label>
                          <label>Nota privada de Laura<input value={draft.private_note || ''} onChange={(e) => changeAnswer(question.id, 'private_note', e.target.value)} placeholder="No aparece en el informe" /></label>
                        </div>
                      </section>
                    );
                  })}

                  <section className="structured-evaluation">
                    <div className="section-heading"><div><p className="eyebrow">EVALUACIÓN DEL BLOQUE</p><h3>De la respuesta a un diagnóstico verificable</h3></div><span className={`visual-status ${evaluation.visual_status}`}>{statusLabels[evaluation.visual_status]}</span></div>
                    <div className="form-grid three">
                      <label>Estado visual<select value={evaluation.visual_status} onChange={(e) => changeEvaluation(block.key, 'visual_status', e.target.value)}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                      <label>Confianza<select value={evaluation.confidence} onChange={(e) => changeEvaluation(block.key, 'confidence', e.target.value)}>{Object.entries(confidenceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                      <label>Prioridad<select value={evaluation.priority} onChange={(e) => changeEvaluation(block.key, 'priority', e.target.value)}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                    </div>
                    <label>Hallazgo<textarea rows="3" value={evaluation.finding || ''} onChange={(e) => changeEvaluation(block.key, 'finding', e.target.value)} /></label>
                    <label>Evidencia que lo sustenta<textarea rows="3" value={evaluation.evidence_summary || ''} onChange={(e) => changeEvaluation(block.key, 'evidence_summary', e.target.value)} /></label>
                    <div className="form-grid two"><label>Riesgo<textarea rows="3" value={evaluation.risk || ''} onChange={(e) => changeEvaluation(block.key, 'risk', e.target.value)} /></label><label>Impacto comercial<textarea rows="3" value={evaluation.commercial_impact || ''} onChange={(e) => changeEvaluation(block.key, 'commercial_impact', e.target.value)} /></label></div>
                    <label>Recomendación<textarea rows="3" value={evaluation.recommendation || ''} onChange={(e) => changeEvaluation(block.key, 'recommendation', e.target.value)} /></label>
                    <label>Siguiente mejor pregunta<input value={evaluation.next_best_question || ''} onChange={(e) => changeEvaluation(block.key, 'next_best_question', e.target.value)} placeholder="Qué preguntar para cerrar la brecha" /></label>
                    <label className="inline-check"><input type="checkbox" checked={Boolean(evaluation.requires_validation)} onChange={(e) => changeEvaluation(block.key, 'requires_validation', e.target.checked)} />Requiere validación adicional</label>
                    <div className="form-actions"><button className="button diagnose-primary" onClick={() => saveBlock(block)} disabled={busy === block.key}><Save size={17} />{busy === block.key ? 'Guardando…' : 'Guardar bloque'}</button></div>
                  </section>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
