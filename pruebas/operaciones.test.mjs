import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crearEstadoNegocio, registrarPaciente, crearCita, reprogramarCita, cambiarEstado, responder, avanzarReloj,
  agregarAEspera, aceptarOferta, resolverTarea, revocarConsentimiento, eliminarPaciente, canalesDe, huecosAlternativos,
  cambiarRegla, validarRegla,
} from '../js/nucleo/operaciones.mjs';
import { NEGOCIOS_CITAS } from '../js/nucleo/negocios.mjs';
import { msDeFecha, HORA, DIA, MIN } from '../js/nucleo/tiempo.mjs';
import { decodificar } from '../js/nucleo/enlace.mjs';
import { REGLA_POR_DEFECTO } from '../js/nucleo/recordatorios.mjs';

const neg = NEGOCIOS_CITAS.consultorio;
const t = (fecha, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return msDeFecha(fecha, h * 60 + m); };
const LUNES = t('2026-10-05', '08:00');
const OPC = { urlBase: 'https://ejemplo.test/confirmar.html', sala: 'abcdefghij' };

function base() {
  const st = crearEstadoNegocio(neg);
  const p1 = registrarPaciente(st, neg, { nombre: 'Iván De León', cedula: '8-000-1101', telefono: '6000-0101', correo: 'ivan@example.com', consentimiento: true }, LUNES).paciente;
  const p2 = registrarPaciente(st, neg, { nombre: 'Rosa Camarena', cedula: '8-000-1102', telefono: '6000-0102', consentimiento: true }, LUNES).paciente;
  const p3 = registrarPaciente(st, neg, { nombre: 'Omar Pinzón', cedula: '8-000-1103', telefono: '6000-0103', consentimiento: true }, LUNES).paciente;
  return { st, p1, p2, p3 };
}

const regla = { ...REGLA_POR_DEFECTO, dias: [2, 1], hora: 540, insistir: true, cadaHoras: 4, maxIntentos: 3, respaldo: 'sms', respaldoDesde: 3 };

test('registrar paciente: consentimiento obligatorio y trazable, teléfono y cédula validados, sin duplicados', () => {
  const st = crearEstadoNegocio(neg);
  const mal = registrarPaciente(st, neg, { nombre: 'Ana', cedula: '81234', telefono: '223-4567' }, LUNES);
  assert.deepEqual(mal.errores.map((e) => e.campo), ['nombre', 'cedula', 'telefono', 'consentimiento']);
  const ok = registrarPaciente(st, neg, { nombre: 'Ana  Sánchez', cedula: '8-000-1', telefono: '+507 6000-0999', consentimiento: true, canalConsentimiento: 'por teléfono' }, LUNES);
  assert.ok(ok.ok);
  assert.equal(ok.paciente.nombre, 'Ana Sánchez');
  assert.equal(ok.paciente.telefono, '+50760000999');
  assert.equal(ok.paciente.consentimiento.fecha, LUNES);
  assert.equal(ok.paciente.consentimiento.canal, 'por teléfono');
  assert.match(ok.paciente.consentimiento.texto, /Ley 81 de 2019/);
  assert.match(ok.paciente.consentimiento.texto, /datos de salud/);
  const dup = registrarPaciente(st, neg, { nombre: 'Otra Persona', cedula: '8-000-1', telefono: '6000-0998', consentimiento: true }, LUNES);
  assert.match(dup.errores[0].mensaje, /Ya hay alguien con esa cédula: Ana Sánchez/);
});

test('crear cita: se valida al escribir (otra recepcionista pudo guardar antes)', () => {
  const { st, p1, p2 } = base();
  const a = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  assert.ok(a.ok);
  const b = crearCita(st, neg, { pacienteId: p2.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  assert.equal(b.ok, false);
  assert.deepEqual(b.errores.map((e) => e.codigo), ['solape_profesional', 'solape_sala']);
  // «Cualquiera»: se asigna el otro profesional y su consultorio.
  const c = crearCita(st, neg, { pacienteId: p2.id, servicioId: 'control', profesionalId: null, salaId: null, inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  assert.ok(c.ok);
  assert.deepEqual([c.cita.profesionalId, c.cita.salaId], ['herrera', 'c2']);
});

test('recorrido: se agenda → sale el recordatorio → el paciente confirma → se detiene el reintento', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  assert.equal(st.envios.filter((e) => e.citaId === cita.id && e.estado === 'programado').length, 4, '3 mensajes y 1 llamada');
  const salieron = avanzarReloj(st, neg, t('2026-10-06', '09:00'), OPC);
  assert.equal(salieron.length, 1);
  assert.match(salieron[0].texto, /^Hola, Iván\. Te recordamos tu cita en Dermatología Ríos el jueves 8 de octubre a las 10:00 a\. m\. con Dra\. Ana Ríos/);
  const datos = decodificar(salieron[0].enlace.split('#')[1]);
  assert.ok(datos.ok);
  assert.equal(datos.datos.c, cita.id);
  assert.equal(datos.datos.s, 'abcdefghij');
  assert.equal(datos.datos.hs.length, 3);
  const r = responder(st, neg, { id: 'resp1', citaId: cita.id, tipo: 'confirmo', via: 'enlace' }, t('2026-10-06', '09:20'));
  assert.equal(r.resultado, 'confirmada');
  assert.equal(cita.estado, 'confirmada');
  assert.equal(st.envios.filter((e) => e.citaId === cita.id && e.estado === 'programado').length, 0, 'el reintento pendiente desapareció');
  assert.equal(st.envios.filter((e) => e.citaId === cita.id && e.estado === 'enviado').length, 1, 'lo enviado no se toca');
  assert.equal(avanzarReloj(st, neg, t('2026-10-08', '12:00'), OPC).length, 0, 'ya no sale nada más');
  assert.equal(responder(st, neg, { id: 'resp1', citaId: cita.id, tipo: 'cancelo' }, t('2026-10-06', '09:30')).resultado, 'repetida', 'la misma respuesta dos veces no hace nada');
  assert.equal(cita.estado, 'confirmada');
});

test('recorrido sin respuesta: reintentos hasta el máximo, el último por SMS, y «Llamar al paciente»', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const salieron = avanzarReloj(st, neg, t('2026-10-08', '09:00'), OPC);
  const mensajes = salieron.filter((e) => e.tipo === 'mensaje');
  assert.deepEqual(mensajes.map((e) => `${e.intento}/${e.de} ${e.canal} ${e.clase}`), ['1/3 whatsapp recordatorio', '2/3 whatsapp reintento', '3/3 sms recordatorio']);
  assert.match(mensajes[1].texto, /Seguimos sin saber si vendrás/);
  const tareas = st.tareas.filter((x) => x.citaId === cita.id && !x.hecha);
  assert.equal(tareas.length, 1);
  assert.match(tareas[0].motivo, /No respondió a 3 mensajes/);
  resolverTarea(st, neg, tareas[0].id, 'confirmo', t('2026-10-08', '09:05'));
  assert.equal(cita.estado, 'confirmada');
});

test('el paciente cancela desde el enlace: el hueco se ofrece a la lista de espera y el primero que acepta se lo queda', () => {
  const { st, p1, p2, p3 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'biopsia', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const w2 = agregarAEspera(st, neg, { pacienteId: p2.id, servicioId: 'control' }, LUNES).entrada;
  const w3 = agregarAEspera(st, neg, { pacienteId: p3.id, servicioId: 'crio', profesionalId: 'rios' }, LUNES).entrada;
  agregarAEspera(st, neg, { pacienteId: p3.id, servicioId: 'limpieza' }, LUNES); // no cabe en el consultorio 1
  const r = responder(st, neg, { id: 'x', citaId: cita.id, tipo: 'cancelo' }, t('2026-10-06', '11:00'));
  assert.equal(r.resultado, 'cancelada');
  assert.ok(r.oferta);
  assert.deepEqual(r.oferta.candidatos.sort(), [w2.id, w3.id].sort());
  const avisos = avanzarReloj(st, neg, t('2026-10-06', '11:00'), OPC).filter((e) => e.clase === 'oferta');
  assert.equal(avisos.length, 2);
  assert.match(avisos[0].texto, /Se liberó un espacio/);
  assert.equal(decodificar(avisos[0].enlace.split('#')[1]).datos.k, 'o');
  const gana = aceptarOferta(st, neg, { id: 'a1', ofertaId: r.oferta.id, esperaId: w3.id }, t('2026-10-06', '11:10'));
  assert.equal(gana.resultado, 'tomada');
  assert.equal(gana.cita.estado, 'confirmada');
  assert.equal(gana.cita.servicioId, 'crio');
  const tarde = aceptarOferta(st, neg, { id: 'a2', ofertaId: r.oferta.id, esperaId: w2.id }, t('2026-10-06', '11:12'));
  assert.equal(tarde.resultado, 'tomada');
  assert.equal(st.espera.find((e) => e.id === w2.id).estado, 'esperando', 'sigue en la lista');
});

test('el paciente elige otro hueco desde el enlace; si ya se ocupó, queda para llamar', () => {
  const { st, p1, p2 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const libre = t('2026-10-09', '11:00');
  const r = responder(st, neg, { id: 'c1', citaId: cita.id, tipo: 'cambio', hueco: libre }, t('2026-10-06', '10:00'));
  assert.equal(r.resultado, 'reprogramada');
  assert.equal(cita.inicio, libre);
  assert.equal(cita.estado, 'confirmada');
  assert.equal(st.envios.filter((e) => e.citaId === cita.id && e.estado === 'programado').length, 0);
  // Otro paciente: elige un hueco que ya tomó alguien.
  const otra = crearCita(st, neg, { pacienteId: p2.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '11:00'), regla }, LUNES).cita;
  const r2 = responder(st, neg, { id: 'c2', citaId: otra.id, tipo: 'cambio', hueco: libre }, t('2026-10-06', '10:05'));
  assert.equal(r2.resultado, 'hueco_ocupado');
  assert.equal(otra.inicio, t('2026-10-08', '11:00'), 'no se movió');
  assert.match(st.tareas.find((x) => x.citaId === otra.id).motivo, /ya no está libre/);
});

test('reprogramar en recepción cancela lo pendiente y replanifica para la hora nueva', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const antes = st.envios.filter((e) => e.citaId === cita.id).map((e) => e.id);
  const r = reprogramarCita(st, neg, cita.id, { inicio: t('2026-10-13', '9:00') }, t('2026-10-05', '12:00'));
  assert.ok(r.ok);
  assert.equal(cita.estado, 'reprogramada');
  assert.ok(st.envios.filter((e) => antes.includes(e.id)).every((e) => e.estado === 'cancelado' && e.motivoCancelacion === 'la cita se reprogramó'));
  const nuevos = st.envios.filter((e) => e.citaId === cita.id && e.estado === 'programado' && e.tipo === 'mensaje');
  assert.equal(nuevos[0].momento, t('2026-10-11', '9:00'), '2 días antes de la hora nueva');
  // No se puede mover encima de otra cita ni a un feriado.
  assert.equal(reprogramarCita(st, neg, cita.id, { inicio: t('2026-11-03', '9:00') }, LUNES).errores[0].codigo, 'feriado');
});

test('estados: transiciones permitidas y efectos', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  assert.match(cambiarEstado(st, neg, cita.id, 'atendida', LUNES).errores[0].mensaje, /Todavía no es la hora/);
  assert.ok(cambiarEstado(st, neg, cita.id, 'confirmada', LUNES).ok);
  assert.equal(st.envios.filter((e) => e.citaId === cita.id && e.estado === 'programado').length, 0);
  assert.ok(cambiarEstado(st, neg, cita.id, 'no_asistio', t('2026-10-08', '10:30')).ok);
  assert.ok(cambiarEstado(st, neg, cita.id, 'atendida', t('2026-10-08', '10:31')).ok, 'se puede corregir');
  assert.equal(cambiarEstado(st, neg, cita.id, 'pendiente', t('2026-10-08', '10:31')).ok, false);
});

test('retirar el consentimiento detiene los mensajes; sin él no se planifica nada', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  revocarConsentimiento(st, p1.id, LUNES + HORA);
  assert.deepEqual(canalesDe(p1), []);
  assert.ok(st.envios.filter((e) => e.citaId === cita.id).every((e) => e.estado === 'cancelado'));
  assert.equal(avanzarReloj(st, neg, t('2026-10-08', '9:00'), OPC).length, 0);
  assert.match(eliminarPaciente(st, p1.id, LUNES).errores[0].mensaje, /Cancélalas antes/);
  cambiarEstado(st, neg, cita.id, 'cancelada', LUNES);
  assert.ok(eliminarPaciente(st, p1.id, LUNES).ok);
  assert.equal(p1.telefono, '');
  assert.equal(p1.nombre, 'Persona eliminada');
});

test('huecos alternativos del enlace: libres, del mismo profesional, en días distintos', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const hs = huecosAlternativos(st, neg, cita, t('2026-10-06', '9:00'));
  assert.equal(hs.length, 3);
  assert.equal(new Set(hs.map((h) => new Date(h - 5 * HORA).toISOString().slice(0, 10))).size, 3);
  assert.ok(hs.every((h) => h > t('2026-10-06', '11:00') - MIN && h !== cita.inicio));
  assert.ok(hs.every((h) => h - t('2026-10-06', '9:00') < 30 * DIA));
});

test('cambiar la regla de una cita replanifica; una regla imposible no se guarda', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const r = cambiarRegla(st, cita.id, { ...regla, dias: [1], insistir: false, hora: 600 }, LUNES);
  assert.ok(r.ok);
  const prog = st.envios.filter((e) => e.citaId === cita.id && e.estado === 'programado');
  assert.deepEqual(prog.map((e) => e.momento), [t('2026-10-07', '10:00')]);
  assert.equal(validarRegla({ ...regla, dias: [] })[0].campo, 'dias');
  assert.equal(validarRegla({ ...regla, hora: 21 * 60 })[0].campo, 'hora');
  assert.equal(cambiarRegla(st, cita.id, { ...regla, dias: [] }, LUNES).ok, false);
});
