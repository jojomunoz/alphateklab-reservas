// Node 22 no acepta una carpeta en `node --test pruebas/`: la resuelve como módulo y carga este index.js.
// Este archivo importa todas las pruebas de la carpeta para que el comando del brief funcione tal cual.
// (En Node 23+ también vale `node --test 'pruebas/*.test.mjs'`.)
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const archivos = readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).sort();
  for (const f of archivos) await import(pathToFileURL(join(__dirname, f)).href);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
