import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semillaCitas, semillaAlojamiento, horaInicialDemo, azar } from '../js/nucleo/semilla.mjs';
import { sinConfirmar, conInasistencias, porProfesional, costoMensajesDelMes, asistenciaDe, porcentaje } from '../js/nucleo/riesgo.mjs';
import { NEGOCIOS_CITAS, NEGOCIO_ALOJAMIENTO } from '../js/nucleo/negocios.mjs';
import { validarCita, siguienteMomentoAbierto, tramosDelDia } from '../js/nucleo/agenda.mjs';
import { detectarChoques } from '../js/nucleo/alojamiento.mjs';
import { msDeFecha, fechaISO, lunesDe, sumarDias, horaTexto, HORA } from '../js/nucleo/tiempo.mjs';
import { normalizarTelefono } from '../js/nucleo/contacto.mjs';

const AHORA = msDeFecha('2026-10-06', 10 * 60); // martes 6 de octubre, 10:00

test('hora inicial de la demo: la real en horario; si no, el siguiente día hábil a las 8:30', () => {
  assert.equal(horaInicialDemo(msDeFecha('2026-10-06', 7 * 60 + 10)), msDeFecha('2026-10-06', 8 * 60 + 30), 'martes temprano → ese día a las 8:30');
  assert.equal(horaInicialDemo(msDeFecha('2026-10-06', 10 * 60 + 7)), msDeFecha('2026-10-07', 8 * 60 + 30), 'martes a media mañana → miércoles 8:30');
  assert.equal(horaInicialDemo(msDeFecha('2026-10-03', 57)), msDeFecha('2026-10-05', 8 * 60 + 30), 'sábado a la 1 a. m. → lunes 8:30');
  assert.equal(horaInicialDemo(msDeFecha('2026-10-03', 16 * 60 + 45)), msDeFecha('2026-10-05', 8 * 60 + 30), 'sábado por la tarde → lunes (antes abría con todo cerrado)');
  assert.equal(horaInicialDemo(msDeFecha('2026-11-02', 18 * 60)), msDeFecha('2026-11-04', 8 * 60 + 30), 'salta el feriado del 3-nov');
});

test('azar con semilla: mismos datos cada vez', () => {
  const a = azar(42), b = azar(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

for (const [id, negocio] of Object.entries(NEGOCIOS_CITAS)) {
  test(`semilla de «${negocio.nombre}»: válida, sin solapes, con datos claramente ficticios`, () => {
    const st = semillaCitas(negocio, AHORA, { urlBase: 'https://ejemplo.test/confirmar.html', sala: 'abcdefghij' });
    const activas = st.citas.filter((c) => c.estado !== 'cancelada');
    for (const c of activas) {
      const otras = activas.filter((x) => x !== c);
      const e = validarCita(negocio, otras, c, 0, { permitirPasado: true });
      assert.deepEqual(e, [], `${c.id} ${fechaISO(c.inicio)} ${horaTexto(c.inicio)}`);
    }
    for (const p of st.pacientes) {
      assert.match(p.telefono, /^\+5076000\d{4}$/);
      assert.ok(normalizarTelefono(p.telefono).ok);
      assert.match(p.cedula, /^8-000-\d+$/, 'tomo 000: no existe');
      assert.ok(!p.correo || p.correo.endsWith('@example.com'));
      assert.ok(p.consentimiento && p.consentimiento.texto.includes('Ley 81 de 2019'));
    }
    const lunes = lunesDe(fechaISO(AHORA));
    const enDosSemanas = st.citas.filter((c) => fechaISO(c.inicio) >= lunes && fechaISO(c.inicio) <= sumarDias(lunes, 13));
    // Unas cuatro citas por profesional cada día que abre (una recepción con trabajo a la vista): entre 3 y 4,2 de
    // promedio, porque a veces no queda hueco para la cuarta.
    let diasAbiertos = 0;
    for (let i = 0; i <= 13; i++) if (tramosDelDia(negocio, sumarDias(lunes, i)).length) diasAbiertos++;
    const promedio = enDosSemanas.length / (diasAbiertos * negocio.profesionales.length);
    assert.ok(promedio >= 3 && promedio <= 4.2, `${enDosSemanas.length} citas en ${diasAbiertos} días con ${negocio.profesionales.length} profesionales (${promedio.toFixed(2)} por profesional y día)`);
    const estados = new Set(st.citas.map((c) => c.estado));
    for (const e of ['pendiente', 'confirmada', 'atendida', 'no_asistio']) assert.ok(estados.has(e), `hay citas «${e}»`);
    assert.ok(st.citas.filter((c) => c.inicio > AHORA).every((c) => !['atendida', 'no_asistio'].includes(c.estado)), 'nada futuro está atendido');
    assert.ok(st.envios.filter((e) => e.estado === 'enviado').every((e) => e.momento <= AHORA && e.texto && e.enlace));
    assert.ok(st.envios.filter((e) => e.estado === 'programado').every((e) => e.momento > AHORA));
    // Las tareas de llamar caen con el negocio abierto (salvo que no abra antes de la cita).
    for (const e of st.envios.filter((x) => x.tipo === 'llamar')) {
      const c = st.citas.find((x) => x.id === e.citaId);
      const abierto = siguienteMomentoAbierto(negocio, e.momento);
      assert.ok(abierto === e.momento || abierto >= c.inicio, `llamar el ${fechaISO(e.momento)} a las ${horaTexto(e.momento)}, con ${negocio.nombre} cerrado`);
    }
    // Ninguna tarea abierta es de una cita que ya empezó, y las citas que nacieron confirmadas tienen su aviso.
    assert.ok(st.tareas.filter((x) => !x.hecha).every((x) => st.citas.find((c) => c.id === x.citaId).inicio > AHORA));
    assert.ok(st.envios.some((e) => e.clase === 'aviso'), 'hay avisos de citas confirmadas');
  });
}

test('panel de riesgo con denominadores', () => {
  const st = semillaCitas(NEGOCIOS_CITAS.consultorio, AHORA, { urlBase: 'x' });
  const sc = sinConfirmar(st, AHORA);
  assert.ok(sc.every((c) => ['pendiente', 'reprogramada'].includes(c.estado)));
  assert.ok(sc.every((c) => [fechaISO(AHORA), sumarDias(fechaISO(AHORA), 1)].includes(fechaISO(c.inicio))));
  const filas = porProfesional(st, NEGOCIOS_CITAS.consultorio);
  assert.equal(filas.length, 2);
  for (const f of filas) {
    const suyas = st.citas.filter((c) => c.profesionalId === f.profesional.id);
    assert.equal(f.inasistencia.de, suyas.filter((c) => ['atendida', 'no_asistio'].includes(c.estado)).length);
    assert.equal(f.inasistencia.n, suyas.filter((c) => c.estado === 'no_asistio').length);
    assert.ok(f.confirmacion.n <= f.confirmacion.de);
  }
  for (const x of conInasistencias(st, AHORA)) {
    assert.ok(x.faltas >= 1);
    assert.equal(asistenciaDe(st, x.paciente.id).faltas, x.faltas);
    assert.ok(x.proxima.inicio > AHORA);
  }
  assert.equal(porcentaje({ n: 3, de: 4, tasa: 0.75 }), '3 de 4 (75 %)');
  assert.equal(porcentaje({ n: 0, de: 0, tasa: null }), 'sin datos aún');
  const costo = costoMensajesDelMes(st, AHORA);
  assert.equal(costo.mes, '2026-10');
  assert.ok(costo.max >= costo.min);
});

test('semilla de alojamiento: 4 canales, un grupo de 3 cabañas y ningún choque de entrada', () => {
  const a = semillaAlojamiento(AHORA);
  const canales = new Set(a.reservas.map((r) => r.canal));
  for (const c of ['directo', 'airbnb', 'booking', 'expedia']) assert.ok(canales.has(c), c);
  assert.ok(a.reservas.some((r) => r.unidades.length === 3));
  assert.deepEqual(detectarChoques(a.reservas), []);
  assert.deepEqual(NEGOCIO_ALOJAMIENTO.cabanas.map((c) => c.nombre), ['Corotú', 'Nance', 'Guayacán', 'Espavé', 'Cuipo', 'Caoba']);
  assert.ok(a.canales.every((c) => AHORA - c.ultimaSync < 6 * HORA), 'todos al día al empezar');
  assert.ok(a.reservas.filter((r) => r.huesped).every((r) => /ejemplo/.test(r.huesped.nombre)));
});

test('la recepción abre con trabajo a la vista: sin confirmar, por llamar y alguien en la sala, cualquier día hábil', () => {
  const negocio = NEGOCIOS_CITAS.consultorio;
  for (let d = 0; d < 10; d++) {
    const ahora = horaInicialDemo(msDeFecha(sumarDias('2026-10-03', d), 12 * 60));
    const st = semillaCitas(negocio, ahora, { urlBase: 'https://ejemplo.test/confirmar.html', sala: 'abcdefghij' });
    const hoy = fechaISO(ahora);
    const enSala = st.citas.filter((c) => c.enSala && fechaISO(c.inicio) === hoy && !['atendida', 'no_asistio', 'cancelada'].includes(c.estado));
    assert.ok(sinConfirmar(st, ahora).length >= 2, `${hoy}: sin confirmar`);
    assert.ok(st.tareas.filter((t) => !t.hecha).length >= 1, `${hoy}: por llamar`);
    assert.equal(enSala.length, 1, `${hoy}: en sala`);
    // quien está en la sala tiene su cita confirmada y ningún mensaje por salir
    assert.equal(enSala[0].estado, 'confirmada');
    assert.ok(!st.envios.some((e) => e.citaId === enSala[0].id && e.estado === 'programado' && e.clase !== 'aviso'));
  }
});
