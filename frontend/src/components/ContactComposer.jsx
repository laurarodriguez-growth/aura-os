import { useMemo, useState } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  Clock3,
  MessageCircle,
  PhoneCall,
  Send,
} from 'lucide-react';
import { api } from '../lib/api';

const conversationOptions = [
  ['waiting_response', 'Esperando respuesta'],
  ['response_received', 'Respuesta recibida'],
  ['conversation_active', 'Conversación activa'],
  ['waiting_decision_maker', 'Esperando al decisor'],
  ['waiting_confirmation', 'Esperando confirmación'],
  ['followup_scheduled', 'Seguimiento programado'],
  ['closed', 'Conversación cerrada'],
];

const outcomeOptions = [
  'Pendiente',
  'No respondió',
  'Buzón de voz',
  'Recepción',
  'Respondió',
  'Contacto con intermediario',
  'Solicitó información',
  'Objeción identificada',
  'Esperando confirmación',
  'Seguimiento solicitado',
  'Interesado',
  'Reunión agendada',
  'No interesado',
  'No califica',
  'Número incorrecto',
  'Venta',
];

function activityForChannel(channel) {
  if (channel === 'Llamada') return 'call_made';
  if (channel === 'Email') return 'email_sent';
  return 'message_sent';
}

function initialForm(mode, channel) {
  if (mode === 'response') {
    return {
      channel,
      direction: 'Entrante',
      activity_type: 'response_received',
      conversation_status: 'response_received',
      outcome_stage: 'provisional',
      outcome: 'Respondió',
      objection: '',
      notes: '',
      next_step: '',
      followup_date: '',
      appointment_booked: false,
      sale_amount: '',
      transcript: '',
      analysis: {},
      awaiting_response: false,
      is_final_outcome: false,
    };
  }
  return {
    channel,
    direction: 'Saliente',
    activity_type: activityForChannel(channel),
    conversation_status: 'waiting_response',
    outcome_stage: 'pending',
    outcome: 'Pendiente',
    objection: '',
    notes: '',
    next_step: '',
    followup_date: '',
    appointment_booked: false,
    sale_amount: '',
    transcript: '',
    analysis: {},
    awaiting_response: true,
    is_final_outcome: false,
  };
}

export const conversationLabel = (value) => (
  conversationOptions.find(([key]) => key === value)?.[1] || value || 'No iniciada'
);

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
      update({
        ...suggestion,
        channel: suggestion.channel || form.channel,
        transcript: form.transcript,
        analysis: result,
        followup_date: suggestion.followup_date || form.followup_date,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const valid = useMemo(() => {
    if (mode === 'action') return Boolean(form.channel && form.conversation_status);
    return Boolean(form.channel && form.outcome && form.conversation_status && form.outcome_stage);
  }, [form, mode]);

  const submit = () => {
    if (!valid || saving) return;
    const finalOutcome = form.outcome_stage === 'final' || form.is_final_outcome;
    onSubmit({
      ...form,
      followup_date: form.followup_date || null,
      sale_amount: form.sale_amount === '' ? null : Number(form.sale_amount),
      is_final_outcome: finalOutcome,
      awaiting_response: form.conversation_status === 'waiting_response'
        || form.conversation_status === 'waiting_confirmation'
        || form.conversation_status === 'waiting_decision_maker',
    });
  };

  return (
    <div className="contact-composer">
      <div className="contact-mode-switch" role="tablist" aria-label="Tipo de registro">
        <button type="button" className={mode === 'action' ? 'active' : ''} onClick={() => setModeAndReset('action')}>
          <Send size={16} />Registrar acción
        </button>
        <button type="button" className={mode === 'response' ? 'active' : ''} onClick={() => setModeAndReset('response')}>
          <MessageCircle size={16} />Registrar respuesta
        </button>
      </div>

      {mode === 'action' ? (
        <div className="contact-composer-intro action">
          <span><Clock3 size={18} /></span>
          <div>
            <strong>Guarda la acción y sigue trabajando.</strong>
            <p>El lead queda esperando respuesta. El outcome no se considera final.</p>
          </div>
        </div>
      ) : (
        <div className="contact-composer-intro response">
          <span><BrainCircuit size={18} /></span>
          <div>
            <strong>Pega la respuesta o resume lo ocurrido.</strong>
            <p>Aura propondrá intención, objeción y próximo paso. Tú confirmas antes de guardar.</p>
          </div>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      <div className="form-grid two">
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

      {mode === 'action' && (
        <>
          <div className="form-grid two">
            <label>Resultado provisional
              <select value={form.outcome} onChange={(e) => update({ outcome: e.target.value })}>
                {['Pendiente', 'No respondió', 'Buzón de voz', 'Recepción'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Próximo seguimiento opcional
              <input type="date" value={form.followup_date} onChange={(e) => update({ followup_date: e.target.value })} />
            </label>
          </div>
          <label>Nota breve opcional
            <textarea rows="3" value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Ej. mensaje inicial enviado; esperar respuesta hasta mañana" />
          </label>
        </>
      )}

      {mode === 'response' && (
        <>
          <label>Respuesta, conversación o resumen
            <textarea
              rows="7"
              value={form.transcript}
              onChange={(e) => update({ transcript: e.target.value })}
              placeholder="Pega los mensajes importantes o escribe un resumen. No es necesario exportar el chat completo."
            />
          </label>
          <button type="button" className="button secondary analyze-chat-button" onClick={analyze} disabled={analyzing || !form.transcript.trim()}>
            <BrainCircuit size={17} />{analyzing ? 'Analizando…' : 'Analizar con Aura'}
          </button>

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

          <div className="form-grid two">
            <label>Outcome
              <select value={form.outcome} onChange={(e) => update({ outcome: e.target.value })}>
                {outcomeOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Madurez del outcome
              <select value={form.outcome_stage} onChange={(e) => update({ outcome_stage: e.target.value, is_final_outcome: e.target.value === 'final' })}>
                <option value="provisional">Provisional · la conversación continúa</option>
                <option value="final">Final · la oportunidad terminó</option>
              </select>
            </label>
            <label>Objeción
              <input value={form.objection} onChange={(e) => update({ objection: e.target.value })} placeholder="Ej. presupuesto, decisor, tiempo" />
            </label>
            <label>Próximo seguimiento
              <input type="date" value={form.followup_date} onChange={(e) => update({ followup_date: e.target.value })} />
            </label>
          </div>
          <label>Próximo paso
            <input value={form.next_step} onChange={(e) => update({ next_step: e.target.value })} placeholder="Ej. enviar diagnóstico y llamar el jueves" />
          </label>
          <label>Notas internas
            <textarea rows="3" value={form.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Contexto que no debe perderse" />
          </label>
          <div className="contact-commercial-fields">
            <label className="check-row"><input type="checkbox" checked={form.appointment_booked} onChange={(e) => update({ appointment_booked: e.target.checked })} />Reunión agendada</label>
            <label>Monto de venta<input type="number" min="0" step="0.01" value={form.sale_amount} onChange={(e) => update({ sale_amount: e.target.value })} placeholder="0.00" /></label>
          </div>
        </>
      )}

      <div className="contact-composer-actions">
        {onCancel && <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>}
        <button type="button" className="button primary" onClick={submit} disabled={!valid || saving}>
          {mode === 'action' ? <Send size={17} /> : <CheckCircle2 size={17} />}
          {saving ? 'Guardando…' : submitLabel || (mode === 'action' ? 'Guardar acción y continuar' : 'Guardar respuesta y continuar')}
        </button>
      </div>
    </div>
  );
}
