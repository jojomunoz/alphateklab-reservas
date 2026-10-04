// Playwright para las herramientas y las pruebas de navegador, en este orden: el de la variable PW (o PLAYWRIGHT,
// PLAYWRIGHT_MJS: la ruta a su index.mjs), el instalado en este repositorio (npm install) o el de la máquina de
// Jonathan. Así las herramientas corren en cualquier equipo sin tocarlas.
import { existsSync } from 'node:fs';

const DE_JONATHAN = '/home/jonathan/alphatend-do/sitio/node_modules/playwright/index.mjs';

async function cargar() {
  const ruta = process.env.PW || process.env.PLAYWRIGHT || process.env.PLAYWRIGHT_MJS;
  if (ruta) return import(ruta);
  try {
    return await import('playwright');
  } catch {
    // sin node_modules en el repositorio: el de la máquina de Jonathan, si está
  }
  if (existsSync(DE_JONATHAN)) return import(DE_JONATHAN);
  throw new Error('Falta Playwright: en este repositorio, npm install y npx playwright install chromium (o PW=<ruta a playwright/index.mjs>).');
}

const pw = await cargar();
export const { chromium, webkit, firefox } = pw;
export default pw;
