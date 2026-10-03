import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportarCalendario, exportarCita, importarCalendario, plegar, desplegar, escapar, desescapar, leerLinea, sello } from '../js/nucleo/ical.mjs';
import { msDeFecha } from '../js/nucleo/tiempo.mjs';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const octetos = (s) => new TextEncoder().encode(s).length;

test('plegar a 75 octetos sin partir un carácter de varios bytes', () => {
  const linea = 'SUMMARY:' + 'Cabaña Guayacán, ñandú y árboles '.repeat(6);
  const plegada = plegar(linea);
  const partes = plegada.split('\r\n');
  assert.ok(partes.length > 2);
  for (const p of partes) assert.ok(octetos(p) <= 75, `línea de ${octetos(p)} octetos`);
  for (const p of partes.slice(1)) assert.equal(p[0], ' ');
  assert.equal(desplegar(plegada), linea);
  assert.ok(!plegada.includes('�'));
  assert.equal(plegar('SUMMARY:corto'), 'SUMMARY:corto');
});

test('escapar y desescapar texto (coma, punto y coma, barra, salto)', () => {
  const t = 'Grupo; 3 cabañas, una reserva\\ruta\nsegunda línea';
  assert.equal(escapar(t), 'Grupo\\; 3 cabañas\\, una reserva\\\\ruta\\nsegunda línea');
  assert.equal(desescapar(escapar(t)), t);
});

test('leer una línea con parámetros y dos puntos dentro de comillas', () => {
  assert.deepEqual(leerLinea('DTSTART;TZID="America/Panama":20261110T150000'), { nombre: 'DTSTART', params: { TZID: 'America/Panama' }, valor: '20261110T150000' });
  assert.equal(leerLinea('PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN').valor, '-//Airbnb Inc//Hosting Calendar 0.8.8//EN');
});

const ESTAMPA = Date.UTC(2026, 9, 3, 15, 0, 0);
const eventos = [
  { uid: 'r1-corotu@reservas.alphateklab', inicio: '2026-10-05', fin: '2026-10-08', resumen: 'Reservado' },
  { uid: 'r2-corotu@reservas.alphateklab', inicio: '2026-10-08', fin: '2026-10-09', resumen: 'No disponible' },
];

test('exportar: VCALENDAR con CRLF, fechas VALUE=DATE, DTEND exclusivo, UID y DTSTAMP', () => {
  const ics = exportarCalendario({ nombre: 'Corotú · Cabañas Quebrada Honda', eventos, dtstamp: ESTAMPA });
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'todas las líneas terminan en CRLF');
  for (const l of desplegar(ics).split('\r\n')) assert.ok(octetos(l) > 0 || l === '');
  for (const l of ics.split('\r\n')) assert.ok(octetos(l) <= 75);
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261008\r\n/);
  assert.match(ics, /UID:r1-corotu@reservas\.alphateklab\r\n/);
  assert.match(ics, /DTSTAMP:20261003T150000Z\r\n/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  // Estable: mismos datos, mismo archivo.
  assert.equal(ics, exportarCalendario({ nombre: 'Corotú · Cabañas Quebrada Honda', eventos, dtstamp: ESTAMPA }));
});

test('exportar y volver a importar da las mismas fechas', () => {
  const ics = exportarCalendario({ nombre: 'Prueba', eventos, dtstamp: ESTAMPA });
  const r = importarCalendario(ics);
  assert.deepEqual(r.eventos.map((e) => [e.uid, e.inicio, e.fin, e.resumen]), eventos.map((e) => [e.uid, e.inicio, e.fin, e.resumen]));
  assert.equal(r.nombre, 'Prueba');
});

test('importar el calendario de Airbnb (PRODID con parámetro, DTEND antes que DTSTART)', () => {
  const r = importarCalendario(fixture('airbnb.ics'));
  assert.deepEqual(r.eventos.map((e) => [e.inicio, e.fin, e.resumen]), [
    ['2026-10-15', '2026-10-18', 'Reserved'],
    ['2026-11-01', '2026-11-03', 'Airbnb (Not available)'],
  ]);
  assert.match(r.prodid, /Airbnb/);
  assert.ok(r.eventos.every((e) => e.uid.endsWith('@airbnb.com')));
});

test('importar el calendario de Booking.com', () => {
  const r = importarCalendario(fixture('booking.ics'));
  assert.deepEqual(r.eventos.map((e) => [e.inicio, e.fin]), [['2026-10-20', '2026-10-23'], ['2026-10-25', '2026-10-26']]);
  assert.ok(r.eventos.every((e) => e.resumen === 'CLOSED - Not available'));
});

test('importar las formas del RFC 5545: Z, TZID, plegado, escapado, CANCELLED, DURATION, alarma', () => {
  const r = importarCalendario(fixture('rfc5545.ics'));
  const por = Object.fromEntries(r.eventos.map((e) => [e.uid, e]));
  // 20:00Z del 5-nov = 15:00 en Panamá del 5; 16:00Z del 8 = 11:00 del 8 → noches 5, 6 y 7.
  assert.deepEqual([por['con-hora-utc@example.com'].inicio, por['con-hora-utc@example.com'].fin], ['2026-11-05', '2026-11-08']);
  assert.deepEqual([por['con-tzid@example.com'].inicio, por['con-tzid@example.com'].fin], ['2026-11-10', '2026-11-12']);
  const largo = por['plegado-muy-largo-para-obligar-a-partir-la-linea-en-dos-trozos@example.com'];
  assert.ok(largo, 'desplegó el UID partido en dos líneas');
  assert.equal(largo.resumen, 'Grupo; tres cabañas, una reserva\nsegunda línea', 'el SUMMARY de la alarma no pisa el del evento');
  assert.deepEqual([por['con-duracion@example.com'].inicio, por['con-duracion@example.com'].fin], ['2026-12-10', '2026-12-12']);
  assert.equal(por['cancelado@example.com'], undefined);
  assert.deepEqual(r.ignorados, [{ uid: 'cancelado@example.com', motivo: 'cancelado' }]);
  assert.equal(r.nombre, 'Prueba, con coma');
});

test('un texto que no es iCal da un error que se puede mostrar', () => {
  assert.throws(() => importarCalendario('<html>Iniciar sesión</html>'), /no es un calendario iCal/);
});

test('el .ics de una cita lleva la hora en UTC', () => {
  const inicio = msDeFecha('2026-10-06', 9 * 60 + 30);
  const ics = exportarCita({ uid: 'c1@reservas.alphateklab', inicio, fin: inicio + 30 * 60000, resumen: 'Cita en Dermatología Ríos', lugar: 'Vía de ejemplo 123', dtstamp: ESTAMPA });
  assert.match(ics, /DTSTART:20261006T143000Z\r\n/);
  assert.match(ics, /DTEND:20261006T150000Z\r\n/);
  assert.equal(sello(inicio), '20261006T143000Z');
  const r = importarCalendario(ics);
  assert.equal(r.eventos[0].inicio, '2026-10-06');
});
