import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huecosDelDia, horasUnicas, validarCita, libresDelRecurso, proximoDiaConHueco, motivoCierre } from '../js/nucleo/agenda.mjs';
import { solapan, restar, unir } from '../js/nucleo/intervalos.mjs';
import { NEGOCIOS_CITAS } from '../js/nucleo/negocios.mjs';
import { msDeFecha, horaCorta, MIN } from '../js/nucleo/tiempo.mjs';

const neg = NEGOCIOS_CITAS.consultorio;
const MARTES = '2026-10-06';
const t = (hhmm, fecha = MARTES) => { const [h, m] = hhmm.split(':').map(Number); return msDeFecha(fecha, h * 60 + m); };
const cita = (id, prof, sala, servicio, inicio, min, estado = 'confirmada') =>
  ({ id, profesionalId: prof, salaId: sala, servicioId: servicio, inicio, fin: inicio + min * MIN, estado });
const horas = (lista) => lista.map((h) => horaCorta(h.inicio));

test('intervalos semiabiertos: el fin no cuenta', () => {
  assert.equal(solapan({ inicio: 0, fin: 30 }, { inicio: 30, fin: 60 }), false);
  assert.equal(solapan({ inicio: 0, fin: 31 }, { inicio: 30, fin: 60 }), true);
  assert.deepEqual(restar({ inicio: 0, fin: 100 }, [{ inicio: 10, fin: 20 }, { inicio: 15, fin: 30 }]), [{ inicio: 0, fin: 10 }, { inicio: 30, fin: 100 }]);
  assert.deepEqual(unir([{ inicio: 5, fin: 10 }, { inicio: 0, fin: 5 }]), [{ inicio: 0, fin: 10 }]);
});

test('una cita que termina justo cuando empieza otra no la pisa', () => {
  const citas = [cita('a', 'rios', 'c1', 'crio', t('9:00'), 30)];
  const h = horas(huecosDelDia({ negocio: neg, citas, fecha: MARTES, servicioId: 'crio', profesionalId: 'rios', salaId: 'c1' }));
  assert.ok(h.includes('9:30'), 'a las 9:30 está libre');
  assert.ok(!h.includes('9:00') && !h.includes('9:15'), '9:00 y 9:15 se pisan con la cita de 9:00 a 9:30');
  assert.ok(h.includes('8:30'), '8:30 termina justo a las 9:00');
});

test('almuerzo: nada cruza de 12:00 a 13:00', () => {
  const h = horas(huecosDelDia({ negocio: neg, citas: [], fecha: MARTES, servicioId: 'crio', profesionalId: 'rios', salaId: 'c1' }));
  assert.ok(h.includes('11:30'));
  assert.ok(!h.includes('11:45'), '11:45 + 30 min cruza el almuerzo');
  assert.ok(!h.includes('12:00') && !h.includes('12:30'));
  assert.ok(h.includes('1:00'));
  const e = validarCita(neg, [], { servicioId: 'crio', profesionalId: 'rios', salaId: 'c1', inicio: t('11:45') }, 0);
  assert.deepEqual(e.map((x) => x.codigo), ['fuera_horario']);
  assert.match(e[0].mensaje, /almuerzo/);
});

test('último hueco del día', () => {
  const h = horas(huecosDelDia({ negocio: neg, citas: [], fecha: MARTES, servicioId: 'crio', profesionalId: 'rios', salaId: 'c1' }));
  assert.equal(h.at(-1), '4:30');
  const limpieza = horas(huecosDelDia({ negocio: neg, citas: [], fecha: MARTES, servicioId: 'limpieza', profesionalId: 'herrera' }));
  assert.equal(limpieza.at(-1), '4:00', 'la limpieza dura 60 min');
  const e = validarCita(neg, [], { servicioId: 'crio', profesionalId: 'rios', salaId: 'c1', inicio: t('16:45') }, 0);
  assert.match(e[0].mensaje, /después del cierre/);
});

test('feriado: el 3 de noviembre no hay huecos y la validación lo dice', () => {
  assert.equal(huecosDelDia({ negocio: neg, citas: [], fecha: '2026-11-03', servicioId: 'control' }).length, 0);
  const e = validarCita(neg, [], { servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('9:00', '2026-11-03') }, 0);
  assert.equal(e[0].codigo, 'feriado');
  assert.match(e[0].mensaje, /Separación de Panamá de Colombia/);
  assert.match(motivoCierre(neg, '2026-11-03'), /^Feriado/);
});

test('sábado medio día y domingo cerrado', () => {
  const sab = huecosDelDia({ negocio: neg, citas: [], fecha: '2026-10-10', servicioId: 'crio', profesionalId: 'rios', salaId: 'c1' });
  assert.equal(horaCorta(sab[0].inicio), '8:00');
  assert.equal(horaCorta(sab.at(-1).inicio), '11:30');
  assert.equal(huecosDelDia({ negocio: neg, citas: [], fecha: '2026-10-11', servicioId: 'crio' }).length, 0);
});

test('sin solapes por profesional NI por consultorio', () => {
  // La Dra. Ríos usa el consultorio 2 de 9:00 a 10:00 para una limpieza facial.
  const citas = [cita('a', 'rios', 'c2', 'limpieza', t('9:00'), 60)];
  // El Dr. Herrera no puede hacer una limpieza a las 9:00: la limpieza solo va en el consultorio 2, que está ocupado.
  const limp = huecosDelDia({ negocio: neg, citas, fecha: MARTES, servicioId: 'limpieza', profesionalId: 'herrera' });
  assert.ok(!horas(limp).includes('9:00'));
  // Pero un control a las 9:00 sí: se le asigna el consultorio 1.
  const ctrl = huecosDelDia({ negocio: neg, citas, fecha: MARTES, servicioId: 'control', profesionalId: 'herrera' }).filter((h) => horaCorta(h.inicio) === '9:00');
  assert.deepEqual(ctrl.map((h) => h.salaId), ['c1']);
  const e = validarCita(neg, citas, { servicioId: 'control', profesionalId: 'herrera', salaId: 'c2', inicio: t('9:30') }, 0);
  assert.deepEqual(e.map((x) => x.codigo), ['solape_sala']);
  const e2 = validarCita(neg, citas, { servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('9:30') }, 0);
  assert.deepEqual(e2.map((x) => x.codigo), ['solape_profesional']);
});

test('una cita cancelada libera su hueco', () => {
  const citas = [cita('a', 'rios', 'c1', 'crio', t('9:00'), 30, 'cancelada')];
  assert.deepEqual(validarCita(neg, citas, { servicioId: 'crio', profesionalId: 'rios', salaId: 'c1', inicio: t('9:00') }, 0), []);
});

test('buffer configurable entre citas', () => {
  const conBuffer = { ...neg, ajustes: { ...neg.ajustes, buffer: 15 } };
  const citas = [cita('a', 'rios', 'c1', 'crio', t('9:00'), 30)];
  const h = horas(huecosDelDia({ negocio: conBuffer, citas, fecha: MARTES, servicioId: 'crio', profesionalId: 'rios', salaId: 'c1' }));
  assert.ok(!h.includes('9:30'), 'con 15 min de buffer, 9:30 queda pegada');
  assert.ok(h.includes('9:45'));
  assert.ok(!h.includes('8:30') && h.includes('8:15'));
});

test('solo la limpieza facial se restringe al consultorio 2', () => {
  const e = validarCita(neg, [], { servicioId: 'limpieza', profesionalId: 'rios', salaId: 'c1', inicio: t('9:00') }, 0);
  assert.equal(e[0].codigo, 'sala_no_permitida');
  assert.match(e[0].mensaje, /Consultorio 2/);
});

test('no se ofrecen horas pasadas ni desalineadas', () => {
  const ahora = t('10:07');
  const h = huecosDelDia({ negocio: neg, citas: [], fecha: MARTES, servicioId: 'control', profesionalId: 'rios', ahora });
  assert.equal(horaCorta(h[0].inicio), '10:15');
  const e = validarCita(neg, [], { servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('9:00') }, ahora);
  assert.ok(e.some((x) => x.codigo === 'pasado'));
  const e2 = validarCita(neg, [], { servicioId: 'control', profesionalId: 'rios', salaId: 'c1', inicio: t('10:20') }, 0);
  assert.ok(e2.some((x) => x.codigo === 'paso'));
});

test('«el primero disponible»: una hora por inicio, con la sala habitual del profesional', () => {
  const unicas = horasUnicas(huecosDelDia({ negocio: neg, citas: [], fecha: MARTES, servicioId: 'control' }));
  assert.equal(unicas[0].profesionalId, 'rios');
  assert.equal(unicas[0].salaId, 'c1');
  assert.equal(new Set(unicas.map((h) => h.inicio)).size, unicas.length);
});

test('próximo día con hueco salta el feriado y el domingo', () => {
  assert.equal(proximoDiaConHueco({ negocio: neg, citas: [], fecha: '2026-11-02', servicioId: 'control' }), '2026-11-04');
  assert.equal(proximoDiaConHueco({ negocio: neg, citas: [], fecha: '2026-10-10', servicioId: 'control' }), '2026-10-12');
});

test('tiempo libre por recurso para pintar los huecos', () => {
  const citas = [cita('a', 'rios', 'c1', 'crio', t('9:00'), 30)];
  const l = libresDelRecurso({ negocio: neg, citas, fecha: MARTES, recurso: { tipo: 'profesional', id: 'rios' } });
  assert.deepEqual(l.map((x) => [horaCorta(x.inicio), horaCorta(x.fin)]), [['8:00', '9:00'], ['9:30', '12:00'], ['1:00', '5:00']]);
});
