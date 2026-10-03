// Panel de riesgo: lo que la recepción necesita ver para no perder citas. Cada cifra lleva su denominador.

import { fechaISO, sumarDias } from './tiempo.mjs';
import { costoDelMes } from './mensajes.mjs';

const ABIERTAS = new Set(['pendiente', 'reprogramada']);

/** Citas sin confirmar de hoy y de mañana, en orden. */
export function sinConfirmar(st, ahora) {
  const hoy = fechaISO(ahora), manana = sumarDias(hoy, 1);
  return st.citas
    .filter((c) => ABIERTAS.has(c.estado) && c.fin > ahora && [hoy, manana].includes(fechaISO(c.inicio)))
    .sort((a, b) => a.inicio - b.inicio);
}

/** Asistencia de una persona: atendidas de (atendidas + no asistió). */
export function asistenciaDe(st, pacienteId) {
  const pasadas = st.citas.filter((c) => c.pacienteId === pacienteId && (c.estado === 'atendida' || c.estado === 'no_asistio'));
  const atendidas = pasadas.filter((c) => c.estado === 'atendida').length;
  return { atendidas, faltas: pasadas.length - atendidas, de: pasadas.length, tasa: pasadas.length ? atendidas / pasadas.length : null };
}

/** Personas que ya faltaron alguna vez y tienen una cita por delante. */
export function conInasistencias(st, ahora) {
  const salida = [];
  for (const p of st.pacientes) {
    if (p.eliminado) continue;
    const a = asistenciaDe(st, p.id);
    if (!a.faltas) continue;
    const proxima = st.citas
      .filter((c) => c.pacienteId === p.id && c.inicio > ahora && ['pendiente', 'reprogramada', 'confirmada'].includes(c.estado))
      .sort((x, y) => x.inicio - y.inicio)[0];
    if (proxima) salida.push({ paciente: p, ...a, proxima });
  }
  return salida.sort((x, y) => y.faltas - x.faltas || x.proxima.inicio - y.proxima.inicio);
}

/**
 * Por profesional:
 * - inasistencia = no asistió / (atendidas + no asistió), sobre las citas ya pasadas;
 * - confirmación = citas confirmadas / citas a las que se les mandó al menos un recordatorio que pide confirmar
 *   (el aviso de una cita que ya nació confirmada no cuenta: no pregunta nada).
 */
export function porProfesional(st, negocio) {
  const conRecordatorio = new Set(st.envios.filter((e) => e.citaId && e.tipo === 'mensaje' && e.estado === 'enviado' && e.clase !== 'aviso').map((e) => e.citaId));
  return negocio.profesionales.map((prof) => {
    const suyas = st.citas.filter((c) => c.profesionalId === prof.id);
    const pasadas = suyas.filter((c) => c.estado === 'atendida' || c.estado === 'no_asistio');
    const faltas = pasadas.filter((c) => c.estado === 'no_asistio').length;
    const recordadas = suyas.filter((c) => conRecordatorio.has(c.id));
    const confirmadas = recordadas.filter((c) => c.confirmadaEn != null).length;
    return {
      profesional: prof,
      inasistencia: { n: faltas, de: pasadas.length, tasa: pasadas.length ? faltas / pasadas.length : null },
      confirmacion: { n: confirmadas, de: recordadas.length, tasa: recordadas.length ? confirmadas / recordadas.length : null },
    };
  });
}

/**
 * Costo del mes. En la demo el enlace lleva los datos de la cita y mide ~280 caracteres; en producción sería un
 * identificador corto. Para no inflar el SMS, el cálculo cambia el enlace por uno de 32 caracteres.
 */
export const ENLACE_PRODUCCION = 'https://example.com/c/Ab3dE6gH9j';
export function costoMensajesDelMes(st, ahora) {
  const mes = fechaISO(ahora).slice(0, 7);
  const envios = st.envios.map((e) => (e.texto && e.enlace ? { ...e, texto: e.texto.replace(e.enlace, ENLACE_PRODUCCION) } : e));
  return { mes, ...costoDelMes(envios, mes, (ms) => fechaISO(ms).slice(0, 7)) };
}

/** «7 de 10 (70 %)» */
export function porcentaje(x) {
  if (x.tasa === null) return 'sin datos aún';
  return `${x.n} de ${x.de} (${Math.round(x.tasa * 100)} %)`;
}
