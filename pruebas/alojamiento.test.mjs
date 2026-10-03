import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nochesEntre, estanciasSolapan, validarReserva, cotizar, minimoNoches, detectarChoques, proponerReubicacion, moverUnidad,
  vigilar, actualizarSincronizaciones, disponiblesParaVenta, eventosParaExportar, sincronizarCanal, rangoTexto,
} from '../js/nucleo/alojamiento.mjs';
import { exportarCalendario, importarCalendario } from '../js/nucleo/ical.mjs';
import { NEGOCIO_ALOJAMIENTO as neg } from '../js/nucleo/negocios.mjs';
import { HORA } from '../js/nucleo/tiempo.mjs';
import { balboas } from '../js/nucleo/mensajes.mjs';

const R = (id, canal, unidades, llegada, salida, extra = {}) => ({ id, canal, unidades, llegada, salida, estado: 'confirmada', creada: 0, ...extra });

test('la noche de salida no cuenta: salir el 8 permite llegar el 8', () => {
  assert.deepEqual(nochesEntre('2026-10-05', '2026-10-08'), ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.equal(estanciasSolapan({ llegada: '2026-10-05', salida: '2026-10-08' }, { llegada: '2026-10-08', salida: '2026-10-10' }), false);
  assert.equal(estanciasSolapan({ llegada: '2026-10-05', salida: '2026-10-08' }, { llegada: '2026-10-07', salida: '2026-10-10' }), true);
  const reservas = [R('a', 'directo', ['corotu'], '2026-10-05', '2026-10-08')];
  assert.deepEqual(validarReserva(neg, reservas, { unidades: ['corotu'], llegada: '2026-10-08', salida: '2026-10-10' }), []);
});

test('solape por cabaña; un grupo se valida cabaña por cabaña', () => {
  const reservas = [R('a', 'booking', ['espave'], '2026-10-11', '2026-10-13')];
  const e = validarReserva(neg, reservas, { unidades: ['guayacan', 'espave', 'cuipo'], llegada: '2026-10-10', salida: '2026-10-13', personas: 12 });
  assert.equal(e.length, 1);
  assert.equal(e[0].codigo, 'choque');
  assert.equal(e[0].unidadId, 'espave');
  assert.match(e[0].mensaje, /Espavé ya está ocupada las noches del 11 al 13 de octubre \(Booking\)/);
  assert.deepEqual(validarReserva(neg, reservas, { unidades: ['guayacan', 'cuipo'], llegada: '2026-10-10', salida: '2026-10-13', personas: 10 }), []);
});

test('capacidad, fechas al revés y mínimo de noches', () => {
  assert.equal(validarReserva(neg, [], { unidades: ['corotu'], llegada: '2026-10-10', salida: '2026-10-13', personas: 3 })[0].codigo, 'capacidad');
  assert.equal(validarReserva(neg, [], { unidades: ['corotu'], llegada: '2026-10-10', salida: '2026-10-10' })[0].codigo, 'fechas');
  assert.equal(minimoNoches(neg, '2026-10-10'), 2);
  assert.equal(minimoNoches(neg, '2026-12-20'), 3);
  const e = validarReserva(neg, [], { unidades: ['corotu'], llegada: '2026-12-20', salida: '2026-12-22' });
  assert.equal(e[0].codigo, 'minimo');
  assert.match(e[0].mensaje, /mínimo es de 3 noches/);
  assert.deepEqual(validarReserva(neg, [], { unidades: ['corotu'], llegada: '2026-12-20', salida: '2026-12-22' }, { ignorarMinimo: true }), []);
  assert.deepEqual(validarReserva(neg, [], { unidades: ['corotu'], llegada: '2026-12-20', salida: '2026-12-21', canal: 'bloqueo' }), [], 'un bloqueo no tiene mínimo');
});

test('precio por noches con temporada (la noche del 30-nov es baja, la del 1-dic alta) e ITBMS de hospedaje 10 %', () => {
  const c = cotizar(neg, ['guayacan'], '2026-11-29', '2026-12-02');
  // 29 y 30 de noviembre en baja (B/.120), 1 de diciembre en alta (B/.150).
  assert.equal(c.noches, 3);
  assert.deepEqual(c.lineas[0].porTemporada, { baja: { noches: 2, tarifa: 12000, subtotal: 24000 }, alta: { noches: 1, tarifa: 15000, subtotal: 15000 } });
  assert.equal(c.subtotal, 39000);
  assert.equal(c.impuesto, 3900);
  assert.equal(c.total, 42900);
  assert.equal(balboas(c.total), 'B/.429.00');
  assert.equal(c.sena, 12870);
  assert.equal(c.minimo, 2);
  const grupo = cotizar(neg, ['guayacan', 'espave', 'cuipo'], '2026-10-10', '2026-10-13');
  assert.equal(grupo.subtotal, (120 + 115 + 165) * 3 * 100);
});

test('choques entre canales y propuesta de reubicación (igual o mayor capacidad, libre esas noches)', () => {
  const reservas = [
    R('dir', 'directo', ['espave'], '2026-10-18', '2026-10-20', { creada: 1 }),
    R('bk', 'booking', ['espave'], '2026-10-18', '2026-10-20', { creada: 2 }),
    R('ab', 'airbnb', ['guayacan'], '2026-10-16', '2026-10-20', { creada: 0 }),
    R('cu', 'directo', ['cuipo'], '2026-10-20', '2026-10-24', { creada: 0 }),
  ];
  const ch = detectarChoques(reservas);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].unidadId, 'espave');
  assert.equal(ch[0].a.id, 'dir', 'a es la que entró primero');
  assert.equal(ch[0].b.id, 'bk');
  assert.equal(ch[0].canalesDistintos, true);
  const prop = proponerReubicacion(neg, reservas, ch[0].b, 'espave');
  // Guayacán (4) está ocupada; Cuipo y Caoba (6) libres el 18 y 19 (Cuipo entra el 20). Corotú y Nance son de 2.
  assert.deepEqual(prop.map((c) => c.id), ['caoba', 'cuipo']);
  const movidas = moverUnidad(reservas, 'bk', 'espave', 'caoba');
  assert.equal(detectarChoques(movidas).length, 0);
});

test('sin cabaña libre de igual o mayor capacidad: lista vacía (contactar al huésped)', () => {
  const reservas = ['guayacan', 'espave', 'cuipo', 'caoba'].map((u, i) => R(`x${i}`, 'directo', [u], '2026-10-10', '2026-10-13'));
  reservas.push(R('bk', 'booking', ['guayacan'], '2026-10-11', '2026-10-12', { creada: 9 }));
  assert.deepEqual(proponerReubicacion(neg, reservas, reservas.at(-1), 'guayacan'), []);
});

test('vigilante: 9 h sin sincronizar con máximo de 6 h es alerta; un canal caído no avanza', () => {
  const ahora = 100 * HORA;
  const canales = [
    { id: 'booking', nombre: 'Booking.com', ultimaSync: ahora - 9 * HORA, maxHoras: 6, intervaloHoras: 2, caido: true, urls: { corotu: 'u' } },
    { id: 'airbnb', nombre: 'Airbnb', ultimaSync: ahora - 1 * HORA, intervaloHoras: 3, caido: false, urls: {} },
  ];
  const v = vigilar(canales, ahora);
  assert.equal(v[0].vencido, true);
  assert.equal(Math.round(v[0].horas), 9);
  assert.deepEqual(v[0].unidades, ['corotu']);
  assert.equal(v[1].vencido, false);
  assert.equal(v[1].max, 6, 'el máximo por defecto es 6 h');
  const despues = actualizarSincronizaciones(canales, ahora + 7 * HORA);
  assert.equal(despues[0].ultimaSync, canales[0].ultimaSync, 'el caído se queda donde estaba');
  assert.equal(despues[1].ultimaSync, ahora - HORA + 6 * HORA, 'el que funciona avanza de 3 en 3 h');
});

test('cierre preventivo: las cabañas afectadas no se venden en la página directa', () => {
  const r = disponiblesParaVenta(neg, [R('a', 'directo', ['nance'], '2026-10-10', '2026-10-12')], { activo: true, unidades: ['corotu', 'guayacan'] }, '2026-10-10', '2026-10-12');
  assert.deepEqual(r.enCierre.map((c) => c.id), ['corotu', 'guayacan']);
  assert.deepEqual(r.ocupadas.map((c) => c.id), ['nance']);
  assert.deepEqual(r.disponibles.map((c) => c.id), ['espave', 'cuipo', 'caoba']);
  const sinCierre = disponiblesParaVenta(neg, [], { activo: false, unidades: ['corotu'] }, '2026-10-10', '2026-10-12');
  assert.equal(sinCierre.disponibles.length, 6);
});

test('exportar solo reservas directas y bloqueos manuales: sin eco de los otros canales', () => {
  const reservas = [
    R('d1', 'directo', ['corotu'], '2026-10-05', '2026-10-08', { huesped: { nombre: 'Pareja de ejemplo', telefono: '+50760000401' } }),
    R('b1', 'bloqueo', ['corotu'], '2026-10-20', '2026-10-22'),
    R('a1', 'airbnb', ['corotu'], '2026-10-10', '2026-10-12', { uidExterno: 'x@airbnb.com' }),
    R('k1', 'booking', ['corotu'], '2026-10-14', '2026-10-16', { uidExterno: 'y@booking.com' }),
    R('e1', 'expedia', ['corotu'], '2026-10-17', '2026-10-19', { uidExterno: 'z@expedia.com' }),
    R('d2', 'directo', ['corotu'], '2026-10-24', '2026-10-26', { estado: 'cancelada' }),
    R('g1', 'directo', ['nance', 'corotu'], '2026-11-01', '2026-11-03'),
  ];
  const ev = eventosParaExportar(reservas, 'corotu');
  assert.deepEqual(ev.map((e) => [e.inicio, e.fin, e.resumen]), [
    ['2026-10-05', '2026-10-08', 'Reservado'],
    ['2026-10-20', '2026-10-22', 'No disponible'],
    ['2026-11-01', '2026-11-03', 'Reservado'],
  ]);
  const ics = exportarCalendario({ nombre: 'Corotú', eventos: ev, dtstamp: 0 });
  assert.ok(!ics.includes('Pareja'), 'el .ics no lleva datos del huésped');
  assert.ok(!ics.includes('+507'), 'ni su teléfono');
});

test('sincronizar un canal: agrega lo nuevo, mueve lo cambiado, quita lo cancelado e ignora el eco', () => {
  let n = 0;
  const id = () => `n${++n}`;
  const reservas = [
    R('v1', 'booking', ['corotu'], '2026-10-10', '2026-10-12', { uidExterno: 'viejo@booking.com' }),
    R('v2', 'booking', ['corotu'], '2026-10-14', '2026-10-16', { uidExterno: 'cambia@booking.com' }),
    R('d1', 'directo', ['corotu'], '2026-10-01', '2026-10-03'),
  ];
  const eventos = [
    { uid: 'cambia@booking.com', inicio: '2026-10-15', fin: '2026-10-17', resumen: 'CLOSED - Not available' },
    { uid: 'nuevo@booking.com', inicio: '2026-10-20', fin: '2026-10-23', resumen: 'CLOSED - Not available' },
    { uid: 'd1-corotu@reservas.alphateklab', inicio: '2026-10-01', fin: '2026-10-03', resumen: 'Reservado' },
  ];
  const r = sincronizarCanal(reservas, 'booking', 'corotu', eventos, 5, id);
  assert.deepEqual(r.nuevas.map((x) => [x.llegada, x.salida, x.canal]), [['2026-10-20', '2026-10-23', 'booking']]);
  assert.deepEqual(r.cambiadas.map((x) => [x.id, x.llegada]), [['v2', '2026-10-15']]);
  assert.deepEqual(r.quitadas.map((x) => x.id), ['v1']);
  assert.equal(r.ecos, 1);
  assert.equal(r.reservas.filter((x) => x.canal === 'directo').length, 1, 'el eco no crea una reserva de Booking encima de la directa');
  assert.equal(detectarChoques(r.reservas).length, 0);
});

test('el ciclo completo: exportar un .ics, importarlo y obtener las mismas noches', () => {
  const reservas = [R('d1', 'directo', ['caoba'], '2026-12-28', '2027-01-02'), R('b1', 'bloqueo', ['caoba'], '2027-01-05', '2027-01-06')];
  const ics = exportarCalendario({ nombre: 'Caoba', eventos: eventosParaExportar(reservas, 'caoba'), dtstamp: Date.UTC(2026, 9, 3) });
  const leidos = importarCalendario(ics).eventos;
  assert.deepEqual(leidos.map((e) => [e.inicio, e.fin]), [['2026-12-28', '2027-01-02'], ['2027-01-05', '2027-01-06']]);
  assert.equal(rangoTexto('2026-12-28', '2027-01-02'), '28 de diciembre al 2 de enero');
});
