// Capturas de cada vista (y de las pestañas de recepción) a 390 y 1280, en claro y oscuro (40 combinaciones), con el ancho del cuerpo (sin scroll
// horizontal) y los errores de consola de cada una. Requiere el servidor en el puerto 4710.
// Uso: node herramientas/capturas.mjs [--completa]
import { chromium } from '/home/jonathan/alphatend-do/sitio/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4710/alphateklab-reservas/';
const DIR = new URL('../capturas/matriz/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const completa = process.argv.includes('--completa');
const VISTAS = ['index.html', 'citas.html', 'citas.html#pacientes', 'citas.html#espera', 'citas.html#riesgo', 'bandeja.html', 'confirmar.html', 'reservar.html', 'alojamiento.html', 'alojamiento-reservar.html'];
const TAMANOS = [[390, 844], [1280, 800]];
const filas = [];
const nav = await chromium.launch();
try {
  for (const tema of ['claro', 'oscuro']) {
    for (const [an, al] of TAMANOS) {
      const ctx = await nav.newContext({ viewport: { width: an, height: al }, colorScheme: tema === 'oscuro' ? 'dark' : 'light', locale: 'es-PA', timezoneId: 'America/Panama' });
      const p = await ctx.newPage();
      let errores = [];
      p.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
      p.on('pageerror', (e) => errores.push(e.message));
      p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('ntfy.sh')) errores.push(`${r.status()} ${r.url()}`); });
      await p.goto(BASE + 'citas.html');
      await p.waitForSelector('.agenda');
      const enlace = await p.evaluate(() => {
        const e = JSON.parse(localStorage.getItem('atk-reservas'));
        const st = e.negocios.consultorio;
        const env = st.envios.find((x) => x.estado === 'enviado' && x.citaId && ['pendiente', 'reprogramada'].includes(st.citas.find((c) => c.id === x.citaId)?.estado));
        return env ? env.enlace : null;
      });
      for (const v of VISTAS) {
        errores = [];
        const url = v === 'confirmar.html' ? enlace : BASE + v;
        // «networkidle» no llega nunca en las vistas que escuchan el relevo (EventSource abierto): se espera la carga.
        await p.goto(url, { waitUntil: 'load' });
        await p.waitForTimeout(500);
        const m = await p.evaluate(() => ({ cuerpo: document.documentElement.scrollWidth, ventana: innerWidth }));
        const archivo = `${DIR}${v.replace('.html', '').replace('#', '-')}-${an}-${tema}.png`;
        await p.screenshot({ path: archivo, fullPage: completa });
        filas.push({ vista: v, ancho: an, tema, desborde: m.cuerpo > m.ventana, errores: errores.length, detalle: errores.slice(0, 2).join(' | ') });
      }
      await ctx.close();
    }
  }
} finally {
  await nav.close();
}
for (const f of filas) console.log(`${f.desborde || f.errores ? 'REVISAR' : 'ok     '} ${f.vista.padEnd(27)} ${String(f.ancho).padStart(4)} ${f.tema.padEnd(6)} desborde:${f.desborde ? 'sí' : 'no'} errores:${f.errores}${f.detalle ? ` ${f.detalle}` : ''}`);
const malas = filas.filter((f) => f.desborde || f.errores).length;
console.log(`\n${filas.length - malas} de ${filas.length} capturas sin desborde horizontal ni errores de consola. Carpeta: ${DIR}`);
process.exitCode = malas ? 1 : 0;
