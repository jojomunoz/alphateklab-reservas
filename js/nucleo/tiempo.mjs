// Hora de Panamá (America/Panama): UTC-5 todo el año, sin horario de verano.
// Todo se guarda como milisegundos UTC y se convierte aquí. No se usa la zona del navegador del visitante:
// alguien que abra la demo desde Madrid tiene que ver las 9:00 de Panamá, no las 16:00 de su reloj.

export const DESFASE_MIN = -300; // minutos respecto de UTC
const DESFASE_MS = DESFASE_MIN * 60000;
export const MIN = 60000;
export const HORA = 60 * MIN;
export const DIA = 24 * HORA;

const pad = (n) => String(n).padStart(2, '0');

/** Partes de la fecha y hora en Panamá. mes 1-12, diaSemana 0 = domingo. */
export function partes(ms) {
  const d = new Date(ms + DESFASE_MS);
  return {
    anio: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    dia: d.getUTCDate(),
    hora: d.getUTCHours(),
    minuto: d.getUTCMinutes(),
    diaSemana: d.getUTCDay(),
  };
}

/** Milisegundos UTC de una fecha y hora de Panamá. */
export function aMs({ anio, mes, dia, hora = 0, minuto = 0 }) {
  return Date.UTC(anio, mes - 1, dia, hora, minuto) - DESFASE_MS;
}

/** 'AAAA-MM-DD' de Panamá para un instante. */
export function fechaISO(ms) {
  const p = partes(ms);
  return `${p.anio}-${pad(p.mes)}-${pad(p.dia)}`;
}

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function leerISO(iso) {
  const m = RE_ISO.exec(iso);
  if (!m) throw new Error(`Fecha mal formada: ${iso}`);
  return { anio: +m[1], mes: +m[2], dia: +m[3] };
}

export function esISO(iso) {
  if (typeof iso !== 'string' || !RE_ISO.test(iso)) return false;
  const { anio, mes, dia } = leerISO(iso);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Instante UTC de una fecha de Panamá más unos minutos del día (0 = medianoche). */
export function msDeFecha(iso, minutosDelDia = 0) {
  const { anio, mes, dia } = leerISO(iso);
  return Date.UTC(anio, mes - 1, dia) + minutosDelDia * MIN - DESFASE_MS;
}

export function minutosDelDia(ms) {
  const p = partes(ms);
  return p.hora * 60 + p.minuto;
}

/** Suma días a una fecha de calendario (sin tocar horas: no hay horario de verano que esquivar). */
export function sumarDias(iso, n) {
  const { anio, mes, dia } = leerISO(iso);
  const d = new Date(Date.UTC(anio, mes - 1, dia + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Días de calendario de a hasta b (b − a). */
export function diferenciaDias(a, b) {
  const x = leerISO(a), y = leerISO(b);
  return Math.round((Date.UTC(y.anio, y.mes - 1, y.dia) - Date.UTC(x.anio, x.mes - 1, x.dia)) / DIA);
}

/** 0 = domingo … 6 = sábado. */
export function diaSemana(iso) {
  const { anio, mes, dia } = leerISO(iso);
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

/** Lunes de la semana de esa fecha. */
export function lunesDe(iso) {
  const ds = diaSemana(iso);
  return sumarDias(iso, ds === 0 ? -6 : 1 - ds);
}

export function inicioDelDia(ms) {
  return msDeFecha(fechaISO(ms), 0);
}

/** Redondea hacia arriba al siguiente múltiplo de `paso` minutos (en hora de Panamá). */
export function redondearArriba(ms, paso = 15) {
  const base = inicioDelDia(ms);
  const m = Math.ceil((ms - base) / (paso * MIN)) * paso;
  return base + m * MIN;
}

// ── Textos en español de Panamá ────────────────────────────────────────────

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «9:30 a. m.», «12:00 m.» no se usa: mediodía va como «12:00 p. m.», como en los relojes de aquí. */
export function horaTexto(ms) {
  return horaDeMinutos(minutosDelDia(ms));
}

export function horaDeMinutos(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** «9:30» sin sufijo, para rejillas donde el contexto ya lo dice. */
export function horaCorta(ms) {
  const p = partes(ms);
  const h12 = p.hora % 12 === 0 ? 12 : p.hora % 12;
  return `${h12}:${pad(p.minuto)}`;
}

/** «martes 6 de octubre» */
export function fechaLarga(isoOMs) {
  const iso = typeof isoOMs === 'number' ? fechaISO(isoOMs) : isoOMs;
  const { mes, dia } = leerISO(iso);
  return `${DIAS[diaSemana(iso)]} ${dia} de ${MESES[mes - 1]}`;
}

/** «mar 6 oct» */
export function fechaCorta(isoOMs) {
  const iso = typeof isoOMs === 'number' ? fechaISO(isoOMs) : isoOMs;
  const { mes, dia } = leerISO(iso);
  return `${DIAS_CORTOS[diaSemana(iso)]} ${dia} ${MESES_CORTOS[mes - 1]}`;
}

/**
 * «hoy», «mañana», «ayer» o «sáb 3 oct»: el día de un instante visto desde `ahora` (en Panamá). Para las listas de
 * recepción, donde una cita de hace dos días no puede leerse como «mañana».
 */
export function diaRelativo(ms, ahora) {
  const d = diferenciaDias(fechaISO(ahora), fechaISO(ms));
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  if (d === -1) return 'ayer';
  return fechaCorta(ms);
}

/** «el martes 6 a las 9:30 a. m.» — para mensajes al paciente. */
export function cuandoTexto(ms) {
  const iso = fechaISO(ms);
  const { dia } = leerISO(iso);
  return { fecha: `${DIAS[diaSemana(iso)]} ${dia}`, hora: horaTexto(ms) };
}

/** «hace 9 h», «hace 40 min», «hace 2 días» */
export function haceTexto(desdeMs, ahoraMs) {
  const min = Math.max(0, Math.round((ahoraMs - desdeMs) / MIN));
  if (min < 1) return 'hace menos de un minuto';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

/** «HH:MM» → minutos del día. */
export function minutosDeTexto(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function textoDeMinutos(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}
