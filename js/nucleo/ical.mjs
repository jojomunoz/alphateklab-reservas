// iCalendar (RFC 5545), lo justo para alojamiento y citas.
// Exportar: VCALENDAR con un VEVENT por reserva (fechas VALUE=DATE, DTEND exclusivo = día de salida), UID estable,
// DTSTAMP, líneas plegadas a 75 octetos y CRLF, texto escapado.
// Importar: despliega líneas plegadas, lee VEVENT con fechas VALUE=DATE y con hora (con Z y con TZID), ignora los
// CANCELLED. Devuelve noches en fechas de calendario 'AAAA-MM-DD'.

import { fechaISO, sumarDias, esISO } from './tiempo.mjs';

const CRLF = '\r\n';

export function escapar(texto) {
  return String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

export function desescapar(texto) {
  return String(texto).replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Pliega una línea a 75 octetos (UTF-8) sin partir un carácter. Las continuaciones empiezan con un espacio. */
export function plegar(linea) {
  const enc = new TextEncoder();
  if (enc.encode(linea).length <= 75) return linea;
  const partes = [];
  let actual = '', octetos = 0, limite = 75;
  for (const ch of linea) {
    const n = enc.encode(ch).length;
    if (octetos + n > limite) {
      partes.push(actual);
      actual = ''; octetos = 0; limite = 74; // la continuación lleva 1 octeto de espacio delante
    }
    actual += ch; octetos += n;
  }
  partes.push(actual);
  return partes.join(CRLF + ' ');
}

/** Quita los pliegues: un salto de línea seguido de espacio o tabulador no es un salto. */
export function desplegar(texto) {
  return String(texto).replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '');
}

const fechaICal = (iso) => iso.replace(/-/g, '');
const pad = (n) => String(n).padStart(2, '0');
export function sello(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function armar(lineas) {
  return lineas.map(plegar).join(CRLF) + CRLF;
}

/**
 * Calendario de una unidad (cabaña) con eventos de día completo.
 * @param {{nombre:string, eventos:Array<{uid:string, inicio:string, fin:string, resumen:string, descripcion?:string}>, dtstamp:number, prodid?:string}} p
 */
export function exportarCalendario({ nombre, eventos, dtstamp, prodid = '-//alphateklab//Reservas demo//ES' }) {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodid}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (nombre) l.push(`X-WR-CALNAME:${escapar(nombre)}`);
  for (const e of eventos) {
    l.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${sello(dtstamp)}`,
      `DTSTART;VALUE=DATE:${fechaICal(e.inicio)}`, `DTEND;VALUE=DATE:${fechaICal(e.fin)}`,
      `SUMMARY:${escapar(e.resumen)}`);
    if (e.descripcion) l.push(`DESCRIPTION:${escapar(e.descripcion)}`);
    l.push('END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return armar(l);
}

/** Un evento con hora (la cita del paciente), en UTC. */
export function exportarCita({ uid, inicio, fin, resumen, lugar, descripcion, dtstamp, prodid = '-//alphateklab//Reservas demo//ES' }) {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodid}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${sello(dtstamp)}`, `DTSTART:${sello(inicio)}`, `DTEND:${sello(fin)}`,
    `SUMMARY:${escapar(resumen)}`];
  if (lugar) l.push(`LOCATION:${escapar(lugar)}`);
  if (descripcion) l.push(`DESCRIPTION:${escapar(descripcion)}`);
  l.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT2H', `DESCRIPTION:${escapar(resumen)}`, 'END:VALARM');
  l.push('END:VEVENT', 'END:VCALENDAR');
  return armar(l);
}

/** Separa «NOMBRE;PARAM=X;PARAM2="a:b":valor» respetando comillas. */
export function leerLinea(linea) {
  let enComillas = false, corte = -1;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') enComillas = !enComillas;
    else if (c === ':' && !enComillas) { corte = i; break; }
  }
  if (corte < 0) return null;
  const cabeza = linea.slice(0, corte), valor = linea.slice(corte + 1);
  const trozos = [];
  let buf = '';
  enComillas = false;
  for (const c of cabeza) {
    if (c === '"') { enComillas = !enComillas; continue; }
    if (c === ';' && !enComillas) { trozos.push(buf); buf = ''; continue; }
    buf += c;
  }
  trozos.push(buf);
  const nombre = trozos.shift().toUpperCase();
  const params = {};
  for (const t of trozos) {
    const i = t.indexOf('=');
    if (i > 0) params[t.slice(0, i).toUpperCase()] = t.slice(i + 1);
  }
  return { nombre, params, valor };
}

/**
 * Fecha de calendario de un DTSTART/DTEND.
 * - VALUE=DATE o 8 dígitos → esa fecha.
 * - Con hora y Z (UTC) → la fecha en Panamá.
 * - Con hora y TZID, o flotante → la fecha escrita (es la fecha local de esa zona).
 */
export function fechaDePropiedad(p) {
  const v = p.valor.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { fecha: `${m[1]}-${m[2]}-${m[3]}`, conHora: false };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  if (m[7] === 'Z') {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return { fecha: fechaISO(ms), conHora: true, utc: ms };
  }
  return { fecha: `${m[1]}-${m[2]}-${m[3]}`, conHora: true, tzid: p.params.TZID || null };
}

function diasDeDuracion(valor) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?/.exec(valor || '');
  if (!m) return null;
  return (+(m[1] || 0)) * 7 + (+(m[2] || 0));
}

/**
 * Lee un .ics y devuelve los eventos como estancias por noches [inicio, fin).
 * @returns {{eventos:Array<{uid:string, inicio:string, fin:string, resumen:string}>, ignorados:Array<{uid:string, motivo:string}>, prodid:string|null, nombre:string|null}}
 */
export function importarCalendario(texto) {
  const lineas = desplegar(texto).split(/\r\n|\n|\r/);
  if (!lineas.some((l) => l.trim().toUpperCase() === 'BEGIN:VCALENDAR')) {
    throw new Error('El texto no es un calendario iCal: falta BEGIN:VCALENDAR.');
  }
  const eventos = [], ignorados = [];
  let prodid = null, nombre = null, actual = null, profundidad = 0;
  for (const cruda of lineas) {
    if (!cruda.trim()) continue;
    const p = leerLinea(cruda);
    if (!p) continue;
    if (p.nombre === 'BEGIN') {
      if (p.valor.toUpperCase() === 'VEVENT') { actual = { props: {} }; profundidad = 0; }
      else if (actual) profundidad++; // VALARM dentro del evento
      continue;
    }
    if (p.nombre === 'END') {
      if (p.valor.toUpperCase() === 'VEVENT' && actual) {
        cerrarEvento(actual, eventos, ignorados);
        actual = null;
      } else if (actual) profundidad--;
      continue;
    }
    if (actual) {
      if (profundidad === 0 && !(p.nombre in actual.props)) actual.props[p.nombre] = p;
    } else if (p.nombre === 'PRODID') prodid = p.valor;
    else if (p.nombre === 'X-WR-CALNAME') nombre = desescapar(p.valor);
  }
  return { eventos, ignorados, prodid, nombre };
}

function cerrarEvento(ev, eventos, ignorados) {
  const pr = ev.props;
  const uid = pr.UID ? pr.UID.valor.trim() : '';
  if (pr.STATUS && pr.STATUS.valor.trim().toUpperCase() === 'CANCELLED') {
    ignorados.push({ uid, motivo: 'cancelado' });
    return;
  }
  const ini = pr.DTSTART ? fechaDePropiedad(pr.DTSTART) : null;
  if (!ini || !esISO(ini.fecha)) { ignorados.push({ uid, motivo: 'sin fecha de inicio' }); return; }
  let fin = pr.DTEND ? fechaDePropiedad(pr.DTEND) : null;
  if (!fin && pr.DURATION) {
    const d = diasDeDuracion(pr.DURATION.valor);
    if (d) fin = { fecha: sumarDias(ini.fecha, d) };
  }
  let finFecha = fin ? fin.fecha : sumarDias(ini.fecha, 1);
  if (!esISO(finFecha)) { ignorados.push({ uid, motivo: 'fecha de fin no válida' }); return; }
  if (finFecha <= ini.fecha) {
    // Evento con hora que empieza y termina el mismo día: ocupa esa noche.
    if (ini.conHora && finFecha === ini.fecha) finFecha = sumarDias(ini.fecha, 1);
    else { ignorados.push({ uid, motivo: 'termina antes de empezar' }); return; }
  }
  eventos.push({
    uid: uid || `sin-uid-${ini.fecha}-${finFecha}`,
    inicio: ini.fecha,
    fin: finFecha,
    resumen: pr.SUMMARY ? desescapar(pr.SUMMARY.valor) : '',
  });
}
