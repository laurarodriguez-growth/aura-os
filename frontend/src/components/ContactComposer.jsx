import { useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  Copy,
  Lightbulb,
  ChevronDown,
  Clock3,
  FileText,
  MessageCircle,
  Send,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { analyzeChatLocally } from '../lib/chatResponseLibrary';
import FollowupDateField from './FollowupDateField';
import OutcomeSelect, { useOutcomes } from './OutcomeSelect';

const MAX_TRANSCRIPT_CHARACTERS = 50000;
const MAX_TXT_BYTES = 5 * 1024 * 1024;

const conversationOptions = [
  ['waiting_response', 'Esperando respuesta'],
  ['response_received', 'Respuesta recibida'],
  ['conversation_active', 'Conversación activa'],
  ['waiting_decision_maker', 'Esperando al decisor'],
  ['waiting_confirmation', 'Esperando confirmación'],
  ['followup_scheduled', 'Seguimiento programado'],
  ['closed', 'Conversación cerrada'],
];

function activityForChannel(channel) {
  if (channel === 'Llamada') return 'call_made';
  if (channel === 'Email') return 'email_sent';
  return 'message_sent';
}

function localISODate(daysFromToday = 0) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialForm(mode, channel) {
  if (mode === 'response') {
    return {
      channel,
      direction: 'Entrante',
      activity_type: 'response_received',
      conversation_status: 'response_received',
      outcome: 'Respondió',
      outcome_id: '',
      objection: '',
      notes: '',
      next_step: '',
      followup_date: '',
      appointment_booked: false,
      sale_amount: '',
      transcript: '',
      analysis: {},
      awaiting_response: false,
    };
  }
  return {
    channel,
    direction: 'Saliente',
    activity_type: activityForChannel(channel),
    conversation_status: 'waiting_response',
    outcome: 'Pendiente',
    outcome_id: '',
    objection: '',
    notes: '',
    next_step: '',
    followup_date: localISODate(1),
    appointment_booked: false,
    sale_amount: '',
    transcript: '',
    analysis: {},
    awaiting_response: true,
  };
}

export const conversationLabel = (value) => (
  conversationOptions.find(([key]) => key === value)?.[1] || value || 'No iniciada'
);

// Se conserva para compatibilidad con datos históricos, pero la madurez ya no se pide al usuario.
export const outcomeStageLabel = (value) => ({
  pending: 'Pendiente',
  provisional: 'Provisional',
  final: 'Final',
}[value] || value || 'Pendiente');

function formatFollowupDate(value) {
  if (!value) return 'No requiere seguimiento';
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('es-PA', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function analysisStrength(result) {
  const signalCount = Array.isArray(result?.signals) ? result.signals.length : 0;
  const outcome = String(result?.suggestion?.outcome || result?.classification?.outcome || '').trim();
  const isGeneric = !outcome || ['Respondió', 'Pendiente'].includes(outcome);
  return (signalCount > 0 ? 1000 : 0) + (!isGeneric ? 200 : 0) + Number(result?.confidence || 0);
}

function mergeAnalysisResults(remoteResult, localResult) {
  const remote = remoteResult || {};
  const local = localResult || {};
  const localWins = analysisStrength(local) > analysisStrength(remote);
  const primary = localWins ? local : remote;
  const secondary = localWins ? remote : local;
  const complete = {
    ...secondary,
    ...primary,
    recommended_reply: primary.recommended_reply || secondary.recommended_reply || '',
    reasoning: primary.reasoning || secondary.reasoning || '',
    signals: primary.signals?.length ? primary.signals : (secondary.signals || []),
    classification: primary.classification || secondary.classification || {},
    suggestion: { ...(secondary.suggestion || {}), ...(primary.suggestion || {}) },
    warning: primary.warning || secondary.warning || 'Respuesta sugerida por Aura. Revísala antes de enviarla.',
  };

  // Una clasificación de cierre nunca debe quedar acompañada por una pregunta de prospección.
  const isClosed = complete.suggestion?.conversation_status === 'closed' || complete.suggestion?.is_final_outcome;
  const localIsSameOutcome = local.suggestion?.outcome && local.suggestion.outcome === complete.suggestion?.outcome;
  if (isClosed && localIsSameOutcome && local.recommended_reply) {
    complete.recommended_reply = local.recommended_reply;
    complete.reasoning = local.reasoning || complete.reasoning;
  }
  return complete;
}

export default function ContactComposer({
  initialChannel = 'Llamada',
  initialMode = 'action',
  saving = false,
  onSubmit,
  onCancel,
  submitLabel,
}) {
  const { profile } = useAuth();
  const setterName = String(profile?.full_name || '').trim() || 'Growth by Laura';
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState(() => initialForm(initialMode, initialChannel));
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisApplied, setAnalysisApplied] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);
  const [error, setError] = useState('');
  const [fileNotice, setFileNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [importedFile, setImportedFile] = useState(null);
  const fileInputRef = useRef(null);
  const {
    items: outcomes,
    loading: outcomesLoading,
    error: outcomesError,
    usingLocalFallback,
  } = useOutcomes(mode === 'action' ? 'action' : 'response');

  const setModeAndReset = (nextMode) => {
    setMode(nextMode);
    setForm(initialForm(nextMode, form.channel || initialChannel));
    setAnalysis(null);
    setAnalysisApplied(false);
    setCopiedReply(false);
    setError('');
    setFileNotice('');
    setSubmitError('');
    setImportedFile(null);
  };

  const update = (changes) => {
    setSubmitError('');
    setForm((current) => ({ ...current, ...changes }));
  };

  const changeChannel = (channel) => {
    update({
      channel,
      activity_type: mode === 'action' ? activityForChannel(channel) : 'response_received',
    });
  };

  const changeTranscript = (transcript) => {
    setForm((current) => ({
      ...current,
      transcript,
      analysis: {},
      conversation_status: 'response_received',
      outcome: 'Respondió',
      outcome_id: '',
      commercial_status: '',
      objection: '',
      next_step: '',
      followup_date: '',
      appointment_booked: false,
    }));
    setAnalysis(null);
    setAnalysisApplied(false);
    setCopiedReply(false);
    setSubmitError('');
  };

  const applyOutcome = (item) => {
    if (!item) {
      update({ outcome_id: '', outcome: '' });
      return;
    }
    const changes = {
      outcome_id: item.is_local_fallback ? '' : item.id,
      outcome: item.name,
    };
    if (item.recommended_conversation_status) {
      changes.conversation_status = item.recommended_conversation_status;
    }
    if (item.recommended_commercial_status) {
      changes.commercial_status = item.recommended_commercial_status;
    }
    if (!form.followup_date && item.followup_delay_days !== null && item.followup_delay_days !== undefined) {
      changes.followup_date = localISODate(Number(item.followup_delay_days));
    }
    if (!form.next_step && item.recommended_next_step) {
      changes.next_step = item.recommended_next_step;
    }
    update(changes);
  };

  const outcomeKey = (value) => String(value || '').trim().toLocaleLowerCase('es');

  const classificationChangesFor = (result, currentForm) => {
    const suggestion = result?.suggestion || {};
    const matchedOutcome = outcomes.find((item) => item.id === suggestion.outcome_id)
      || outcomes.find((item) => outcomeKey(item.name) === outcomeKey(suggestion.outcome));
    const changes = {
      ...suggestion,
      outcome_id: matchedOutcome?.is_local_fallback
        ? ''
        : (matchedOutcome?.id || suggestion.outcome_id || currentForm.outcome_id),
      outcome: matchedOutcome?.name || suggestion.outcome || currentForm.outcome,
      channel: suggestion.channel || currentForm.channel,
      transcript: currentForm.transcript,
      analysis: result,
      followup_date: suggestion.followup_date || currentForm.followup_date,
      next_step: suggestion.next_step || matchedOutcome?.recommended_next_step || currentForm.next_step,
    };
    if (matchedOutcome?.recommended_conversation_status && !suggestion.conversation_status) {
      changes.conversation_status = matchedOutcome.recommended_conversation_status;
    }
    if (!changes.followup_date && matchedOutcome?.followup_delay_days !== null && matchedOutcome?.followup_delay_days !== undefined) {
      changes.followup_date = localISODate(Number(matchedOutcome.followup_delay_days));
    }
    return changes;
  };

  const storeAnalysisResult = (result) => {
    const localGuidance = analyzeChatLocally(form.transcript, form.channel, { setterName });
    const completeResult = mergeAnalysisResults(result, localGuidance);
    setAnalysis(completeResult);
    setAnalysisApplied(true);
    setCopiedReply(false);
    setForm((current) => ({ ...current, ...classificationChangesFor(completeResult, current) }));
  };

  const copyRecommendedReply = async () => {
    const reply = analysis?.recommended_reply?.trim();
    if (!reply) return;
    try {
      await copyToClipboard(reply);
      setCopiedReply(true);
      window.setTimeout(() => setCopiedReply(false), 2200);
    } catch (_) {
      setError('No pude copiar automáticamente. Mantén presionado el texto para copiarlo.');
    }
  };

  const analyze = async () => {
    if (!form.transcript.trim()) {
      setError('Pega una respuesta, un resumen o sube el TXT del chat antes de analizar.');
      return;
    }
    setAnalyzing(true);
    setError('');
    try {
      const result = await api('/api/chat-analysis', {
        method: 'POST',
        body: JSON.stringify({ transcript: form.transcript, channel: form.channel }),
      });
      storeAnalysisResult(result);
    } catch (_) {
      storeAnalysisResult(analyzeChatLocally(form.transcript, form.channel, { setterName }));
    } finally {
      setAnalyzing(false);
    }
  };

  const importTranscriptFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setFileNotice('');
    setAnalysis(null);
    setAnalysisApplied(false);
    setCopiedReply(false);

    const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
    if (!isTxt) {
      setError('Sube el archivo .txt exportado del chat.');
      return;
    }
    if (file.size > MAX_TXT_BYTES) {
      setError('El TXT supera 5 MB. Exporta solo la conversación necesaria o divide el archivo.');
      return;
    }

    try {
      const rawText = await file.text();
      if (!rawText.trim()) {
        setError('El archivo TXT está vacío.');
        return;
      }
      const wasTrimmed = rawText.length > MAX_TRANSCRIPT_CHARACTERS;
      const transcript = wasTrimmed
        ? rawText.slice(-MAX_TRANSCRIPT_CHARACTERS)
        : rawText;
      changeTranscript(transcript);
      changeChannel('WhatsApp');
      setImportedFile({ name: file.name, characters: transcript.length });
      setFileNotice(wasTrimmed
        ? 'El archivo era muy largo. Aura cargó los últimos 50,000 caracteres, donde normalmente está la conversación más reciente.'
        : 'Chat cargado. Ya puedes analizarlo con Aura.');
    } catch (_) {
      setError('No pude leer ese TXT. Vuelve a exportarlo como archivo de texto e inténtalo otra vez.');
    }
  };

  const removeImportedFile = () => {
    setImportedFile(null);
    setFileNotice('');
    setAnalysis(null);
    setAnalysisApplied(false);
    setCopiedReply(false);
    changeTranscript('');
  };

  const valid = useMemo(() => {
    const hasOutcome = Boolean(form.outcome_id || form.outcome);
    if (mode === 'action') return Boolean(form.channel && form.conversation_status && hasOutcome);
    return Boolean(form.channel && form.conversation_status && hasOutcome && form.next_step.trim());
  }, [form, mode]);

  const submit = async () => {
    if (!valid || saving || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onSubmit({
        ...form,
        outcome_id: form.outcome_id || null,
        followup_date: form.followup_date || null,
        sale_amount: form.sale_amount === '' ? null : Number(form.sale_amount),
        awaiting_response: ['waiting_response', 'waiting_confirmation', 'waiting_decision_maker'].includes(form.conversation_status),
      });
    } catch (submitFailure) {
      setSubmitError(submitFailure?.message || 'No se pudo guardar la interacción. Inténtalo nuevamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const analysisClassification = analysis ? {
    commercialStatus: form.commercial_status || analysis.classification?.commercial_status || analysis.suggestion?.commercial_status || 'Sin cambio sugerido',
    conversationStatus: form.conversation_status || analysis.classification?.conversation_status || analysis.suggestion?.conversation_status || 'response_received',
    conversationStatusLabel: conversationLabel(
      form.conversation_status || analysis.classification?.conversation_status || analysis.suggestion?.conversation_status,
    ),
    outcome: form.outcome || analysis.classification?.outcome || analysis.suggestion?.outcome || 'Respondió',
    followupDate: form.followup_date || analysis.classification?.followup_date || analysis.suggestion?.followup_date || null,
    nextStep: form.next_step || analysis.classification?.next_step || analysis.suggestion?.next_step || '',
  } : null;

  return (
    <div className="contact-composer">
      <div className="contact-mode-switch" role="tablist" aria-label="Tipo de registro">
        <button type="button" className={mode === 'action' ? 'active' : ''} onClick={() => setModeAndReset('action')}>
          <Send size={18} />Registrar acción
        </button>
        <button type="button" className={mode === 'response' ? 'active' : ''} onClick={() => setModeAndReset('response')}>
          <MessageCircle size={18} />Registrar respuesta
        </button>
      </div>

      {mode === 'action' ? (
        <div className="contact-composer-intro action">
          <span><Clock3 size={18} /></span>
          <div>
            <strong>Guarda la acción y sigue con el siguiente lead.</strong>
            <p>Aura mantendrá la conversación abierta, organizará el seguimiento y te dejará continuar con el siguiente lead.</p>
          </div>
        </div>
      ) : (
        <div className="contact-composer-intro response">
          <span><BrainCircuit size={18} /></span>
          <div>
            <strong>Registra qué pasó y qué sigue.</strong>
            <p>Pega la respuesta, resume la conversación o sube el TXT exportado del chat.</p>
          </div>
        </div>
      )}

      {(error || outcomesError) && <div className="form-error">{error || outcomesError}</div>}
      {usingLocalFallback && (
        <div className="form-notice compact">Aura cargó la biblioteca de respaldo y seguirá clasificando automáticamente.</div>
      )}

      <section className="contact-essential-fields" aria-label="Campos principales">
        <div className="contact-automatic-bar">
          <label>Canal
            <select value={form.channel} onChange={(e) => changeChannel(e.target.value)}>
              {['Llamada', 'WhatsApp', 'Instagram', 'Email', 'Otro'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <div className="automatic-classification-note">
            <CheckCircle2 size={18} />
            <div>
              <strong>Clasificación automática</strong>
              <small>{mode === 'response' ? `Aura personalizará la respuesta con ${setterName} y completará estado, outcome y próximo paso.` : 'Aura registrará la acción y organizará el seguimiento.'}</small>
            </div>
          </div>
        </div>

        {mode === 'response' && (
          <>
            <div className="chat-import-row">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,text/plain"
                onChange={importTranscriptFile}
                hidden
              />
              <button
                type="button"
                className="button secondary chat-upload-button mobile-large-button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={18} />Subir TXT del chat
              </button>
              <small>Compatible con el TXT exportado de WhatsApp.</small>
            </div>

            {importedFile && (
              <div className="chat-file-chip">
                <FileText size={18} />
                <span><strong>{importedFile.name}</strong><small>{importedFile.characters.toLocaleString()} caracteres cargados</small></span>
                <button type="button" onClick={removeImportedFile} aria-label="Quitar archivo"><X size={17} /></button>
              </div>
            )}
            {fileNotice && <div className="form-notice compact">{fileNotice}</div>}

            <label>Respuesta, conversación o resumen
              <textarea
                rows="6"
                value={form.transcript}
                onChange={(e) => changeTranscript(e.target.value)}
                placeholder="Pega los mensajes importantes, resume lo ocurrido o sube el TXT del chat."
              />
            </label>
            <button type="button" className="button secondary analyze-chat-button mobile-large-button" onClick={analyze} disabled={analyzing || !form.transcript.trim()}>
              <BrainCircuit size={18} />{analyzing ? 'Analizando…' : 'Analizar con Aura'}
            </button>
          </>
        )}

        {analysis && analysisClassification && (
          <section className="chat-analysis-card aura-guidance-card" aria-label="Análisis de Aura">
            <header className="aura-guidance-header">
              <div>
                <small>ANÁLISIS DE AURA</small>
                <strong>Qué pasó, qué responder y cómo quedará el lead</strong>
              </div>
              <span>{analysis.confidence}% confianza</span>
            </header>

            <div className="aura-guidance-section">
              <div className="aura-guidance-number">1</div>
              <div className="aura-guidance-content">
                <h4>Qué pasó</h4>
                <p>{analysis.summary}</p>
                {!!analysis.signals?.length && (
                  <details className="aura-evidence-details">
                    <summary>Ver evidencia detectada</summary>
                    <div className="chat-signal-list">
                      {analysis.signals.map((signal) => (
                        <article key={signal.key}>
                          <strong>{signal.label}</strong>
                          <p>{signal.evidence}</p>
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>

            <div className="aura-guidance-section reply-section">
              <div className="aura-guidance-number">2</div>
              <div className="aura-guidance-content">
                <h4>Qué responder</h4>
                <div className="aura-recommended-reply">
                  <p>{analysis.recommended_reply || 'Aura no recomienda enviar un mensaje en este caso.'}</p>
                  {!!analysis.recommended_reply && (
                    <button type="button" className="button secondary aura-copy-button" onClick={copyRecommendedReply}>
                      {copiedReply ? <CheckCircle2 size={17} /> : <Copy size={17} />}
                      {copiedReply ? 'Respuesta copiada' : 'Copiar respuesta'}
                    </button>
                  )}
                </div>
                <small className="aura-review-note">Respuesta sugerida por Aura. Revísala antes de enviarla.</small>
              </div>
            </div>

            <div className="aura-guidance-section classification-section">
              <div className="aura-guidance-number">3</div>
              <div className="aura-guidance-content">
                <h4>Clasificación automática</h4>
                <div className="aura-classification-grid">
                  <div><small>Estado comercial</small><strong>{analysisClassification.commercialStatus}</strong></div>
                  <div><small>Estado de conversación</small><strong>{analysisClassification.conversationStatusLabel}</strong></div>
                  <div><small>Outcome</small><strong>{analysisClassification.outcome}</strong></div>
                  <div><small>Próximo seguimiento</small><strong>{formatFollowupDate(analysisClassification.followupDate)}</strong></div>
                  <div className="aura-next-step"><small>Próximo paso</small><strong>{analysisClassification.nextStep || 'Definir manualmente'}</strong></div>
                </div>
                <div className="aura-auto-applied" role="status">
                  <CheckCircle2 size={17} />
                  <span>{analysisApplied ? 'Clasificación aplicada automáticamente' : 'Preparando clasificación automática'}</span>
                </div>
              </div>
            </div>

            <div className="aura-guidance-section why-section">
              <div className="aura-guidance-number">4</div>
              <div className="aura-guidance-content">
                <h4>Por qué</h4>
                <div className="aura-reasoning"><Lightbulb size={18} /><p>{analysis.reasoning || 'Aura basó la recomendación en las señales detectadas en la conversación.'}</p></div>
              </div>
            </div>

            <p className="aura-analysis-warning">{analysis.warning}</p>
          </section>
        )}

        {mode === 'action' && (
          <FollowupDateField
            value={form.followup_date}
            onChange={(value) => update({ followup_date: value })}
            label="Próximo seguimiento"
          />
        )}
      </section>

      {(mode === 'action' || analysis) && (
        <details className="advanced-options contact-more-options">
          <summary><ChevronDown size={17} />Ajustar manualmente</summary>
          <div className="advanced-options-body">
          <div className="form-grid two manual-classification-grid">
            <label>Estado de conversación
              <select value={form.conversation_status} onChange={(e) => update({ conversation_status: e.target.value })}>
                {conversationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <OutcomeSelect
              outcomes={outcomes}
              value={form.outcome_id}
              fallbackName={form.outcome}
              onChange={applyOutcome}
              disabled={outcomesLoading}
              label="Corregir outcome"
            />
          </div>
          {mode === 'action' ? (
            <label>Nota breve
              <textarea rows="3" value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Información útil para retomar el contacto" />
            </label>
          ) : (
            <>
              <FollowupDateField
                value={form.followup_date}
                onChange={(value) => update({ followup_date: value })}
                label="Corregir próximo seguimiento"
              />
              <label>Próximo paso
                <input required value={form.next_step} onChange={(e) => update({ next_step: e.target.value })} placeholder="Ej. enviar información y llamar hoy" />
              </label>
              <div className="form-grid two">
                <label>Objeción
                  <input value={form.objection} onChange={(e) => update({ objection: e.target.value })} placeholder="Ej. presupuesto, decisor, tiempo" />
                </label>
                <label>Notas internas
                  <input value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Contexto que no debe perderse" />
                </label>
              </div>
              <div className="contact-commercial-fields">
                <label className="check-row"><input type="checkbox" checked={form.appointment_booked} onChange={(e) => update({ appointment_booked: e.target.checked })} />Reunión agendada</label>
                <label>Monto de venta<input type="number" min="0" step="0.01" value={form.sale_amount} onChange={(e) => update({ sale_amount: e.target.value })} placeholder="0.00" /></label>
              </div>
            </>
          )}
          </div>
        </details>
      )}

      {submitError && <div className="form-error contact-save-error" role="alert">{submitError}</div>}
      <div className="contact-composer-actions field-work-savebar">
        {onCancel && <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>}
        <button type="button" className="button primary" onClick={submit} disabled={!valid || saving || submitting}>
          {mode === 'action' ? <Send size={18} /> : <CheckCircle2 size={18} />}
          {(saving || submitting) ? 'Guardando…' : submitLabel || 'Guardar y continuar'}
        </button>
      </div>
    </div>
  );
}
