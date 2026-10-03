// Planificador de recordatorios. Funciones puras: reciben la cita, la regla y la hora, y devuelven el plan.
//
// Regla (por cita):
//   dias:          [2, 1]  → «2 días antes», «1 día antes» o ambos (también 3 y 0 = el mismo día)
//   hora:          minutos del día a la que sale el recordatorio (540 = 9:00)
//   canal:         'whatsapp' | 'sms' | 'correo'
//   insistir:      si no responde, volver a escribir
//   cadaHoras:     cada cuántas horas se vuelve a escribir
//   maxIntentos:   tope de mensajes en total para esa cita (los recordatorios elegidos cuentan)
//   respaldo:      canal al que se sube si no responde ('sms' | 'correo' | null)
//   respaldoDesde: número de intento desde el que se usa el respaldo
//   llamar:        si se agotan los intentos, tarea «Llamar al paciente» en recepción
//
// Nada sale fuera de la ventana de envío (8:00 a 20:00 de Panamá por defecto) ni en la última hora antes de la cita.

import { msDeFecha, fechaISO, sumarDias, minutosDelDia, HORA, MIN } from './tiempo.mjs';

export const VENTANA = [8 * 60, 20 * 60];
export const MARGEN_MIN = 60;

export const REGLA_POR_DEFECTO = Object.freeze({
  dias: [2, 1],
  hora: 9 * 60,
  canal: 'whatsapp',
  insistir: true,
  cadaHoras: 4,
  maxIntentos: 4,
  respaldo: 'sms',
  respaldoDesde: 4,
  llamar: true,
});

export const CANALES = { whatsapp: 'WhatsApp', sms: 'SMS', correo: 'Correo' };

const ETIQUETA_DIAS = { 0: 'el mismo día', 1: '1 día antes', 2: '2 días antes', 3: '3 días antes' };

/** Lleva un instante a la ventana de envío: si es de madrugada, a las 8:00; si es de noche, a las 8:00 del día siguiente. */
export function ajustarAVentana(ms, ventana = VENTANA) {
  const [desde, hasta] = ventana;
  const m = minutosDelDia(ms);
  if (m < desde) return msDeFecha(fechaISO(ms), desde);
  if (m >= hasta) return msDeFecha(sumarDias(fechaISO(ms), 1), desde);
  return ms;
}

/** Canal de un intento según la escalera de la regla y los canales que tiene el paciente. */
export function canalDelIntento(regla, intento, canales) {
  if (regla.respaldo && intento >= (regla.respaldoDesde || Infinity) && canales.includes(regla.respaldo)) {
    return regla.respaldo;
  }
  if (canales.includes(regla.canal)) return regla.canal;
  return canales[0] || null;
}

/**
 * Plan de envíos para una cita.
 * @returns {Array<{tipo:'mensaje', intento:number, de:number, canal:string, momento:number, motivo:string, etiqueta:string, atrasado:boolean} | {tipo:'llamar', momento:number, motivo:string}>}
 */
export function planificar(cita, regla, ahora, opciones = {}) {
  const ventana = opciones.ventana || VENTANA;
  const margen = (opciones.margenMin ?? MARGEN_MIN) * MIN;
  const canales = opciones.canales || ['whatsapp', 'sms', 'correo'];
  if (!['pendiente', 'reprogramada'].includes(cita.estado)) return [];
  if (!canales.length || !regla || !regla.dias || !regla.dias.length) return [];

  const limite = cita.inicio - margen;
  const fechaCita = fechaISO(cita.inicio);

  // 1. Recordatorios elegidos. Si su hora ya pasó al agendar, salen en el siguiente momento razonable.
  const base = [];
  for (const d of [...new Set(regla.dias)].sort((a, b) => b - a)) {
    const previsto = msDeFecha(sumarDias(fechaCita, -d), regla.hora);
    const atrasado = previsto < ahora;
    const momento = ajustarAVentana(atrasado ? ahora : previsto, ventana);
    if (momento >= limite) continue;
    const etiqueta = atrasado ? 'al agendar' : ETIQUETA_DIAS[d] || `${d} días antes`;
    const ya = base.find((b) => b.momento === momento);
    if (ya) {
      if (!atrasado) Object.assign(ya, { etiqueta, atrasado: false });
      continue;
    }
    base.push({ momento, etiqueta, atrasado });
  }
  base.sort((a, b) => a.momento - b.momento);
  if (!base.length) return [];

  // 2. Línea de tiempo con reintentos.
  const cada = Math.max(1, regla.cadaHoras || 1) * HORA;
  const max = regla.insistir ? Math.max(regla.maxIntentos || 1, base.length) : base.length;
  const pendientes = [...base];
  const mensajes = [];
  let ultimo = null;
  const empujar = (momento, motivo, etiqueta, atrasado = false) => {
    mensajes.push({ momento, motivo, etiqueta, atrasado });
    ultimo = momento;
  };
  const primero = pendientes.shift();
  empujar(primero.momento, 'recordatorio', primero.etiqueta, primero.atrasado);

  while (mensajes.length < max) {
    const siguienteBase = pendientes[0];
    let elegido = null;
    if (regla.insistir) {
      const reintento = ajustarAVentana(ultimo + cada, ventana);
      const reservar = siguienteBase && mensajes.length + pendientes.length >= max;
      // No se manda un reintento si el siguiente recordatorio elegido sale antes de que pasen N horas.
      const muyCerca = siguienteBase && reintento + cada > siguienteBase.momento;
      if (siguienteBase && (reservar || muyCerca)) elegido = { ...pendientes.shift(), motivo: 'recordatorio' };
      else elegido = { momento: reintento, motivo: 'reintento', etiqueta: 'reintento', atrasado: false };
    } else if (siguienteBase) {
      elegido = { ...pendientes.shift(), motivo: 'recordatorio' };
    }
    if (!elegido || elegido.momento >= limite) break;
    empujar(elegido.momento, elegido.motivo, elegido.etiqueta, elegido.atrasado);
  }

  const plan = mensajes.map((m, i) => ({
    tipo: 'mensaje',
    intento: i + 1,
    de: mensajes.length,
    canal: canalDelIntento(regla, i + 1, canales),
    momento: m.momento,
    motivo: m.motivo,
    etiqueta: m.etiqueta,
    atrasado: m.atrasado,
  }));

  // 3. Si insiste y se agota sin respuesta: tarea de llamar en recepción.
  if (regla.insistir && regla.llamar !== false) {
    let momento = ajustarAVentana(ultimo + cada, ventana);
    if (momento > limite) momento = Math.max(ultimo + 30 * MIN, limite);
    plan.push({ tipo: 'llamar', momento, motivo: 'sin_respuesta' });
  }
  return plan;
}

export const MOTIVOS_CANCELACION = {
  confirmo: 'confirmó',
  cancelo: 'canceló la cita',
  cambio: 'pidió otro horario',
  llamenme: 'pidió que lo llamen',
  reprogramada: 'la cita se reprogramó',
  cancelada: 'la cita se canceló',
  confirmada: 'la cita se confirmó en recepción',
  sin_consentimiento: 'retiró el permiso para mensajes',
  atendida: 'la cita ya se atendió',
  no_asistio: 'se marcó que no asistió',
};

/**
 * Detiene lo que falta por salir de una cita. Lo ya enviado no se toca.
 * @param envios lista completa de la bandeja
 */
export function aplicarRespuesta(envios, citaId, motivo, ahora) {
  return envios.map((e) => {
    if (e.citaId !== citaId || e.estado !== 'programado') return e;
    return { ...e, estado: 'cancelado', canceladoEn: ahora, motivoCancelacion: MOTIVOS_CANCELACION[motivo] || motivo };
  });
}

/**
 * Hace salir todo lo que vence hasta `ahora`, en orden. Los mensajes pasan a «enviado»; la llamada, a tarea.
 * @returns {{envios: Array, salieron: Array}}
 */
export function vencer(envios, ahora) {
  const salieron = [];
  const nuevos = envios.map((e) => {
    if (e.estado !== 'programado' || e.momento > ahora) return e;
    const n = { ...e, estado: e.tipo === 'llamar' ? 'tarea' : 'enviado', salioEn: e.momento };
    salieron.push(n);
    return n;
  });
  salieron.sort((a, b) => a.momento - b.momento);
  return { envios: nuevos, salieron };
}

/** Próximo momento con algo programado después de `ahora`, o null. */
export function proximoEnvio(envios, ahora) {
  let min = null;
  for (const e of envios) if (e.estado === 'programado' && e.momento > ahora && (min === null || e.momento < min)) min = e.momento;
  return min;
}
