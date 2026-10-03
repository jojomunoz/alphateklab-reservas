// Horario, huecos libres y validación de citas. Todo en hora de Panamá.
// Una cita ocupa a la vez a un profesional y una sala (consultorio, silla, bahía): las dos tienen que estar libres.

import { msDeFecha, fechaISO, minutosDelDia, diaSemana, horaTexto, horaDeMinutos, fechaLarga, sumarDias, MIN } from './tiempo.mjs';
import { feriado } from './feriados.mjs';
import { solapanConMargen, restar } from './intervalos.mjs';

/** Estados que ocupan el horario. Una cita cancelada libera su hueco. */
export const ESTADOS_QUE_OCUPAN = new Set(['pendiente', 'confirmada', 'reprogramada', 'atendida', 'no_asistio']);

export const ESTADOS = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  reprogramada: 'Reprogramada',
  cancelada: 'Cancelada',
  atendida: 'Atendida',
  no_asistio: 'No asistió',
};

export function servicioDe(negocio, id) { return negocio.servicios.find((s) => s.id === id) || null; }
export function profesionalDe(negocio, id) { return negocio.profesionales.find((p) => p.id === id) || null; }
export function salaDe(negocio, id) { return negocio.salas.find((s) => s.id === id) || null; }

/**
 * Tramos abiertos de un día, en minutos del día: [[480, 720], [780, 1020]].
 * Vacío si es feriado (y el negocio cierra en feriados) o si ese día de la semana no abre.
 */
export function tramosDelDia(negocio, iso) {
  if (negocio.cerrarFeriados !== false && feriado(iso)) return [];
  return negocio.horario[diaSemana(iso)] || [];
}

/** Por qué está cerrado un día, o null si abre. */
export function motivoCierre(negocio, iso) {
  const f = negocio.cerrarFeriados !== false ? feriado(iso) : null;
  if (f) return `Feriado: ${f}`;
  if (!(negocio.horario[diaSemana(iso)] || []).length) return 'Cerrado';
  return null;
}

/** Salas donde se puede dar un servicio, con la sala habitual del profesional primero. */
export function salasPosibles(negocio, servicio, profesional, salaFija = null) {
  let salas = negocio.salas.map((s) => s.id);
  if (servicio.salas) salas = salas.filter((s) => servicio.salas.includes(s));
  if (salaFija) salas = salas.filter((s) => s === salaFija);
  if (profesional && profesional.sala && salas.includes(profesional.sala)) {
    salas = [profesional.sala, ...salas.filter((s) => s !== profesional.sala)];
  }
  return salas;
}

export function profesionalesPosibles(negocio, servicio, profesionalFijo = null) {
  return negocio.profesionales
    .filter((p) => !profesionalFijo || p.id === profesionalFijo)
    .filter((p) => !p.servicios || p.servicios.includes(servicio.id));
}

function ocupadas(citas, filtro, excluirCitaId) {
  return citas.filter((c) => ESTADOS_QUE_OCUPAN.has(c.estado) && c.id !== excluirCitaId && filtro(c));
}

/**
 * Huecos libres de un día para un servicio. Cada hueco es una combinación concreta de profesional y sala.
 * - Solo empieza en múltiplos de `paso` desde la apertura del tramo (8:00, 8:15…).
 * - Cabe entero dentro de un tramo (no cruza el almuerzo ni el cierre).
 * - No pisa citas del profesional ni de la sala, dejando `buffer` minutos a cada lado.
 * - No empieza antes de `ahora` (más la antelación mínima).
 */
export function huecosDelDia({ negocio, citas, fecha, servicioId, profesionalId = null, salaId = null, ahora = 0, excluirCitaId = null }) {
  const servicio = servicioDe(negocio, servicioId);
  if (!servicio) return [];
  const tramos = tramosDelDia(negocio, fecha);
  if (!tramos.length) return [];
  const { paso = 15, buffer = 0, antelacionMin = 0 } = negocio.ajustes || {};
  const dur = servicio.min * MIN;
  const margen = buffer * MIN;
  const desde = ahora + antelacionMin * MIN;
  const salida = [];
  for (const prof of profesionalesPosibles(negocio, servicio, profesionalId)) {
    const delProf = ocupadas(citas, (c) => c.profesionalId === prof.id, excluirCitaId);
    for (const salaIdPosible of salasPosibles(negocio, servicio, prof, salaId)) {
      const deSala = ocupadas(citas, (c) => c.salaId === salaIdPosible, excluirCitaId);
      for (const [a, b] of tramos) {
        const inicioTramo = msDeFecha(fecha, a), finTramo = msDeFecha(fecha, b);
        for (let t = inicioTramo; t + dur <= finTramo; t += paso * MIN) {
          if (t < desde) continue;
          const prop = { inicio: t, fin: t + dur };
          if (delProf.some((c) => solapanConMargen(prop, c, margen))) continue;
          if (deSala.some((c) => solapanConMargen(prop, c, margen))) continue;
          salida.push({ inicio: t, fin: t + dur, profesionalId: prof.id, salaId: salaIdPosible });
        }
      }
    }
  }
  return salida.sort((x, y) => x.inicio - y.inicio);
}

/** Una hora por inicio: la primera combinación (orden de profesionales y su sala habitual). */
export function horasUnicas(huecos) {
  const vistos = new Map();
  for (const h of huecos) if (!vistos.has(h.inicio)) vistos.set(h.inicio, h);
  return [...vistos.values()];
}

/** Próximo día con al menos un hueco, buscando hasta `dias` días hacia delante. */
export function proximoDiaConHueco(args, dias = 30) {
  for (let i = 1; i <= dias; i++) {
    const fecha = sumarDias(args.fecha, i);
    if (huecosDelDia({ ...args, fecha }).length) return fecha;
  }
  return null;
}

/**
 * Tiempo libre de un recurso en un día (para pintar los huecos en la agenda).
 * `recurso` = { tipo: 'profesional' | 'sala', id }.
 */
export function libresDelRecurso({ negocio, citas, fecha, recurso, ahora = 0, minimoMin = 15 }) {
  const tramos = tramosDelDia(negocio, fecha);
  const campo = recurso.tipo === 'profesional' ? 'profesionalId' : 'salaId';
  const ocup = ocupadas(citas, (c) => c[campo] === recurso.id, null).map((c) => ({ inicio: c.inicio, fin: c.fin }));
  const salida = [];
  for (const [a, b] of tramos) {
    let base = { inicio: msDeFecha(fecha, a), fin: msDeFecha(fecha, b) };
    if (base.fin <= ahora) continue;
    if (base.inicio < ahora) base = { inicio: Math.ceil(ahora / (15 * MIN)) * 15 * MIN, fin: base.fin };
    for (const l of restar(base, ocup)) if (l.fin - l.inicio >= minimoMin * MIN) salida.push(l);
  }
  return salida;
}

/**
 * Valida una cita antes de escribirla. Devuelve la lista de errores (vacía si se puede guardar).
 * Se llama con el estado MÁS RECIENTE justo antes de guardar: comprobarlo solo al pintar la agenda no basta,
 * porque otra pestaña (otra recepcionista) pudo guardar en medio.
 */
export function validarCita(negocio, citas, prop, ahora = 0, { excluirCitaId = null, permitirPasado = false } = {}) {
  const errores = [];
  const servicio = servicioDe(negocio, prop.servicioId);
  const prof = profesionalDe(negocio, prop.profesionalId);
  const sala = salaDe(negocio, prop.salaId);
  const v = negocio.vocab || {};
  if (!servicio) errores.push({ codigo: 'servicio', mensaje: 'Elige un servicio.' });
  if (!prof) errores.push({ codigo: 'profesional', mensaje: `Elige ${v.profesionalArt || 'el profesional'}.` });
  if (!sala) errores.push({ codigo: 'sala', mensaje: `Elige ${v.salaArt || 'la sala'}.` });
  if (!Number.isFinite(prop.inicio)) errores.push({ codigo: 'hora', mensaje: 'Elige una hora.' });
  if (errores.length) return errores;

  const fin = prop.inicio + servicio.min * MIN;
  if (prop.fin != null && prop.fin !== fin) {
    errores.push({ codigo: 'duracion', mensaje: `${servicio.nombre} dura ${servicio.min} min.` });
  }
  if (servicio.salas && !servicio.salas.includes(sala.id)) {
    const nombres = servicio.salas.map((s) => salaDe(negocio, s)?.nombre).join(' o ');
    errores.push({ codigo: 'sala_no_permitida', mensaje: `${servicio.nombre} solo se hace en ${nombres}.` });
  }
  if (prof.servicios && !prof.servicios.includes(servicio.id)) {
    errores.push({ codigo: 'profesional_no_hace', mensaje: `${prof.nombre} no hace ${servicio.nombre.toLowerCase()}.` });
  }
  if (!permitirPasado && prop.inicio < ahora) {
    errores.push({ codigo: 'pasado', mensaje: 'Esa hora ya pasó. Elige una hora desde ahora en adelante.' });
  }

  const fecha = fechaISO(prop.inicio);
  const motivo = motivoCierre(negocio, fecha);
  if (motivo) {
    errores.push({
      codigo: motivo.startsWith('Feriado') ? 'feriado' : 'cerrado',
      mensaje: motivo.startsWith('Feriado')
        ? `El ${fechaLarga(fecha)} es feriado (${motivo.slice(9)}): no se atiende.`
        : `El ${fechaLarga(fecha)} no se atiende.`,
    });
  } else {
    const a = minutosDelDia(prop.inicio), b = a + servicio.min;
    const tramos = tramosDelDia(negocio, fecha);
    const cabe = tramos.some(([x, y]) => a >= x && b <= y);
    if (!cabe) {
      const apertura = tramos[0][0], cierre = tramos[tramos.length - 1][1];
      let mensaje;
      if (a < apertura) mensaje = `Se abre a las ${horaDeMinutos(apertura)}`;
      else if (b > cierre) mensaje = `La cita terminaría a las ${horaDeMinutos(b)}, después del cierre (${horaDeMinutos(cierre)}).`;
      else {
        const pausa = tramos.find(([, y], i) => tramos[i + 1] && a < tramos[i + 1][0] && b > y);
        mensaje = pausa
          ? `La cita cruzaría el almuerzo (${horaDeMinutos(pausa[1])} a ${horaDeMinutos(tramos[tramos.indexOf(pausa) + 1][0])}).`
          : 'Esa hora está fuera del horario de atención.';
      }
      errores.push({ codigo: 'fuera_horario', mensaje });
    }
    const { paso = 15 } = negocio.ajustes || {};
    if (a % paso !== 0) errores.push({ codigo: 'paso', mensaje: `Las citas empiezan cada ${paso} minutos.` });
  }

  const { buffer = 0 } = negocio.ajustes || {};
  const propI = { inicio: prop.inicio, fin };
  const choqueProf = ocupadas(citas, (c) => c.profesionalId === prof.id, excluirCitaId)
    .find((c) => solapanConMargen(propI, c, buffer * MIN));
  if (choqueProf) {
    errores.push({
      codigo: 'solape_profesional',
      citaId: choqueProf.id,
      mensaje: `${prof.nombre} ya tiene una cita de ${horaTexto(choqueProf.inicio)} a ${horaTexto(choqueProf.fin)}${buffer ? ` (y se dejan ${buffer} min entre citas).` : ''}`,
    });
  }
  const choqueSala = ocupadas(citas, (c) => c.salaId === sala.id, excluirCitaId)
    .find((c) => solapanConMargen(propI, c, buffer * MIN));
  if (choqueSala) {
    errores.push({
      codigo: 'solape_sala',
      citaId: choqueSala.id,
      mensaje: `${sala.nombre} no está libre de ${horaTexto(choqueSala.inicio)} a ${horaTexto(choqueSala.fin)}`,
    });
  }
  return errores;
}
