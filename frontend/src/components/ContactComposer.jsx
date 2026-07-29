import { useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  Copy,
  Lightbulb,
  ListChecks,
  ChevronDown,
  Clock3,
  FileText,
  MessageCircle,
  Send,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
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

function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function evidenceLine(transcript, regex) {
  return transcript.split(/\r?\n/).find((line) => regex.test(normalizeText(line)))?.trim().slice(0, 220)
    || transcript.trim().slice(0, 220);
}

function localFollowupDate(normalized) {
  if (/\bmanana\b/.test(normalized)) return localISODate(1);
  if (/\b(en|dentro de) 3 dias\b/.test(normalized)) return localISODate(3);
  if (/\b(en|dentro de) 7 dias\b|\bproxima semana\b/.test(normalized)) return localISODate(7);
  return null;
}

function localChatAnalysis(transcript) {
  const normalized = normalizeText(transcript);
  const detectedFollowupDate = localFollowupDate(normalized);
  const rules = [
    {
      key: 'do_not_contact',
      label: 'Solicitud expresa de no contacto',
      pattern: /\b(no me escriban|no me escribas|no nos contacten|no volver a contactar|no llamar|no llames|no contactes|eliminar mi numero)\b/,
      outcome: 'No contactar',
      status: 'closed',
      commercialStatus: 'Descartado',
      nextStep: 'No insistir y conservar el historial.',
      reply: 'Entendido. Gracias por indicarlo; no volveremos a contactarles por este medio.',
      reasoning: 'La persona pidió detener el contacto. Aura recomienda cerrar el lead y respetar la solicitud.',
      confidence: 97,
    },
    {
      key: 'wrong_number',
      label: 'Contacto o número incorrecto',
      pattern: /\b(numero equivocado|numero incorrecto|numero invalido|se equivoco de numero|aqui no es|no conozco esa empresa|no conozco ese negocio)\b/,
      outcome: 'Número incorrecto o inválido',
      status: 'closed',
      commercialStatus: 'No califica',
      nextStep: 'Buscar otro canal; si no existe, descartar.',
      reply: 'Gracias por avisarnos. Disculpe la molestia; actualizaremos nuestros datos.',
      reasoning: 'El canal no corresponde al negocio o a la persona buscada. No conviene seguir insistiendo allí.',
      confidence: 96,
    },
    {
      key: 'outside_hours_auto_reply',
      label: 'Respuesta automática fuera de horario',
      pattern: /\b(fuera de (nuestro )?horario|horario de atencion|en este momento estamos cerrados|te responderemos pronto)\b/,
      outcome: 'Respuesta automática fuera de horario',
      status: 'followup_scheduled',
      commercialStatus: 'Seguimiento 1',
      nextStep: 'Contactar dentro del horario con el mensaje corregido.',
      reply: 'Hola 😊 Retomo mi mensaje dentro de su horario de atención. Mi nombre es Maikol y escribo de parte de Laura Rodriguez. ¿Podría indicarme quién gestiona las consultas y su seguimiento en la empresa?',
      reasoning: 'La respuesta fue automática y no representa interés ni rechazo. El lead debe seguir abierto.',
      confidence: 92,
    },
    {
      key: 'bot_requested_name_reason',
      label: 'Bot pidió nombre y motivo',
      pattern: /\b(indica|indiquenos|escribe|compartenos) (tu|su)? ?nombre\b|\b(cual es|indica|indiquenos) el motivo\b|\bselecciona una opcion\b/,
      outcome: 'Bot pidió nombre y motivo',
      status: 'followup_scheduled',
      commercialStatus: 'Seguimiento 1',
      nextStep: 'Responder al bot y solicitar a la persona encargada.',
      reply: 'Hola 😊 Mi nombre es Maikol y escribo de parte de Laura Rodriguez. Estamos realizando una revisión breve de cómo las empresas gestionan y dan seguimiento a sus consultas. ¿Podría indicarme quién es la persona encargada de este proceso?',
      reasoning: 'Todavía no respondió una persona. Aura recomienda completar el filtro del bot y pedir al responsable.',
      confidence: 91,
    },
    {
      key: 'not_interested',
      label: 'Negativa comercial',
      pattern: /\b(no me interesa|no nos interesa|no estoy interesad[oa]|no estamos interesad[oa]s|no gracias|gracias pero no)\b/,
      outcome: 'No interesado',
      status: 'closed',
      commercialStatus: 'No interesado',
      nextStep: 'Cerrar la oportunidad y conservar el historial.',
      reply: 'Entiendo, gracias por responder. No insistiremos. Quedo disponible si más adelante desean revisar el proceso.',
      reasoning: 'La persona rechazó continuar. Aura recomienda cerrar el lead sin confundirlo con falta de respuesta.',
      confidence: 95,
    },
    {
      key: 'meeting',
      label: 'Reunión coordinada o solicitada',
      pattern: /\b(agendamos|agendemos|coordinemos|reunion agendada|meet agendado|nos vemos el|llamada agendada|confirmado para|cuando podemos hablar)\b/,
      outcome: 'Reunión agendada',
      status: 'waiting_confirmation',
      commercialStatus: 'Reunión agendada',
      nextStep: 'Confirmar fecha, hora, asistentes y enviar el enlace.',
      reply: 'Perfecto 😊 Confirmemos fecha, hora y quiénes participarán. En cuanto quede validado, les envío el enlace de la reunión.',
      reasoning: 'Existe intención concreta de reunirse. Aura recomienda convertirla en un compromiso operativo.',
      confidence: 93,
    },
    {
      key: 'provider',
      label: 'Ya utiliza una solución o proveedor',
      pattern: /\b(ya tenemos proveedor|ya trabajamos con|ya usamos un crm|ya tenemos sistema|nos lo maneja una agencia)\b/,
      outcome: 'Ya tiene proveedor',
      status: 'followup_scheduled',
      commercialStatus: 'Seguimiento 2',
      nextStep: 'Preguntar qué funciona y qué todavía les cuesta; revisar en nurture.',
      reply: 'Perfecto. No busco reemplazar algo que ya funciona. ¿Hay algún punto del proceso actual que todavía les cueste, por ejemplo seguimiento, velocidad de respuesta o visibilidad de resultados?',
      reasoning: 'Tener proveedor no elimina necesariamente la necesidad. Aura recomienda explorar brechas sin confrontarlo.',
      confidence: 89,
    },
    {
      key: 'decision_maker',
      label: 'No se contactó al decisor',
      pattern: /\b(lo ve el doctor|lo ve la doctora|lo maneja administracion|lo decide gerencia|no soy la persona encargada|debo consultar con|pregunta por el encargado)\b/,
      outcome: 'Contacto con intermediario',
      status: 'waiting_decision_maker',
      commercialStatus: 'Seguimiento 1',
      nextStep: 'Identificar al decisor y acordar cuándo contactarlo.',
      reply: 'Gracias. ¿Podría indicarme el nombre de la persona encargada y el mejor horario para contactarla? Así no les envío información genérica.',
      reasoning: 'La persona respondió, pero no tiene autoridad sobre el proceso. Aura recomienda identificar al decisor.',
      confidence: 89,
    },
    {
      key: 'information',
      label: 'Solicitó información',
      pattern: /\b(enviame informacion|mandame informacion|pasame informacion|enviame la propuesta|mandame la propuesta|quiero saber mas|de que se trata|puedes enviarme)\b/,
      outcome: 'Solicitó información',
      status: 'conversation_active',
      commercialStatus: 'Respondió',
      nextStep: 'Enviar información concreta y acordar seguimiento.',
      reply: 'Claro 😊 Para enviarle algo relevante y no genérico, primero quisiera confirmar algo: ¿actualmente el seguimiento de las consultas se realiza manualmente o utilizan algún sistema?',
      reasoning: 'Enviar una presentación genérica puede enfriar la conversación. Aura recomienda calificar antes de enviar material.',
      confidence: 88,
    },
    {
      key: 'followup',
      label: 'Solicitó retomar después',
      pattern: /\b(escribeme manana|llamame manana|contactame despues|mas adelante|la proxima semana|el proximo mes|ahora no puedo)\b/,
      outcome: 'Seguimiento solicitado',
      status: 'followup_scheduled',
      commercialStatus: 'Seguimiento 1',
      nextStep: 'Retomar en la fecha acordada.',
      reply: 'Claro. ¿Qué día les funciona mejor para retomarlo? Así lo dejo agendado y no les escribo fuera de contexto.',
      reasoning: 'La conversación sigue abierta, pero falta convertir “después” en una fecha concreta.',
      confidence: 86,
    },
    {
      key: 'interest',
      label: 'Interés comercial',
      pattern: /\b(me interesa|nos interesa|suena interesante|quiero avanzar|como seguimos|como empezamos|esto nos puede ayudar)\b/,
      outcome: 'Interesado',
      status: 'conversation_active',
      commercialStatus: 'Interesado',
      nextStep: 'Acordar reunión o siguiente paso concreto.',
      reply: 'Excelente 😊 Para aterrizarlo a su caso, propongo una llamada breve de 15 minutos para revisar el proceso actual y definir el primer paso. ¿Qué horario les funciona mejor?',
      reasoning: 'Hay interés, pero todavía falta un compromiso concreto. Aura recomienda pedir una acción clara.',
      confidence: 88,
    },
  ];

  const match = rules.find((rule) => rule.pattern.test(normalized));
  const fallback = {
    key: 'response',
    label: 'Respuesta sin intención explícita',
    outcome: 'Respondió',
    status: 'response_received',
    commercialStatus: 'Respondió',
    nextStep: 'Responder, calificar la necesidad y acordar un próximo paso concreto.',
    reply: 'Gracias por responder 😊 Para entender mejor el contexto, ¿cómo gestionan actualmente las consultas y el seguimiento de las personas que no compran o no agendan en el primer contacto?',
    reasoning: 'La conversación está abierta, pero todavía falta información para decidir el siguiente paso.',
    confidence: 52,
  };
  const detected = match || fallback;
  const finalOutcome = detected.status === 'closed';
  const followupDate = finalOutcome ? null : (detectedFollowupDate || localISODate(1));
  const suggestion = {
    activity_type: 'response_received',
    conversation_status: detected.status,
    outcome: detected.outcome,
    objection: detected.label,
    next_step: detected.nextStep,
    followup_date: followupDate,
    commercial_status: detected.commercialStatus,
    is_final_outcome: finalOutcome,
  };

  return {
    method: 'local_browser_rules_v2',
    confidence: detected.confidence,
    summary: match
      ? `Aura detectó ${detected.label.toLowerCase()}.`
      : 'Hubo respuesta, pero Aura no detectó una objeción, compromiso o cierre suficientemente explícito.',
    recommended_reply: detected.reply,
    reasoning: detected.reasoning,
    signals: match ? [{
      key: detected.key,
      label: detected.label,
      evidence: evidenceLine(transcript, detected.pattern),
    }] : [],
    classification: {
      commercial_status: detected.commercialStatus,
      conversation_status: detected.status,
      conversation_status_label: conversationLabel(detected.status),
      outcome: detected.outcome,
      next_step: detected.nextStep,
      followup_date: followupDate,
    },
    suggestion,
    warning: 'Respuesta sugerida por Aura. Revísala antes de enviarla y confirma la clasificación antes de guardar.',
  };
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
  const [analysisApplied, setAnalysisApplied] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);
  const [error, setError] = useState('');
  const [fileNotice, setFileNotice] = useState('');
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
    setImportedFile(null);
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
      outcome_id: item.is_local_fallback ? '' : item.id,
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

  const storeAnalysisResult = (result) => {
    const localGuidance = localChatAnalysis(form.transcript);
    const completeResult = {
      ...localGuidance,
      ...result,
      recommended_reply: result?.recommended_reply || localGuidance.recommended_reply,
      reasoning: result?.reasoning || localGuidance.reasoning,
      signals: result?.signals?.length ? result.signals : localGuidance.signals,
      classification: result?.classification || localGuidance.classification,
      suggestion: { ...localGuidance.suggestion, ...(result?.suggestion || {}) },
      warning: result?.warning || localGuidance.warning,
    };
    setAnalysis(completeResult);
    setAnalysisApplied(false);
    setCopiedReply(false);
    update({ analysis: completeResult });
  };

  const applyAnalysisClassification = () => {
    if (!analysis) return;
    const suggestion = analysis.suggestion || {};
    const matchedOutcome = outcomes.find((item) => item.id === suggestion.outcome_id)
      || outcomes.find((item) => item.name === suggestion.outcome);
    const changes = {
      ...suggestion,
      outcome_id: matchedOutcome?.is_local_fallback
        ? ''
        : (matchedOutcome?.id || suggestion.outcome_id || form.outcome_id),
      outcome: matchedOutcome?.name || suggestion.outcome || form.outcome,
      channel: suggestion.channel || form.channel,
      transcript: form.transcript,
      analysis,
      followup_date: suggestion.followup_date || form.followup_date,
      next_step: suggestion.next_step || matchedOutcome?.recommended_next_step || form.next_step,
    };
    if (matchedOutcome?.recommended_conversation_status && !suggestion.conversation_status) {
      changes.conversation_status = matchedOutcome.recommended_conversation_status;
    }
    if (!changes.followup_date && matchedOutcome?.followup_delay_days !== null && matchedOutcome?.followup_delay_days !== undefined) {
      changes.followup_date = localISODate(Number(matchedOutcome.followup_delay_days));
    }
    update(changes);
    setAnalysisApplied(true);
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
      storeAnalysisResult(localChatAnalysis(form.transcript));
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
      update({ transcript, channel: 'WhatsApp' });
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
    update({ transcript: '', analysis: {} });
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

  const analysisClassification = analysis ? {
    commercialStatus: analysis.classification?.commercial_status || analysis.suggestion?.commercial_status || 'Sin cambio sugerido',
    conversationStatus: analysis.classification?.conversation_status || analysis.suggestion?.conversation_status || 'response_received',
    conversationStatusLabel: analysis.classification?.conversation_status_label
      || conversationLabel(analysis.classification?.conversation_status || analysis.suggestion?.conversation_status),
    outcome: analysis.classification?.outcome || analysis.suggestion?.outcome || 'Respondió',
    followupDate: analysis.classification?.followup_date || analysis.suggestion?.followup_date || null,
    nextStep: analysis.classification?.next_step || analysis.suggestion?.next_step || '',
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
        <div className="form-notice compact">Aura cargó la biblioteca de respaldo. Puedes seleccionar y guardar el outcome normalmente.</div>
      )}

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
                onChange={(e) => update({ transcript: e.target.value })}
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
                <strong>Qué pasó, qué responder y cómo dejar el lead</strong>
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
                <h4>Cómo clasificarlo</h4>
                <div className="aura-classification-grid">
                  <div><small>Estado comercial</small><strong>{analysisClassification.commercialStatus}</strong></div>
                  <div><small>Estado de conversación</small><strong>{analysisClassification.conversationStatusLabel}</strong></div>
                  <div><small>Outcome</small><strong>{analysisClassification.outcome}</strong></div>
                  <div><small>Próximo seguimiento</small><strong>{formatFollowupDate(analysisClassification.followupDate)}</strong></div>
                  <div className="aura-next-step"><small>Próximo paso</small><strong>{analysisClassification.nextStep || 'Definir manualmente'}</strong></div>
                </div>
                <button
                  type="button"
                  className={`button ${analysisApplied ? 'secondary applied' : 'primary'} aura-apply-button`}
                  onClick={applyAnalysisClassification}
                >
                  {analysisApplied ? <CheckCircle2 size={17} /> : <ListChecks size={17} />}
                  {analysisApplied ? 'Clasificación aplicada' : 'Aplicar clasificación'}
                </button>
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
