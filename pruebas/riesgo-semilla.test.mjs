import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semillaCitas, semillaAlojamiento, horaInicialDemo, azar } from '../js/nucleo/semilla.mjs';
import { sinConfirmar, conInasistencias, porProfesional, costoMensajesDelMes, asistenciaDe, porcentaje } from '../js/nucleo/riesgo.mjs';
import { NEGOCIOS_CITAS, NEGOCIO_ALOJAMIENTO } from '../js/nucleo/negocios.mjs';
import { validarCita, siguienteMomentoAbierto } from '../js/nucleo/agenda.mjs';
import { detectarChoques } from '../js/nucleo/alojamiento.mjs';
import { msDeFecha, fechaISO, lunesDe, sumarDias, horaTexto, HORA } from '../js/nucleo/tiempo.mjs';
import { normalizarTelefono } from '../js/nucleo/contacto.mjs';

const AHORA = msDeFecha('2026-10-06', 10 * 60); // martes 6 de octubre, 10:00

test('hora inicial de la demo: la real en horario; si no, el siguiente día hábil a las 8:30', () => {
  assert.equal(horaInicialDemo(msDeFecha('2026-10-06', 10 * 60 + 7)), msDeFecha('2026-10-06', 10 * 60 + 15));
  assert.equal(horaInicialDemo(msDeFecha('2026-10-03', 57)), msDeFecha('2026-10-03', 8 * 60 + 30), 'sábado a la 1 a. m. → sábado 8:30');
  assert.equal(horaInicialDemo(msDeFecha('2026-10-03', 19 * 60)), msDeFecha('2026-10-05', 8 * 60 + 30), 'sábado de noche → lunes');
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
    assert.ok(enDosSemanas.length >= 30 && enDosSemanas.length <= 50, `${enDosSemanas.length} citas en la semana actual y la siguiente`);
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
