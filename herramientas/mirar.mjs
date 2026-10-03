// Abre una vista con Playwright, guarda una captura y lista los errores de consola y el ancho del cuerpo.
// Uso: node herramientas/mirar.mjs <pagina> [ancho] [alto] [claro|oscuro] [nombre] [--completa] [--js "código"]
// Requiere el servidor: python3 -m http.server 4730 -d ~/alphateklab/repos (o PUERTO=<otro>)
import { chromium } from '/home/jonathan/alphatend-do/sitio/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const completa = args.includes('--completa');
const iJs = args.indexOf('--js');
const js = iJs >= 0 ? args[iJs + 1] : null;
const pos = args.filter((a, i) => !a.startsWith('--') && (iJs < 0 || i !== iJs + 1));
const [pagina = 'index.html', ancho = '1280', alto = '800', tema = 'claro', nombre] = pos;
const base = `http://localhost:${process.env.PUERTO || 4730}/alphateklab-reservas/`;
mkdirSync(new URL('../capturas/', import.meta.url), { recursive: true });

const nav = await chromium.launch();
try {
  const ctx = await nav.newContext({ viewport: { width: +ancho, height: +alto }, colorScheme: tema === 'oscuro' ? 'dark' : 'light', locale: 'es-PA', timezoneId: 'America/Panama' });
  const p = await ctx.newPage();
  const errores = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errores.push(`${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  p.on('requestfailed', (r) => { if (!r.url().includes('ntfy.sh')) errores.push(`falló: ${r.url()}`); });
  p.on('response', (r) => { if (r.status() >= 400) errores.push(`${r.status()}: ${r.url()}`); });
  await p.goto(base + pagina, { waitUntil: 'networkidle' }).catch(async () => { await p.waitForTimeout(1500); });
  if (js) { await p.evaluate(js); await p.waitForTimeout(400); }
  await p.waitForTimeout(300);
  const medida = await p.evaluate(() => ({ cuerpo: document.documentElement.scrollWidth, ventana: innerWidth, alto: document.documentElement.scrollHeight }));
  const archivo = new URL(`../capturas/${nombre || pagina.replace(/[^a-z0-9]+/gi, '-')}-${ancho}-${tema}.png`, import.meta.url).pathname;
  await p.screenshot({ path: archivo, fullPage: completa });
  console.log(JSON.stringify({ archivo, ...medida, desborde: medida.cuerpo > medida.ventana, errores }, null, 1));
} finally {
  await nav.close();
}
