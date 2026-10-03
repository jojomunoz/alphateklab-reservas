// Feriados nacionales de Panamá.
//
// Lista oficial de 2026 (12 días), comprobada el 3-oct-2026 en:
//   - La Estrella de Panamá, «Panamá tendrá 12 días feriados nacionales en 2026 según calendario oficial»
//     https://www.laestrella.com.pa/panama/informacion-util/panama-tendra-12-dias-feriados-nacionales-en-2026-segun-calendario-oficial-HL18751879
//   - La Prensa, «Días feriados y fiestas nacionales en Panamá 2026: calendario detallado»
//     https://www.prensa.com/sociedad/dias-feriados-y-fiestas-nacionales-en-panama-2026-calendario-detallado/
//     (el 20 de diciembre cae domingo y el descanso pasa al lunes 21).
//
// Las fechas se calculan con la regla (fijas + Carnaval y Viernes Santo según la Pascua + traslado de domingo a
// lunes) y una prueba comprueba que la regla da exactamente la lista oficial de 2026. Para 2027 la regla da la
// lista esperada, pero el calendario oficial de 2027 todavía no está publicado: confirmarlo cuando salga.

import { sumarDias, diaSemana } from './tiempo.mjs';

const FIJOS = [
  ['01-01', 'Año Nuevo'],
  ['01-09', 'Día de los Mártires'],
  ['05-01', 'Día del Trabajador'],
  ['11-03', 'Separación de Panamá de Colombia'],
  ['11-05', 'Consolidación de la Separación (Colón)'],
  ['11-10', 'Primer Grito de Independencia (La Villa de Los Santos)'],
  ['11-28', 'Independencia de Panamá de España'],
  ['12-08', 'Día de las Madres'],
  ['12-20', 'Día de Duelo Nacional (20 de diciembre)'],
  ['12-25', 'Navidad'],
];

/** Domingo de Pascua (algoritmo anónimo gregoriano, Meeus/Jones/Butcher). */
export function pascua(anio) {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

const cache = new Map();

/**
 * Días sin atención por feriado nacional en un año, como Map(iso → nombre).
 * Si un feriado cae domingo, el descanso se toma el lunes siguiente (se marca el lunes; el domingo ya está cerrado).
 */
export function feriadosDe(anio) {
  if (cache.has(anio)) return cache.get(anio);
  const lista = [];
  for (const [md, nombre] of FIJOS) lista.push([`${anio}-${md}`, nombre]);
  const p = pascua(anio);
  lista.push([sumarDias(p, -47), 'Martes de Carnaval']);
  lista.push([sumarDias(p, -2), 'Viernes Santo']);
  const mapa = new Map();
  for (const [iso, nombre] of lista) {
    if (diaSemana(iso) === 0) {
      mapa.set(iso, nombre);
      mapa.set(sumarDias(iso, 1), `${nombre} (se descansa el lunes)`);
    } else {
      mapa.set(iso, nombre);
    }
  }
  const ordenado = new Map([...mapa.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  cache.set(anio, ordenado);
  return ordenado;
}

/** Nombre del feriado o null. */
export function feriado(iso) {
  return feriadosDe(+iso.slice(0, 4)).get(iso) || null;
}
