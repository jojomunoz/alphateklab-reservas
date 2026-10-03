// Operaciones sobre el estado de un negocio de citas. Cada una recibe el estado (y lo modifica), la configuración
// del negocio y la hora de la demo, y devuelve { ok, … } o { ok:false, errores }. Sin DOM: se prueban con node --test.
//
// Estado de un negocio:
//   pacientes, citas, envios (la bandeja), tareas (llamadas de recepción), espera (lista de espera),
//   ofertas (huecos liberados ofrecidos a la lista), plantillas, regla (por defecto), ajustes, bitacora, procesados.

import { MIN, fechaISO, fechaLarga, horaTexto, sumarDias } from './tiempo.mjs';
import { validarCita, huecosDelDia, horasUnicas, servicioDe, profesionalDe, ESTADOS, salasPosibles, profesionalesPosibles, siguienteMomentoAbierto } from './agenda.mjs';
import { planificar, aplicarRespuesta, vencer, ajustarAVentana, REGLA_POR_DEFECTO, VENTANA, CANALES } from './recordatorios.mjs';
import { normalizarTelefono, validarCedula, validarCorreo, primerNombre } from './contacto.mjs';
import { PLANTILLAS_POR_DEFECTO, rellenar } from './mensajes.mjs';
import { codificar, aMinutos } from './enlace.mjs';
import { textoConsentimiento } from './negocios.mjs';

export const nuevoId = (prefijo) => `${prefijo}_${Math.random().toString(36).slice(2, 10)}`;

export function crearEstadoNegocio(negocio) {
  return {
    negocioId: negocio.id,
    pacientes: [], citas: [], envios: [], tareas: [], espera: [], ofertas: [],
    plantillas: { ...PLANTILLAS_POR_DEFECTO },
    regla: { ...REGLA_POR_DEFECTO, dias: [...REGLA_POR_DEFECTO.dias] },
    ajustes: { buffer: negocio.ajustes.buffer, autoConfirmar: negocio.ajustes.autoConfirmar },
    bitacora: [],
    procesados: [],
  };
}

/**
 * Ajustes de la agenda que la recepción cambia en la demo: minutos libres entre citas (buffer) y si las citas que
 * se piden en la página quedan confirmadas al momento.
 */
export function cambiarAjustes(st, cambios) {
  const errores = [];
  const nuevos = {};
  if ('buffer' in cambios) {
    const b = cambios.buffer;
    if (Number.isInteger(b) && b >= 0 && b <= 60 && b % 5 === 0) nuevos.buffer = b;
    else errores.push({ campo: 'buffer', mensaje: 'Los minutos entre citas van de 0 a 60, de 5 en 5.' });
  }
  if ('autoConfirmar' in cambios) {
    if (typeof cambios.autoConfirmar === 'boolean') nuevos.autoConfirmar = cambios.autoConfirmar;
    else errores.push({ campo: 'autoConfirmar', mensaje: 'Elige si se confirman solas o no.' });
  }
  if (errores.length) return { ok: false, errores };
  st.ajustes = { ...(st.ajustes || {}), ...nuevos };
  return { ok: true, ajustes: st.ajustes };
}

/** Configuración del negocio con los ajustes que la recepción cambió en la demo. */
export function negocioEfectivo(negocio, st) {
  return { ...negocio, ajustes: { ...negocio.ajustes, ...(st.ajustes || {}) } };
}

export function pacienteDe(st, id) { return st.pacientes.find((p) => p.id === id) || null; }
export function citaDe(st, id) { return st.citas.find((c) => c.id === id) || null; }

/** Canales a los que se le puede escribir: ninguno sin consentimiento vigente. */
export function canalesDe(paciente) {
  if (!paciente || !paciente.consentimiento || paciente.revocado) return [];
  const c = [];
  if (paciente.telefono) c.push('whatsapp', 'sms');
  if (paciente.correo) c.push('correo');
  return c;
}

/** Anota en la bitácora. `pacienteId` marca las entradas que nombran a una persona, para poder borrarla después. */
function anotar(st, t, texto, tipo = 'info', pacienteId = null) {
  st.bitacora.unshift({ t, texto, tipo, ...(pacienteId ? { pacienteId } : {}) });
  if (st.bitacora.length > 200) st.bitacora.length = 200;
}

/** Cierra las tareas de llamar abiertas de una cita (la persona ya respondió, la cita cambió o ya pasó). */
function cerrarTareas(st, citaId, ahora, resultado = 'cerrada') {
  for (const t of st.tareas) if (t.citaId === citaId && !t.hecha) t.hecha = { t: ahora, resultado };
}

// ── Pacientes ──────────────────────────────────────────────────────────────

/**
 * Revisa los datos de una persona sin tocar el estado y sin mirar si ya existe.
 * @returns {{errores: Array, nombre: string, ced: object, tel: object, correo: object}}
 */
export function revisarDatosPersona(datos, ahora) {
  const errores = [];
  const nombre = String(datos.nombre || '').trim().replace(/\s+/g, ' ');
  if (nombre.length < 3 || !nombre.includes(' ')) errores.push({ campo: 'nombre', mensaje: 'Escribe nombre y apellido.' });
  const ced = validarCedula(datos.cedula);
  if (!ced.ok) errores.push({ campo: 'cedula', mensaje: ced.error });
  const tel = normalizarTelefono(datos.telefono);
  if (!tel.ok) errores.push({ campo: 'telefono', mensaje: tel.error });
  const correo = validarCorreo(datos.correo);
  if (!correo.ok) errores.push({ campo: 'correo', mensaje: correo.error });
  if (datos.nacimiento && !/^\d{4}-\d{2}-\d{2}$/.test(datos.nacimiento)) errores.push({ campo: 'nacimiento', mensaje: 'La fecha de nacimiento no es válida.' });
  if (datos.nacimiento && datos.nacimiento > fechaISO(ahora)) errores.push({ campo: 'nacimiento', mensaje: 'La fecha de nacimiento no puede ser futura.' });
  if (!datos.consentimiento) {
    errores.push({ campo: 'consentimiento', mensaje: 'Falta el consentimiento: sin él no se pueden guardar los datos (Ley 81 de 2019).' });
  }
  return { errores, nombre, ced, tel, correo };
}

/** Registro en recepción: quien registra ve la lista, así que ante una cédula repetida se le dice de quién es. */
export function registrarPaciente(st, negocio, datos, ahora) {
  const { errores, nombre, ced, tel, correo } = revisarDatosPersona(datos, ahora);
  if (ced.ok) {
    const dup = st.pacientes.find((p) => p.cedula === ced.valor && !p.eliminado);
    if (dup) errores.push({ campo: 'cedula', mensaje: `Ya hay alguien con esa cédula: ${dup.nombre}. Búscalo en la lista.` });
  }
  if (errores.length) return { ok: false, errores };
  return { ok: true, paciente: guardarPersona(st, negocio, datos, { nombre, ced, tel, correo }, ahora) };
}

function guardarPersona(st, negocio, datos, { nombre, ced, tel, correo }, ahora) {
  const paciente = {
    id: nuevoId('p'),
    nombre,
    cedula: ced.valor,
    telefono: tel.e164,
    correo: correo.valor,
    nacimiento: datos.nacimiento || '',
    notas: String(datos.notas || '').trim().slice(0, 300),
    consentimiento: { fecha: ahora, canal: datos.canalConsentimiento || 'en persona', texto: textoConsentimiento(negocio), version: 1 },
    revocado: null,
    creado: ahora,
  };
  st.pacientes.push(paciente);
  anotar(st, ahora, `Se registró a ${nombre}.`, 'paciente', paciente.id);
  return paciente;
}

/** Retira el permiso: no se le vuelve a escribir y lo que estaba en cola se detiene. */
export function revocarConsentimiento(st, pacienteId, ahora) {
  const p = pacienteDe(st, pacienteId);
  if (!p) return { ok: false, errores: [{ mensaje: 'No existe esa persona.' }] };
  p.revocado = { fecha: ahora };
  for (const c of st.citas.filter((x) => x.pacienteId === pacienteId)) {
    st.envios = aplicarRespuesta(st.envios, c.id, 'sin_consentimiento', ahora);
  }
  anotar(st, ahora, `${p.nombre} retiró el permiso para mensajes. No se le escribirá más.`, 'paciente', p.id);
  return { ok: true };
}

export function renovarConsentimiento(st, negocio, pacienteId, canal, ahora) {
  const p = pacienteDe(st, pacienteId);
  if (!p) return { ok: false, errores: [{ mensaje: 'No existe esa persona.' }] };
  p.consentimiento = { fecha: ahora, canal, texto: textoConsentimiento(negocio), version: 1 };
  p.revocado = null;
  anotar(st, ahora, `${p.nombre} volvió a dar su permiso (${canal}).`, 'paciente', p.id);
  return { ok: true };
}

export const PERSONA_ELIMINADA = 'Persona eliminada';

/**
 * Derecho de cancelación (ARCO): borra los datos personales y deja las citas pasadas como anónimas. El nombre sale
 * también de la bitácora y de los mensajes ya enviados (su texto y su enlace lo llevaban); queda lo que pasó.
 */
export function eliminarPaciente(st, pacienteId, ahora) {
  const p = pacienteDe(st, pacienteId);
  if (!p) return { ok: false, errores: [{ mensaje: 'No existe esa persona.' }] };
  const futuras = st.citas.filter((c) => c.pacienteId === pacienteId && c.inicio > ahora && ['pendiente', 'confirmada', 'reprogramada'].includes(c.estado));
  if (futuras.length) {
    return { ok: false, errores: [{ mensaje: `Tiene ${futuras.length === 1 ? 'una cita próxima' : `${futuras.length} citas próximas`}. Cancélalas antes de borrar sus datos.` }] };
  }
  const nombre = p.nombre;
  for (const b of st.bitacora) {
    if (b.pacienteId === pacienteId || (nombre && b.texto.includes(nombre))) b.texto = b.texto.split(nombre).join('(persona eliminada)');
  }
  st.envios = st.envios
    .filter((e) => e.pacienteId !== pacienteId || e.estado !== 'programado')
    .map((e) => (e.pacienteId === pacienteId && (e.texto || e.enlace) ? { ...e, texto: '', enlace: '', borrado: ahora } : e));
  st.espera = st.espera.filter((e) => e.pacienteId !== pacienteId);
  Object.assign(p, { nombre: PERSONA_ELIMINADA, cedula: '', telefono: '', correo: '', nacimiento: '', notas: '', consentimiento: null, revocado: { fecha: ahora }, eliminado: ahora });
  anotar(st, ahora, 'Se borraron los datos de una persona a pedido suyo.', 'paciente');
  return { ok: true };
}

// ── Citas ──────────────────────────────────────────────────────────────────

/**
 * Programa en la bandeja los recordatorios de una cita según su regla. La tarea de llamar cae con el negocio
 * abierto. `previos` son los momentos de lo que ya salió (al cambiar la regla a mitad de camino).
 */
export function programarRecordatorios(st, cita, ahora, { negocio = null, previos = [] } = {}) {
  const paciente = pacienteDe(st, cita.pacienteId);
  const siguienteAbierto = negocio ? (ms) => siguienteMomentoAbierto(negocio, ms) : undefined;
  const plan = planificar(cita, cita.regla, ahora, { canales: canalesDe(paciente), ventana: VENTANA, previos, siguienteAbierto });
  for (const it of plan) {
    st.envios.push({
      id: nuevoId('e'),
      citaId: cita.id,
      pacienteId: cita.pacienteId,
      tipo: it.tipo,
      clase: it.tipo === 'llamar' ? 'llamar' : it.motivo,
      intento: it.intento || null,
      de: it.de || null,
      canal: it.canal || null,
      etiqueta: it.etiqueta || null,
      atrasado: !!it.atrasado,
      momento: it.momento,
      estado: 'programado',
      creado: ahora,
    });
  }
  return plan;
}

/** Completa profesional y sala si vienen como «cualquiera», con la primera combinación libre a esa hora. */
function asignar(negocio, st, datos, ahora, excluirCitaId = null) {
  if (datos.profesionalId && datos.salaId) return datos;
  const huecos = huecosDelDia({
    negocio, citas: st.citas, fecha: fechaISO(datos.inicio), servicioId: datos.servicioId,
    profesionalId: datos.profesionalId || null, salaId: datos.salaId || null, ahora: datos.permitirPasado ? 0 : ahora, excluirCitaId,
    pacienteId: datos.pacienteId || null,
  }).filter((h) => h.inicio === datos.inicio);
  if (huecos.length) return { ...datos, profesionalId: huecos[0].profesionalId, salaId: huecos[0].salaId };
  // Sin hueco a esa hora: se completa con lo habitual para que la validación diga el motivo real
  // (feriado, almuerzo, choque…) en vez de «elige el consultorio».
  const servicio = servicioDe(negocio, datos.servicioId);
  if (!servicio) return datos;
  const prof = profesionalDe(negocio, datos.profesionalId) || profesionalesPosibles(negocio, servicio)[0];
  const sala = datos.salaId || salasPosibles(negocio, servicio, prof)[0] || null;
  return { ...datos, profesionalId: prof ? prof.id : null, salaId: sala };
}

export function crearCita(st, negocioBase, datos, ahora, { origen = 'recepcion', permitirPasado = false } = {}) {
  const negocio = negocioEfectivo(negocioBase, st);
  const paciente = pacienteDe(st, datos.pacienteId);
  const errores = [];
  if (!paciente || paciente.eliminado) errores.push({ campo: 'paciente', mensaje: `Elige ${negocio.vocab.persona === 'paciente' ? 'un paciente' : 'un cliente'} o regístralo.` });
  const d = asignar(negocio, st, { ...datos, permitirPasado }, ahora);
  const servicio = servicioDe(negocio, d.servicioId);
  errores.push(...validarCita(negocio, st.citas, { ...d, fin: servicio ? d.inicio + servicio.min * MIN : undefined }, ahora, { permitirPasado }));
  if (errores.length) return { ok: false, errores };
  const cita = {
    id: nuevoId('c'),
    pacienteId: paciente.id,
    servicioId: d.servicioId,
    profesionalId: d.profesionalId,
    salaId: d.salaId,
    inicio: d.inicio,
    fin: d.inicio + servicio.min * MIN,
    estado: datos.estado || 'pendiente',
    origen,
    regla: datos.regla ? { ...datos.regla, dias: [...datos.regla.dias] } : { ...st.regla, dias: [...st.regla.dias] },
    creada: ahora,
    historial: [{ t: ahora, texto: origen === 'autoagenda' ? 'Pedida por la página de citas' : origen === 'lista_espera' ? 'Tomada desde la lista de espera' : 'Agendada en recepción' }],
    respuesta: null,
    confirmadaEn: datos.estado === 'confirmada' ? ahora : null,
    enSala: null,
  };
  st.citas.push(cita);
  programarRecordatorios(st, cita, ahora, { negocio });
  anotar(st, ahora, `Cita de ${paciente.nombre}: ${fechaLarga(cita.inicio)}, ${horaTexto(cita.inicio)} con ${profesionalDe(negocio, cita.profesionalId).nombre}.`, 'cita', paciente.id);
  return { ok: true, cita };
}

export function reprogramarCita(st, negocioBase, citaId, nuevo, ahora, { por = 'recepcion' } = {}) {
  const negocio = negocioEfectivo(negocioBase, st);
  const cita = citaDe(st, citaId);
  if (!cita) return { ok: false, errores: [{ mensaje: 'Esa cita ya no existe.' }] };
  if (['cancelada', 'atendida', 'no_asistio'].includes(cita.estado)) {
    return { ok: false, errores: [{ mensaje: `No se puede mover una cita ${ESTADOS[cita.estado].toLowerCase()}.` }] };
  }
  const d = asignar(negocio, st, { servicioId: cita.servicioId, profesionalId: nuevo.profesionalId ?? cita.profesionalId, salaId: nuevo.salaId ?? null, inicio: nuevo.inicio, pacienteId: cita.pacienteId }, ahora, citaId);
  const servicio = servicioDe(negocio, cita.servicioId);
  const errores = validarCita(negocio, st.citas, { ...d, fin: d.inicio + servicio.min * MIN }, ahora, { excluirCitaId: citaId });
  if (errores.length) return { ok: false, errores };
  const antes = cita.inicio;
  st.envios = aplicarRespuesta(st.envios, citaId, 'reprogramada', ahora);
  cerrarTareas(st, citaId, ahora, 'reprogramada');
  Object.assign(cita, { inicio: d.inicio, fin: d.inicio + servicio.min * MIN, profesionalId: d.profesionalId, salaId: d.salaId });
  cita.historial.push({ t: ahora, texto: `${por === 'paciente' ? `${negocio.vocab.Persona === 'Paciente' ? 'El paciente' : 'El cliente'} la cambió` : 'Reprogramada'}: de ${fechaLarga(antes)} ${horaTexto(antes)} a ${fechaLarga(cita.inicio)} ${horaTexto(cita.inicio)}` });
  if (por === 'paciente') {
    // La eligió la persona: queda confirmada y se le manda solo el aviso para la hora nueva.
    cita.estado = 'confirmada';
    cita.confirmadaEn = ahora;
  } else {
    cita.estado = 'reprogramada';
    cita.confirmadaEn = null;
    cita.respuesta = null;
  }
  programarRecordatorios(st, cita, ahora, { negocio });
  const p = pacienteDe(st, cita.pacienteId);
  anotar(st, ahora, `${p ? p.nombre : 'Cita'}: pasa al ${fechaLarga(cita.inicio)}, ${horaTexto(cita.inicio)}`, 'cita', cita.pacienteId);
  return { ok: true, cita, antes };
}

const TRANSICIONES = {
  pendiente: ['confirmada', 'cancelada', 'atendida', 'no_asistio'],
  reprogramada: ['confirmada', 'cancelada', 'atendida', 'no_asistio'],
  confirmada: ['cancelada', 'atendida', 'no_asistio'],
  atendida: ['no_asistio'],
  no_asistio: ['atendida'],
  cancelada: [],
};

export function transicionesDe(cita) { return TRANSICIONES[cita.estado] || []; }

export function cambiarEstado(st, negocioBase, citaId, estado, ahora, { por = 'recepcion', urlBase, sala } = {}) {
  const negocio = negocioEfectivo(negocioBase, st);
  const cita = citaDe(st, citaId);
  if (!cita) return { ok: false, errores: [{ mensaje: 'Esa cita ya no existe.' }] };
  if (!TRANSICIONES[cita.estado].includes(estado)) {
    return { ok: false, errores: [{ mensaje: `Una cita ${ESTADOS[cita.estado].toLowerCase()} no puede pasar a ${ESTADOS[estado].toLowerCase()}.` }] };
  }
  if (['atendida', 'no_asistio'].includes(estado) && cita.inicio > ahora + 15 * MIN) {
    return { ok: false, errores: [{ mensaje: 'Todavía no es la hora de la cita.' }] };
  }
  const previo = cita.estado;
  cita.estado = estado;
  cita.historial.push({ t: ahora, texto: `${ESTADOS[previo]} → ${ESTADOS[estado]} (${por})` });
  if (estado === 'confirmada') cita.confirmadaEn = ahora;
  st.envios = aplicarRespuesta(st.envios, citaId, estado === 'confirmada' ? 'confirmada' : estado === 'cancelada' ? 'cancelada' : estado, ahora);
  // Confirmada, cancelada, atendida o no asistió: ya no hay a quién llamar para preguntar si viene.
  cerrarTareas(st, citaId, ahora, estado);
  const p = pacienteDe(st, cita.pacienteId);
  anotar(st, ahora, `${p ? p.nombre : 'Cita'}: ${ESTADOS[estado].toLowerCase()} (${por}).`, 'cita', cita.pacienteId);
  let oferta = null;
  if (estado === 'cancelada') oferta = ofrecerHueco(st, negocio, cita, ahora).oferta;
  return { ok: true, cita, oferta };
}

/**
 * Cambia la regla de recordatorio de una cita: lo que faltaba se detiene y se vuelve a planificar. Lo que ya salió
 * cuenta: el máximo de mensajes no se reinicia y el siguiente respeta «cada N horas» desde el último.
 */
export function cambiarRegla(st, citaId, regla, ahora, negocio = null) {
  const cita = citaDe(st, citaId);
  if (!cita) return { ok: false, errores: [{ mensaje: 'Esa cita ya no existe.' }] };
  const errores = validarRegla(regla);
  if (errores.length) return { ok: false, errores };
  st.envios = aplicarRespuesta(st.envios, citaId, 'se cambió el recordatorio', ahora);
  cita.regla = { ...regla, dias: [...regla.dias] };
  cita.historial.push({ t: ahora, texto: 'Se cambió el recordatorio' });
  const previos = st.envios.filter((e) => e.citaId === citaId && e.tipo === 'mensaje' && e.estado === 'enviado').map((e) => e.salioEn ?? e.momento);
  const plan = programarRecordatorios(st, cita, ahora, { negocio, previos });
  return { ok: true, cita, plan };
}

/** Errores de una regla de recordatorio armada en el formulario. */
export function validarRegla(regla) {
  const errores = [];
  if (!regla.dias || !regla.dias.length) errores.push({ campo: 'dias', mensaje: 'Marca al menos un recordatorio (2 días antes o 1 día antes).' });
  if (!(regla.hora >= VENTANA[0] && regla.hora < VENTANA[1])) errores.push({ campo: 'hora', mensaje: 'La hora del recordatorio tiene que estar entre las 8:00 a. m. y las 8:00 p. m.' });
  if (!CANALES[regla.canal]) errores.push({ campo: 'canal', mensaje: 'Elige el canal.' });
  if (regla.insistir) {
    if (!(regla.cadaHoras >= 1 && regla.cadaHoras <= 24)) errores.push({ campo: 'cadaHoras', mensaje: 'Vuelve a escribir cada 1 a 24 horas.' });
    if (!(regla.maxIntentos >= 1 && regla.maxIntentos <= 8)) errores.push({ campo: 'maxIntentos', mensaje: 'El máximo es de 1 a 8 mensajes.' });
  }
  return errores;
}

export function marcarEnSala(st, citaId, ahora) {
  const cita = citaDe(st, citaId);
  if (!cita) return { ok: false, errores: [{ mensaje: 'Esa cita ya no existe.' }] };
  cita.enSala = cita.enSala ? null : ahora;
  return { ok: true, cita };
}

// ── Respuestas del paciente (enlace, relevo entre dispositivos) ───────────────

/**
 * Aplica la respuesta del paciente. Es idempotente: la misma respuesta (mismo id) dos veces no hace nada.
 * r = { id, citaId, tipo: 'confirmo'|'cancelo'|'cambio'|'llamenme', hueco?: ms, t, via }
 * @returns {{ok:boolean, resultado:string, cita?:object}}
 */
export function responder(st, negocioBase, r, ahora) {
  const negocio = negocioEfectivo(negocioBase, st);
  if (r.id && st.procesados.includes(r.id)) return { ok: true, resultado: 'repetida' };
  const cita = citaDe(st, r.citaId);
  if (!cita) return { ok: false, resultado: 'no_existe' };
  if (r.id) { st.procesados.push(r.id); if (st.procesados.length > 500) st.procesados.shift(); }
  // Una cita cerrada, o que ya empezó, no se confirma ni se cambia desde el enlace.
  if (['cancelada', 'atendida', 'no_asistio'].includes(cita.estado) || cita.inicio <= ahora) return { ok: false, resultado: 'cerrada', cita };
  const p = pacienteDe(st, cita.pacienteId);
  const quien = p ? p.nombre : (negocio.vocab.Persona || 'La persona');
  const via = r.via === 'relevo' ? 'desde otro dispositivo' : 'por el enlace';
  cita.respuesta = { t: r.t ?? ahora, tipo: r.tipo, via: r.via || 'enlace' };

  if (r.tipo === 'confirmo') {
    if (cita.estado !== 'confirmada') {
      cita.estado = 'confirmada';
      cita.confirmadaEn = ahora;
      cita.historial.push({ t: ahora, texto: `Confirmó ${via}` });
    }
    st.envios = aplicarRespuesta(st.envios, cita.id, 'confirmo', ahora);
    cerrarTareas(st, cita.id, ahora, 'confirmo');
    anotar(st, ahora, `${quien} confirmó ${via}. Se detuvieron los mensajes que faltaban.`, 'respuesta', cita.pacienteId);
    return { ok: true, resultado: 'confirmada', cita };
  }
  if (r.tipo === 'cancelo') {
    cita.estado = 'cancelada';
    cita.historial.push({ t: ahora, texto: `Canceló ${via}` });
    st.envios = aplicarRespuesta(st.envios, cita.id, 'cancelo', ahora);
    cerrarTareas(st, cita.id, ahora, 'cancelo');
    anotar(st, ahora, `${quien} avisó que no podrá ir ${via}. El horario quedó libre.`, 'respuesta', cita.pacienteId);
    const { oferta } = ofrecerHueco(st, negocio, cita, ahora);
    return { ok: true, resultado: 'cancelada', cita, oferta };
  }
  if (r.tipo === 'cambio' && Number.isFinite(r.hueco)) {
    st.envios = aplicarRespuesta(st.envios, cita.id, 'cambio', ahora);
    const res = reprogramarCita(st, negocio, cita.id, { inicio: r.hueco, profesionalId: cita.profesionalId }, ahora, { por: 'paciente' });
    if (res.ok) {
      anotar(st, ahora, `${quien} cambió su cita ${via} al ${fechaLarga(r.hueco)}, ${horaTexto(r.hueco)}`, 'respuesta', cita.pacienteId);
      return { ok: true, resultado: 'reprogramada', cita };
    }
    // Ya pasó o se ocupó: la cita sigue como estaba y la recepción llama.
    const pasado = r.hueco < ahora || res.errores.some((e) => e.codigo === 'pasado');
    cerrarTareas(st, cita.id, ahora, 'reemplazada');
    crearTarea(st, cita, `Eligió el ${fechaLarga(r.hueco)} a las ${horaTexto(r.hueco)}, pero ese horario ${pasado ? 'ya pasó' : 'ya no está libre'}`, ahora);
    anotar(st, ahora, `${quien} pidió otro horario que ${pasado ? 'ya había pasado' : 'ya no estaba libre'}: queda para llamar.`, 'respuesta', cita.pacienteId);
    return { ok: false, resultado: pasado ? 'hueco_pasado' : 'hueco_ocupado', cita };
  }
  if (r.tipo === 'llamenme' || r.tipo === 'cambio') {
    st.envios = aplicarRespuesta(st.envios, cita.id, 'llamenme', ahora);
    cerrarTareas(st, cita.id, ahora, 'reemplazada');
    crearTarea(st, cita, 'Pidió que lo llamen para cambiar la cita', ahora);
    anotar(st, ahora, `${quien} pidió que lo llamen para cambiar la cita.`, 'respuesta', cita.pacienteId);
    return { ok: true, resultado: 'llamar', cita };
  }
  return { ok: false, resultado: 'desconocida' };
}

// ── Autoagendamiento (la persona pide la cita desde la página) ─────────────

/**
 * Busca a la persona por cédula y celular (o la registra) y crea la cita.
 * - La página es pública: nunca dice de quién es una cédula ni si ya está registrada. Si la cédula existe con otro
 *   celular, la solicitud se trata igual que la de una persona nueva (la respuesta pública es idéntica), queda marcada
 *   «por verificar» y recepción recibe una tarea; el registro existente no se toca ni se muestra. Antes se pedía
 *   llamar, y esa diferencia decía si una cédula estaba registrada (revisión del 3-oct).
 * - Primero se valida todo (datos y hora) y después se escribe: si la hora ya no sirve, no queda nadie registrado
 *   ni una línea en la bitácora.
 * datos = { persona: {nombre, cedula, telefono, correo, consentimiento}, servicioId, profesionalId, inicio }
 */
export function solicitarCita(st, negocioBase, datos, ahora) {
  const negocio = negocioEfectivo(negocioBase, st);
  const persona = datos.persona || {};
  const revision = revisarDatosPersona(persona, ahora);
  const { ced, tel } = revision;
  const existente = ced.ok ? st.pacientes.find((p) => !p.eliminado && p.cedula === ced.valor) : null;
  if (revision.errores.length) {
    // Un error de formato se puede decir; que la cédula exista, no.
    return { ok: false, errores: revision.errores };
  }
  const porVerificar = Boolean(existente && existente.telefono !== tel.e164);
  const conocido = porVerificar ? null : existente;

  const pacienteId = conocido ? conocido.id : null;
  const d = asignar(negocio, st, { servicioId: datos.servicioId, profesionalId: datos.profesionalId || null, salaId: null, inicio: datos.inicio, pacienteId }, ahora);
  const servicio = servicioDe(negocio, d.servicioId);
  const errCita = validarCita(negocio, st.citas, { ...d, fin: servicio ? d.inicio + servicio.min * MIN : undefined }, ahora);
  if (errCita.length) {
    return {
      ok: false,
      errores: errCita.map((e) => (e.codigo === 'pasado'
        ? { ...e, mensaje: 'Esa hora ya pasó. Elige otra.' }
        : ['solape_profesional', 'solape_sala'].includes(e.codigo) ? { ...e, mensaje: 'Esa hora se acaba de ocupar. Elige otra.' }
          : e.codigo === 'solape_paciente' ? { ...e, mensaje: `Ya tienes una cita a esa hora. Elige otra o llama ${negocio.vocab.alNegocio}.` } : e)),
    };
  }

  let paciente = conocido;
  if (paciente) {
    if (!paciente.consentimiento || paciente.revocado) renovarConsentimiento(st, negocio, paciente.id, 'en la página de citas', ahora);
  } else {
    paciente = guardarPersona(st, negocio, { ...persona, canalConsentimiento: 'en la página de citas' }, revision, ahora);
    if (porVerificar) paciente.porVerificar = 'La cédula ya estaba registrada con otro celular: verifica quién es antes de la cita.';
  }
  const r = crearCita(st, negocio, {
    pacienteId: paciente.id, servicioId: d.servicioId, profesionalId: d.profesionalId, salaId: d.salaId,
    inicio: d.inicio, estado: negocio.ajustes.autoConfirmar ? 'confirmada' : 'pendiente',
  }, ahora, { origen: 'autoagenda' });
  if (r.ok && porVerificar) crearTarea(st, r.cita, 'Verificar identidad: la cédula ya estaba registrada con otro celular', ahora);
  return r.ok ? { ok: true, cita: r.cita, paciente } : r;
}

// ── Tareas de recepción ───────────────────────────────────────────────────

export function crearTarea(st, cita, motivo, ahora) {
  const ya = st.tareas.find((t) => t.citaId === cita.id && !t.hecha && t.motivo === motivo);
  if (ya) return ya;
  const t = { id: nuevoId('t'), tipo: 'llamar', citaId: cita.id, pacienteId: cita.pacienteId, motivo, creada: ahora, hecha: null, intentos: [] };
  st.tareas.push(t);
  return t;
}

/** resultado: 'confirmo' | 'cancelo' | 'no_contesto' */
export function resolverTarea(st, negocio, tareaId, resultado, ahora) {
  const t = st.tareas.find((x) => x.id === tareaId);
  if (!t) return { ok: false, errores: [{ mensaje: 'Esa tarea ya no existe.' }] };
  if (resultado === 'no_contesto') {
    t.intentos.push({ t: ahora, resultado });
    anotar(st, ahora, 'Llamada sin respuesta; la tarea sigue abierta.', 'tarea');
    return { ok: true, tarea: t };
  }
  t.hecha = { t: ahora, resultado };
  const cita = citaDe(st, t.citaId);
  if (cita && ['pendiente', 'reprogramada', 'confirmada'].includes(cita.estado)) {
    if (resultado === 'confirmo' && cita.estado !== 'confirmada') cambiarEstado(st, negocio, cita.id, 'confirmada', ahora, { por: 'teléfono' });
    if (resultado === 'cancelo') cambiarEstado(st, negocio, cita.id, 'cancelada', ahora, { por: 'teléfono' });
  }
  return { ok: true, tarea: t };
}

// ── Lista de espera ───────────────────────────────────────────────────────

export function agregarAEspera(st, negocio, { pacienteId, servicioId, profesionalId = null, nota = '' }, ahora) {
  const p = pacienteDe(st, pacienteId);
  if (!p) return { ok: false, errores: [{ campo: 'paciente', mensaje: 'Elige a la persona.' }] };
  if (!servicioDe(negocio, servicioId)) return { ok: false, errores: [{ campo: 'servicio', mensaje: 'Elige el servicio.' }] };
  if (st.espera.some((e) => e.pacienteId === pacienteId && e.servicioId === servicioId && e.estado === 'esperando')) {
    return { ok: false, errores: [{ campo: 'paciente', mensaje: `${p.nombre} ya está en la lista para ese servicio.` }] };
  }
  const e = { id: nuevoId('w'), pacienteId, servicioId, profesionalId: profesionalId || null, nota: String(nota).slice(0, 200), desde: ahora, estado: 'esperando' };
  st.espera.push(e);
  anotar(st, ahora, `${p.nombre} entró a la lista de espera.`, 'espera', p.id);
  return { ok: true, entrada: e };
}

export function retirarDeEspera(st, esperaId, ahora) {
  const e = st.espera.find((x) => x.id === esperaId);
  if (!e) return { ok: false, errores: [{ mensaje: 'Ya no está en la lista.' }] };
  e.estado = 'retirado';
  e.retirado = ahora;
  return { ok: true };
}

/**
 * Cuando se libera un horario, se ofrece a quienes esperan un servicio que quepa ahí (mismo profesional si lo
 * pidieron). Se les escribe a todos a la vez; el primero que acepta se lo queda.
 */
export function ofrecerHueco(st, negocio, citaLiberada, ahora) {
  const hueco = { inicio: citaLiberada.inicio, fin: citaLiberada.fin, profesionalId: citaLiberada.profesionalId, salaId: citaLiberada.salaId };
  if (hueco.inicio < ahora + 60 * MIN) return { oferta: null, candidatos: [] };
  const candidatos = [];
  for (const e of st.espera) {
    if (e.estado !== 'esperando' || e.pacienteId === citaLiberada.pacienteId) continue;
    if (e.profesionalId && e.profesionalId !== hueco.profesionalId) continue;
    const s = servicioDe(negocio, e.servicioId);
    if (!s || s.min * MIN > hueco.fin - hueco.inicio) continue;
    if (s.salas && !s.salas.includes(hueco.salaId)) continue;
    const pac = pacienteDe(st, e.pacienteId);
    if (!canalesDe(pac).includes('whatsapp')) continue;
    const errores = validarCita(negocio, st.citas, { inicio: hueco.inicio, servicioId: s.id, profesionalId: hueco.profesionalId, salaId: hueco.salaId, pacienteId: e.pacienteId }, ahora);
    if (errores.length) continue;
    candidatos.push(e);
  }
  if (!candidatos.length) {
    anotar(st, ahora, `Se liberó el ${fechaLarga(hueco.inicio)}, ${horaTexto(hueco.inicio)}: nadie en la lista de espera para ese horario.`, 'espera');
    return { oferta: null, candidatos };
  }
  const oferta = { id: nuevoId('o'), hueco, citaOrigenId: citaLiberada.id, estado: 'abierta', creada: ahora, candidatos: candidatos.map((c) => c.id), tomadaPor: null, citaNuevaId: null };
  st.ofertas.push(oferta);
  const momento = ajustarAVentana(ahora, VENTANA);
  for (const e of candidatos) {
    st.envios.push({
      id: nuevoId('e'), citaId: null, ofertaId: oferta.id, esperaId: e.id, pacienteId: e.pacienteId,
      tipo: 'mensaje', clase: 'oferta', intento: 1, de: 1, canal: 'whatsapp', etiqueta: 'lista de espera',
      momento, estado: 'programado', creado: ahora,
    });
  }
  anotar(st, ahora, `Se liberó el ${fechaLarga(hueco.inicio)}, ${horaTexto(hueco.inicio)}: se ofrece a ${candidatos.length} ${candidatos.length === 1 ? 'persona' : 'personas'} de la lista de espera.`, 'espera');
  return { oferta, candidatos };
}

/** El primero que acepta se lo queda. r = { id, ofertaId, esperaId, t } */
export function aceptarOferta(st, negocioBase, r, ahora) {
  const negocio = negocioEfectivo(negocioBase, st);
  if (r.id && st.procesados.includes(r.id)) return { ok: true, resultado: 'repetida' };
  if (r.id) st.procesados.push(r.id);
  const oferta = st.ofertas.find((o) => o.id === r.ofertaId);
  if (!oferta) return { ok: false, resultado: 'no_existe' };
  if (oferta.estado === 'tomada') return { ok: false, resultado: oferta.tomadaPor === r.esperaId ? 'ya_es_tuya' : 'tomada' };
  if (oferta.estado !== 'abierta') return { ok: false, resultado: 'vencida' };
  const e = st.espera.find((x) => x.id === r.esperaId);
  if (!e || !oferta.candidatos.includes(e.id)) return { ok: false, resultado: 'no_existe' };
  const res = crearCita(st, negocio, {
    pacienteId: e.pacienteId, servicioId: e.servicioId, profesionalId: oferta.hueco.profesionalId,
    salaId: oferta.hueco.salaId, inicio: oferta.hueco.inicio, estado: 'confirmada',
  }, ahora, { origen: 'lista_espera' });
  if (!res.ok) {
    oferta.estado = 'vencida';
    return { ok: false, resultado: 'ya_no_libre', errores: res.errores };
  }
  oferta.estado = 'tomada';
  oferta.tomadaPor = e.id;
  oferta.citaNuevaId = res.cita.id;
  e.estado = 'atendido';
  st.envios = st.envios.map((x) => (x.ofertaId === oferta.id && x.estado === 'programado'
    ? { ...x, estado: 'cancelado', canceladoEn: ahora, motivoCancelacion: 'otra persona tomó el espacio' } : x));
  const p = pacienteDe(st, e.pacienteId);
  anotar(st, ahora, `${p ? p.nombre : 'Alguien'} tomó el espacio del ${fechaLarga(oferta.hueco.inicio)}, ${horaTexto(oferta.hueco.inicio)} desde la lista de espera.`, 'espera', e.pacienteId);
  return { ok: true, resultado: 'tomada', cita: res.cita };
}

// ── Reloj de la demo: lo que vence, sale ─────────────────────────────────

/** Tres horarios libres alternativos (días distintos) con el mismo profesional, para el enlace. */
export function huecosAlternativos(st, negocio, cita, ahora, cuantos = 3) {
  const salida = [];
  const desde = fechaISO(Math.max(ahora, cita.inicio - 3 * 24 * 60 * MIN));
  for (let i = 0; i < 21 && salida.length < cuantos; i++) {
    const fecha = sumarDias(desde, i);
    const h = horasUnicas(huecosDelDia({ negocio, citas: st.citas, fecha, servicioId: cita.servicioId, profesionalId: cita.profesionalId, ahora: ahora + 2 * 60 * MIN, excluirCitaId: cita.id, pacienteId: cita.pacienteId }))
      .filter((x) => x.inicio !== cita.inicio);
    if (h.length) salida.push(h[Math.min(h.length - 1, Math.floor(h.length / 3))].inicio);
  }
  return salida;
}

export function enlaceDeCita(st, negocio, cita, ahora, { urlBase, sala }) {
  const p = pacienteDe(st, cita.pacienteId);
  const datos = {
    k: 'c', pl: negocio.id, c: cita.id, n: primerNombre(p ? p.nombre : ''), i: aMinutos(cita.inicio),
    pr: cita.profesionalId, sv: cita.servicioId, sl: cita.salaId,
    hs: huecosAlternativos(st, negocio, cita, ahora).map(aMinutos),
  };
  if (sala) datos.s = sala;
  return `${urlBase}#${codificar(datos)}`;
}

export function enlaceDeOferta(st, negocio, oferta, esperaId, { urlBase, sala }) {
  const e = st.espera.find((x) => x.id === esperaId);
  const p = e ? pacienteDe(st, e.pacienteId) : null;
  const datos = {
    k: 'o', pl: negocio.id, o: oferta.id, e: esperaId, n: primerNombre(p ? p.nombre : ''), i: aMinutos(oferta.hueco.inicio),
    pr: oferta.hueco.profesionalId, sv: e ? e.servicioId : '-', sl: oferta.hueco.salaId,
  };
  if (sala) datos.s = sala;
  return `${urlBase}#${codificar(datos)}`;
}

/** Texto y enlace de un envío en el momento en que sale. */
export function componerEnvio(st, negocioBase, envio, ahora, opciones) {
  const negocio = negocioEfectivo(negocioBase, st);
  const p = pacienteDe(st, envio.pacienteId);
  if (envio.clase === 'oferta') {
    const oferta = st.ofertas.find((o) => o.id === envio.ofertaId);
    const enlace = enlaceDeOferta(st, negocio, oferta, envio.esperaId, opciones);
    const texto = rellenar(st.plantillas.oferta, {
      nombre: primerNombre(p?.nombre), fecha: fechaLarga(oferta.hueco.inicio), hora: horaTexto(oferta.hueco.inicio),
      profesional: profesionalDe(negocio, oferta.hueco.profesionalId).nombre, negocio: negocio.nombre, enlace,
    });
    return { texto, enlace };
  }
  const cita = citaDe(st, envio.citaId);
  const enlace = enlaceDeCita(st, negocio, cita, ahora, opciones);
  const plantilla = envio.clase === 'reintento' ? st.plantillas.reintento
    : envio.clase === 'aviso' ? (st.plantillas.aviso || PLANTILLAS_POR_DEFECTO.aviso) : st.plantillas.recordatorio;
  const texto = rellenar(plantilla, {
    nombre: primerNombre(p?.nombre), fecha: fechaLarga(cita.inicio), hora: horaTexto(cita.inicio),
    profesional: profesionalDe(negocio, cita.profesionalId).nombre, negocio: negocio.nombre, enlace,
  });
  return { texto, enlace };
}

/**
 * Adelanta la bandeja hasta `ahora`: lo que vencía sale (o se vuelve tarea de llamar).
 * @returns {Array} lo que salió, en orden
 */
export function avanzarReloj(st, negocioBase, ahora, opciones = {}) {
  const negocio = negocioEfectivo(negocioBase, st);
  const { envios, salieron } = vencer(st.envios, ahora);
  st.envios = envios;
  for (const e of salieron) {
    const p = pacienteDe(st, e.pacienteId);
    const quien = p ? p.nombre : 'alguien';
    if (e.tipo === 'llamar') {
      const cita = citaDe(st, e.citaId);
      const n = st.envios.filter((x) => x.citaId === e.citaId && x.tipo === 'mensaje' && x.estado === 'enviado').length;
      if (cita) crearTarea(st, cita, `No respondió a ${n} ${n === 1 ? 'mensaje' : 'mensajes'}`, e.momento);
      anotar(st, e.momento, `Sin respuesta de ${quien}: queda «${negocio.vocab.llamar}» en recepción.`, 'tarea', e.pacienteId);
      continue;
    }
    const { texto, enlace } = componerEnvio(st, negocio, e, e.momento, opciones);
    e.texto = texto;
    e.enlace = enlace;
    const que = e.clase === 'oferta' ? 'el aviso de la lista de espera' : e.clase === 'reintento' ? 'el reintento'
      : e.clase === 'aviso' ? `el aviso de la cita confirmada (${e.etiqueta})` : `el recordatorio (${e.etiqueta})`;
    anotar(st, e.momento, `Salió ${que} a ${quien} por ${CANALES[e.canal]}${e.de > 1 ? `, intento ${e.intento} de ${e.de}` : ''}.`, 'envio', e.pacienteId);
  }
  // Una cita que ya empezó no se confirma por teléfono: sus tareas de llamar se cierran solas.
  for (const t of st.tareas) {
    if (t.hecha) continue;
    const cita = citaDe(st, t.citaId);
    if (cita && cita.inicio <= ahora) t.hecha = { t: cita.inicio, resultado: 'vencida' };
  }
  return salieron;
}
