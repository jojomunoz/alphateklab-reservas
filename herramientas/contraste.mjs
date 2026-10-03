// Mide el contraste (WCAG 2.x) de los pares de tokens que se usan como texto sobre fondo, en las cuatro marcas,
// en claro y en oscuro. Falla (código 1) si algún par de texto queda por debajo de 4,5:1.
// Uso: node herramientas/contraste.mjs
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');

function bloque(selector) {
  const i = css.indexOf(selector + ' {');
  if (i < 0) return {};
  const fin = css.indexOf('}', i);
  const tokens = {};
  for (const m of css.slice(i, fin).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) tokens[m[1]] = m[2];
  return tokens;
}

const base = bloque(':root');
const marcas = {
  consultorio: base,
  barberia: { ...base, ...bloque(':root[data-marca="barberia"]') },
  taller: { ...base, ...bloque(':root[data-marca="taller"]') },
  cabanas: { ...base, ...bloque(':root[data-marca="cabanas"]') },
};

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PARES = [
  ['tinta', 'fondo'], ['tinta', 'superficie'], ['tinta-2', 'superficie'], ['tinta-2', 'superficie-2'], ['tinta-3', 'superficie'], ['tinta-3', 'fondo'], ['tinta-3', 'superficie-2'],
  ['primario-texto', 'superficie'], ['primario-texto', 'fondo'], ['primario-texto', 'primario-suave'], ['sobre-primario', 'primario'],
  ['ok', 'ok-fondo'], ['aviso', 'aviso-fondo'], ['gris', 'gris-fondo'], ['tinta-2', 'gris-fondo'], ['peligro', 'peligro-fondo'], ['peligro', 'superficie'], ['ok', 'superficie'], ['aviso', 'superficie'],
  ['superficie', 'tinta'], ['tinta', 'peligro-fondo'], ['superficie', 'peligro'], ['tinta', 'aviso-fondo'], ['tinta', 'primario-suave'],
];
const CANALES = ['c-directo', 'c-airbnb', 'c-booking', 'c-expedia', 'c-bloqueo'];

let fallos = 0;
for (const [marca, t] of Object.entries(marcas)) {
  for (const modo of ['c', 'o']) {
    const v = (n) => t[`${n}-${modo}`];
    const filas = [];
    const pares = [...PARES, ...(marca === 'cabanas' ? CANALES.map((c) => ['sobre-canal', c]) : [])];
    for (const [a, b] of pares) {
      if (!v(a) || !v(b)) continue;
      const c = contraste(v(a), v(b));
      const ok = c >= 4.5;
      if (!ok) fallos++;
      filas.push(`${ok ? ' ' : '✗'} ${a} sobre ${b}: ${c.toFixed(2)}`);
    }
    // Los canales contra el fondo (forma, no texto): 3:1.
    if (marca === 'cabanas') for (const c of CANALES) {
      const r = contraste(v(c), v('superficie'));
      if (r < 3) { fallos++; filas.push(`✗ ${c} contra superficie (objeto): ${r.toFixed(2)}`); }
    }
    console.log(`\n${marca} · ${modo === 'c' ? 'claro' : 'oscuro'}`);
    console.log(filas.join('\n'));
  }
}
// Barra de alphateklab: grafito #202729 y ámbar #F2B544 (marca del 3-oct-2026). El ámbar es subrayado y foco (forma, 3:1),
// y el logo lleva texto claro #F7F5EF.
const demo = [['#eef2f2', '#202729'], ['#b7c2c4', '#202729'], ['#eef2f2', '#2b3436'], ['#b7c2c4', '#2b3436'], ['#f7f5ef', '#202729']];
const demoFormas = [['#f2b544', '#202729'], ['#f2b544', '#2b3436']];
console.log('\nbarra de la demo');
for (const [a, b] of demo) { const c = contraste(a, b); if (c < 4.5) fallos++; console.log(`${c >= 4.5 ? ' ' : '✗'} ${a} sobre ${b}: ${c.toFixed(2)}`); }
for (const [a, b] of demoFormas) { const c = contraste(a, b); if (c < 3) fallos++; console.log(`${c >= 3 ? ' ' : '✗'} ${a} sobre ${b} (forma): ${c.toFixed(2)}`); }
console.log(`\n${fallos ? `${fallos} pares por debajo del mínimo` : 'Todos los pares pasan (texto ≥ 4,5:1; formas ≥ 3:1).'}`);
process.exitCode = fallos ? 1 : 0;
