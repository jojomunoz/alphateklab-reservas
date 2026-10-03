import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefono, enlaceWhatsApp, validarCedula, validarCorreo, buscarPersonas, primerNombre } from '../js/nucleo/contacto.mjs';
import { codificar, decodificar, aBase64url, deBase64url, ERROR_ENLACE } from '../js/nucleo/enlace.mjs';
import { rellenar, revisarPlantilla, segmentosSMS, costoDelMes, PLANTILLAS_POR_DEFECTO, balboas, dolares } from '../js/nucleo/mensajes.mjs';

test('teléfono: +507 y 8 dígitos que empiezan por 6, en cualquier formato que escriba la recepción', () => {
  for (const entrada of ['6000-0123', '+507 6000-0123', '507 60000123', '(507) 6000 0123', '00507 6000 0123', ' 60000123 ']) {
    const r = normalizarTelefono(entrada);
    assert.ok(r.ok, entrada);
    assert.equal(r.e164, '+50760000123');
    assert.equal(r.mostrar, '+507 6000-0123');
    assert.equal(r.wa, '50760000123');
  }
  assert.match(normalizarTelefono('223-4567').error, /7 dígitos/);
  assert.match(normalizarTelefono('7000-0123').error, /empiezan por 6/);
  assert.match(normalizarTelefono('6000-012').error, /8 dígitos/);
  assert.match(normalizarTelefono('6000-0l23').error, /solo lleva dígitos/);
  assert.equal(normalizarTelefono('').ok, false);
});

test('wa.me va sin «+», sin espacios y con el texto codificado', () => {
  assert.equal(enlaceWhatsApp('+50760000123', 'Hola, ¿vienes el martes 6?'), 'https://wa.me/50760000123?text=Hola%2C%20%C2%BFvienes%20el%20martes%206%3F');
  assert.ok(!enlaceWhatsApp('+507 6000-0123', 'x').includes('+'));
});

test('cédula panameña', () => {
  for (const ok of ['8-123-4567', 'PE-12-345', 'E-8-12345', '4PI-12-345', '8AV-12-345', '13-1-1', 'n-1-22']) assert.ok(validarCedula(ok).ok, ok);
  for (const mal of ['81234567', '14-1-1', 'X-1-1', '8-12345-1', '']) assert.equal(validarCedula(mal).ok, false, mal);
  assert.equal(validarCedula(' pe-12-345 ').valor, 'PE-12-345');
});

test('correo opcional', () => {
  assert.deepEqual(validarCorreo(''), { ok: true, valor: '' });
  assert.equal(validarCorreo('Ana@Example.com').valor, 'ana@example.com');
  assert.equal(validarCorreo('ana@example').ok, false);
});

test('buscar por nombre sin acentos, por teléfono y por cédula', () => {
  const p = [{ nombre: 'Iván De León', telefono: '+50760000123', cedula: '8-000-1101' }, { nombre: 'Rosa Camarena', telefono: '+50760000124', cedula: '8-000-1102' }];
  assert.deepEqual(buscarPersonas(p, 'ivan').map((x) => x.nombre), ['Iván De León']);
  assert.deepEqual(buscarPersonas(p, '0124').map((x) => x.nombre), ['Rosa Camarena']);
  assert.deepEqual(buscarPersonas(p, '8-000-1101').map((x) => x.nombre), ['Iván De León']);
  assert.equal(primerNombre('  Iván De León'), 'Iván');
});

const datosCita = { k: 'c', pl: 'consultorio', c: 'c_abc123', n: 'Iván', i: 29823510, pr: 'rios', sv: 'control', sl: 'c1', hs: [29820495, 29823315], s: 'abcdefghij' };

test('enlace de confirmación: base64url de ida y vuelta, con acentos', () => {
  const frag = codificar(datosCita);
  assert.match(frag, /^[A-Za-z0-9_-]+$/, 'sin +, / ni =');
  const r = decodificar('#' + frag);
  assert.ok(r.ok);
  assert.equal(r.datos.n, 'Iván');
  assert.deepEqual(r.datos.hs, datosCita.hs);
  assert.equal(deBase64url(aBase64url('ñandú €')), 'ñandú €');
});

test('enlace roto, vacío, de otra versión o con forma mala: error que dice qué hacer', () => {
  const frag = codificar(datosCita);
  assert.equal(decodificar(frag.slice(0, 20)).error, ERROR_ENLACE);
  assert.equal(decodificar('#%%%').error, ERROR_ENLACE);
  assert.match(decodificar('').error, /pide uno nuevo/);
  assert.match(decodificar(aBase64url(JSON.stringify({ ...datosCita, v: 2 }))).error, /versión anterior/);
  assert.equal(decodificar(codificar({ ...datosCita, i: 'mañana' })).ok, false);
  assert.equal(decodificar(codificar({ ...datosCita, hs: [1, 2, 3, 4] })).ok, false);
  assert.equal(decodificar(codificar({ ...datosCita, s: 'SALA MALA!' })).ok, false);
  assert.equal(decodificar(aBase64url('[1,2]')).ok, false);
  assert.match(ERROR_ENLACE, /Pide un enlace nuevo al consultorio/);
  const oferta = codificar({ k: 'o', pl: 'consultorio', o: 'o_1', e: 'w_1', n: 'Rosa', i: 29823510, pr: 'rios', sv: 'control', sl: 'c1' });
  assert.ok(decodificar(oferta).ok);
});

test('plantillas: variables, enlace obligatorio y sin variable de servicio', () => {
  const t = rellenar(PLANTILLAS_POR_DEFECTO.recordatorio, { nombre: 'Iván', negocio: 'Dermatología Ríos', fecha: 'martes 6 de octubre', hora: '9:30 a. m.', profesional: 'Dra. Ana Ríos', enlace: 'https://x/#y' });
  assert.equal(t, 'Hola, Iván. Te recordamos tu cita en Dermatología Ríos el martes 6 de octubre a las 9:30 a. m. con Dra. Ana Ríos. Confirma, cámbiala o avísanos si no podrás ir: https://x/#y');
  assert.deepEqual(revisarPlantilla(PLANTILLAS_POR_DEFECTO.recordatorio), []);
  assert.match(revisarPlantilla('Hola {nombre}, tu {servicio}: {enlace}')[0], /No existe \{servicio\}/);
  assert.match(revisarPlantilla('Hola {nombre}')[0], /Falta \{enlace\}/);
  assert.deepEqual(revisarPlantilla('   '), ['El mensaje está vacío.']);
  for (const p of Object.values(PLANTILLAS_POR_DEFECTO)) assert.ok(!/servicio|diagn|biopsia/i.test(p));
});

test('SMS: 160 caracteres en GSM-7; una sola «á» lo pasa a UCS-2 (70)', () => {
  assert.deepEqual(segmentosSMS('a'.repeat(160)), { codificacion: 'GSM-7', largo: 160, segmentos: 1 });
  assert.equal(segmentosSMS('a'.repeat(161)).segmentos, 2);
  assert.equal(segmentosSMS('Ñandú'.repeat(1)).codificacion, 'UCS-2'); // la «ú» no está en GSM-7
  assert.equal(segmentosSMS('Ñandu').codificacion, 'GSM-7'); // la «Ñ» sí
  assert.equal(segmentosSMS('á'.repeat(70)).segmentos, 1);
  assert.equal(segmentosSMS('á'.repeat(71)).segmentos, 2);
  assert.equal(segmentosSMS('€'.repeat(80)).largo, 160, 'el euro ocupa dos posiciones');
});

test('costo del mes: solo lo enviado de ese mes, SMS por segmento', () => {
  const mesDe = (ms) => (ms < 100 ? '2026-10' : '2026-11');
  const envios = [
    { tipo: 'mensaje', estado: 'enviado', canal: 'whatsapp', momento: 1, texto: 'x' },
    { tipo: 'mensaje', estado: 'enviado', canal: 'whatsapp', momento: 2, texto: 'x' },
    { tipo: 'mensaje', estado: 'cancelado', canal: 'whatsapp', momento: 3, texto: 'x' },
    { tipo: 'mensaje', estado: 'enviado', canal: 'sms', momento: 4, texto: 'á'.repeat(71) },
    { tipo: 'mensaje', estado: 'enviado', canal: 'correo', momento: 5, texto: 'x' },
    { tipo: 'mensaje', estado: 'enviado', canal: 'whatsapp', momento: 200, texto: 'x' },
    { tipo: 'llamar', estado: 'tarea', momento: 6 },
  ];
  const c = costoDelMes(envios, '2026-10', mesDe);
  assert.deepEqual([c.por.whatsapp.mensajes, c.por.sms.mensajes, c.por.sms.unidades, c.por.correo.mensajes], [2, 1, 2, 1]);
  assert.equal(c.min.toFixed(3), (2 * 0.011 + 2 * 0.10).toFixed(3));
  assert.equal(c.max.toFixed(3), (2 * 0.013 + 2 * 0.18).toFixed(3));
});

test('montos al modo de Panamá', () => {
  assert.equal(balboas(123450), 'B/.1,234.50');
  assert.equal(balboas(5), 'B/.0.05');
  assert.equal(dolares(0.4219), 'US$0.42');
});
