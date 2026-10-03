// Rompe el código a propósito, una regla a la vez, y comprueba que `node --test pruebas/` falla.
// Si alguna mutación deja las pruebas en verde, esa regla no está probada. El archivo se restaura siempre.
// Uso: node herramientas/mutaciones.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const raiz = new URL('../', import.meta.url).pathname;
const MUTACIONES = [
  ['intervalos: el fin cuenta (cita que termina cuando empieza otra)', 'js/nucleo/intervalos.mjs', 'return a.inicio < b.fin && b.inicio < a.fin;', 'return a.inicio <= b.fin && b.inicio <= a.fin;'],
  ['agenda: sin buffer entre citas (horas ofrecidas)', 'js/nucleo/agenda.mjs', 'if (delProf.some((c) => solapanConMargen(prop, c, margen))) continue;', 'if (delProf.some((c) => solapanConMargen(prop, c, 0))) continue;'],
  ['agenda: sin buffer al validar la cita', 'js/nucleo/agenda.mjs', '.find((c) => solapanConMargen(propI, c, buffer * MIN));\n  if (choqueProf)', '.find((c) => solapanConMargen(propI, c, 0));\n  if (choqueProf)'],
  ['agenda: no se mira el consultorio', 'js/nucleo/agenda.mjs', 'if (deSala.some((c) => solapanConMargen(prop, c, margen))) continue;', ''],
  ['agenda: la misma persona en dos citas a la vez', 'js/nucleo/agenda.mjs', '  if (prop.pacienteId) {', '  if (false) {'],
  ['agenda: las horas ofrecidas no miran las otras citas de la persona', 'js/nucleo/agenda.mjs', 'if (dePersona.some((c) => solapan(prop, c))) continue;', ''],
  ['feriados: sin traslado de domingo a lunes', 'js/nucleo/feriados.mjs', "mapa.set(sumarDias(iso, 1), `${nombre} (se descansa el lunes)`);", ''],
  ['tiempo: usar UTC en vez de la hora de Panamá', 'js/nucleo/tiempo.mjs', 'export const DESFASE_MIN = -300;', 'export const DESFASE_MIN = 0;'],
  ['tiempo: «mañana» para cualquier día que no es hoy', 'js/nucleo/tiempo.mjs', "  if (d === -1) return 'ayer';\n  return fechaCorta(ms);", "  return 'mañana';"],
  ['recordatorios: sin ventana de envío (manda de madrugada)', 'js/nucleo/recordatorios.mjs', '  const [desde, hasta] = ventana;\n  const m = minutosDelDia(ms);', '  return ms;\n  const [desde, hasta] = ventana;\n  const m = minutosDelDia(ms);'],
  ['recordatorios: la ventana acepta las 8:00 p. m. en punto', 'js/nucleo/recordatorios.mjs', 'if (m >= hasta) return', 'if (m > hasta) return'],
  ['recordatorios: la respuesta también cancela lo ya enviado', 'js/nucleo/recordatorios.mjs', "if (e.citaId !== citaId || e.estado !== 'programado') return e;", 'if (e.citaId !== citaId) return e;'],
  ['recordatorios: insistir sin tope', 'js/nucleo/recordatorios.mjs', 'const max = insistir ? Math.max((regla.maxIntentos || 1) - previos.length, base.length) : base.length;', 'const max = insistir ? 99 : base.length;'],
  ['recordatorios: lo ya enviado no cuenta para el máximo', 'js/nucleo/recordatorios.mjs', 'Math.max((regla.maxIntentos || 1) - previos.length, base.length)', 'Math.max(regla.maxIntentos || 1, base.length)'],
  ['recordatorios: sin escalera de canal', 'js/nucleo/recordatorios.mjs', 'if (regla.respaldo && de > 1 && intento >= desde && canales.includes(regla.respaldo)) return regla.respaldo;', 'if (false) return regla.respaldo;'],
  ['recordatorios: el respaldo no va en el último mensaje real', 'js/nucleo/recordatorios.mjs', 'const desde = Math.min(regla.respaldoDesde || Infinity, de);', 'const desde = regla.respaldoDesde || Infinity;'],
  ['recordatorios: el atrasado sale pegado al siguiente', 'js/nucleo/recordatorios.mjs', 'if (base.length > 1 && base[0].atrasado && base[1].momento - base[0].momento < cada) base.shift();', ''],
  ['recordatorios: la llamada no mira el horario del negocio', 'js/nucleo/recordatorios.mjs', 'if (abierto != null && abierto < cita.inicio) momento = abierto;', ''],
  ['recordatorios: una cita confirmada no recibe su aviso', 'js/nucleo/recordatorios.mjs', '    const aviso = base[base.length - 1];', '    const aviso = null;'],
  ['operaciones: la misma respuesta se aplica dos veces', 'js/nucleo/operaciones.mjs', "if (r.id && st.procesados.includes(r.id)) return { ok: true, resultado: 'repetida' };\n  const cita = citaDe(st, r.citaId);", 'const cita = citaDe(st, r.citaId);'],
  ['operaciones: se responde a una cita que ya empezó', 'js/nucleo/operaciones.mjs', " || cita.inicio <= ahora) return { ok: false, resultado: 'cerrada', cita };", ") return { ok: false, resultado: 'cerrada', cita };"],
  ['operaciones: un horario que ya pasó se llama «ocupado»', 'js/nucleo/operaciones.mjs', "resultado: pasado ? 'hueco_pasado' : 'hueco_ocupado'", "resultado: 'hueco_ocupado'"],
  ['operaciones: confirmar no cierra la tarea de llamar', 'js/nucleo/operaciones.mjs', "    cerrarTareas(st, cita.id, ahora, 'confirmo');\n", ''],
  ['operaciones: cambiar el estado (confirmar o cancelar) no cierra las tareas', 'js/nucleo/operaciones.mjs', '  cerrarTareas(st, citaId, ahora, estado);\n', ''],
  ['operaciones: las tareas de una cita que ya empezó siguen abiertas', 'js/nucleo/operaciones.mjs', "if (cita && cita.inicio <= ahora) t.hecha = { t: cita.inicio, resultado: 'vencida' };", ''],
  ['operaciones: cambiar la regla reinicia el conteo', 'js/nucleo/operaciones.mjs', 'programarRecordatorios(st, cita, ahora, { negocio, previos });', 'programarRecordatorios(st, cita, ahora, { negocio });'],
  ['operaciones: borrar a la persona deja su nombre en la bitácora', 'js/nucleo/operaciones.mjs', "b.texto = b.texto.split(nombre).join('(persona eliminada)');", ''],
  ['operaciones: borrar a la persona deja el texto de sus mensajes', 'js/nucleo/operaciones.mjs', "(e.pacienteId === pacienteId && (e.texto || e.enlace) ? { ...e, texto: '', enlace: '', borrado: ahora } : e)", '(e)'],
  ['operaciones: la autoagenda une la solicitud al registro existente aunque el celular no coincida', 'js/nucleo/operaciones.mjs', 'const porVerificar = Boolean(existente && existente.telefono !== tel.e164);', 'const porVerificar = false;'],
  ['operaciones: la autoagenda registra antes de saber si la hora sirve', 'js/nucleo/operaciones.mjs', '  if (errCita.length) {', '  if (false) {'],
  ['operaciones: lista de espera, gana el último y no el primero', 'js/nucleo/operaciones.mjs', "if (oferta.estado === 'tomada') return { ok: false, resultado: oferta.tomadaPor === r.esperaId ? 'ya_es_tuya' : 'tomada' };", ''],
  ['operaciones: se ofrece un hueco que empieza en menos de 1 h', 'js/nucleo/operaciones.mjs', 'if (hueco.inicio < ahora + 60 * MIN) return { oferta: null, candidatos: [] };', ''],
  ['operaciones: aceptar el espacio no detiene los avisos a los demás', 'js/nucleo/operaciones.mjs', "x.ofertaId === oferta.id && x.estado === 'programado'", 'false'],
  ['operaciones: se registra sin consentimiento', 'js/nucleo/operaciones.mjs', '  if (!datos.consentimiento) {\n    errores.push', '  if (false) {\n    errores.push'],
  ['relevo: el acuse le llega a cualquier teléfono', 'js/nucleo/mensajes-relevo.mjs', "m.tipo === 'acuse' && m.de === id", "m.tipo === 'acuse'"],
  ['enlace: no se comprueba la versión', 'js/nucleo/enlace.mjs', 'if (datos.v !== VERSION_ENLACE) {', 'if (false) {'],
  ['enlace: más de 3 horarios alternativos', 'js/nucleo/enlace.mjs', 'datos.hs.length <= 3 && ', ''],
  ['contacto: acepta fijos de 7 dígitos para WhatsApp', 'js/nucleo/contacto.mjs', "if (d.length === 7) return { ok: false,", "if (d.length === 7) return { ok: true, e164: `+507${d}`, mostrar: d, wa: `507${d}`,"],
  ['ical: DTEND inclusivo (noche fantasma el día de salida)', 'js/nucleo/ical.mjs', '    inicio: ini.fecha,\n    fin: finFecha,', '    inicio: ini.fecha,\n    fin: sumarDias(finFecha, 1),'],
  ['ical: no ignora los CANCELLED', 'js/nucleo/ical.mjs', "if (pr.STATUS && pr.STATUS.valor.trim().toUpperCase() === 'CANCELLED') {", 'if (false) {'],
  ['ical: sin plegar a 75 octetos', 'js/nucleo/ical.mjs', '  if (enc.encode(linea).length <= 75) return linea;', '  return linea;'],
  ['ical: una hora con TZID se lee como UTC', 'js/nucleo/ical.mjs', "return { fecha: `${m[1]}-${m[2]}-${m[3]}`, conHora: true, tzid: p.params.TZID || null };", "{ const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); return { fecha: fechaISO(ms), conHora: true }; }"],
  ['alojamiento: el .ics exporta también las reservas de otros canales (eco)', 'js/nucleo/alojamiento.mjs', "export const CANALES_EXPORTABLES = new Set(['directo', 'bloqueo']);", "export const CANALES_EXPORTABLES = new Set(['directo', 'bloqueo', 'airbnb', 'booking', 'expedia']);"],
  ['alojamiento: el .ics no avisa de una reserva de canal reubicada aquí', 'js/nucleo/alojamiento.mjs', '(CANALES_EXPORTABLES.has(r.canal) || unidadDeCanal(r) !== unidadId)', 'CANALES_EXPORTABLES.has(r.canal)'],
  ['alojamiento: importar ignora de qué calendario vino la reserva (las reubicadas se pierden)', 'js/nucleo/alojamiento.mjs', 'r.uidExterno && unidadDeCanal(r) === unidadId;', 'r.uidExterno && r.unidades.includes(unidadId);'],
  ['alojamiento: el cierre preventivo no se respeta', 'js/nucleo/alojamiento.mjs', 'if (cerradas.has(c.id)) { enCierre.push(c); continue; }', ''],
  ['alojamiento: la noche de salida cuenta', 'js/nucleo/alojamiento.mjs', 'return a.llegada < b.salida && b.llegada < a.salida;', 'return a.llegada <= b.salida && b.llegada <= a.salida;'],
  ['alojamiento: el vigilante no avisa', 'js/nucleo/alojamiento.mjs', 'const vencido = horas > max;', 'const vencido = false;'],
  ['alojamiento: subir el máximo deja «al día» un canal que no sincroniza', 'js/nucleo/alojamiento.mjs', "const estado = vencido ? 'vencido' : horas >= (c.intervaloHoras || 2) ? 'retrasado' : 'al_dia';", "const estado = vencido ? 'vencido' : 'al_dia';"],
  ['alojamiento: reubicar a una cabaña más chica', 'js/nucleo/alojamiento.mjs', '&& c.capacidad >= origen.capacidad)', ')'],
  ['alojamiento: la reubicación propone primero cabañas en riesgo', 'js/nucleo/alojamiento.mjs', '.sort((a, b) => a.riesgo - b.riesgo || a.capacidad - b.capacidad', '.sort((a, b) => a.capacidad - b.capacidad'],
  ['negocios: ITBMS de hospedaje al 7 %', 'js/nucleo/negocios.mjs', 'itbms: 0.10,', 'itbms: 0.07,'],
  ['mensajes: SMS con acentos a 160 caracteres', 'js/nucleo/mensajes.mjs', "return { codificacion: 'UCS-2', largo, segmentos: largo <= 70 ? 1 : Math.ceil(largo / 67) };", "return { codificacion: 'UCS-2', largo, segmentos: largo <= 160 ? 1 : Math.ceil(largo / 153) };"],
  ['relevo: acepta «__proto__» como negocio', 'js/nucleo/negocios.mjs', "return typeof id === 'string' && Object.hasOwn(NEGOCIOS_CITAS, id) ? NEGOCIOS_CITAS[id] : null;", 'return NEGOCIOS_CITAS[id] || null;'],
  ['recordatorios: sin tarea de llamar al agotarse', 'js/nucleo/recordatorios.mjs', 'if (insistir && regla.llamar !== false && ultimo !== null) {', 'if (false) {'],
  ['operaciones: reprogramar no vuelve a planificar los recordatorios', 'js/nucleo/operaciones.mjs', '  programarRecordatorios(st, cita, ahora, { negocio });\n  const p = pacienteDe(st, cita.pacienteId);', '  const p = pacienteDe(st, cita.pacienteId);'],
  ['operaciones: cancelar desde el enlace no cierra la tarea de llamar', 'js/nucleo/operaciones.mjs', "    cerrarTareas(st, cita.id, ahora, 'cancelo');\n", ''],
  ['operaciones: una cédula registrada con otro celular entra sin tarea para que recepción la verifique', 'js/nucleo/operaciones.mjs', 'if (r.ok && porVerificar) crearTarea(', 'if (false) crearTarea('],
  ['alojamiento: el .ics exporta las reservas canceladas', 'js/nucleo/alojamiento.mjs', 'activa(r) && r.unidades.includes(unidadId) && (CANALES_EXPORTABLES', 'r.unidades.includes(unidadId) && (CANALES_EXPORTABLES'],
  ['alojamiento: importar no cancela lo que el canal ya no manda', 'js/nucleo/alojamiento.mjs', 'if (deEsteCalendario(r) && activa(r) && !ajenas.some((e) => e.uid === r.uidExterno)) {', 'if (false) {'],
  ['riesgo: el aviso de una cita ya confirmada cuenta como «confirmó»', 'js/nucleo/riesgo.mjs', "e.estado === 'enviado' && e.clase !== 'aviso')", "e.estado === 'enviado')"],
  ['semilla: las llamadas caen con el negocio cerrado', 'js/nucleo/semilla.mjs', '{ canales: canalesDe(pac), ventana: VENTANA, siguienteAbierto });', '{ canales: canalesDe(pac), ventana: VENTANA });'],
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
