// Reglas que la revisión del 3-oct-2026 encontró sin proteger o rotas. Cada prueba falla con el código de antes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crearEstadoNegocio, registrarPaciente, crearCita, reprogramarCita, cambiarEstado, responder, avanzarReloj,
  agregarAEspera, aceptarOferta, eliminarPaciente, cambiarRegla, solicitarCita, cambiarAjustes,
} from '../js/nucleo/operaciones.mjs';
import { planificar, ajustarAVentana, REGLA_POR_DEFECTO } from '../js/nucleo/recordatorios.mjs';
import { validarCita, huecosDelDia, siguienteMomentoAbierto } from '../js/nucleo/agenda.mjs';
import { importarCalendario } from '../js/nucleo/ical.mjs';
import { codificar, decodificar } from '../js/nucleo/enlace.mjs';
import { NEGOCIOS_CITAS } from '../js/nucleo/negocios.mjs';
import { aplicarMensaje, acuseDe, esAcuseDe, mensajeSolicitud, mensajeRespuesta } from '../js/nucleo/mensajes-relevo.mjs';
import { crearEstadoInicial } from '../js/nucleo/demo.mjs';
import { msDeFecha, fechaISO, horaCorta, diaRelativo, HORA, MIN } from '../js/nucleo/tiempo.mjs';

const neg = NEGOCIOS_CITAS.consultorio;
const t = (fecha, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return msDeFecha(fecha, h * 60 + m); };
const LUNES = t('2026-10-05', '08:00');
const OPC = { urlBase: 'https://ejemplo.test/confirmar.html', sala: 'abcdefghij' };
const regla = { ...REGLA_POR_DEFECTO, dias: [2, 1], hora: 540, insistir: true, cadaHoras: 4, maxIntentos: 3, respaldo: 'sms', respaldoDesde: 3 };

function base() {
  const st = crearEstadoNegocio(neg);
  const p1 = registrarPaciente(st, neg, { nombre: 'Iván De León', cedula: '8-000-1101', telefono: '6000-0101', correo: 'ivan@example.com', consentimiento: true }, LUNES).paciente;
  const p2 = registrarPaciente(st, neg, { nombre: 'Rosa Camarena', cedula: '8-000-1102', telefono: '6000-0102', consentimiento: true }, LUNES).paciente;
  const p3 = registrarPaciente(st, neg, { nombre: 'Omar Pinzón', cedula: '8-000-1103', telefono: '6000-0103', consentimiento: true }, LUNES).paciente;
  return { st, p1, p2, p3 };
}
const abiertas = (st, citaId) => st.tareas.filter((x) => x.citaId === citaId && !x.hecha);
/** Cita del jueves 8 a las 10:00 sin respuesta hasta el miércoles 7 a las 14:00: ya hay tarea de llamar. */
function citaConTarea() {
  const b = base();
  const { cita } = crearCita(b.st, neg, { pacienteId: b.p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  avanzarReloj(b.st, neg, t('2026-10-07', '14:00'), OPC);
  assert.equal(abiertas(b.st, cita.id).length, 1, 'la tarea de llamar existe antes de responder');
  return { ...b, cita };
}

// ── Autoagenda ─────────────────────────────────────────────────────────────

test('autoagenda: una cédula que ya existe no revela de quién es, venga el celular bien, mal o vacío', () => {
  const { st, p1 } = base();
  const antes = st.bitacora.length;
  for (const telefono of ['123', '6000-0999', '']) {
    const r = solicitarCita(st, neg, { persona: { nombre: 'Otra Persona', cedula: p1.cedula, telefono, consentimiento: true }, servicioId: 'control', inicio: t('2026-10-09', '11:00') }, LUNES);
    assert.equal(r.ok, false, telefono);
    const textos = r.errores.map((e) => e.mensaje).join(' ');
    assert.ok(!textos.includes('Iván') && !textos.includes('De León'), `«${textos}» nombra a la persona`);
    assert.ok(!/Búscalo|Ya hay alguien|ya está registrada/.test(textos), `«${textos}» confirma que la cédula existe`);
  }
  assert.equal(st.bitacora.length, antes, 'nada queda en la bitácora');
});

test('autoagenda: si la hora no sirve no se registra a nadie ni se anota nada; una hora pasada no se llama «ocupada»', () => {
  const { st, p1 } = base();
  crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const pacientes = st.pacientes.length, bitacora = st.bitacora.length;
  const persona = { nombre: 'Nueva Persona', cedula: '8-000-2101', telefono: '6000-0211', consentimiento: true };
  const ocupada = solicitarCita(st, neg, { persona, servicioId: 'control', profesionalId: 'rios', inicio: t('2026-10-08', '10:00') }, LUNES);
  assert.match(ocupada.errores.map((e) => e.mensaje).join(' '), /se acaba de ocupar/);
  const pasada = solicitarCita(st, neg, { persona, servicioId: 'control', profesionalId: 'rios', inicio: t('2026-10-03', '09:00') }, LUNES);
  const textoPasada = pasada.errores.map((e) => e.mensaje).join(' ');
  assert.match(textoPasada, /ya pasó/);
  assert.ok(!/ocupar/.test(textoPasada), textoPasada);
  assert.equal(st.pacientes.length, pacientes, 'no se registró a nadie');
  assert.equal(st.bitacora.length, bitacora, 'la bitácora no dice «Se registró a…» de alguien que no quedó');
});

// ── Tareas de llamar ───────────────────────────────────────────────────────

for (const [como, hacer] of [
  ['la persona confirma por el enlace', (st, cita, a) => responder(st, neg, { id: 'r1', citaId: cita.id, tipo: 'confirmo' }, a)],
  ['la recepción la marca confirmada', (st, cita, a) => cambiarEstado(st, neg, cita.id, 'confirmada', a)],
  ['la recepción la reprograma', (st, cita, a) => reprogramarCita(st, neg, cita.id, { inicio: t('2026-10-13', '09:00') }, a)],
  ['la persona elige otro horario libre', (st, cita, a) => responder(st, neg, { id: 'r2', citaId: cita.id, tipo: 'cambio', hueco: t('2026-10-09', '11:00') }, a)],
  ['la persona cancela por el enlace', (st, cita, a) => responder(st, neg, { id: 'r3', citaId: cita.id, tipo: 'cancelo' }, a)],
  ['la recepción la cancela', (st, cita, a) => cambiarEstado(st, neg, cita.id, 'cancelada', a)],
]) {
  test(`la tarea «no respondió» se cierra cuando ${como}`, () => {
    const { st, cita } = citaConTarea();
    const r = hacer(st, cita, t('2026-10-07', '14:30'));
    assert.notEqual(r.ok, false);
    assert.equal(abiertas(st, cita.id).length, 0);
  });
}

test('si pide que la llamen, queda una sola tarea (la nueva reemplaza a «no respondió»)', () => {
  const { st, cita } = citaConTarea();
  responder(st, neg, { id: 'r4', citaId: cita.id, tipo: 'llamenme' }, t('2026-10-07', '14:30'));
  assert.deepEqual(abiertas(st, cita.id).map((x) => x.motivo), ['Pidió que lo llamen para cambiar la cita']);
});

test('cuando la cita empieza, sus tareas de llamar se cierran solas al pasar el reloj', () => {
  const { st, cita } = citaConTarea();
  avanzarReloj(st, neg, t('2026-10-08', '09:59'), OPC);
  assert.equal(abiertas(st, cita.id).length, 1);
  avanzarReloj(st, neg, t('2026-10-08', '10:00'), OPC);
  assert.equal(abiertas(st, cita.id).length, 0);
  assert.equal(st.tareas.find((x) => x.citaId === cita.id).hecha.resultado, 'vencida');
});

test('«hoy», «mañana», «ayer» o la fecha: nunca «mañana» para una cita que ya pasó', () => {
  const ahora = t('2026-10-05', '14:30');
  assert.equal(diaRelativo(t('2026-10-05', '16:00'), ahora), 'hoy');
  assert.equal(diaRelativo(t('2026-10-06', '08:00'), ahora), 'mañana');
  assert.equal(diaRelativo(t('2026-10-04', '10:00'), ahora), 'ayer');
  assert.equal(diaRelativo(t('2026-10-03', '10:00'), ahora), 'sáb 3 oct');
  assert.equal(diaRelativo(t('2026-10-09', '10:00'), ahora), 'vie 9 oct');
});

// ── La misma persona, dos citas a la vez ───────────────────────────────────

test('la misma persona no puede tener dos citas que se pisan, aunque sean con profesionales distintos', () => {
  const { st, p1 } = base();
  assert.ok(crearCita(st, neg, { pacienteId: p1.id, servicioId: 'primera', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-09', '15:00'), regla }, LUNES).ok);
  const otra = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'primera', profesionalId: 'herrera', salaId: 'c2', inicio: t('2026-10-09', '15:00'), regla }, LUNES);
  assert.equal(otra.ok, false);
  const e = otra.errores.find((x) => x.codigo === 'solape_paciente');
  assert.ok(e, JSON.stringify(otra.errores));
  assert.match(e.mensaje, /ya tiene una cita de 3:00 p\. m\. a 3:30 p\. m\. con Dra\. Ana Ríos/);
  assert.ok(crearCita(st, neg, { pacienteId: p1.id, servicioId: 'primera', profesionalId: 'herrera', salaId: 'c2', inicio: t('2026-10-09', '15:30'), regla }, LUNES).ok, 'una cita contigua sí');
  const horas = huecosDelDia({ negocio: neg, citas: st.citas, fecha: '2026-10-09', servicioId: 'control', profesionalId: 'herrera', pacienteId: p1.id }).map((h) => horaCorta(h.inicio));
  assert.ok(!horas.includes('2:45') && !horas.includes('3:00') && !horas.includes('3:30'), horas.join(' '));
  assert.ok(horas.includes('2:30'));
  const otraPersona = huecosDelDia({ negocio: neg, citas: st.citas, fecha: '2026-10-09', servicioId: 'control', profesionalId: 'herrera' }).map((h) => horaCorta(h.inicio));
  assert.ok(otraPersona.includes('3:00'), 'para otra persona, Herrera sí está libre a las 3:00');
});

test('reprogramar a la misma persona no choca con su propia cita', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-09', '15:00'), regla }, LUNES);
  assert.ok(reprogramarCita(st, neg, cita.id, { inicio: t('2026-10-09', '15:15') }, LUNES).ok);
});

// ── Cambiar el recordatorio a mitad de camino ──────────────────────────────

test('cambiar el recordatorio con mensajes ya enviados no reinicia el conteo ni escribe pegado', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla: { ...REGLA_POR_DEFECTO, dias: [2, 1] } }, t('2026-10-05', '10:00'));
  avanzarReloj(st, neg, t('2026-10-06', '17:30'), OPC);
  const enviados = () => st.envios.filter((e) => e.citaId === cita.id && e.tipo === 'mensaje' && e.estado === 'enviado');
  assert.equal(enviados().length, 3, 'salieron 1/4, 2/4 y 3/4');
  const r = cambiarRegla(st, cita.id, { ...cita.regla, hora: 600 }, t('2026-10-06', '17:30'));
  assert.ok(r.ok);
  const nuevos = r.plan.filter((x) => x.tipo === 'mensaje');
  assert.deepEqual(nuevos.map((x) => `${x.intento}/${x.de}`), ['4/4'], 'queda uno: el cuarto de cuatro');
  assert.equal(nuevos[0].momento, t('2026-10-07', '10:00'));
  assert.ok(nuevos[0].momento - enviados().at(-1).momento >= 4 * HORA, 'respeta «cada 4 h» desde el último enviado');
  avanzarReloj(st, neg, t('2026-10-08', '09:30'), OPC);
  assert.equal(enviados().length, 4, 'en total, el máximo de la regla');
});

// ── Borrar los datos (derecho de cancelación) ──────────────────────────────

test('borrar los datos también los quita de la bitácora y de los mensajes enviados', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  avanzarReloj(st, neg, t('2026-10-07', '18:00'), OPC);
  assert.ok(st.envios.some((e) => e.pacienteId === p1.id && e.texto && e.texto.includes('Iván')), 'antes, el texto lo nombra');
  cambiarEstado(st, neg, cita.id, 'cancelada', t('2026-10-07', '18:00'));
  assert.ok(eliminarPaciente(st, p1.id, t('2026-10-07', '18:30')).ok);
  const todo = JSON.stringify(st);
  assert.ok(!todo.includes('Iván') && !todo.includes('De León'), 'no queda el nombre en ninguna parte');
  assert.ok(!todo.includes('ivan@example.com') && !todo.includes('60000101'), 'ni el correo ni el teléfono');
  assert.ok(st.envios.filter((e) => e.pacienteId === p1.id && e.estado === 'enviado').every((e) => e.borrado && !e.texto && !e.enlace));
  assert.ok(st.bitacora.some((b) => /persona eliminada/.test(b.texto)), 'la bitácora conserva qué pasó, sin el nombre');
});

// ── Huecos que ya pasaron ──────────────────────────────────────────────────

test('si la persona elige un horario que ya pasó, el resultado es «hueco_pasado», no «ocupado»', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const r = responder(st, neg, { id: 'p1', citaId: cita.id, tipo: 'cambio', hueco: t('2026-10-06', '09:00') }, t('2026-10-06', '10:00'));
  assert.equal(r.resultado, 'hueco_pasado');
  assert.equal(cita.inicio, t('2026-10-08', '10:00'), 'la cita no se movió');
  assert.match(abiertas(st, cita.id)[0].motivo, /ya pasó/);
});

// ── Citas que nacen confirmadas ────────────────────────────────────────────

test('una cita que nace confirmada (barbería con autoconfirmación) recibe un aviso el día antes, sin insistir', () => {
  const barb = NEGOCIOS_CITAS.barberia;
  const st = crearEstadoNegocio(barb);
  const r = solicitarCita(st, barb, { persona: { nombre: 'Cliente Prueba', cedula: '8-000-7777', telefono: '6000-0777', consentimiento: true }, servicioId: 'corte', inicio: t('2026-10-08', '10:00') }, LUNES);
  assert.ok(r.ok);
  assert.equal(r.cita.estado, 'confirmada');
  const env = st.envios.filter((e) => e.citaId === r.cita.id);
  assert.deepEqual(env.map((e) => [e.tipo, e.clase, e.etiqueta, e.momento]), [['mensaje', 'aviso', '1 día antes', t('2026-10-07', '09:00')]]);
  const salieron = avanzarReloj(st, barb, t('2026-10-07', '09:00'), OPC);
  assert.equal(salieron.length, 1);
  assert.match(salieron[0].texto, /Te esperamos/);
  assert.ok(!/Confirma/.test(salieron[0].texto), 'no le pide confirmar lo que ya está confirmado');
});

test('la cita que se toma de la lista de espera también recibe su aviso', () => {
  const { st, p1, p2 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const w = agregarAEspera(st, neg, { pacienteId: p2.id, servicioId: 'control' }, LUNES).entrada;
  const { oferta } = responder(st, neg, { id: 'c1', citaId: cita.id, tipo: 'cancelo' }, t('2026-10-06', '11:00'));
  const gana = aceptarOferta(st, neg, { id: 'a1', ofertaId: oferta.id, esperaId: w.id }, t('2026-10-06', '11:10'));
  assert.equal(gana.cita.estado, 'confirmada');
  assert.deepEqual(st.envios.filter((e) => e.citaId === gana.cita.id).map((e) => e.clase), ['aviso']);
});

// ── Mutaciones que sobrevivían ─────────────────────────────────────────────

test('validarCita respeta el buffer: con 15 min entre citas, la contigua no se guarda', () => {
  const conBuffer = { ...neg, ajustes: { ...neg.ajustes, buffer: 15 } };
  const citas = [{ id: 'a', profesionalId: 'rios', salaId: 'c1', servicioId: 'crio', inicio: t('2026-10-06', '09:00'), fin: t('2026-10-06', '09:30'), estado: 'confirmada' }];
  const prop = { servicioId: 'crio', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-06', '09:30') };
  const e = validarCita(conBuffer, citas, prop, 0);
  assert.deepEqual(e.map((x) => x.codigo), ['solape_profesional', 'solape_sala']);
  assert.match(e[0].mensaje, /15 min entre citas/);
  assert.deepEqual(validarCita(neg, citas, prop, 0), [], 'sin buffer, la contigua sí');
});

test('ventana de envío: a las 8:00 p. m. en punto ya no se escribe; pasa al día siguiente a las 8:00', () => {
  assert.equal(fechaISO(ajustarAVentana(t('2026-10-06', '20:00'))), '2026-10-07');
  assert.equal(horaCorta(ajustarAVentana(t('2026-10-06', '20:00'))), '8:00');
  assert.equal(ajustarAVentana(t('2026-10-06', '19:59')), t('2026-10-06', '19:59'));
});

test('un hueco que empieza en menos de una hora no se ofrece a la lista de espera', () => {
  for (const [cancela, ofrece] of [[t('2026-10-06', '09:15'), false], [t('2026-10-06', '08:55'), true]]) {
    const { st, p1, p2 } = base();
    const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-06', '10:00'), regla }, LUNES);
    agregarAEspera(st, neg, { pacienteId: p2.id, servicioId: 'control' }, LUNES);
    const r = cambiarEstado(st, neg, cita.id, 'cancelada', cancela);
    assert.equal(!!r.oferta, ofrece, `cancelada a las ${horaCorta(cancela)}`);
  }
});

test('cuando alguien acepta el espacio, los avisos que faltaban a los demás se detienen', () => {
  const { st, p1, p2, p3 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  const w2 = agregarAEspera(st, neg, { pacienteId: p2.id, servicioId: 'control' }, LUNES).entrada;
  const w3 = agregarAEspera(st, neg, { pacienteId: p3.id, servicioId: 'control' }, LUNES).entrada;
  const { oferta } = responder(st, neg, { id: 'x', citaId: cita.id, tipo: 'cancelo' }, t('2026-10-06', '07:00'));
  assert.ok(oferta);
  assert.ok(aceptarOferta(st, neg, { id: 'a', ofertaId: oferta.id, esperaId: w2.id }, t('2026-10-06', '07:05')).ok);
  const alOtro = st.envios.find((e) => e.ofertaId === oferta.id && e.esperaId === w3.id);
  assert.equal(alOtro.estado, 'cancelado');
  assert.equal(alOtro.motivoCancelacion, 'otra persona tomó el espacio');
});

test('una hora con TZID se lee como la fecha escrita, aunque en UTC cayera el día anterior', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:madrugada@example.com', 'DTSTART;TZID=America/Panama:20261110T030000',
    'DTEND;TZID=America/Panama:20261112T030000', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const e = importarCalendario(ics).eventos[0];
  assert.deepEqual([e.inicio, e.fin], ['2026-11-10', '2026-11-12']);
});

test('un enlace con cuatro horarios alternativos (todos con forma válida) se rechaza', () => {
  const datos = { k: 'c', pl: 'consultorio', c: 'c_abc123', n: 'Iván', i: 29823510, pr: 'rios', sv: 'control', sl: 'c1', s: 'abcdefghij' };
  assert.ok(decodificar(codificar({ ...datos, hs: [29820495, 29823315, 29823400] })).ok);
  assert.equal(decodificar(codificar({ ...datos, hs: [29820495, 29823315, 29823400, 29823500] })).ok, false);
});

// ── Planificador ───────────────────────────────────────────────────────────

const citaP = (inicio, estado = 'pendiente') => ({ id: 'c1', inicio, fin: inicio + 30 * MIN, estado });

test('el recordatorio atrasado «al agendar» no sale si el siguiente llega antes de N horas', () => {
  const plan = planificar(citaP(t('2026-10-06', '09:30')), REGLA_POR_DEFECTO, t('2026-10-05', '08:00'));
  const msj = plan.filter((p) => p.tipo === 'mensaje');
  assert.equal(msj[0].momento, t('2026-10-05', '09:00'), 'el primero es el de «1 día antes», no uno a las 8:00');
  for (let i = 1; i < msj.length; i++) assert.ok(msj[i].momento - msj[i - 1].momento >= 4 * HORA, `${horaCorta(msj[i - 1].momento)} → ${horaCorta(msj[i].momento)}`);
});

test('«el último por SMS» va en el último mensaje del plan real, aunque quepan menos que el máximo', () => {
  const dos = planificar(citaP(t('2026-10-06', '16:00')), REGLA_POR_DEFECTO, t('2026-10-06', '10:00')).filter((p) => p.tipo === 'mensaje');
  assert.deepEqual(dos.map((p) => p.canal), ['whatsapp', 'sms']);
  const uno = planificar(citaP(t('2026-10-06', '11:30')), REGLA_POR_DEFECTO, t('2026-10-06', '10:00')).filter((p) => p.tipo === 'mensaje');
  assert.deepEqual(uno.map((p) => p.canal), ['whatsapp'], 'con un solo mensaje no hay escalera');
});

test('la tarea de llamar cae cuando el negocio abre: ni en domingo ni a las 7:00', () => {
  const abrir = (ms) => siguienteMomentoAbierto(neg, ms);
  // Cita el lunes 12 a las 10:00, agendada el viernes 9 a las 6:00 p. m.: los mensajes caen el sábado y el domingo.
  const llamar = planificar(citaP(t('2026-10-12', '10:00')), REGLA_POR_DEFECTO, t('2026-10-09', '18:00'), { siguienteAbierto: abrir }).find((p) => p.tipo === 'llamar');
  assert.equal(fechaISO(llamar.momento), '2026-10-12');
  assert.equal(horaCorta(llamar.momento), '8:00');
  // Cita a las 8:45 a. m., agendada la noche anterior: la llamada no queda a las 7:45 (cerrado) sino a la apertura.
  const temprano = planificar(citaP(t('2026-10-07', '08:45')), REGLA_POR_DEFECTO, t('2026-10-06', '19:30'), { siguienteAbierto: abrir }).find((p) => p.tipo === 'llamar');
  assert.equal(temprano.momento, t('2026-10-07', '08:00'), horaCorta(temprano.momento));
});

test('siguienteMomentoAbierto: dentro del horario se queda; en el almuerzo pasa a la 1:00; el sábado tarde, al lunes', () => {
  assert.equal(siguienteMomentoAbierto(neg, t('2026-10-06', '10:10')), t('2026-10-06', '10:10'));
  assert.equal(siguienteMomentoAbierto(neg, t('2026-10-06', '12:30')), t('2026-10-06', '13:00'));
  assert.equal(siguienteMomentoAbierto(neg, t('2026-10-06', '06:00')), t('2026-10-06', '08:00'));
  assert.equal(siguienteMomentoAbierto(neg, t('2026-10-10', '13:00')), t('2026-10-12', '08:00'));
  assert.equal(siguienteMomentoAbierto(neg, t('2026-11-02', '18:00')), t('2026-11-04', '08:00'), 'salta el feriado del 3 de noviembre');
});

test('una cita confirmada: un solo aviso a su hora (el más cercano), sin reintentos, sin escalera y sin llamar', () => {
  const JUEVES_10 = t('2026-10-08', '10:00');
  const plan = planificar(citaP(JUEVES_10, 'confirmada'), REGLA_POR_DEFECTO, LUNES);
  assert.deepEqual(plan.map((p) => [p.tipo, p.motivo, p.canal, p.momento, `${p.intento}/${p.de}`]), [['mensaje', 'aviso', 'whatsapp', t('2026-10-07', '09:00'), '1/1']]);
  assert.deepEqual(planificar(citaP(JUEVES_10, 'confirmada'), REGLA_POR_DEFECTO, t('2026-10-07', '15:00')), [], 'si ya pasó la hora del aviso, no se manda «al agendar»');
});

// ── Relevo entre dispositivos: el teléfono se entera del resultado real ────

test('relevo: una solicitud rechazada no deja a nadie registrado y el acuse dice por qué', () => {
  const estado = crearEstadoInicial(t('2026-10-06', '10:00'), { urlBase: 'x', sala: 'abcdefghij' });
  const st = estado.negocios.consultorio;
  // El teléfono, con su propio reloj, pidió las 8:30 de hoy; en la recepción ya son las 10:00.
  const sol = mensajeSolicitud({ id: 's_pasada', pl: 'consultorio', cita: { servicioId: 'control', profesionalId: 'rios', inicio: Math.round(t('2026-10-06', '08:30') / 60000) }, paciente: { nombre: 'Remota Prueba', cedula: '8-000-5555', telefono: '6000-0555', consentimiento: true } });
  const pacientes = st.pacientes.length;
  const r = aplicarMensaje(estado, sol);
  assert.equal(r.resultado, 'rechazada');
  assert.match(r.aviso, /ya pasó/);
  assert.equal(st.pacientes.length, pacientes);
  assert.ok(!JSON.stringify(st.bitacora).includes('Remota Prueba'), 'la bitácora no dice que se registró');
  const ac = acuseDe(sol, r);
  assert.ok(esAcuseDe(ac, 's_pasada'));
  assert.equal(ac.resultado, 'rechazada');
  assert.match(ac.motivo, /ya pasó/);
  assert.equal(esAcuseDe(ac, 's_otra'), false, 'el acuse es solo para quien lo pidió');
  assert.equal(acuseDe(sol, aplicarMensaje(estado, sol)), null, 'lo repetido no se vuelve a contestar');
});

test('relevo: el acuse de un cambio trae la hora nueva; el de un horario ocupado, que no se movió', () => {
  const estado = crearEstadoInicial(t('2026-10-06', '10:00'), { urlBase: 'x', sala: 'abcdefghij' });
  const st = estado.negocios.consultorio;
  const ahora = estado.reloj.ahora;
  const [a, b] = st.citas.filter((c) => c.estado === 'pendiente' && c.inicio > ahora + 26 * HORA && c.profesionalId === 'rios');
  const libre = huecosDelDia({ negocio: neg, citas: st.citas, fecha: '2026-10-14', servicioId: a.servicioId, profesionalId: a.profesionalId, ahora, excluirCitaId: a.id, pacienteId: a.pacienteId })[0].inicio;
  const m1 = mensajeRespuesta({ id: 'r_cambio1', pl: 'consultorio', citaId: a.id, respuesta: 'cambio', hueco: Math.round(libre / 60000) });
  const ac1 = acuseDe(m1, aplicarMensaje(estado, m1));
  assert.deepEqual([ac1.resultado, ac1.inicio, ac1.estado], ['reprogramada', Math.round(libre / 60000), 'confirmada']);
  // b pide el mismo horario: ya lo tomó a.
  const m2 = mensajeRespuesta({ id: 'r_cambio2', pl: 'consultorio', citaId: b.id, respuesta: 'cambio', hueco: Math.round(libre / 60000) });
  const ac2 = acuseDe(m2, aplicarMensaje(estado, m2));
  assert.equal(ac2.resultado, 'hueco_ocupado');
  assert.equal(ac2.inicio, Math.round(b.inicio / 60000), 'su cita sigue donde estaba');
});

test('una cita que ya empezó no se confirma ni se cambia desde el enlace', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  assert.equal(responder(st, neg, { id: 'tarde1', citaId: cita.id, tipo: 'confirmo' }, t('2026-10-08', '10:05')).resultado, 'cerrada');
  assert.equal(responder(st, neg, { id: 'tarde2', citaId: cita.id, tipo: 'cancelo' }, t('2026-10-08', '10:05')).resultado, 'cerrada');
  assert.equal(cita.estado, 'pendiente');
});

test('ajustes de la demo: los minutos entre citas y la autoconfirmación se cambian desde la recepción', () => {
  const { st, p1, p2 } = base();
  assert.ok(crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES).ok);
  assert.ok(cambiarAjustes(st, { buffer: 15 }).ok);
  const contigua = crearCita(st, neg, { pacienteId: p2.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:30'), regla }, LUNES);
  assert.equal(contigua.ok, false, 'la primera termina a las 10:20; con 15 min entre citas, la de las 10:30 ya no cabe');
  assert.match(contigua.errores.map((e) => e.mensaje).join(' '), /15 min entre citas/);
  assert.ok(crearCita(st, neg, { pacienteId: p2.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:45'), regla }, LUNES).ok);
  assert.equal(cambiarAjustes(st, { buffer: 7 }).ok, false);
  assert.equal(cambiarAjustes(st, { autoConfirmar: 'sí' }).ok, false);
  assert.ok(cambiarAjustes(st, { autoConfirmar: true }).ok);
  const r = solicitarCita(st, neg, { persona: { nombre: 'Nueva Persona', cedula: '8-000-2301', telefono: '6000-0231', consentimiento: true }, servicioId: 'control', inicio: t('2026-10-09', '10:00') }, LUNES);
  assert.equal(r.cita.estado, 'confirmada');
});

// ── Alojamiento ────────────────────────────────────────────────────────────

import {
  vigilar, sincronizarCanal, eventosParaExportar, proponerReubicacion, moverReserva, simularCaida, activarCierre,
  simularReservaOta, aplicarImportacion, previsualizarImportacion, unidadesEnRiesgo, detectarChoques, sincronizoDespuesDe,
} from '../js/nucleo/alojamiento.mjs';
import { semillaAlojamiento } from '../js/nucleo/semilla.mjs';
import { NEGOCIO_ALOJAMIENTO } from '../js/nucleo/negocios.mjs';
import { exportarCalendario } from '../js/nucleo/ical.mjs';

const A = (id, canal, unidades, llegada, salida, extra = {}) => ({ id, canal, unidades, llegada, salida, estado: 'confirmada', creada: 0, ...extra });

test('vigilante: dentro del máximo pero sin sincronizar no es «al día»; y «volvió a sincronizar» solo si de verdad sincronizó', () => {
  const ahora = 100 * HORA;
  const caido = { id: 'booking', nombre: 'Booking.com', ultimaSync: ahora - 9 * HORA, maxHoras: 12, intervaloHoras: 2, caido: true, urls: { corotu: 'u' } };
  const v = vigilar([caido], ahora)[0];
  assert.equal(v.vencido, false, '9 h con máximo de 12 h no es alerta roja');
  assert.equal(v.estado, 'retrasado', 'pero tampoco está al día: no sincroniza desde hace 9 h');
  assert.equal(vigilar([{ ...caido, ultimaSync: ahora - HORA }], ahora)[0].estado, 'al_dia');
  assert.equal(vigilar([{ ...caido, maxHoras: 6 }], ahora)[0].estado, 'vencido');
  const cierre = { canalId: 'booking', desde: ahora - HORA };
  assert.equal(sincronizoDespuesDe(caido, cierre), false, 'subir el máximo no es volver a sincronizar');
  assert.equal(sincronizoDespuesDe({ ...caido, ultimaSync: ahora }, cierre), true);
});

test('importar: la vista previa cuenta lo que se va a quitar y reconoce un archivo exportado desde aquí', () => {
  const reservas = [
    A('d1', 'directo', ['corotu'], '2026-10-01', '2026-10-04'),
    A('b1', 'booking', ['corotu'], '2026-10-12', '2026-10-15', { uidExterno: 'x@booking.com', unidadCanal: 'corotu' }),
  ];
  const propio = exportarCalendario({ nombre: 'Corotú', eventos: eventosParaExportar(reservas, 'corotu'), dtstamp: 0 });
  const leido = importarCalendario(propio);
  const v = previsualizarImportacion(reservas, 'booking', 'corotu', leido);
  assert.equal(v.soloEcos, true, 'todas sus estancias salieron de aquí');
  assert.deepEqual(v.quitadas.map((r) => [r.id, r.llegada, r.salida]), [['b1', '2026-10-12', '2026-10-15']]);
  assert.equal(reservas[1].estado, 'confirmada', 'la vista previa no cambia nada');
});

test('una reserva de canal reubicada no se pierde en la siguiente importación y sale en el calendario de su cabaña nueva', () => {
  let reservas = [A('b1', 'booking', ['nance'], '2026-10-04', '2026-10-06', { uidExterno: 'res1@booking.com', unidadCanal: 'nance' })];
  const aloj = { reservas, canales: [], cierres: [] };
  assert.ok(moverReserva(aloj, NEGOCIO_ALOJAMIENTO, 'b1', 'nance', 'espave', 0).ok);
  reservas = aloj.reservas;
  // Booking sigue mandando la reserva en el calendario de Nance (allá no se movió): no se duplica ni se quita.
  const deNance = sincronizarCanal(reservas, 'booking', 'nance', [{ uid: 'res1@booking.com', inicio: '2026-10-04', fin: '2026-10-06', resumen: 'CLOSED - Not available' }], 1, () => 'n1');
  assert.deepEqual([deNance.nuevas.length, deNance.quitadas.length], [0, 0]);
  assert.deepEqual(deNance.reservas.filter((r) => r.estado !== 'cancelada').map((r) => r.unidades.join()), ['espave']);
  // El calendario de Booking para Espavé no la trae (Booking no sabe que se movió): tampoco se quita.
  const deEspave = sincronizarCanal(reservas, 'booking', 'espave', [], 1, () => 'n2');
  assert.equal(deEspave.quitadas.length, 0);
  // Si Booking la cambia de fecha en Nance, la reserva movida sigue a esas fechas.
  const cambio = sincronizarCanal(reservas, 'booking', 'nance', [{ uid: 'res1@booking.com', inicio: '2026-10-05', fin: '2026-10-07', resumen: '' }], 1, () => 'n3');
  assert.deepEqual(cambio.cambiadas.map((r) => [r.unidades.join(), r.llegada]), [['espave', '2026-10-05']]);
  // Espavé está ocupada esas noches: su calendario lo dice a los demás canales (no es eco: Booking la tiene en Nance).
  assert.deepEqual(eventosParaExportar(reservas, 'espave').map((e) => [e.inicio, e.fin]), [['2026-10-04', '2026-10-06']]);
  assert.deepEqual(eventosParaExportar(reservas, 'nance'), []);
});

test('reubicar: primero las cabañas que no están en cierre ni conectadas al canal caído', () => {
  const ahora = msDeFecha('2026-10-06', 10 * 60);
  const aloj = semillaAlojamiento(ahora);
  simularCaida(aloj, 'booking', ahora);
  activarCierre(aloj, 'booking', ahora);
  const s = simularReservaOta(aloj, 'booking', ahora, fechaISO(ahora));
  const ch = detectarChoques(aloj.reservas).find((c) => c.b.id === s.reserva.id);
  const riesgo = unidadesEnRiesgo(aloj, ahora);
  assert.deepEqual([...riesgo].sort(), ['corotu', 'cuipo', 'guayacan', 'nance']);
  const prop = proponerReubicacion(NEGOCIO_ALOJAMIENTO, aloj.reservas, ch.b, ch.unidadId, { riesgo });
  assert.ok(prop.length > 0);
  assert.equal(prop[0].riesgo, false, `la primera propuesta (${prop[0].nombre}) no está en riesgo`);
  assert.ok(!riesgo.has(prop[0].id));
  for (let i = 1; i < prop.length; i++) assert.ok(!(prop[i - 1].riesgo && !prop[i].riesgo), 'las de riesgo van al final');
});

// ── La portada dice que su ejemplo es la salida real del planificador: que lo sea ──

import { readFileSync } from 'node:fs';
import { fechaCorta, horaTexto } from '../js/nucleo/tiempo.mjs';
import { CANALES } from '../js/nucleo/recordatorios.mjs';

test('el ejemplo de la portada es la salida real del planificador', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const desde = html.indexOf('<ol class="ejemplo-plan__linea">');
  const lista = html.slice(desde, html.indexOf('</ol>', desde));
  const filas = [...lista.matchAll(/<li[^>]*><time>([^<]+)<\/time><span>([^<]+)<\/span><\/li>/g)].map((m) => `${m[1]} · ${m[2]}`);
  const reglaPortada = { ...REGLA_POR_DEFECTO, dias: [2, 1], hora: 540, insistir: true, cadaHoras: 4, maxIntentos: 4, respaldo: 'sms', respaldoDesde: 4 };
  const plan = planificar({ estado: 'pendiente', inicio: t('2026-10-08', '10:00'), fin: t('2026-10-08', '10:30') }, reglaPortada, t('2026-10-05', '10:00'), { siguienteAbierto: (ms) => siguienteMomentoAbierto(neg, ms) });
  const dia = (ms) => fechaCorta(ms).split(' ').slice(0, 2).join(' ');
  const esperado = plan.map((p) => `${dia(p.momento)}, ${horaTexto(p.momento)} · ${p.tipo === 'llamar' ? 'Llamar al paciente' : `${CANALES[p.canal]} · ${p.etiqueta}`}`);
  assert.deepEqual(filas, esperado);
});

test('ningún texto escribe «a. m..»: la hora ya termina en punto', () => {
  const { st, p1 } = base();
  const { cita } = crearCita(st, neg, { pacienteId: p1.id, servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('2026-10-08', '10:00'), regla }, LUNES);
  reprogramarCita(st, neg, cita.id, { inicio: t('2026-10-09', '10:00') }, LUNES);
  responder(st, neg, { id: 'pp1', citaId: cita.id, tipo: 'cambio', hueco: t('2026-10-09', '11:00') }, LUNES);
  avanzarReloj(st, neg, t('2026-10-08', '12:00'), OPC);
  const textos = [...st.bitacora.map((b) => b.texto), ...st.tareas.map((x) => x.motivo), ...st.envios.map((e) => e.texto || '')].join('\n');
  assert.ok(!/m\.\./.test(textos), textos.split('\n').find((x) => /m\.\./.test(x)));
});
