const BASE_AGENT_HINTS = ['maikol', 'laura', 'growth by laura', 'aura os', 'aura grow'];

function normalizedSetterName(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim() || 'Growth by Laura';
}

function setterFirstName(value = '') {
  const fullName = normalizedSetterName(value);
  return fullName === 'Growth by Laura' ? fullName : fullName.split(' ')[0];
}

function personalizeSetterText(value, setterName = '') {
  const fullName = normalizedSetterName(setterName);
  const firstName = setterFirstName(fullName);
  return String(value || '')
    .replace(/\bMaikol Brown\b/g, fullName)
    .replace(/\bMaikol\b/g, firstName);
}

function agentHints(setterName = '') {
  const fullName = normalizeChatText(normalizedSetterName(setterName));
  const firstName = fullName.split(' ')[0] || '';
  return [...new Set([
    ...BASE_AGENT_HINTS,
    fullName,
    firstName.length >= 4 ? firstName : '',
  ].filter(Boolean))];
}

export function normalizeChatText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9ñ\s:/@.,+()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseExportMessages(text = '') {
  const messages = [];
  const patterns = [
    /^\s*\[[^\]]+\]\s*([^:]{1,80}):\s*(.*)$/,
    /^\s*\d{1,2}[/. -]\d{1,2}[/. -]\d{2,4}[^-]{0,40}-\s*([^:]{1,80}):\s*(.*)$/,
  ];
  String(text).split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.replace(/^\uFEFF/, '');
    const match = patterns.map((pattern) => line.match(pattern)).find(Boolean);
    if (match) {
      messages.push({ sender: match[1].trim(), message: match[2].trim() });
    } else if (messages.length && line.trim()) {
      messages[messages.length - 1].message = `${messages[messages.length - 1].message} ${line.trim()}`.trim();
    }
  });
  return messages.filter((item) => item.message);
}

function isAgentSender(sender = '', setterName = '') {
  const normalized = normalizeChatText(sender);
  return agentHints(setterName).some((hint) => normalized.includes(hint));
}

export function chatAnalysisContext(text = '', setterName = '') {
  const messages = parseExportMessages(text);
  if (!messages.length) {
    return { scope: String(text || ''), previousAgentMessage: '', messages: [] };
  }
  let leadIndex = messages.length - 1;
  while (leadIndex >= 0 && isAgentSender(messages[leadIndex].sender, setterName)) leadIndex -= 1;
  if (leadIndex < 0) leadIndex = messages.length - 1;
  let previousAgentMessage = '';
  for (let index = leadIndex - 1; index >= 0; index -= 1) {
    if (isAgentSender(messages[index].sender, setterName)) {
      previousAgentMessage = messages[index].message;
      break;
    }
  }
  return {
    scope: messages[leadIndex]?.message || messages[messages.length - 1].message,
    previousAgentMessage,
    messages,
  };
}

export function chatAnalysisScope(text = '', setterName = '') {
  return chatAnalysisContext(text, setterName).scope;
}

function localISODate(daysFromToday = 0) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextBusinessISODate(daysFromToday = 1) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  while (value.getDay() === 0 || value.getDay() === 6) {
    value.setDate(value.getDate() + 1);
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DAY_INDEX = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function explicitFollowupDate(normalized) {
  if (/\bpasado manana\b/.test(normalized)) return localISODate(2);
  if (/\bmanana\b/.test(normalized)) return localISODate(1);
  const daysMatch = normalized.match(/\b(?:en|dentro de) (\d{1,2}) dias?\b/);
  if (daysMatch) return localISODate(Math.max(0, Math.min(90, Number(daysMatch[1]))));
  if (/\bproxima semana\b/.test(normalized)) return localISODate(7);
  if (/\bproximo mes\b/.test(normalized)) return localISODate(30);
  const dateMatch = normalized.match(/\b(?:el )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dateMatch) {
    const now = new Date();
    let year = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    let candidate = new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[1]));
    if (!dateMatch[3] && candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      candidate = new Date(year + 1, Number(dateMatch[2]) - 1, Number(dateMatch[1]));
    }
    if (!Number.isNaN(candidate.getTime())) {
      const y = candidate.getFullYear();
      const m = String(candidate.getMonth() + 1).padStart(2, '0');
      const d = String(candidate.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  const today = new Date();
  const dayName = Object.keys(DAY_INDEX).find((name) => new RegExp(`\\b${name}\\b`).test(normalized));
  if (dayName) {
    let delta = (DAY_INDEX[dayName] - today.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return localISODate(delta);
  }
  return null;
}

function evidenceLine(scope, patterns) {
  const normalized = normalizeChatText(scope);
  const matchedPattern = patterns.find((pattern) => pattern.test(normalized));
  if (!matchedPattern) return String(scope || '').trim().slice(0, 220);
  return String(scope || '').split(/\r?\n/)
    .find((line) => matchedPattern.test(normalizeChatText(line)))?.trim().slice(0, 220)
    || String(scope || '').trim().slice(0, 220);
}

export const CHAT_RESPONSE_LIBRARY = [

  {
    key: 'maikol_outside_hours',
    label: 'respuesta automática fuera de horario',
    priority: 140,
    confidence: 98,
    patterns: [
      /\b(fuera de|fuera del) (nuestro )?horario\b/i,
      /\bhorario de atencion\b/i,
      /\ben este momento estamos (cerrados|fuera de servicio)\b/i,
      /\bte responderemos (pronto|en horario|cuando regresemos)\b/i,
      /\bnuestro horario es de\b/i,
    ],
    outcome: 'Respuesta automática fuera de horario',
    status: 'followup_scheduled',
    commercialStatus: 'Contactado',
    followupMode: 'next_business_day',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Retomar el próximo día hábil entre 9:15 a. m. y 10:30 a. m.',
    reply: 'Hola 😊 Retomo mi mensaje dentro de su horario de atención. Soy Maikol Brown, asistente de consultoría de Growth by Laura. Vimos una posible oportunidad relacionada con el seguimiento de sus consultas por WhatsApp. ¿Con quién podría conversar sobre marketing, ventas o gestión de pacientes?',
    reasoning: 'Respondió una automatización, no una persona. El lead sigue abierto y debe retomarse dentro del horario de atención.',
  },
  {
    key: 'maikol_bot_name_reason',
    label: 'bot solicitó nombre y motivo',
    priority: 139,
    confidence: 98,
    patterns: [
      /\b(indica|indiquenos|escribe|compartenos|ingresa) (tu|su)? ?nombre\b/i,
      /\b(cual es|indica|indiquenos|escribe) (el )?motivo\b/i,
      /\b(nombre completo|motivo de contacto|motivo de la consulta)\b/i,
      /\bpara poder ayudarte.*\bnombre\b/i,
    ],
    outcome: 'Bot pidió nombre y motivo',
    status: 'waiting_decision_maker',
    commercialStatus: 'Contactado',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Responder al bot y solicitar a la persona encargada.',
    reply: 'Hola 😊 Soy Maikol Brown, asistente de consultoría de Growth by Laura. Motivo: queremos compartirles una observación breve sobre su proceso de atención por WhatsApp que podría ayudarles a convertir más consultas en citas. ¿Con quién podría conversarlo?',
    reasoning: 'El bot está filtrando el contacto. Maikol debe identificarse con transparencia y pedir una sola derivación.',
  },
  {
    key: 'maikol_patient_flow',
    label: 'flujo automático de paciente',
    priority: 138,
    confidence: 97,
    patterns: [
      /^\s*quiero agendar una cita\s*[.!]*$/i,
      /^\s*quiero mas informacion\s*[.!]*$/i,
      /\b(agendar|reservar|confirmar) (una )?(cita|consulta)\b/i,
      /\bselecciona (el|un) (servicio|tratamiento|especialidad)\b/i,
      /\bdatos del paciente\b/i,
    ],
    outcome: 'WhatsApp abrió flujo de paciente',
    status: 'waiting_response',
    commercialStatus: 'Contactado',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Borrar el texto de paciente, aclarar el motivo comercial y confirmar si el seguimiento es manual o utiliza un sistema.',
    reply: 'Hola 😊 Gracias por responder. No escribo como paciente. Soy Maikol Brown, asistente de consultoría de Growth by Laura. Estamos conversando con clínicas para entender cómo organizan y dan seguimiento a las personas que consultan por WhatsApp. Quería hacerles una pregunta breve: ¿actualmente ese seguimiento lo realizan manualmente o utilizan algún sistema?',
    reasoning: 'WhatsApp abrió un flujo de paciente. Maikol debe borrar el texto predeterminado, aclarar que no escribe como paciente y hacer la pregunta sobre el sistema de seguimiento.',
  },
  {
    key: 'maikol_auto_welcome',
    label: 'respuesta automática de bienvenida',
    priority: 137,
    confidence: 96,
    patterns: [
      /\bgracias por (comunicarte|comunicarse|contactarnos|escribirnos)\b/i,
      /\bhemos recibido (tu|su) (mensaje|consulta|solicitud)\b/i,
      /\buno de (nuestros|nuestro) (asesores|agentes|representantes) (te|le) respondera\b/i,
      /\bbienvenid[oa]s? a\b/i,
      /\btu mensaje ha sido recibido\b/i,
    ],
    outcome: 'Respondió',
    status: 'waiting_response',
    commercialStatus: 'Contactado',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Confirmar si el seguimiento de consultas es manual o utiliza un sistema.',
    reply: 'Hola 😊 Gracias por responder. No escribo como paciente. Soy Maikol Brown, asistente de consultoría de Growth by Laura. Estamos conversando con clínicas para entender cómo organizan y dan seguimiento a las personas que consultan por WhatsApp. Quería hacerles una pregunta breve: ¿actualmente ese seguimiento lo realizan manualmente o utilizan algún sistema?',
    reasoning: 'La bienvenida automática no es una respuesta comercial humana. El script actualizado pide aclarar que no se escribe como paciente y abrir con una sola pregunta sobre el seguimiento.',
  },
  {
    key: 'maikol_send_info_here',
    label: 'solicitud de enviar información por el mismo chat',
    priority: 136,
    confidence: 97,
    patterns: [
      /\b(puede|puedes|pueden|pueden ustedes) (enviar|mandar|compartir)(nos|me)? (la|esa|mas)? ?(informacion|info|detalles) (por aqui|aqui|por este medio)\b/i,
      /\benvie(n)? (la|esa|mas)? ?(informacion|info|detalles) (por aqui|aqui|por este medio)\b/i,
      /\bmandalo por aqui\b/i,
      /\b(puede|puedes|pueden) enviar(la|lo)? por aqui\b/i,
    ],
    outcome: 'Solicitó información',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Confirmar si el seguimiento es manual o si utilizan un sistema.',
    reply: 'Claro 😊 Laura realiza un diagnóstico del proceso de atención y seguimiento comercial. Revisa cómo reciben las consultas, cómo las califican, qué seguimiento realizan y en qué puntos podrían estar perdiéndose oportunidades. Luego entrega recomendaciones concretas para mejorar el proceso. No es un servicio de manejo de redes ni publicidad. ¿Actualmente el seguimiento de las personas que consultan por WhatsApp se realiza manualmente o utilizan algún sistema?',
    reasoning: 'El lead abrió la conversación, pero todavía falta una sola pregunta de diagnóstico antes de enviar información.',
  },
  {
    key: 'maikol_no_system',
    label: 'seguimiento manual o sin sistema',
    priority: 135,
    confidence: 97,
    patterns: [
      /\b(no tenemos|no usamos|no utilizamos|no contamos con) (ningun )?(sistema|crm|software|plataforma|automatizacion)\b/i,
      /\b(se hace|lo hacemos|es|todo es) manual\b/i,
      /\bdepende de (una persona|alguien|recepcion|la recepcionista)\b/i,
      /\b(lo llevamos|usamos) (en )?(excel|google sheets|una libreta|papel|whatsapp)\b/i,
    ],
    outcome: 'Respondió',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Proceso manual',
    nextStep: 'Registrar que el proceso es manual y observar la siguiente respuesta antes de avanzar.',
    reply: 'Entiendo 😊 Probablemente el seguimiento depende de que alguien recuerde responder, retomar conversaciones y confirmar citas. Justamente ayudamos a los negocios a organizar ese proceso para que menos consultas se pierdan y más personas terminen agendando.',
    reasoning: 'Se confirmó una operación manual. El script actualizado explica brevemente la brecha sin agregar otra pregunta en ese mismo mensaje.',
  },
  {
    key: 'maikol_uses_system',
    label: 'ya utiliza un sistema',
    priority: 134,
    confidence: 96,
    patterns: [
      /\b(si|sí),? (tenemos|usamos|utilizamos|contamos con) (un|una|el|la)? ?(sistema|crm|software|plataforma|automatizacion|bot|chatbot)\b/i,
      /\b(tenemos|usamos|utilizamos|trabajamos con) (kommo|hubspot|zoho|salesforce|monday|trello|whatsapp business)\b/i,
      /\bya (tenemos|usamos|utilizamos) (un|una|el|la)? ?(sistema|crm|software|plataforma)\b/i,
      /\bya esta (automatizado|sistematizado)\b/i,
    ],
    outcome: 'Objeción identificada',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Ya utiliza sistema o CRM',
    nextStep: 'Identificar qué sistema utilizan y quién supervisa el proceso.',
    reply: 'Perfecto 😊 Eso ya es un buen avance. Muchas veces el problema no es tener o no una herramienta, sino cómo se utiliza para dar seguimiento, recuperar conversaciones y convertir consultas en citas. ¿Qué sistema utilizan actualmente y quién supervisa este proceso?',
    reasoning: 'Tener sistema no cierra la oportunidad. El script pide identificar la herramienta y al responsable.',
  },
  {
    key: 'maikol_decision_maker_present',
    label: 'apareció la persona encargada',
    priority: 133,
    confidence: 96,
    patterns: [
      /\b(yo soy|soy) (la|el)? ?(encargad[oa]|responsable|administrador[a]?|gerente)\b/i,
      /\b(yo|conmigo) (lo manejo|lo veo|me encargo|puede hablar|puedes hablar)\b/i,
      /\bhabla conmigo\b/i,
      /\bese tema lo (veo|manejo) yo\b/i,
    ],
    outcome: 'Respondió',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Confirmar si miden cuántas consultas se convierten en citas o clientes.',
    reply: 'Hola, mucho gusto 😊 Soy Maikol Brown, asistente de consultoría de Growth by Laura. Estuvimos revisando brevemente su proceso de atención y detectamos una posible oportunidad relacionada con el seguimiento de las consultas que reciben por WhatsApp. ¿Actualmente tienen una forma clara de saber cuántas consultas terminan convirtiéndose en citas o clientes?',
    reasoning: 'Ya apareció el responsable. El script pasa de derivación a una sola pregunta de medición.',
  },
  {
    key: 'maikol_not_measuring',
    label: 'no mide conversión de consultas',
    priority: 132,
    confidence: 97,
    patterns: [
      /\b(no medimos|no lo medimos|no llevamos metricas|no tenemos metricas)\b/i,
      /\bno (sabemos|se) cuantas? (consultas|personas|conversaciones) (terminan|se convierten|agendan)\b/i,
      /\bno llevamos (ese|un) control\b/i,
      /\bno tenemos forma de saber\b/i,
      /\bno calculamos (la )?conversion\b/i,
    ],
    outcome: 'Interesado',
    status: 'conversation_active',
    commercialStatus: 'Interesado',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: 'No mide conversión',
    nextStep: 'Ofrecer dos horarios cerrados para una llamada de 15 minutos.',
    reply: 'Entiendo. Eso suele hacer que muchas oportunidades se pierdan sin que el negocio pueda identificar exactamente dónde ocurrió. Laura está realizando revisiones breves de procesos comerciales para detectar posibles fugas en atención, seguimiento y conversión. Podríamos mostrarle en una llamada de 15 minutos qué observamos y qué mejora puntual podría aplicar. Laura tiene disponibilidad [OPCIÓN 1] o [OPCIÓN 2]. ¿Cuál de esos dos horarios le funciona mejor?',
    reasoning: 'La falta de medición confirma una brecha concreta. El siguiente paso es ofrecer dos horarios, no pedir disponibilidad abierta.',
  },
  {
    key: 'maikol_metric_provided',
    label: 'compartió el indicador que utiliza',
    priority: 131,
    confidence: 92,
    patterns: [
      /\b(medimos|calculamos|revisamos|seguimos) (por|con|la|el) (porcentaje|tasa|numero|cantidad|dashboard|reporte)\b/i,
      /\b(tasa|porcentaje) de conversion\b/i,
      /\b(consultas|leads|mensajes).*(citas|ventas|clientes).*(porcentaje|tasa|reporte|dashboard)\b/i,
      /\b(kpi|indicador) (es|principal|que usamos)\b/i,
    ],
    outcome: 'Interesado',
    status: 'conversation_active',
    commercialStatus: 'Interesado',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Relacionar el indicador con el hallazgo y ofrecer dos horarios.',
    reply: 'Gracias. Lo que observamos parece estar más relacionado con [TIEMPO DE RESPUESTA / SEGUIMIENTO / RECUPERACIÓN DE CONVERSACIONES / CLARIDAD DEL PRÓXIMO PASO]. Laura podría mostrarle el hallazgo en una llamada breve de 15 minutos. Tiene disponibilidad [OPCIÓN 1] o [OPCIÓN 2]. ¿Cuál le funciona mejor?',
    reasoning: 'El lead ya explicó cómo mide. Aura deja marcado el espacio que Maikol debe adaptar al hallazgo real antes de copiar.',
  },
  {
    key: 'maikol_yes_measuring',
    label: 'sí mide la conversión',
    priority: 130,
    confidence: 94,
    patterns: [
      /\b(si|sí),? (medimos|lo medimos|llevamos metricas|tenemos metricas|llevamos control)\b/i,
      /\btenemos (un )?(reporte|dashboard|control) de conversion\b/i,
      /\bsabemos cuantas? (consultas|personas) (agendan|se convierten)\b/i,
    ],
    outcome: 'Respondió',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Preguntar qué indicador utilizan para medir la conversión.',
    reply: 'Perfecto 😊 Eso ya los coloca por delante de muchos negocios. Para entender mejor, ¿qué indicador utilizan actualmente para medir la conversión de consultas en citas o ventas?',
    reasoning: 'La empresa sí mide. El script pide identificar el indicador antes de proponer la llamada.',
  },
  {
    key: 'maikol_information_request',
    label: 'pidió más información',
    priority: 129,
    confidence: 96,
    patterns: [
      /\b(enviame|mandame|comparteme|pasame|envie|mande) (la|mas|esa|algo de)? ?(informacion|info|propuesta|presentacion|detalles)\b/i,
      /\bquiero (ver|conocer|saber) mas\b/i,
      /\bde que se trata\b/i,
      /\bcomo funciona\b/i,
    ],
    outcome: 'Solicitó información',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Identificar si el reto principal es responder, dar seguimiento o lograr citas.',
    reply: 'Claro 😊 Para enviarte algo realmente útil y no una presentación genérica, quisiera confirmar algo primero: ¿el principal reto que tienen actualmente está en responder las consultas, dar seguimiento o lograr que las personas agenden?',
    reasoning: 'El script evita enviar presentaciones genéricas y utiliza una sola pregunta para ubicar el problema principal.',
  },
  {
    key: 'maikol_price_request',
    label: 'preguntó el precio',
    priority: 128,
    confidence: 97,
    patterns: [
      /\bcuanto (cuesta|sale|vale|cobran)\b/i,
      /\b(cual es|cuales son) (el|los|su|sus) (precio|precios|tarifa|tarifas|planes)\b/i,
      /\bque precio tiene\b/i,
      /\b(enviame|mandame|envienos) (los|el)? ?(precios|tarifas|planes|cotizacion)\b/i,
    ],
    outcome: 'Solicitó información',
    status: 'conversation_active',
    commercialStatus: 'Interesado',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: 'Precio',
    nextStep: 'Aclarar que la primera conversación es gratuita y ofrecer dos horarios.',
    reply: 'La primera conversación de 15 minutos no tiene costo. Es únicamente para mostrarles la observación y determinar si vale la pena realizar una evaluación más completa. Si después identificamos que podemos ayudarles, Laura les explicará las opciones disponibles. ¿Les funciona mejor [OPCIÓN 1] o [OPCIÓN 2]?',
    reasoning: 'Según el script, Maikol no cotiza por chat: explica el propósito de la llamada inicial y ofrece dos horarios.',
  },
  {
    key: 'maikol_existing_owner',
    label: 'ya cuenta con una persona encargada',
    priority: 127,
    confidence: 97,
    patterns: [
      /\bya (tenemos|contamos con|hay) (una persona|alguien|un encargado|una encargada|un equipo|personal)\b/i,
      /\b(eso|el seguimiento|las consultas|whatsapp) (lo|las) (maneja|lleva|ve|atiende) (recepcion|la recepcionista|administracion|una persona|nuestro equipo|alguien)\b/i,
      /\btenemos (quien|a alguien que) (responda|atienda|maneje|lleve)\b/i,
      /\bya hay (encargado|encargada|responsable)\b/i,
      /\btenemos (una recepcionista|un recepcionista|un asistente|una asistente) que (se encarga|lo maneja|lo lleva|responde)\b/i,
    ],
    outcome: 'Objeción identificada',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Ya cuenta con encargado',
    nextStep: 'Confirmar si esa persona también supervisa seguimiento y conversión.',
    reply: 'Perfecto 😊 Justamente no buscamos reemplazar a la persona encargada. La revisión sirve para darle una segunda mirada al proceso y detectar posibles oportunidades de mejora. ¿Esa persona supervisa también el seguimiento y la conversión de las consultas?',
    reasoning: 'La frase aclara que ya existe un responsable, pero no necesariamente rechaza la conversación.',
  },
  {
    key: 'maikol_not_interested',
    label: 'rechazo comercial explícito',
    priority: 150,
    confidence: 98,
    patterns: [
      /\b(no me interesa|no nos interesa|no le interesa|no les interesa|no interesa)\b/i,
      /\bno (estoy|estamos|esta|estan) interesad[oa]s?\b/i,
      /\b(no gracias|gracias pero no|prefiero que no|por ahora no)\b/i,
      /\bno (quiero|queremos|deseo|deseamos) (continuar|seguir|avanzar|recibir informacion)\b/i,
    ],
    outcome: 'No interesado',
    status: 'closed',
    commercialStatus: 'No interesado',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: false,
    objection: 'No interesado',
    nextStep: 'Retirar del seguimiento y conservar el historial.',
    reply: 'Entendido 😊 Muchas gracias por responder. Los retiramos del seguimiento. Que tengan un excelente día.',
    reasoning: 'Existe un rechazo claro. El script indica cerrar con respeto y no seguir calificando.',
  },
  {
    key: 'maikol_referral',
    label: 'referencia a otro contacto',
    priority: 125,
    confidence: 97,
    patterns: [
      /\b(escrib(e|ele|anle)|contact(a|e|en)|llam(a|e|en)) a (esta|esa|la|el) persona\b/i,
      /\b(eso|este tema|marketing|ventas|las consultas) lo maneja (otra persona|[a-zñ ]{2,50})\b/i,
      /\b(te|le|les) (paso|comparto|envio|doy) (el )?(numero|contacto|correo)\b/i,
      /\bpregunta(le)? si (esta|estan) interesad[oa]s?\b/i,
      /\bhabla con [a-zñ ]{2,50}\b/i,
      /\bescribele a [a-zñ ]{2,50}\b/i,
    ],
    outcome: 'Referido a otro contacto',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Crear el referido como lead separado, registrar quién lo compartió y escribirle hoy.',
    reply: 'Perfecto, muchas gracias por orientarme 😊 Le escribiré ahora mismo indicando que usted me compartió el contacto.',
    reasoning: 'El lead original es referidor, no “No califica”. Debe conservarse y crear el nuevo contacto por separado.',
  },
  {
    key: 'maikol_meeting_details',
    label: 'envió datos para crear la reunión',
    priority: 124,
    confidence: 95,
    patterns: [
      /\b(correo|email)\s*(?:es|:|=|-)\s*[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
      /^\s*[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\s*$/i,
      /\b(nombre|cargo)\b.{0,160}\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
    ],
    outcome: 'Reunión agendada',
    status: 'closed',
    commercialStatus: 'Reunión agendada',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: true,
    objection: '',
    nextStep: 'Crear la reunión en Google Meet y enviar la invitación al correo confirmado.',
    reply: 'Gracias 😊 En unos minutos le comparto la invitación de Google Meet.',
    reasoning: 'El contacto ya entregó el correo y los datos necesarios. El siguiente paso es crear la invitación, no volver a calificar.',
  },
  {
    key: 'maikol_time_selected',
    label: 'eligió uno de los horarios',
    priority: 123,
    confidence: 95,
    patterns: [
      /\b(la|el) (primera|segunda|primer|segundo) (opcion|horario)\b/i,
      /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo).*(a las|am|pm|a\. m\.|p\. m\.)\b/i,
      /\b(ese|este) horario (me|nos) (funciona|sirve|queda bien)\b/i,
      /\b(me|nos) funciona (el|la|a las|a la)\b/i,
      /\b(prefiero|elegimos|tomamos) (el|la)\b.*\b(horario|opcion|am|pm|a\. m\.|p\. m\.)\b/i,
      /\b(confirmado|confirmada) para\b/i,
    ],
    outcome: 'Esperando confirmación',
    status: 'waiting_confirmation',
    commercialStatus: 'Interesado',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Confirmar día y hora y solicitar nombre, cargo y correo.',
    reply: 'Perfecto 😊 Queda confirmado para [DÍA, FECHA Y HORA]. La llamada será por Google Meet y tendrá una duración aproximada de 15 minutos. Para que Laura pueda aprovechar mejor la conversación, ¿me confirma nombre de la persona que participará, cargo y correo electrónico?',
    reasoning: 'El horario fue elegido, pero todavía faltan los datos para crear la invitación.',
  },
  {
    key: 'do_not_contact',
    label: 'Solicitud expresa de no contacto',
    priority: 170,
    confidence: 98,
    patterns: [
      /\b(no me escriban|no me escribas|no nos escriban|no vuelvas a escribir|dejen de escribirme|no me manden mensajes)\b/i,
      /\b(no me contacten|no nos contacten|no volver a contactar|no contactes|no me llames|no nos llamen|no llamar)\b/i,
      /\b(elimina|borra|saquen|quita) (mi|este) (numero|contacto|dato|datos)\b/i,
      /\bno autorizo (el )?contacto\b/i,
    ],
    outcome: 'No contactar',
    status: 'closed',
    commercialStatus: 'Descartado',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: false,
    objection: 'No contactar',
    nextStep: 'No insistir y conservar el historial.',
    reply: 'Entendido. Gracias por indicarlo; no volveremos a contactarles por este medio.',
    reasoning: 'La persona pidió explícitamente detener el contacto. Aura recomienda cerrar el lead y respetar la solicitud.',
  },
  {
    key: 'wrong_contact',
    label: 'Contacto o número incorrecto',
    priority: 99,
    confidence: 97,
    patterns: [
      /\b(numero|contacto) (equivocado|incorrecto|invalido)\b/i,
      /\bse (equivocaron|equivoco|confundieron|confundio) de numero\b/i,
      /\b(aqui|aca) no (es|trabaja|queda|vive)\b/i,
      /\bno conozco (esa|ese|a esa|a ese) (empresa|clinica|persona|negocio|doctor|doctora)\b/i,
      /\b(ya no usa|no pertenece a) este numero\b/i,
    ],
    outcome: 'Número incorrecto o inválido',
    status: 'closed',
    commercialStatus: 'No califica',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: false,
    objection: 'Contacto incorrecto',
    nextStep: 'Buscar otro canal; si no existe, descartar.',
    reply: 'Gracias por avisarnos. Disculpe la molestia; actualizaremos nuestros datos.',
    reasoning: 'El canal no corresponde al negocio o a la persona buscada. No conviene seguir insistiendo en este contacto.',
  },
  {
    key: 'business_closed',
    label: 'Negocio cerrado o fuera de operación',
    priority: 98,
    confidence: 97,
    patterns: [
      /\b(cerramos|cerraron|cesamos|suspendimos) (operaciones|el negocio|la clinica|definitivamente)\b/i,
      /\b(negocio|empresa|clinica|local) (cerro|esta cerrado|ya no existe|ya no opera)\b/i,
      /\bya no (operamos|atendemos|estamos funcionando)\b/i,
    ],
    outcome: 'No califica',
    status: 'closed',
    commercialStatus: 'No califica',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: false,
    objection: 'Negocio fuera de operación',
    nextStep: 'Cerrar la oportunidad y actualizar la base.',
    reply: 'Gracias por informarlo. Actualizaremos nuestros datos para no volver a contactarles.',
    reasoning: 'El negocio ya no opera. Mantenerlo activo distorsionaría la base y el pipeline.',
  },
  {
    key: 'sale',
    label: 'Acuerdo de compra o implementación',
    priority: 97,
    confidence: 97,
    patterns: [
      /\b(aceptamos|aprobamos|confirmamos) (la|su|tu) (propuesta|cotizacion|servicio)\b/i,
      /\b(queremos|vamos a) contratar\b/i,
      /\b(procedamos|avancemos) con (la|el|esto)\b/i,
      /\b(enviame|mandame|envienos) (el )?(contrato|factura|link de pago|enlace de pago)\b/i,
      /\b(ya hicimos|realizamos|se hizo) (el )?pago\b/i,
    ],
    outcome: 'Venta',
    status: 'closed',
    commercialStatus: 'Implementación vendida',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Iniciar onboarding y registrar el monto.',
    reply: 'Excelente, gracias por la confianza. El siguiente paso es coordinar el inicio, responsables y documentación necesaria para la implementación.',
    reasoning: 'La persona confirmó la compra o el inicio. Aura recomienda cerrar la etapa comercial y abrir el onboarding.',
  },
  {
    key: 'meeting_confirmed',
    label: 'Reunión confirmada',
    priority: 96,
    confidence: 96,
    patterns: [
      /\b(reunion|llamada|meet|demo|cita) (agendada|confirmada|coordinada|reservada)\b/i,
      /\b(queda|quedo|esta) (agendado|confirmado|coordinado) para\b/i,
      /\b(confirmado|confirmada) para\b/i,
      /\b(nos vemos|hablamos) (el|la|este|esta|manana)\b/i,
      /\b(ese|este) horario (me|nos) (funciona|sirve|queda bien)\b/i,
    ],
    outcome: 'Reunión agendada',
    status: 'closed',
    commercialStatus: 'Reunión agendada',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: true,
    objection: '',
    nextStep: 'Enviar el enlace, registrar asistentes y confirmar antes de la reunión.',
    reply: 'Perfecto 😊 Queda confirmada. Les envío el enlace y los detalles de la reunión para que los tengan a mano.',
    reasoning: 'La fecha u horario ya fue aceptado. Aura recomienda registrar la reunión como conversión y preparar la confirmación.',
  },
  {
    key: 'not_interested',
    label: 'Negativa comercial explícita',
    priority: 95,
    confidence: 96,
    patterns: [
      /\b(no me interesa|no nos interesa|no le interesa|no les interesa|no interesa)\b/i,
      /\bno (estoy|estamos|esta|estan|se encuentra|se encuentran) interesad[oa]s?\b/i,
      /\b(?:el cliente|la cliente|el negocio|la empresa|ellos|ellas|nosotros|nosotras)?\s*(?:indica|dice|respondio|comenta|menciona|informo|informa)?\s*(?:que )?no (?:esta|estan|estamos|tiene|tienen|hay) (?:interes|interesad[oa]s?)\b/i,
      /\bpor (?:el )?momento no (?:esta|estan|estamos|hay|tenemos|tienen) (?:interes|interesad[oa]s?)\b/i,
      /\b(sin interes|no hay interes|no tenemos interes|no tienen interes|no es de (nuestro|su) interes)\b/i,
      /\b(no gracias|gracias pero no|prefiero que no|paso por ahora|por ahora no)\b/i,
      /\bno (quiero|queremos|deseo|deseamos|quiere|quieren) (continuar|seguir|avanzar|recibir informacion)\b/i,
      /\bno estamos buscando (eso|ese servicio|una solucion)\b/i,
      /\b(rechaza|rechazaron|declina|declinaron) (la )?(propuesta|oferta|conversacion|servicio)\b/i,
    ],
    outcome: 'No interesado',
    status: 'closed',
    commercialStatus: 'No interesado',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: false,
    objection: 'No interesado',
    nextStep: 'Cerrar la oportunidad y conservar el historial.',
    reply: 'Entiendo, gracias por responder. No insistiremos. Quedo disponible si más adelante desean revisar el proceso.',
    reasoning: 'La persona rechazó continuar. Aura recomienda cerrar el lead sin confundirlo con falta de respuesta.',
  },
  {
    key: 'not_qualified',
    label: 'El caso no califica',
    priority: 94,
    confidence: 94,
    patterns: [
      /\bno somos (una )?(empresa|negocio|clinica|centro|consultorio)\b/i,
      /\bno recibimos (consultas|mensajes|clientes|pacientes|prospectos)\b/i,
      /\bno (vendemos|ofrecemos) (servicios|citas|tratamientos)\b/i,
      /\besto no aplica (para nosotros|a nuestro negocio)?\b/i,
      /\bno tenemos (whatsapp|redes|equipo comercial|proceso de ventas)\b/i,
    ],
    outcome: 'No califica',
    status: 'closed',
    commercialStatus: 'No califica',
    followupDelayDays: null,
    terminal: true,
    appointmentBooked: false,
    objection: 'No califica',
    nextStep: 'Cerrar la oportunidad con la razón documentada.',
    reply: 'Gracias por aclararlo. Entiendo que la solución no aplica a su operación actual; cierro el contacto para no hacerles perder tiempo.',
    reasoning: 'La necesidad o el perfil mínimo no existe. Mantener el lead abierto distorsionaría el pipeline.',
  },
  {
    key: 'meeting_cancelled',
    label: 'Reunión cancelada',
    priority: 92,
    confidence: 92,
    patterns: [
      /\b(cancelar|cancelemos|cancela|suspender|suspendamos) (la|el|nuestra)? ?(reunion|llamada|meet|demo|cita)\b/i,
      /\bno (podre|podemos|voy a poder) (asistir|conectarme|estar en la reunion)\b/i,
    ],
    outcome: 'Seguimiento solicitado',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Reunión cancelada',
    nextStep: 'Confirmar si desea reprogramar y proponer dos horarios.',
    reply: 'Entiendo. ¿Desean que la reprogramemos? Puedo compartirles dos horarios concretos para dejarla coordinada.',
    reasoning: 'La reunión se canceló, pero no necesariamente la oportunidad. Aura recomienda confirmar si debe reprogramarse.',
  },
  {
    key: 'meeting_reschedule',
    label: 'Solicitud de reprogramación',
    priority: 91,
    confidence: 93,
    patterns: [
      /\b(reprogramar|reprogramemos|mover|cambiar) (la|el|nuestra)? ?(reunion|llamada|meet|demo|cita|horario)\b/i,
      /\b(otro|otro) horario (me|nos) funciona mejor\b/i,
      /\bpodemos (hacerlo|verlo|hablar) (mas tarde|otro dia|a otra hora)\b/i,
    ],
    outcome: 'Seguimiento solicitado',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: 'Reprogramación',
    nextStep: 'Ofrecer dos horarios y confirmar el nuevo espacio.',
    reply: 'Claro 😊 Tengo disponibilidad en dos horarios. ¿Cuál les funciona mejor para dejar la reunión nuevamente confirmada?',
    reasoning: 'La intención de reunirse continúa, pero el horario cambió. Aura recomienda cerrar una nueva fecha de inmediato.',
  },
  {
    key: 'outside_hours_auto_reply',
    label: 'Respuesta automática fuera de horario',
    priority: 90,
    confidence: 94,
    patterns: [
      /\b(fuera de|fuera del) (nuestro )?horario\b/i,
      /\bhorario de atencion\b/i,
      /\ben este momento estamos (cerrados|fuera de servicio)\b/i,
      /\bte responderemos (pronto|en horario|cuando regresemos)\b/i,
      /\bnuestro horario es de\b/i,
    ],
    outcome: 'Respuesta automática fuera de horario',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Contactar dentro del horario con el mensaje corregido.',
    reply: 'Hola 😊 Retomo mi mensaje dentro de su horario de atención. Mi nombre es Maikol y escribo de parte de Laura Rodriguez. ¿Podría indicarme quién gestiona las consultas y su seguimiento en la empresa?',
    reasoning: 'La respuesta provino de una automatización y no representa interés ni rechazo. El lead debe seguir abierto.',
  },
  {
    key: 'generic_auto_reply',
    label: 'Respuesta automática de recepción',
    priority: 89,
    confidence: 91,
    patterns: [
      /\bgracias por (comunicarte|comunicarse|contactarnos|escribirnos)\b.*\b(en breve|pronto|lo antes posible)\b/i,
      /\bhemos recibido (tu|su) (mensaje|consulta|solicitud)\b/i,
      /\buno de (nuestros|nuestro) (asesores|agentes|representantes) (te|le) respondera\b/i,
      /\btu mensaje ha sido recibido\b/i,
    ],
    outcome: 'Bot pidió nombre y motivo',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Esperar la respuesta humana y retomar si no ocurre.',
    reply: 'Gracias 😊 Quedo pendiente de la persona encargada. Mi consulta es sobre cómo gestionan y dan seguimiento a las consultas que reciben por sus canales digitales.',
    reasoning: 'La empresa confirmó recepción mediante una automatización. Aura recomienda no tratarlo como respuesta humana.',
  },
  {
    key: 'bot_requested_name_reason',
    label: 'Bot pidió nombre y motivo',
    priority: 88,
    confidence: 94,
    patterns: [
      /\b(indica|indiquenos|escribe|compartenos|ingresa) (tu|su)? ?nombre\b/i,
      /\b(cual es|indica|indiquenos|escribe) (el )?motivo\b/i,
      /\bpara poder ayudarte.*\bnombre\b/i,
      /\b(nombre completo|motivo de contacto|motivo de la consulta)\b/i,
    ],
    outcome: 'Bot pidió nombre y motivo',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Responder al bot y solicitar a la persona encargada.',
    reply: 'Hola 😊 Mi nombre es Maikol y escribo de parte de Laura Rodriguez. Estamos realizando una revisión breve de cómo las empresas gestionan y dan seguimiento a sus consultas. ¿Podría indicarme quién es la persona encargada de este proceso?',
    reasoning: 'Todavía no respondió una persona. Aura recomienda completar el filtro del bot y pedir directamente al responsable.',
  },
  {
    key: 'bot_menu',
    label: 'Bot mostró un menú de opciones',
    priority: 87,
    confidence: 93,
    patterns: [
      /\b(selecciona|seleccione|elige|elija) (una|la) opcion\b/i,
      /\b(responde|escribe|marca) (con )?(el )?(numero|número)\b/i,
      /\bmenu (principal|de opciones)\b/i,
      /\bopcion 1\b.*\bopcion 2\b/i,
    ],
    outcome: 'Bot pidió nombre y motivo',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Elegir la opción más cercana a administración o hablar con un asesor.',
    reply: 'Hola 😊 Mi consulta no es para agendar un servicio. Es una consulta comercial sobre su proceso de atención y seguimiento. ¿Podrían comunicarme con administración o con la persona encargada?',
    reasoning: 'La conversación está detenida en un menú automático. Aura recomienda buscar la ruta hacia una persona o administración.',
  },
  {
    key: 'patient_flow',
    label: 'WhatsApp abrió un flujo para pacientes',
    priority: 86,
    confidence: 94,
    patterns: [
      /\b(agendar|reservar|confirmar) (una )?(cita|consulta)\b/i,
      /\bselecciona (el|un) (servicio|tratamiento|especialidad)\b/i,
      /\bmotivo de (tu|su) consulta (medica|dental)?\b/i,
      /\bdatos del paciente\b/i,
      /\bnumero de cedula del paciente\b/i,
    ],
    outcome: 'WhatsApp abrió flujo de paciente',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Aclarar que es una consulta comercial y pedir al encargado.',
    reply: 'Hola 😊 Disculpe, el sistema abrió el flujo de pacientes. Mi consulta es comercial: escribo de parte de Laura Rodriguez para conocer cómo gestionan y dan seguimiento a las consultas que reciben. ¿Con quién podría conversar sobre ese proceso?',
    reasoning: 'El canal es correcto, pero la conversación entró por el flujo equivocado. Debe corregirse el contexto antes de continuar.',
  },
  {
    key: 'referral',
    label: 'Compartió o indicó otro contacto',
    priority: 85,
    confidence: 94,
    patterns: [
      /\b(escribele|escribale|contacta|contacte|habla|hable) (a|con)\b/i,
      /\b(te|le) paso (el|su|otro) (numero|contacto|correo|email)\b/i,
      /\b(comunicate|comuniquese) con\b/i,
      /\bla persona encargada es\b/i,
      /\beste es (el|su) (numero|contacto|correo)\b/i,
    ],
    outcome: 'Referido a otro contacto',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Crear o actualizar el contacto referido y escribirle.',
    reply: 'Muchas gracias. ¿Podría compartirme el nombre, el contacto y el mejor horario para escribirle a la persona encargada?',
    reasoning: 'El contacto actual redirigió la oportunidad. Aura recomienda crear el referido y continuar con él.',
  },
  {
    key: 'send_email',
    label: 'Pidió continuar por correo',
    priority: 84,
    confidence: 91,
    patterns: [
      /\b(enviame|mandame|envie|mande|escribeme|escriba) (eso |la informacion |la propuesta )?(al|a mi|por) (correo|email)\b/i,
      /\bmejor por (correo|email)\b/i,
      /\bnuestro correo es\b/i,
    ],
    outcome: 'Referido a otro contacto',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: 'Canal preferido: correo',
    nextStep: 'Registrar el correo, enviar el mensaje y fijar seguimiento.',
    reply: 'Perfecto. ¿Me confirma el correo correcto y a nombre de quién debo dirigir la información? También dejaré programado el seguimiento para no enviarla sin contexto.',
    reasoning: 'La persona indicó un canal específico. Aura recomienda registrar el dato y mantener un siguiente paso concreto.',
  },
  {
    key: 'request_call',
    label: 'Pidió continuar por llamada',
    priority: 83,
    confidence: 91,
    patterns: [
      /\b(llamame|llameme|puedes llamarme|puede llamarme|mejor llamame|mejor por llamada)\b/i,
      /\b(hablemos|conversemos) por (telefono|llamada)\b/i,
      /\bpuedes llamar (hoy|manana|en la tarde|a las)\b/i,
    ],
    outcome: 'Seguimiento solicitado',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: 'Canal preferido: llamada',
    nextStep: 'Confirmar dos horarios y registrar la llamada.',
    reply: 'Perfecto 😊 Tengo dos espacios disponibles. ¿Les funciona mejor la primera opción o la segunda?',
    reasoning: 'La persona aceptó continuar por llamada. Aura recomienda convertirlo en un horario concreto.',
  },
  {
    key: 'decision_maker_unavailable',
    label: 'Decisor no disponible',
    priority: 82,
    confidence: 93,
    patterns: [
      /\b(el|la|nuestro|nuestra) (encargad[oa]|doctor|doctora|dueno|duena|gerente|administrador[oa]) no esta\b/i,
      /\b(regresa|vuelve|estara) (manana|el lunes|la proxima semana|en la tarde)\b/i,
      /\besta (de vacaciones|ocupad[oa]|en reunion|fuera de la oficina)\b/i,
    ],
    outcome: 'Decisor no disponible',
    status: 'waiting_decision_maker',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Decisor no disponible',
    nextStep: 'Contactar en el horario indicado y registrar al decisor.',
    reply: 'Gracias. ¿Podría indicarme el nombre de la persona encargada y el mejor día u horario para contactarla?',
    reasoning: 'La persona responsable existe, pero no está disponible. Aura recomienda fijar cuándo retomar.',
  },
  {
    key: 'intermediary',
    label: 'No se contactó al decisor',
    priority: 81,
    confidence: 92,
    patterns: [
      /\b(yo|nosotros) no (decido|decidimos|veo|vemos|manejo|manejamos) eso\b/i,
      /\beso lo (ve|maneja|decide) (la|el|mi|nuestro|nuestra)? ?(doctor|doctora|administracion|gerencia|dueno|duena|encargad[oa])\b/i,
      /\bno soy (la|el) (persona|encargad[oa]|responsable|indicad[oa])\b/i,
      /\bdebe hablar con (administracion|gerencia|el doctor|la doctora|el encargado|la encargada)\b/i,
    ],
    outcome: 'Contacto con intermediario',
    status: 'waiting_decision_maker',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'No se contactó al decisor',
    nextStep: 'Identificar al decisor y acordar cuándo contactarlo.',
    reply: 'Gracias. ¿Podría indicarme el nombre de la persona encargada y el mejor horario para contactarla? Así no les envío información genérica.',
    reasoning: 'La persona respondió, pero no tiene autoridad sobre el proceso. Aura recomienda identificar al decisor.',
  },
  {
    key: 'internal_approval',
    label: 'Requiere aprobación interna',
    priority: 80,
    confidence: 90,
    patterns: [
      /\b(tengo|tenemos|debo|debemos|voy|vamos) (que )?(consultar|consultarlo|preguntar|validar|validarlo|revisar|revisarlo|hablar) con\b/i,
      /\b(lo|se lo) (consulto|presento|comento) (a|con) (mi|el|la|los) (socio|socia|jefe|jefa|gerente|gerencia|doctor|doctora|equipo)\b/i,
      /\bnecesito (aprobacion|autorizacion|validacion)\b/i,
    ],
    outcome: 'Esperando confirmación',
    status: 'waiting_confirmation',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Aprobación interna',
    nextStep: 'Definir cuándo tendrá respuesta y programar seguimiento.',
    reply: 'Perfecto. ¿Cuándo cree que podrá validarlo internamente? Así dejo programado el seguimiento para esa fecha.',
    reasoning: 'La persona no rechazó; necesita una validación interna. Aura recomienda acordar una fecha de respuesta.',
  },
  {
    key: 'existing_internal_owner',
    label: 'Ya cuenta con una persona o equipo encargado',
    priority: 79,
    confidence: 92,
    patterns: [
      /\b(ya tenemos|ya contamos con|ya hay|tenemos|contamos con) (a )?(una persona|alguien|un encargado|una encargada|encargad[oa]|un equipo|un departamento|personal)(?: (para eso|encargad[oa]|que se encarga))?\b/i,
      /\b(eso|el seguimiento|las consultas|los mensajes|whatsapp|las redes) ya lo (maneja|lleva|ve|gestiona|atiende) (una persona|alguien|el encargado|la encargada|recepcion|administracion|nuestro equipo|la secretaria|la recepcionista|nuestra recepcionista|nuestro recepcionista|el community manager|nuestro community manager)\b/i,
      /\b(lo|eso) (hacemos|manejamos|gestionamos|llevamos) (internamente|nosotros mismos|con nuestro equipo)\b/i,
      /\b(tenemos|hay) (recepcionista|secretaria|community manager|equipo comercial|departamento de ventas|departamento de atencion)\b/i,
      /\b(nuestra|nuestro) (recepcionista|secretaria|equipo|administracion) se encarga\b/i,
    ],
    outcome: 'Objeción identificada',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Ya cuenta con encargado',
    nextStep: 'Aclarar que no se busca reemplazar al encargado y detectar brechas de seguimiento, medición o herramientas.',
    reply: 'Perfecto 😊 No buscamos reemplazar a la persona o al equipo encargado. Lo que revisamos es si el proceso actual permite responder a tiempo, dar seguimiento y medir cuántas consultas se convierten. ¿Hoy llevan ese control en alguna herramienta o depende principalmente del equipo?',
    reasoning: 'La empresa ya tiene responsables internos, pero eso no confirma que el proceso esté sistematizado ni medido. Aura recomienda explorar brechas sin generar percepción de reemplazo.',
  },
  {
    key: 'existing_provider',
    label: 'Ya trabaja con un proveedor o agencia',
    priority: 78,
    confidence: 91,
    patterns: [
      /\bya (tenemos|trabajamos con|contratamos|usamos) (una|un|otra|otro)? ?(agencia|proveedor|consultor|consultora|empresa externa)\b/i,
      /\bnos lo (maneja|lleva|gestiona) (una|la|un|el) (agencia|proveedor|consultor|empresa)\b/i,
      /\btenemos contrato con\b/i,
      /\bestamos (contentos|bien|conformes) con (la|el|nuestro|nuestra) (agencia|proveedor|consultor)\b/i,
    ],
    outcome: 'Ya tiene proveedor',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 2',
    followupDelayDays: 60,
    terminal: false,
    appointmentBooked: false,
    objection: 'Ya utiliza proveedor',
    nextStep: 'Preguntar qué funciona y qué todavía les cuesta; revisar en nurture.',
    reply: 'Perfecto. No busco reemplazar algo que ya funciona. ¿Hay algún punto del proceso actual que todavía les cueste, por ejemplo seguimiento, velocidad de respuesta o visibilidad de resultados?',
    reasoning: 'Tener proveedor no elimina necesariamente la necesidad. Aura recomienda explorar brechas sin confrontar la solución actual.',
  },
  {
    key: 'existing_system',
    label: 'Ya utiliza un sistema o CRM',
    priority: 77,
    confidence: 91,
    patterns: [
      /\bya (tenemos|usamos|utilizamos|trabajamos con) (un|una|el|la)? ?(crm|sistema|software|plataforma|automatizacion|bot|chatbot)\b/i,
      /\b(usamos|utilizamos|tenemos) (kommo|hubspot|zoho|salesforce|monday|trello|excel|google sheets|whatsapp business)\b/i,
      /\bya esta (automatizado|sistematizado)\b/i,
      /\btenemos todo en (excel|sheets|un sistema|el crm)\b/i,
    ],
    outcome: 'Ya tiene proveedor',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 2',
    followupDelayDays: 30,
    terminal: false,
    appointmentBooked: false,
    objection: 'Ya utiliza sistema o CRM',
    nextStep: 'Identificar qué cubre el sistema y qué sigue siendo manual.',
    reply: 'Perfecto. Para no duplicar lo que ya tienen, ¿qué parte cubre hoy el sistema y qué sigue dependiendo de tareas manuales o del seguimiento de una persona?',
    reasoning: 'Usar una herramienta no garantiza adopción, integración ni seguimiento efectivo. Aura recomienda identificar la brecha concreta.',
  },
  {
    key: 'privacy_source',
    label: 'Pregunta por el origen del contacto o sus datos',
    priority: 76,
    confidence: 93,
    patterns: [
      /\b(de donde|como) (sacaste|sacaron|obtuviste|obtuvieron|conseguiste|consiguieron) (mi|nuestro|este) (numero|contacto|dato|datos)\b/i,
      /\bquien (te|les) dio (mi|nuestro) (numero|contacto)\b/i,
      /\bpor que tienes mi numero\b/i,
      /\bcomo encontraste (la empresa|el negocio|nuestro contacto)\b/i,
    ],
    outcome: 'Objeción identificada',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Privacidad / origen del contacto',
    nextStep: 'Responder con transparencia y confirmar si desea continuar.',
    reply: 'Claro. Encontramos el contacto publicado por la empresa en sus canales comerciales. Mi mensaje es de parte de Laura Rodriguez y se relaciona con la gestión de consultas y seguimiento. ¿Le parece bien que le explique brevemente el motivo?',
    reasoning: 'La persona necesita transparencia antes de continuar. Aura recomienda explicar el origen del contacto sin evadir la pregunta.',
  },
  {
    key: 'skepticism',
    label: 'Desconfianza o percepción de spam',
    priority: 75,
    confidence: 92,
    patterns: [
      /\b(esto|eso) (es|parece|se ve como) (spam|estafa|fraude)\b/i,
      /\bno (confio|me da confianza|parece real)\b/i,
      /\bquien eres|quienes son ustedes|de parte de quien\b/i,
      /\bes una llamada de ventas\b/i,
    ],
    outcome: 'Objeción identificada',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Confianza / identidad',
    nextStep: 'Identificarse, explicar el motivo y ofrecer una verificación pública.',
    reply: 'Entiendo la cautela. Soy Maikol y escribo de parte de Laura Rodriguez, estratega de crecimiento y automatización. Puedo compartirle su página y perfil profesional para que verifique la información antes de continuar.',
    reasoning: 'La barrera principal es confianza, no necesariamente falta de interés. Aura recomienda validar identidad antes de vender.',
  },
  {
    key: 'budget',
    label: 'Restricción de presupuesto',
    priority: 74,
    confidence: 91,
    patterns: [
      /\b(no tenemos|no hay|no cuento con|no contamos con|sin) (presupuesto|budget|dinero)\b/i,
      /\b(se sale|esta fuera) de (mi|nuestro|el) presupuesto\b/i,
      /\b(muy|demasiado) (caro|costoso)\b/i,
      /\b(no podemos|no puedo) (invertir|pagar|gastar)\b/i,
      /\bno tenemos presupuesto (ahora|este mes|por el momento)\b/i,
    ],
    outcome: 'Objeción identificada',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 7,
    terminal: false,
    appointmentBooked: false,
    objection: 'Presupuesto',
    nextStep: 'Validar prioridad, costo del problema y rango viable.',
    reply: 'Entiendo. Para no proponer algo fuera de contexto, ¿hoy el problema les está haciendo perder tiempo, citas o consultas? Con eso podemos evaluar si existe un primer paso pequeño que tenga sentido.',
    reasoning: 'Existe una objeción económica, no un rechazo definitivo. Aura recomienda validar impacto y prioridad antes de hablar de una solución mayor.',
  },
  {
    key: 'no_need',
    label: 'Percibe que no necesita la solución',
    priority: 73,
    confidence: 90,
    patterns: [
      /\bno (lo|la) necesitamos\b/i,
      /\b(no tenemos|no hay) (ese problema|problemas con eso|necesidad)\b/i,
      /\b(todo|eso) (funciona|esta) (bien|perfecto)\b/i,
      /\bestamos bien (asi|como estamos)\b/i,
      /\bya lo tenemos resuelto\b/i,
    ],
    outcome: 'Objeción identificada',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 30,
    terminal: false,
    appointmentBooked: false,
    objection: 'No percibe necesidad',
    nextStep: 'Validar cómo miden respuesta, seguimiento y conversión antes de cerrar.',
    reply: 'Perfecto. Para entenderlo bien, ¿hoy pueden ver con claridad cuánto tardan en responder, cuántas consultas reciben seguimiento y cuántas terminan en cita o venta?',
    reasoning: 'La empresa percibe que el proceso funciona. Aura recomienda validar con métricas antes de asumir que no existe una brecha.',
  },
  {
    key: 'busy_now',
    label: 'No puede atender en este momento',
    priority: 72,
    confidence: 89,
    patterns: [
      /\b(ahora|en este momento) (no puedo|no podemos|estoy ocupad[oa]|estamos ocupados|estoy en reunion|estoy atendiendo)\b/i,
      /\bno puedo hablar (ahora|en este momento)\b/i,
      /\bestoy (manejando|trabajando|con un paciente|con un cliente)\b/i,
    ],
    outcome: 'Seguimiento solicitado',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'No disponible ahora',
    nextStep: 'Pedir un día u horario concreto para retomar.',
    reply: 'Claro, no hay problema. ¿Le funciona mejor que lo retomemos más tarde o mañana en un horario específico?',
    reasoning: 'La persona no rechazó; únicamente no puede atender ahora. Aura recomienda convertirlo en un seguimiento concreto.',
  },
  {
    key: 'timing',
    label: 'Pidió retomar después',
    priority: 71,
    confidence: 90,
    patterns: [
      /\b(mas adelante|despues|otro dia|la proxima semana|el proximo mes|en unas semanas)\b/i,
      /\b(ahora|hoy) no (es buen momento|podemos verlo|me conviene)\b/i,
      /\b(escribeme|escriba|llamame|llameme|contactame|contactenos) (manana|luego|despues|el lunes|la proxima semana)\b/i,
      /\bcuando (tenga|tengamos) tiempo\b/i,
    ],
    outcome: 'Seguimiento solicitado',
    status: 'followup_scheduled',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Momento / prioridad',
    nextStep: 'Retomar en la fecha acordada.',
    reply: 'Claro. ¿Qué día les funciona mejor para retomarlo? Así lo dejo agendado y no les escribo fuera de contexto.',
    reasoning: 'La conversación sigue abierta, pero el momento no es inmediato. Aura recomienda convertir “después” en una fecha concreta.',
  },
  {
    key: 'waiting_confirmation',
    label: 'Quedó una confirmación pendiente',
    priority: 70,
    confidence: 89,
    patterns: [
      /\b(te|le|les) (confirmo|confirmamos|avisamos|aviso)\b/i,
      /\bdejame|dejenme\b.*\b(revisar|validar|confirmar)\b/i,
      /\b(consulto|reviso|verifico) y (te|le|les) (digo|aviso|confirmo)\b/i,
      /\bpendiente de (confirmar|respuesta|aprobacion|validacion)\b/i,
    ],
    outcome: 'Esperando confirmación',
    status: 'waiting_confirmation',
    commercialStatus: 'Seguimiento 1',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Definir una fecha límite y programar seguimiento.',
    reply: 'Perfecto, quedo pendiente. ¿Les parece bien que retome la conversación mañana si todavía no tengo confirmación?',
    reasoning: 'La persona pidió tiempo para validar. Aura recomienda fijar cuándo se retomará para evitar un seguimiento indefinido.',
  },
  {
    key: 'price_request',
    label: 'Solicitó precio o planes',
    priority: 69,
    confidence: 91,
    patterns: [
      /\bcuanto (cuesta|sale|vale|cobran)\b/i,
      /\b(cual es|cuales son) (el|los|su|sus) (precio|precios|tarifa|tarifas|planes)\b/i,
      /\b(enviame|mandame|comparteme) (los|el)? ?(precios|tarifas|planes|cotizacion)\b/i,
      /\bque precio tiene\b/i,
    ],
    outcome: 'Solicitó información',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Precio',
    nextStep: 'Aclarar alcance y necesidad antes de cotizar.',
    reply: 'Claro. Para indicarle el precio correcto y no enviarle algo genérico, necesito confirmar brevemente cómo gestionan hoy las consultas y qué parte desean mejorar.',
    reasoning: 'La persona pidió precio, pero falta contexto para cotizar correctamente. Aura recomienda calificar antes de enviar una cifra aislada.',
  },
  {
    key: 'proof_request',
    label: 'Solicitó pruebas, referencias o casos',
    priority: 68,
    confidence: 91,
    patterns: [
      /\b(tienen|tienes|puedes enviar|puede enviar) (casos de exito|referencias|testimonios|portafolio|ejemplos|resultados)\b/i,
      /\bquiero ver (casos|resultados|trabajos|clientes)\b/i,
      /\bcon quien han trabajado\b/i,
    ],
    outcome: 'Solicitó información',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Prueba / credibilidad',
    nextStep: 'Compartir evidencia relevante y acordar el siguiente paso.',
    reply: 'Claro. Le comparto evidencia relacionada con su tipo de negocio y, después de verla, coordinamos una conversación breve para revisar si aplica a su caso.',
    reasoning: 'La persona necesita reducir riesgo mediante evidencia. Aura recomienda compartir pruebas específicas, no un portafolio genérico.',
  },
  {
    key: 'request_information',
    label: 'Solicitó información',
    priority: 67,
    confidence: 90,
    patterns: [
      /\b(enviame|mandame|comparteme|pasame|envie|mande) (la|mas|esa|algo de)? ?(informacion|info|propuesta|presentacion|detalles)\b/i,
      /\bpuedes (enviar|mandar|compartir|explicar)\b/i,
      /\bquiero (ver|conocer|saber) mas\b/i,
      /\bde que se trata\b/i,
      /\bcomo funciona\b/i,
    ],
    outcome: 'Solicitó información',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Enviar información concreta y acordar seguimiento.',
    reply: 'Claro 😊 Para enviarle algo relevante y no genérico, primero quisiera confirmar algo: ¿actualmente el seguimiento de las consultas se realiza manualmente o utilizan algún sistema?',
    reasoning: 'La persona abrió la conversación, pero enviar una presentación genérica puede enfriarla. Aura recomienda hacer una pregunta de calificación.',
  },
  {
    key: 'meeting_requested',
    label: 'Interés en coordinar una conversación',
    priority: 66,
    confidence: 92,
    patterns: [
      /\b(agendemos|coordinemos|hagamos|quiero|quisiera) (agendar |coordinar |hacer )?(una|la)? ?(reunion|llamada|meet|demo)\b/i,
      /\bcuando (puedes|puede|podemos) (hablar|reunirnos|verlo)\b/i,
      /\bpodemos (hablar|coordinar|agendar)\b/i,
      /\bme gustaria (hablar|verlo|una llamada)\b/i,
    ],
    outcome: 'Interesado',
    status: 'conversation_active',
    commercialStatus: 'Interesado',
    followupDelayDays: 0,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Ofrecer dos horarios cerrados y confirmar uno.',
    reply: 'Excelente 😊 Laura tiene dos espacios disponibles. ¿Les funciona mejor la primera opción o la segunda?',
    reasoning: 'Existe intención concreta de conversar, pero todavía falta una fecha confirmada. Aura recomienda ofrecer dos horarios.',
  },
  {
    key: 'positive_interest',
    label: 'Interés comercial',
    priority: 65,
    confidence: 90,
    patterns: [
      /\b(me interesa|nos interesa|suena interesante|me gusta|nos gusta)\b/i,
      /\b(esto|eso) (nos|me) puede (servir|ayudar|funcionar)\b/i,
      /\bquiero (probar|avanzar|hacerlo|conocerlo)\b/i,
      /\bcomo (seguimos|avanzamos|empezamos)\b/i,
      /\bcuentame mas\b/i,
    ],
    outcome: 'Interesado',
    status: 'conversation_active',
    commercialStatus: 'Interesado',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Acordar reunión o siguiente paso concreto.',
    reply: 'Excelente 😊 Para aterrizarlo a su caso, propongo una llamada breve de 15 minutos para revisar el proceso actual y definir el primer paso. ¿Les funciona mejor uno de estos dos horarios?',
    reasoning: 'La persona mostró interés, pero todavía falta convertirlo en una acción concreta. Aura recomienda pedir un compromiso claro.',
  },
  {
    key: 'manual_process_pain',
    label: 'Proceso manual o pérdida de seguimiento',
    priority: 64,
    confidence: 91,
    patterns: [
      /\b(todo|el seguimiento|las respuestas|las consultas) (es|se hace|lo hacemos) manual\b/i,
      /\b(no tenemos|no usamos) (crm|sistema|automatizacion|software)\b/i,
      /\b(usamos|llevamos) (excel|google sheets|una libreta|papel|whatsapp)\b/i,
      /\bse (nos )?(pierden|quedan) (mensajes|consultas|clientes|seguimientos)\b/i,
      /\b(no damos|nos cuesta dar|se nos olvida el) seguimiento\b/i,
      /\b(tardamos|demoramos) (mucho )?en responder\b/i,
    ],
    outcome: 'Respondió',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: 'Brecha operativa detectada',
    nextStep: 'Cuantificar el impacto y proponer una revisión breve.',
    reply: 'Gracias, eso ayuda a entender el contexto. Aproximadamente, ¿cuántas consultas reciben al mes y qué ocurre hoy con las personas que no compran o no agendan en el primer contacto?',
    reasoning: 'La persona describió una brecha real de proceso. Aura recomienda cuantificar volumen e impacto antes de presentar la solución.',
  },
  {
    key: 'low_volume',
    label: 'Bajo volumen de consultas',
    priority: 63,
    confidence: 88,
    patterns: [
      /\brecibimos (muy )?pocas (consultas|mensajes|solicitudes|citas)\b/i,
      /\b(no llegan|casi no llegan) (consultas|mensajes|clientes|pacientes)\b/i,
      /\bmenos de (cinco|diez|veinte|5|10|20) (consultas|mensajes)\b/i,
      /\bno tenemos mucho volumen\b/i,
    ],
    outcome: 'Respondió',
    status: 'conversation_active',
    commercialStatus: 'Respondió',
    followupDelayDays: 7,
    terminal: false,
    appointmentBooked: false,
    objection: 'Bajo volumen',
    nextStep: 'Validar ticket, origen de consultas y prioridad de crecimiento.',
    reply: 'Entiendo. ¿El reto principal es generar más consultas o convertir mejor las pocas que ya reciben? Con eso podemos definir si el diagnóstico aplica.',
    reasoning: 'El volumen puede ser bajo, pero aún falta validar ticket y prioridad. Aura recomienda no descartar automáticamente.',
  },
  {
    key: 'generic_acknowledgement',
    label: 'Respuesta breve sin intención explícita',
    priority: 20,
    confidence: 64,
    patterns: [
      /^\s*(ok|okay|oki|dale|listo|perfecto|entendido|comprendo|gracias|muchas gracias|bien|bueno)\s*[.!]*$/i,
      /^\s*(ok|perfecto|gracias),? (gracias|entendido|lo reviso)\s*[.!]*$/i,
    ],
    outcome: 'Respondió',
    status: 'response_received',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Hacer una pregunta de calificación y acordar el siguiente paso.',
    reply: 'Gracias 😊 Para entender mejor el contexto, ¿cómo gestionan actualmente las consultas y el seguimiento de las personas que no compran o no agendan en el primer contacto?',
    reasoning: 'La persona respondió, pero no expresó interés, objeción ni compromiso. Aura recomienda continuar con una pregunta de calificación.',
  },
  {
    key: 'greeting_only',
    label: 'Saludo sin intención explícita',
    priority: 10,
    confidence: 58,
    patterns: [
      /^\s*(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|digame|si diga)\s*[.!]*$/i,
    ],
    outcome: 'Respondió',
    status: 'response_received',
    commercialStatus: 'Respondió',
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    nextStep: 'Presentarse brevemente y confirmar si el seguimiento es manual o utiliza un sistema.',
    reply: 'Hola 😊 Soy Maikol Brown, asistente de consultoría de Growth by Laura. Estamos conversando con clínicas para entender cómo organizan y dan seguimiento a las personas que consultan por WhatsApp. Quería hacerles una pregunta breve: ¿actualmente ese seguimiento lo realizan manualmente o utilizan algún sistema?',
    reasoning: 'La persona abrió la conversación con un saludo. Aura usa el primer contacto actualizado y hace una sola pregunta sobre el sistema de seguimiento.',
  }
];

const CONVERSATION_LABELS = {
  not_started: 'No iniciada',
  waiting_response: 'Esperando respuesta',
  response_received: 'Respuesta recibida',
  conversation_active: 'Conversación activa',
  waiting_decision_maker: 'Esperando al decisor',
  waiting_confirmation: 'Esperando confirmación',
  followup_scheduled: 'Seguimiento programado',
  closed: 'Cerrada',
};

function contextualRuleKey(scopeNormalized, previousAgentNormalized) {
  const shortYes = /^(si|correcto|exacto|asi es|claro)[,;.!]*$/.test(scopeNormalized);
  const shortNo = /^(no|negativo|para nada|no lo hacemos)[,;.!]*$/.test(scopeNormalized);
  const shortMe = /^(yo|conmigo|yo mismo|yo misma)[,;.!]*$/.test(scopeNormalized);
  if (!previousAgentNormalized) return null;

  const askedMeasurement = /(forma clara de saber|cuantas consultas|miden|medir).*(citas|clientes|ventas|conversion)/.test(previousAgentNormalized)
    || /(conversion).*(consultas|citas|ventas)/.test(previousAgentNormalized);
  if (askedMeasurement && shortNo) return 'maikol_not_measuring';
  if (askedMeasurement && shortYes) return 'maikol_yes_measuring';

  const askedSystem = /(utilizan|usan|tienen|cuentan con).*(sistema|crm|software|plataforma)/.test(previousAgentNormalized);
  if (askedSystem && shortNo) return 'maikol_no_system';
  if (askedSystem && shortYes) return 'maikol_uses_system';

  const askedResponsible = /(con quien|quien).*(conversar|hablar|encargad|supervisa|maneja)/.test(previousAgentNormalized);
  if (askedResponsible && (shortMe || /^(soy yo|yo lo manejo|yo me encargo)[,;.!]*$/.test(scopeNormalized))) {
    return 'maikol_decision_maker_present';
  }

  const askedOwnerScope = /esa persona supervisa.*(seguimiento|conversion)/.test(previousAgentNormalized);
  if (askedOwnerScope && shortYes) return 'maikol_decision_maker_present';

  return null;
}

export function analyzeChatLocally(transcript, channel = 'WhatsApp', options = {}) {
  const setterName = normalizedSetterName(options?.setterName);
  const context = chatAnalysisContext(transcript, setterName);
  const scope = context.scope;
  const normalized = normalizeChatText(scope);
  const previousAgentNormalized = normalizeChatText(context.previousAgentMessage);
  const contextualKey = contextualRuleKey(normalized, previousAgentNormalized);
  const contextualRule = contextualKey
    ? CHAT_RESPONSE_LIBRARY.find((rule) => rule.key === contextualKey)
    : null;
  const detectedMatches = CHAT_RESPONSE_LIBRARY
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(normalized)));
  const matches = [contextualRule, ...detectedMatches]
    .filter(Boolean)
    .filter((rule, index, items) => items.findIndex((item) => item.key === rule.key) === index)
    .sort((a, b) => {
      if (a.key === contextualKey) return -1;
      if (b.key === contextualKey) return 1;
      return b.priority - a.priority;
    });

  const fallback = {
    key: 'response',
    label: 'Respuesta sin intención explícita',
    outcome: 'Respondió',
    status: 'response_received',
    commercialStatus: 'Respondió',
    nextStep: 'Identificar al responsable o formular una sola pregunta de calificación.',
    reply: 'Gracias por responder 😊 Para orientarme correctamente, ¿usted supervisa el seguimiento de las consultas por WhatsApp o debería conversar con otra persona?',
    reasoning: 'La conversación está abierta, pero todavía falta información para decidir el siguiente paso.',
    confidence: normalized.length < 2 ? 0 : 48,
    followupDelayDays: 1,
    terminal: false,
    appointmentBooked: false,
    objection: '',
    patterns: [],
  };
  const detected = matches[0] || fallback;
  const finalOutcome = Boolean(detected.terminal || detected.status === 'closed');
  const explicitDate = explicitFollowupDate(normalized);
  const followupDate = finalOutcome
    ? null
    : (explicitDate
      || (detected.followupMode === 'next_business_day'
        ? nextBusinessISODate(detected.followupDelayDays ?? 1)
        : localISODate(detected.followupDelayDays ?? 1)));
  const confidence = Math.min(99, detected.confidence + Math.min(5, Math.max(0, matches.length - 1)));
  const suggestion = {
    activity_type: 'response_received',
    conversation_status: detected.status,
    outcome_stage: finalOutcome ? 'final' : 'provisional',
    outcome: detected.outcome,
    objection: detected.objection || '',
    next_step: detected.nextStep,
    followup_date: followupDate,
    commercial_status: detected.commercialStatus,
    is_final_outcome: finalOutcome,
    awaiting_response: ['waiting_response', 'waiting_confirmation', 'waiting_decision_maker', 'followup_scheduled'].includes(detected.status),
    appointment_booked: Boolean(detected.appointmentBooked),
    channel,
  };

  return {
    method: 'aura_setter_playbook_browser_v3',
    library_version: '2026.07.29.5',
    confidence,
    summary: matches.length
      ? `Aura detectó ${detected.label.toLowerCase()}${matches[1] ? ` y también ${matches[1].label.toLowerCase()}` : ''}.`
      : (normalized.length < 2
        ? 'No hay suficiente texto para analizar.'
        : 'Hubo respuesta, pero Aura no detectó una intención comercial suficientemente explícita.'),
    recommended_reply: normalized.length < 2 ? '' : personalizeSetterText(detected.reply, setterName),
    reasoning: normalized.length < 2
      ? 'Pega una respuesta, un resumen o el TXT del chat para que Aura pueda proponer qué decir y cómo clasificarlo.'
      : personalizeSetterText(detected.reasoning, setterName),
    signals: matches.slice(0, 3).map((item) => ({
      key: item.key,
      label: item.label,
      priority: item.priority,
      confidence: item.confidence,
      outcome: item.outcome,
      conversation_status: item.status,
      commercial_status: item.commercialStatus,
      next_step: item.nextStep,
      objection: item.objection,
      evidence: evidenceLine(scope, item.patterns),
    })),
    analysis_scope: String(scope || '').slice(0, 500),
    classification: {
      commercial_status: detected.commercialStatus,
      conversation_status: detected.status,
      conversation_status_label: CONVERSATION_LABELS[detected.status] || detected.status,
      outcome: detected.outcome,
      next_step: detected.nextStep,
      followup_date: followupDate,
    },
    suggestion,
    warning: 'Respuesta sugerida por Aura. Revísala antes de enviarla. La clasificación ya fue aplicada automáticamente y puedes corregirla en Ajustar manualmente.',
  };
}
