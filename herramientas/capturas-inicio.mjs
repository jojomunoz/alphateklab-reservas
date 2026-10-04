// Capturas reales para las dos tarjetas de la portada (assets/inicio/agenda-*.webp y cabanas-*.webp): la agenda de
// recepción del día y la planilla de cabañas por canal, en tema claro, a 1280×800 y reducidas a 640 y 1280 px.
// Uso: con el servidor en marcha, PUERTO=4900 node herramientas/capturas-inicio.mjs
import { chromium } from './navegador.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = `http://localhost:${process.env.PUERTO || 4730}/alphateklab-reservas/`;
const SALIDA = new URL('../assets/inicio/', import.meta.url).pathname;
mkdirSync(SALIDA, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'atk-reservas-inicio-'));

// La primera pantalla de cada una: la agenda del día con los paneles de recepción, y la planilla por canal.
const TOMAS = [
  { nombre: 'agenda', pagina: 'citas.html' },
  { nombre: 'cabanas', pagina: 'alojamiento.html' },
];

const b = await chromium.launch();
try {
  for (const t of TOMAS) {
    const c = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'es-PA', timezoneId: 'America/Panama' });
    const p = await c.newPage();
    // «load» y una pausa: con el relevo de ntfy abierto la página nunca llega a «networkidle»
    await p.goto(BASE + t.pagina, { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    // sin la barra de la demo: la tarjeta muestra el producto
    await p.addStyleTag({ content: '.barra-demo, .avisos-breves { display: none !important; }' });
    await p.waitForTimeout(300);
    const png = join(tmp, `${t.nombre}.png`);
    await p.screenshot({ path: png, clip: { x: 0, y: 0, width: 1280, height: 800 } });
    for (const ancho of [640, 1280]) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', `scale=${ancho}:-2:flags=lanczos`, '-quality', '80', join(SALIDA, `${t.nombre}-${ancho}.webp`)]);
    }
    console.log('ok', t.nombre);
    await c.close();
  }
} finally {
  await b.close();
  rmSync(tmp, { recursive: true, force: true });
}
