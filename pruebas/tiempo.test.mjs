import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partes, aMs, fechaISO, msDeFecha, sumarDias, diferenciaDias, diaSemana, lunesDe, horaTexto, horaDeMinutos,
  fechaLarga, redondearArriba, haceTexto, minutosDeTexto, esISO, MIN, HORA,
} from '../js/nucleo/tiempo.mjs';
import { feriadosDe, feriado, pascua } from '../js/nucleo/feriados.mjs';

test('Panamá es UTC-5: las 23:59 del 5 de octubre son las 04:59 UTC del 6', () => {
  assert.equal(fechaISO(Date.UTC(2026, 9, 6, 4, 59)), '2026-10-05');
  assert.equal(fechaISO(Date.UTC(2026, 9, 6, 5, 0)), '2026-10-06');
  assert.deepEqual(partes(Date.UTC(2026, 9, 6, 14, 30)), { anio: 2026, mes: 10, dia: 6, hora: 9, minuto: 30, diaSemana: 2 });
});

test('aMs y msDeFecha son inversas de partes, sin depender de la zona del navegador', () => {
  const ms = aMs({ anio: 2026, mes: 12, dia: 31, hora: 23, minuto: 15 });
  assert.equal(ms, Date.UTC(2027, 0, 1, 4, 15));
  assert.equal(msDeFecha('2026-12-31', 23 * 60 + 15), ms);
  const p = partes(ms);
  assert.equal(`${p.anio}-${p.mes}-${p.dia} ${p.hora}:${p.minuto}`, '2026-12-31 23:15');
});

test('sin horario de verano: marzo y noviembre no corren la hora', () => {
  // En EE. UU. el horario cambia el 8-mar y el 1-nov de 2026; en Panamá no.
  assert.equal(msDeFecha('2026-03-09', 540) - msDeFecha('2026-03-07', 540), 48 * HORA);
  assert.equal(msDeFecha('2026-11-02', 540) - msDeFecha('2026-10-31', 540), 48 * HORA);
});

test('aritmética de fechas de calendario', () => {
  assert.equal(sumarDias('2026-12-30', 3), '2027-01-02');
  assert.equal(sumarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(diferenciaDias('2026-10-05', '2026-10-08'), 3);
  assert.equal(diaSemana('2026-10-03'), 6);
  assert.equal(lunesDe('2026-10-03'), '2026-09-28');
  assert.equal(lunesDe('2026-10-04'), '2026-09-28'); // domingo → lunes anterior
  assert.equal(lunesDe('2026-10-05'), '2026-10-05');
  assert.ok(esISO('2026-02-28'));
  assert.ok(!esISO('2026-02-30'));
  assert.ok(!esISO('2026-2-3'));
});

test('textos de hora y fecha en español de Panamá', () => {
  assert.equal(horaTexto(msDeFecha('2026-10-06', 9 * 60 + 30)), '9:30 a. m.');
  assert.equal(horaDeMinutos(12 * 60), '12:00 p. m.');
  assert.equal(horaDeMinutos(0), '12:00 a. m.');
  assert.equal(horaDeMinutos(17 * 60 + 5), '5:05 p. m.');
  assert.equal(fechaLarga('2026-10-06'), 'martes 6 de octubre');
  assert.equal(haceTexto(0, 9 * HORA), 'hace 9 h');
  assert.equal(haceTexto(0, 40 * MIN), 'hace 40 min');
  assert.equal(minutosDeTexto('09:30'), 570);
  assert.equal(minutosDeTexto('25:00'), null);
});

test('redondear al cuarto de hora siguiente', () => {
  assert.equal(redondearArriba(msDeFecha('2026-10-06', 607)), msDeFecha('2026-10-06', 615));
  assert.equal(redondearArriba(msDeFecha('2026-10-06', 615)), msDeFecha('2026-10-06', 615));
});

test('Pascua (algoritmo gregoriano) en años conocidos', () => {
  assert.equal(pascua(2024), '2024-03-31');
  assert.equal(pascua(2025), '2025-04-20');
  assert.equal(pascua(2026), '2026-04-05');
  assert.equal(pascua(2027), '2027-03-28');
});

test('la regla de feriados da exactamente la lista oficial de 2026', () => {
  // La Estrella y La Prensa: 12 días; el 20-dic cae domingo y se descansa el lunes 21.
  const oficial = ['2026-01-01', '2026-01-09', '2026-02-17', '2026-04-03', '2026-05-01', '2026-11-03', '2026-11-05',
    '2026-11-10', '2026-11-28', '2026-12-08', '2026-12-20', '2026-12-21', '2026-12-25'];
  assert.deepEqual([...feriadosDe(2026).keys()], oficial);
  assert.match(feriado('2026-12-21'), /lunes/);
  assert.equal(feriado('2026-10-06'), null);
  assert.equal(feriado('2026-02-16'), null); // el lunes de carnaval no es feriado nacional
});

test('2027: el 28 de noviembre cae domingo y pasa al lunes 29', () => {
  assert.ok(feriado('2027-11-29'));
  assert.equal(feriado('2027-02-09'), 'Martes de Carnaval');
  assert.equal(feriado('2027-03-26'), 'Viernes Santo');
});
