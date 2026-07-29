import { useMemo, useState } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Clock3,
  MessageCircle,
  Send,
} from 'lucide-react';
import { api } from '../lib/api';
import FollowupDateField from './FollowupDateField';
import OutcomeSelect, { useOutcomes } from './OutcomeSelect';

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
    followup_date: '',
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

export default function ContactComposer({
  initialChannel = 'Llamada',
  initialMode = 'action',
  saving = false,
  onSubmit,
  onCancel,
  submitLabel,
}) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState(() => initialForm(initialMode, initialChannel));
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  const { items: outcomes, loading: outcomesLoading, error: outcomesError } = useOutcomes(mode === 'action' ? 'action' : 'response');

  const setModeAndReset = (nextMode) => {
    setMode(nextMode);
    setForm(initialForm(nextMode, form.channel || initialChannel));
    setAnalysis(null);
    setError('');
  };

  const update = (changes) => setForm((current) => ({ ...current, ...changes }));

  const changeChannel = (channel) => {
    update({
      channel,
      activity_type: mode === 'action' ? activityForChannel(channel) : 'response_received',
    });
  };

  const applyOutcome = (item) => {
    if (!item) {
      update({ outcome_id: '', outcome: '' });
      return;
    }
    const changes = {
      outcome_id: item.id,
      outcome: item.name,
    };
    if (item.recommended_conversation_status) {
      changes.conversation_status = item.recommended_conversation_status;
    }
    if (!form.followup_date && item.followup_delay_days !== null && item.followup_delay_days !== undefined) {
      changes.followup_date = localISODate(Number(item.followup_delay_days));
    }
    if (!form.next_step && item.recommended_next_step) {
      changes.next_step = item.recommended_next_step;
    }
    update(changes);
  };

  const analyze = async () => {
    if (!form.transcript.trim()) {
      setError('Pega la respuesta o un resumen de la conversación antes de analizar.');
      return;
    }
    setAnalyzing(true);
    setError('');
    try {
      const result = await api('/api/chat-analysis', {
        method: 'POST',
        body: JSON.stringify({ transcript: form.transcript, channel: form.channel }),
      });
      setAnalysis(result);
      const suggestion = result.suggestion || {};
      const matchedOutcome = outcomes.find((item) => item.id === suggestion.outcome_id)
        || outcomes.find((item) => item.name === suggestion.outcome);
      update({
        ...suggestion,
        outcome_id: matchedOutcome?.id || suggestion.outcome_id || form.outcome_id,
        outcome: matchedOutcome?.name || suggestion.outcome || form.outcome,
        channel: suggestion.channel || form.channel,
        transcript: form.transcript,
        analysis: result,
        followup_date: suggestion.followup_date || form.followup_date,
        next_step: suggestion.next_step || form.next_step,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const valid = useMemo(() => {
    const hasOutcome = Boolean(form.outcome_id || form.outcome);
    if (mode === 'action') return Boolean(form.channel && form.conversation_status && hasOutcome);
    return Boolean(form.channel && form.conversation_status && hasOutcome && form.next_step.trim());
  }, [form, mode]);

  const submit = () => {
    if (!valid || saving) return;
    onSubmit({
      ...form,
      followup_date: form.followup_date || null,
      sale_amount: form.sale_amount === '' ? null : Number(form.sale_amount),
      awaiting_response: ['waiting_response', 'waiting_confirmation', 'waiting_decision_maker'].includes(form.conversation_status),
    });
  };

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
            <p>Pega la respuesta o resume la conversación. Aura propone; tú confirmas.</p>
          </div>
        </div>
      )}

      {(error || outcomesError) && <div className="form-error">{error || outcomesError}</div>}

      <section className="contact-essential-fields" aria-label="Campos principales">
        <div className="form-grid two contact-primary-grid">
          <label>Canal
            <select value={form.channel} onChange={(e) => changeChannel(e.target.value)}>
              {['Llamada', 'WhatsApp', 'Instagram', 'Email', 'Otro'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Estado de conversación
            <select value={form.conversation_status} onChange={(e) => update({ conversation_status: e.target.value })}>
              {conversationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        {mode === 'response' && (
          <>
            <label>Respuesta, conversación o resumen
              <textarea
                rows="6"
                value={form.transcript}
                onChange={(e) => update({ transcript: e.target.value })}
                placeholder="Pega los mensajes importantes o resume lo ocurrido."
              />
            </label>
            <button type="button" className="button secondary analyze-chat-button mobile-large-button" onClick={analyze} disabled={analyzing || !form.transcript.trim()}>
              <BrainCircuit size={18} />{analyzing ? 'Analizando…' : 'Analizar con Aura'}
            </button>
          </>
        )}

        {analysis && (
          <section className="chat-analysis-card">
            <header>
              <div><small>ANÁLISIS PROPUESTO</small><strong>{analysis.summary}</strong></div>
              <span>{analysis.confidence}% confianza</span>
            </header>
            {!!analysis.signals?.length && (
              <div className="chat-signal-list">
                {analysis.signals.map((signal) => (
                  <article key={signal.key}>
                    <strong>{signal.label}</strong>
                    <p>{signal.evidence}</p>
                  </article>
                ))}
              </div>
            )}
            <p className="muted">{analysis.warning}</p>
          </section>
        )}

        <div className="form-grid two contact-decision-grid">
          <OutcomeSelect
            outcomes={outcomes}
            value={form.outcome_id}
            fallbackName={form.outcome}
            onChange={applyOutcome}
            disabled={outcomesLoading}
            label="Outcome · qué pasó"
          />
          <FollowupDateField value={form.followup_date} onChange={(value) => update({ followup_date: value })} />
        </div>

        {mode === 'response' && (
          <label>Próximo paso · qué hacemos ahora
            <input required value={form.next_step} onChange={(e) => update({ next_step: e.target.value })} placeholder="Ej. enviar información y llamar mañana" />
          </label>
        )}
      </section>

      <details className="advanced-options contact-more-options">
        <summary><ChevronDown size={17} />Más opciones</summary>
        <div className="advanced-options-body">
          {mode === 'action' ? (
            <label>Nota breve
              <textarea rows="3" value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Información útil para retomar el contacto" />
            </label>
          ) : (
            <>
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

      <div className="contact-composer-actions field-work-savebar">
        {onCancel && <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>}
        <button type="button" className="button primary" onClick={submit} disabled={!valid || saving}>
          {mode === 'action' ? <Send size={18} /> : <CheckCircle2 size={18} />}
          {saving ? 'Guardando…' : submitLabel || 'Guardar y continuar'}
        </button>
      </div>
    </div>
  );
}
