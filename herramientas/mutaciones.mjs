// Rompe el código a propósito, una regla a la vez, y comprueba que `node --test pruebas/` falla.
// Si alguna mutación deja las pruebas en verde, esa regla no está probada. El archivo se restaura siempre.
// Uso: node herramientas/mutaciones.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const raiz = new URL('../', import.meta.url).pathname;
const MUTACIONES = [
  ['intervalos: el fin cuenta (cita que termina cuando empieza otra)', 'js/nucleo/intervalos.mjs', 'return a.inicio < b.fin && b.inicio < a.fin;', 'return a.inicio <= b.fin && b.inicio <= a.fin;'],
  ['agenda: sin buffer entre citas', 'js/nucleo/agenda.mjs', 'if (delProf.some((c) => solapanConMargen(prop, c, margen))) continue;', 'if (delProf.some((c) => solapanConMargen(prop, c, 0))) continue;'],
  ['agenda: no se mira el consultorio', 'js/nucleo/agenda.mjs', 'if (deSala.some((c) => solapanConMargen(prop, c, margen))) continue;', ''],
  ['feriados: sin traslado de domingo a lunes', 'js/nucleo/feriados.mjs', "mapa.set(sumarDias(iso, 1), `${nombre} (se descansa el lunes)`);", ''],
  ['tiempo: usar UTC en vez de la hora de Panamá', 'js/nucleo/tiempo.mjs', 'export const DESFASE_MIN = -300;', 'export const DESFASE_MIN = 0;'],
  ['recordatorios: sin ventana de envío (manda de madrugada)', 'js/nucleo/recordatorios.mjs', '  const [desde, hasta] = ventana;\n  const m = minutosDelDia(ms);', '  return ms;\n  const [desde, hasta] = ventana;\n  const m = minutosDelDia(ms);'],
  ['recordatorios: la respuesta también cancela lo ya enviado', 'js/nucleo/recordatorios.mjs', "if (e.citaId !== citaId || e.estado !== 'programado') return e;", 'if (e.citaId !== citaId) return e;'],
  ['recordatorios: insistir sin tope', 'js/nucleo/recordatorios.mjs', 'const max = regla.insistir ? Math.max(regla.maxIntentos || 1, base.length) : base.length;', 'const max = regla.insistir ? 99 : base.length;'],
  ['recordatorios: sin escalera de canal', 'js/nucleo/recordatorios.mjs', "if (regla.respaldo && intento >= (regla.respaldoDesde || Infinity) && canales.includes(regla.respaldo)) {", 'if (false) {'],
  ['operaciones: la misma respuesta se aplica dos veces', 'js/nucleo/operaciones.mjs', "if (r.id && st.procesados.includes(r.id)) return { ok: true, resultado: 'repetida' };\n  const cita = citaDe(st, r.citaId);", 'const cita = citaDe(st, r.citaId);'],
  ['operaciones: lista de espera, gana el último y no el primero', 'js/nucleo/operaciones.mjs', "if (oferta.estado === 'tomada') return { ok: false, resultado: oferta.tomadaPor === r.esperaId ? 'ya_es_tuya' : 'tomada' };", ''],
  ['operaciones: se registra sin consentimiento', 'js/nucleo/operaciones.mjs', '  if (!datos.consentimiento) {\n    errores.push', '  if (false) {\n    errores.push'],
  ['enlace: no se comprueba la versión', 'js/nucleo/enlace.mjs', 'if (datos.v !== VERSION_ENLACE) {', 'if (false) {'],
  ['contacto: acepta fijos de 7 dígitos para WhatsApp', 'js/nucleo/contacto.mjs', "if (d.length === 7) return { ok: false,", "if (d.length === 7) return { ok: true, e164: `+507${d}`, mostrar: d, wa: `507${d}`,"],
  ['ical: DTEND inclusivo (noche fantasma el día de salida)', 'js/nucleo/ical.mjs', '    inicio: ini.fecha,\n    fin: finFecha,', '    inicio: ini.fecha,\n    fin: sumarDias(finFecha, 1),'],
  ['ical: no ignora los CANCELLED', 'js/nucleo/ical.mjs', "if (pr.STATUS && pr.STATUS.valor.trim().toUpperCase() === 'CANCELLED') {", 'if (false) {'],
  ['ical: sin plegar a 75 octetos', 'js/nucleo/ical.mjs', '  if (enc.encode(linea).length <= 75) return linea;', '  return linea;'],
  ['alojamiento: el .ics exporta también las reservas de otros canales (eco)', 'js/nucleo/alojamiento.mjs', "export const CANALES_EXPORTABLES = new Set(['directo', 'bloqueo']);", "export const CANALES_EXPORTABLES = new Set(['directo', 'bloqueo', 'airbnb', 'booking', 'expedia']);"],
  ['alojamiento: el cierre preventivo no se respeta', 'js/nucleo/alojamiento.mjs', 'if (cerradas.has(c.id)) { enCierre.push(c); continue; }', ''],
  ['alojamiento: la noche de salida cuenta', 'js/nucleo/alojamiento.mjs', 'return a.llegada < b.salida && b.llegada < a.salida;', 'return a.llegada <= b.salida && b.llegada <= a.salida;'],
  ['alojamiento: el vigilante no avisa', 'js/nucleo/alojamiento.mjs', 'vencido: horas > max,', 'vencido: false,'],
  ['alojamiento: reubicar a una cabaña más chica', 'js/nucleo/alojamiento.mjs', '&& c.capacidad >= origen.capacidad)', ')'],
  ['negocios: ITBMS de hospedaje al 7 %', 'js/nucleo/negocios.mjs', 'itbms: 0.10,', 'itbms: 0.07,'],
  ['mensajes: SMS con acentos a 160 caracteres', 'js/nucleo/mensajes.mjs', "return { codificacion: 'UCS-2', largo, segmentos: largo <= 70 ? 1 : Math.ceil(largo / 67) };", "return { codificacion: 'UCS-2', largo, segmentos: largo <= 160 ? 1 : Math.ceil(largo / 153) };"],
  ['relevo: acepta «__proto__» como negocio', 'js/nucleo/negocios.mjs', "return typeof id === 'string' && Object.hasOwn(NEGOCIOS_CITAS, id) ? NEGOCIOS_CITAS[id] : null;", 'return NEGOCIOS_CITAS[id] || null;'],
];

let atrapadas = 0;
for (const [nombre, archivo, buscar, poner] of MUTACIONES) {
  const ruta = raiz + archivo;
  const original = readFileSync(ruta, 'utf8');
  if (!original.includes(buscar)) { console.log(`?? ${nombre}: no encontré el código a mutar (¿cambió?)`); continue; }
  try {
    writeFileSync(ruta, original.replace(buscar, poner));
    const r = spawnSync(process.execPath, ['--test', 'pruebas/'], { cwd: raiz, encoding: 'utf8', timeout: 120000 });
    const fallas = (r.stdout.match(/^# fail (\d+)/m) || [])[1];
    const ok = r.status !== 0;
    if (ok) atrapadas++;
    console.log(`${ok ? 'atrapada' : 'VIVA    '} ${nombre}${fallas ? ` (${fallas} pruebas fallan)` : ''}`);
  } finally {
    writeFileSync(ruta, original);
  }
}
const verde = spawnSync(process.execPath, ['--test', 'pruebas/'], { cwd: raiz, encoding: 'utf8' }).status === 0;
console.log(`\n${atrapadas} de ${MUTACIONES.length} mutaciones hicieron fallar las pruebas. Código restaurado y pruebas en verde: ${verde ? 'sí' : 'NO'}.`);
process.exitCode = atrapadas === MUTACIONES.length && verde ? 0 : 1;
