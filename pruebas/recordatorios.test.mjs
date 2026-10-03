import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planificar, ajustarAVentana, aplicarRespuesta, vencer, proximoEnvio, canalDelIntento, REGLA_POR_DEFECTO } from '../js/nucleo/recordatorios.mjs';
import { msDeFecha, fechaCorta, horaCorta, fechaISO } from '../js/nucleo/tiempo.mjs';

const t = (fecha, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return msDeFecha(fecha, h * 60 + m); };
const cita = (inicio, estado = 'pendiente') => ({ id: 'c1', inicio, fin: inicio + 30 * 60000, estado });
const sinInsistir = { ...REGLA_POR_DEFECTO, insistir: false, respaldo: null };
const ver = (plan) => plan.map((p) => p.tipo === 'llamar' ? `llamar ${fechaCorta(p.momento)} ${horaCorta(p.momento)}` : `${p.intento}/${p.de} ${p.canal} ${fechaCorta(p.momento)} ${horaCorta(p.momento)} ${p.etiqueta}`);

// Cita: jueves 8 de octubre de 2026 a las 10:00. Se agenda el lunes 5 a las 8:00.
const JUEVES_10 = t('2026-10-08', '10:00');
const LUNES_8 = t('2026-10-05', '08:00');

test('2 días y 1 día antes a la hora elegida', () => {
  const plan = planificar(cita(JUEVES_10), { ...sinInsistir, dias: [2, 1], hora: 9 * 60 }, LUNES_8);
  assert.deepEqual(ver(plan), ['1/2 whatsapp mar 6 oct 9:00 2 días antes', '2/2 whatsapp mié 7 oct 9:00 1 día antes']);
});

test('solo «1 día antes»', () => {
  const plan = planificar(cita(JUEVES_10), { ...sinInsistir, dias: [1], hora: 10 * 60 + 30 }, LUNES_8);
  assert.deepEqual(ver(plan), ['1/1 whatsapp mié 7 oct 10:30 1 día antes']);
});

test('insistir: cada 4 h dentro de la ventana, máximo 4, y al final «Llamar»', () => {
  const regla = { ...REGLA_POR_DEFECTO, dias: [2, 1], hora: 540, insistir: true, cadaHoras: 4, maxIntentos: 4, respaldo: null };
  assert.deepEqual(ver(planificar(cita(JUEVES_10), regla, LUNES_8)), [
    '1/4 whatsapp mar 6 oct 9:00 2 días antes',
    '2/4 whatsapp mar 6 oct 1:00 reintento',
    '3/4 whatsapp mar 6 oct 5:00 reintento',
    '4/4 whatsapp mié 7 oct 9:00 1 día antes', // el de las 21:00 no sale de noche; se reserva el cupo para el de 1 día antes
    'llamar mié 7 oct 1:00',
  ]);
});

test('nada sale de madrugada ni de noche (ventana 8:00-20:00)', () => {
  assert.equal(horaCorta(ajustarAVentana(t('2026-10-06', '03:00'))), '8:00');
  assert.equal(fechaISO(ajustarAVentana(t('2026-10-06', '20:30'))), '2026-10-07');
  assert.equal(horaCorta(ajustarAVentana(t('2026-10-06', '20:30'))), '8:00');
  assert.equal(ajustarAVentana(t('2026-10-06', '12:00')), t('2026-10-06', '12:00'));
  const regla = { ...REGLA_POR_DEFECTO, insistir: true, cadaHoras: 3, maxIntentos: 6, respaldo: null };
  for (const p of planificar(cita(JUEVES_10), regla, LUNES_8).filter((x) => x.tipo === 'mensaje')) {
    const h = new Date(p.momento - 5 * 3600000).getUTCHours();
    assert.ok(h >= 8 && h < 20, `salió a las ${h}`);
  }
});

test('si la hora del recordatorio ya pasó al agendar, sale en el siguiente momento razonable', () => {
  // Se agenda el martes a las 15:00 para el jueves: «2 días antes» (martes 9:00) ya pasó → sale ya.
  const plan = planificar(cita(JUEVES_10), sinInsistir, t('2026-10-06', '15:00'));
  assert.deepEqual(ver(plan), ['1/2 whatsapp mar 6 oct 3:00 al agendar', '2/2 whatsapp mié 7 oct 9:00 1 día antes']);
  assert.equal(plan[0].atrasado, true);
  // Agendado a las 22:00 del martes: no sale de noche, sino a las 8:00; y el de 1 día antes no se duplica.
  const noche = planificar(cita(JUEVES_10), { ...sinInsistir, hora: 8 * 60 }, t('2026-10-06', '22:00'));
  assert.deepEqual(ver(noche), ['1/1 whatsapp mié 7 oct 8:00 1 día antes']);
});

test('cita creada el mismo día', () => {
  const cita16 = cita(t('2026-10-06', '16:00'));
  const plan = planificar(cita16, { ...REGLA_POR_DEFECTO, insistir: true, cadaHoras: 4, maxIntentos: 4, respaldo: null }, t('2026-10-06', '10:00'));
  // Sale ya; el reintento de las 14:00 cabe; el de las 18:00 no (la última hora antes de la cita no se escribe).
  assert.deepEqual(ver(plan), ['1/2 whatsapp mar 6 oct 10:00 al agendar', '2/2 whatsapp mar 6 oct 2:00 reintento', 'llamar mar 6 oct 3:00']);
});

test('sin un momento razonable antes de la cita, no hay recordatorio', () => {
  // Agendada a las 21:00 para las 8:30 del día siguiente: las 8:00 ya está dentro de la última hora.
  assert.deepEqual(planificar(cita(t('2026-10-07', '08:30')), REGLA_POR_DEFECTO, t('2026-10-06', '21:00')), []);
});

test('no se manda un reintento pegado al siguiente recordatorio', () => {
  const regla = { ...REGLA_POR_DEFECTO, insistir: true, cadaHoras: 6, maxIntentos: 6, respaldo: null };
  const plan = ver(planificar(cita(JUEVES_10), regla, LUNES_8));
  assert.deepEqual(plan.slice(0, 3), ['1/5 whatsapp mar 6 oct 9:00 2 días antes', '2/5 whatsapp mar 6 oct 3:00 reintento', '3/5 whatsapp mié 7 oct 9:00 1 día antes']);
});

test('escalera de canal: WhatsApp y luego SMS o correo, según lo que tenga el paciente', () => {
  const regla = { ...REGLA_POR_DEFECTO, insistir: true, cadaHoras: 4, maxIntentos: 4, respaldo: 'sms', respaldoDesde: 3 };
  const plan = planificar(cita(JUEVES_10), regla, LUNES_8);
  assert.deepEqual(plan.filter((p) => p.tipo === 'mensaje').map((p) => p.canal), ['whatsapp', 'whatsapp', 'sms', 'sms']);
  const sinCorreo = planificar(cita(JUEVES_10), { ...regla, respaldo: 'correo' }, LUNES_8, { canales: ['whatsapp', 'sms'] });
  assert.deepEqual(sinCorreo.filter((p) => p.tipo === 'mensaje').map((p) => p.canal), ['whatsapp', 'whatsapp', 'whatsapp', 'whatsapp']);
  assert.equal(canalDelIntento({ canal: 'correo' }, 1, ['whatsapp']), 'whatsapp');
});

test('sin consentimiento (sin canales) o cita cerrada: nada que enviar; confirmada: solo el aviso', () => {
  assert.deepEqual(planificar(cita(JUEVES_10), REGLA_POR_DEFECTO, LUNES_8, { canales: [] }), []);
  assert.deepEqual(planificar(cita(JUEVES_10, 'confirmada'), REGLA_POR_DEFECTO, LUNES_8).map((p) => p.motivo), ['aviso']);
  assert.deepEqual(planificar(cita(JUEVES_10, 'cancelada'), REGLA_POR_DEFECTO, LUNES_8), []);
  assert.deepEqual(planificar(cita(JUEVES_10, 'atendida'), REGLA_POR_DEFECTO, LUNES_8), []);
  assert.ok(planificar(cita(JUEVES_10, 'reprogramada'), REGLA_POR_DEFECTO, LUNES_8).length > 0);
});

test('el tope de intentos nunca deja fuera un recordatorio elegido', () => {
  const plan = planificar(cita(JUEVES_10), { ...REGLA_POR_DEFECTO, dias: [2, 1], insistir: true, maxIntentos: 1, respaldo: null }, LUNES_8);
  assert.deepEqual(plan.filter((p) => p.tipo === 'mensaje').map((p) => p.etiqueta), ['2 días antes', '1 día antes']);
});

test('aplicarRespuesta detiene solo lo que faltaba de esa cita', () => {
  const envios = [
    { id: 1, citaId: 'c1', estado: 'enviado', momento: 1 },
    { id: 2, citaId: 'c1', estado: 'programado', momento: 5 },
    { id: 3, citaId: 'c2', estado: 'programado', momento: 5 },
  ];
  const r = aplicarRespuesta(envios, 'c1', 'confirmo', 2);
  assert.deepEqual(r.map((e) => e.estado), ['enviado', 'cancelado', 'programado']);
  assert.equal(r[1].motivoCancelacion, 'confirmó');
  assert.equal(envios[1].estado, 'programado', 'no modifica la lista original');
});

test('vencer: sale lo que toca, en orden; la llamada se vuelve tarea', () => {
  const envios = [
    { id: 'b', tipo: 'mensaje', estado: 'programado', momento: 20 },
    { id: 'a', tipo: 'mensaje', estado: 'programado', momento: 10 },
    { id: 'l', tipo: 'llamar', estado: 'programado', momento: 30 },
    { id: 'x', tipo: 'mensaje', estado: 'cancelado', momento: 5 },
  ];
  const { envios: nuevos, salieron } = vencer(envios, 30);
  assert.deepEqual(salieron.map((e) => e.id), ['a', 'b', 'l']);
  assert.equal(nuevos.find((e) => e.id === 'l').estado, 'tarea');
  assert.equal(nuevos.find((e) => e.id === 'x').estado, 'cancelado');
  assert.equal(proximoEnvio(envios, 10), 20);
});
