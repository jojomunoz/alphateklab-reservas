// Recorrido completo con Playwright, con clics reales. Comprueba lo que pide la especificación («Hecho = verificado»)
// y termina con un resumen de lo que pasó y lo que falló. Requiere el servidor en el puerto 4730 (o el de la variable PUERTO):
//   python3 -m http.server 4730 -d ~/alphateklab/repos (o PUERTO=<otro>)
// Uso: node herramientas/recorrido.mjs [--sin-relevo] [--sin-capturas]
import { chromium } from '/home/jonathan/alphatend-do/sitio/node_modules/playwright/index.mjs';
// El «otro dispositivo» es un segundo proceso de Chromium, con su propio perfil y sin almacenamiento compartido.
// WebKit no arranca en esta máquina (Fedora: le faltan libicu74 y libjpeg-turbo8, que pide instalar con sudo).
import { mkdirSync, readFileSync } from 'node:fs';
import { fechaISO, sumarDias, diaSemana } from '../js/nucleo/tiempo.mjs';
import { feriado } from '../js/nucleo/feriados.mjs';

const BASE = `http://localhost:${process.env.PUERTO || 4730}/alphateklab-reservas/`;
const CAP = new URL('../capturas/', import.meta.url).pathname;
mkdirSync(CAP, { recursive: true });
const args = process.argv.slice(2);
const conRelevo = !args.includes('--sin-relevo');
const conCapturas = !args.includes('--sin-capturas');

const resultados = [];
const errores = [];
// ntfy.sh limita las conexiones por IP (429) cuando varias pruebas abren el relevo seguido. Chrome lo anota en la
// consola sin la URL; se cuenta aparte, como externo, solo si se vio de verdad una respuesta 429 de ntfy.sh.
let ntfy429 = 0;
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? 'OK ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
}
function vigilar(pagina, etiqueta) {
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(`${etiqueta}: ${m.text()}`); });
  pagina.on('pageerror', (e) => errores.push(`${etiqueta}: ${e.message}`));
  pagina.on('response', (r) => {
    if (r.url().includes('ntfy.sh') && r.status() === 429) ntfy429++;
    else if (r.status() >= 400 && !r.url().includes('ntfy.sh')) errores.push(`${etiqueta}: ${r.status()} ${r.url()}`);
  });
}
const estadoDe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('atk-reservas')));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Primer día hábil (lun-vie, sin feriado) al menos `n` días después. */
function diaHabil(desde, n) {
  let f = sumarDias(desde, n);
  while ([0, 6].includes(diaSemana(f)) || feriado(f)) f = sumarDias(f, 1);
  return f;
}

async function registrarYAgendar(p, { nombre, cedula, telefono, fecha, maxIntentos = null, nHora = 2 }) {
  await p.click('[data-nueva]');
  await p.click('.dialogo [data-registrar]');
  const reg = p.locator('dialog.dialogo').last();
  await reg.locator('[name=nombre]').fill(nombre);
  await reg.locator('[name=cedula]').fill(cedula);
  await reg.locator('[name=telefono]').fill(telefono);
  await reg.locator('[name=consentimiento]').check();
  await reg.locator('button[type=submit]').click();
  await p.waitForTimeout(200);
  const d = p.locator('dialog.dialogo').last();
  await d.locator('#nc-servicio').selectOption('control');
  await d.locator('#nc-fecha').fill(fecha);
  await d.locator('#nc-fecha').dispatchEvent('change');
  await d.locator('.horas label').nth(nHora).click();
  if (maxIntentos) await d.locator('#nc-max').selectOption(String(maxIntentos));
  const plan = await d.locator('[data-plan] li').allTextContents();
  await d.locator('button[type=submit]').click();
  await p.waitForTimeout(250);
  return plan;
}

const navegadores = [];
try {
  const nav = await chromium.launch();
  navegadores.push(nav);
  const escritorio = await nav.newContext({ viewport: { width: 1280, height: 860 }, locale: 'es-PA', timezoneId: 'America/Panama' });
  // ntfy.sh limita las conexiones por IP: cada vista de recepción abre una. Hasta la prueba del relevo (paso 6), las
  // vistas reciben un relevo callado (sin conexión real) para no gastar el cupo antes de tiempo.
  const callado = (ruta) => ruta.request().method() === 'POST'
    ? ruta.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '{}' })
    : ruta.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' }, body: 'retry: 600000\n\n' });
  if (conRelevo) await escritorio.route(/https:\/\/ntfy\.sh\//, callado);
  const p = await escritorio.newPage();
  vigilar(p, 'recepción');
  await p.goto(BASE + 'citas.html');
  await p.click('#btn-restablecer').catch(async () => { await p.click('.barra-demo__menu'); await p.click('#btn-restablecer'); });
  await Promise.all([p.waitForNavigation(), p.click('dialog [data-si]')]);
  await p.waitForSelector('.agenda');
  let estado = await estadoDe(p);
  const hoy = fechaISO(estado.reloj.ahora);
  comprobar('la agenda abre con datos de ejemplo', estado.negocios.consultorio.citas.length >= 30, `${estado.negocios.consultorio.citas.length} citas`);

  // ── 1. Crear paciente y cita → adelantar → sale el recordatorio → confirmar en el teléfono → confirmada ──
  const fechaA = diaHabil(hoy, 3);
  const planA = await registrarYAgendar(p, { nombre: 'Prueba Uno Recorrido', cedula: '8-000-9001', telefono: '6000-0901', fecha: fechaA });
  comprobar('la vista previa del plan sale antes de guardar', planA.length >= 2, planA[0]);
  estado = await estadoDe(p);
  const stA = estado.negocios.consultorio;
  const pacA = stA.pacientes.find((x) => x.cedula === '8-000-9001');
  const citaA = stA.citas.find((c) => c.pacienteId === pacA?.id);
  comprobar('paciente registrado con consentimiento trazable', pacA && pacA.consentimiento && /Ley 81/.test(pacA.consentimiento.texto), pacA ? pacA.consentimiento.canal : 'no está');
  comprobar('cita creada pendiente con recordatorios en cola', citaA && citaA.estado === 'pendiente' && stA.envios.filter((e) => e.citaId === citaA.id && e.estado === 'programado').length >= 2);

  await p.goto(BASE + 'bandeja.html');
  let enlaceA = null;
  for (let i = 0; i < 30 && !enlaceA; i++) {
    await p.click('[data-proximo]');
    await p.waitForTimeout(120);
    const e = await estadoDe(p);
    const env = e.negocios.consultorio.envios.find((x) => x.citaId === citaA.id && x.estado === 'enviado');
    if (env) enlaceA = env.enlace;
  }
  comprobar('al adelantar el reloj sale el recordatorio', !!enlaceA);
  const textoYaSalio = await p.locator('#b-env').locator('xpath=../..').textContent();
  comprobar('el mensaje aparece en «Ya salió» con su paciente', textoYaSalio.includes('Prueba Uno Recorrido'));
  estado = await estadoDe(p);
  const pendientesAntes = estado.negocios.consultorio.envios.filter((x) => x.citaId === citaA.id && x.estado === 'programado').length;
  comprobar('quedan reintentos en cola antes de responder', pendientesAntes >= 1, `${pendientesAntes} en cola`);

  // Teléfono en el mismo navegador (otra pestaña, viewport de teléfono): avisa por BroadcastChannel/localStorage.
  const tel = await escritorio.newPage();
  vigilar(tel, 'teléfono (misma sesión)');
  await tel.setViewportSize({ width: 390, height: 844 });
  await tel.goto(enlaceA);
  await tel.click('[data-r="confirmo"]');
  await tel.waitForSelector('.resultado--ok');
  await p.waitForTimeout(300);
  estado = await estadoDe(p);
  const citaA2 = estado.negocios.consultorio.citas.find((c) => c.id === citaA.id);
  const enColaA = estado.negocios.consultorio.envios.filter((x) => x.citaId === citaA.id && x.estado === 'programado').length;
  comprobar('confirmar en el teléfono → la cita queda confirmada', citaA2.estado === 'confirmada');
  comprobar('el reintento pendiente desaparece', enColaA === 0, `${pendientesAntes} → ${enColaA}`);
  const colaUI = await p.locator('#b-cola').locator('xpath=../..').textContent();
  comprobar('la bandeja ya no muestra a ese paciente en cola', !colaUI.includes('Prueba Uno Recorrido'));
  await tel.reload();
  comprobar('al volver a abrir el enlace dice que ya respondió', (await tel.textContent('.resultado__titulo')).includes('confirmada'));
  if (conCapturas) await tel.screenshot({ path: CAP + 'recorrido-confirmar-ok-390.png', fullPage: true });
  await p.goto(BASE + 'citas.html');
  await p.evaluate((f) => { document.querySelector('[data-mover="hoy"]'); }, fechaA);
  // Ir al día de la cita y ver el bloque confirmado.
  for (let i = 0; i < 10; i++) {
    const titulo = await p.textContent('.herramientas__titulo');
    if (titulo.toLowerCase().includes(String(Number(fechaA.slice(8))) + ' de')) break;
    await p.click('[data-mover="1"]');
  }
  const bloque = p.locator(`.bloque[data-cita="${citaA.id}"]`);
  comprobar('la agenda pinta la cita como confirmada', (await bloque.getAttribute('class') || '').includes('bloque--confirmada'));
  if (conCapturas) await p.screenshot({ path: CAP + 'recorrido-agenda-confirmada-1280.png' });

  // ── 2. Sin respuesta: reintentos hasta el máximo y «Llamar al paciente» ──
  const fechaB = diaHabil(fechaISO((await estadoDe(p)).reloj.ahora), 3);
  await registrarYAgendar(p, { nombre: 'Prueba Dos Recorrido', cedula: '8-000-9002', telefono: '6000-0902', fecha: fechaB, maxIntentos: 3, nHora: 4 });
  estado = await estadoDe(p);
  const pacB = estado.negocios.consultorio.pacientes.find((x) => x.cedula === '8-000-9002');
  const citaB = estado.negocios.consultorio.citas.find((c) => c.pacienteId === pacB?.id);
  comprobar('segunda cita creada', !!citaB);
  await p.goto(BASE + 'bandeja.html');
  let tarea = null;
  // De envío en envío (no de día en día): la tarea de llamar se cierra sola cuando empieza la cita, así que se mira
  // justo después de que aparece.
  for (let i = 0; i < 40 && !tarea; i++) {
    await p.click('[data-proximo]');
    await p.waitForTimeout(100);
    const e = await estadoDe(p);
    tarea = e.negocios.consultorio.tareas.find((t) => t.citaId === citaB.id && !t.hecha);
  }
  estado = await estadoDe(p);
  const enviadosB = estado.negocios.consultorio.envios.filter((x) => x.citaId === citaB.id && x.tipo === 'mensaje' && x.estado === 'enviado');
  comprobar('sin respuesta salen los reintentos hasta el máximo', enviadosB.length === 3, enviadosB.map((x) => `${x.intento}/${x.de} ${x.canal}`).join(', '));
  comprobar('el último intento sube a SMS (escalera de canal)', enviadosB.at(-1)?.canal === 'sms');
  comprobar('al agotarse queda «Llamar al paciente» en recepción', !!tarea, tarea?.motivo);
  if (conCapturas) await p.screenshot({ path: CAP + 'recorrido-bandeja-1280.png' });
  await p.goto(BASE + 'citas.html');
  const lateral = await p.textContent('#hoy-recepcion');
  comprobar('la tarea aparece en la columna «Por llamar»', lateral.includes('Prueba Dos Recorrido'));

  // ── 3. Alojamiento: caída de Booking → alerta → cierre → no se ofrece → reserva por Booking → choque ──
  // El reloj avanzó varios días en los pasos anteriores: se restablecen los datos para partir de la semilla.
  await p.goto(BASE + 'alojamiento.html');
  await p.click('#btn-restablecer');
  await Promise.all([p.waitForNavigation(), p.click('dialog [data-si]')]);
  await p.waitForSelector('[data-caida="booking"]');
  await p.click('[data-caida="booking"]');
  await p.waitForSelector('#alertas .alerta');
  const alerta = await p.textContent('#alertas .alerta__titulo');
  comprobar('alerta roja del vigilante arriba de todo', /Booking\.com no sincroniza desde hace 9 h/.test(alerta), alerta.trim());
  await p.click('[data-cierre="booking"]');
  await p.waitForSelector('.cierre-activo');
  estado = await estadoDe(p);
  const cerradas = estado.alojamiento.cierres[0]?.unidades || [];
  const huesped = await escritorio.newPage();
  vigilar(huesped, 'huésped');
  await huesped.setViewportSize({ width: 390, height: 844 });
  await huesped.goto(BASE + 'alojamiento-reservar.html');
  await huesped.selectOption('#ar-personas', '2');
  await huesped.click('[data-buscar] button[type=submit]');
  await huesped.waitForTimeout(200);
  const ofrecidas = await huesped.$$eval('[name=cabana]', (l) => l.map((x) => x.value));
  comprobar('las cabañas en cierre no se ofrecen al huésped', cerradas.length > 0 && !ofrecidas.some((x) => cerradas.includes(x)), `cerradas ${cerradas.join(',')}; ofrecidas ${ofrecidas.join(',') || 'ninguna'}`);
  if (conCapturas) await huesped.screenshot({ path: CAP + 'recorrido-huesped-cierre-390.png', fullPage: true });
  await p.click('[data-simular-ota="booking"]');
  await p.waitForSelector('.choque');
  const choque = await p.textContent('#choques');
  comprobar('aparece el choque con su propuesta de reubicación', /Propuesta:/.test(choque) && /(Mover (la|el) .+ a |contactar)/i.test(choque));
  if (conCapturas) await p.screenshot({ path: CAP + 'recorrido-alojamiento-alerta-1280.png' });
  // Aplicar la propuesta resuelve el choque.
  if (await p.locator('.propuesta [data-mover-res]').count()) {
    await p.locator('.propuesta [data-mover-res]').first().click();
    await p.waitForTimeout(250);
    comprobar('mover según la propuesta resuelve el choque', (await p.locator('.choque').count()) === 0);
  } else comprobar('sin cabaña libre, la propuesta dice que hay que contactar al huésped', /contactar al huésped/i.test(choque));

  // ── 4. Exportar un .ics y volver a importarlo: mismas fechas ──
  await p.goto(BASE + 'alojamiento.html#canales');
  const [descarga] = await Promise.all([p.waitForEvent('download'), p.click('[data-exportar="guayacan"]')]);
  const ruta = await descarga.path();
  const ics = readFileSync(ruta, 'utf8');
  const exportadas = [...ics.matchAll(/DTSTART;VALUE=DATE:(\d{8})\r\nDTEND;VALUE=DATE:(\d{8})/g)].map((m) => `${m[1]}-${m[2]}`);
  await p.fill('#ics-texto', ics);
  await p.click('[data-comprobar] button[type=submit]');
  await p.waitForSelector('[data-eventos-leidos]');
  const leidas = await p.$$eval('[data-eventos-leidos] li', (l) => l.map((x) => `${x.dataset.inicio.replace(/-/g, '')}-${x.dataset.fin.replace(/-/g, '')}`));
  comprobar('exportar e importar el .ics da las mismas fechas', exportadas.length > 0 && JSON.stringify(exportadas) === JSON.stringify(leidas), exportadas.join(' '));
  estado = await estadoDe(p);
  const otasGuayacan = estado.alojamiento.reservas.filter((r) => r.unidades.includes('guayacan') && !['directo', 'bloqueo'].includes(r.canal) && r.estado !== 'cancelada').length;
  comprobar('el .ics exportado no lleva las reservas de otros canales (sin eco)', !/airbnb|booking\.com|expedia/i.test(ics) && otasGuayacan > 0, `${otasGuayacan} de otros canales fuera`);
  comprobar('el .ics usa CRLF y líneas de 75 octetos o menos', !/[^\r]\n/.test(ics) && ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  // Leer una URL: el CORS lo impide y la demo lo dice.
  await p.locator('#canales details').nth(1).evaluate((d) => { d.open = true; });
  await p.locator('[data-import^="booking|"] [data-leer-url]').first().click();
  await p.waitForSelector('[data-import^="booking|"] .mensaje-import--error', { timeout: 15000 });
  comprobar('leer la URL de Booking explica el CORS y ofrece subir o pegar', /CORS/.test(await p.textContent('[data-import^="booking|"] .mensaje-import--error')));

  // ── 5. Teclado ──
  await p.goto(BASE + 'citas.html');
  await p.locator('[data-nueva]').focus();
  await p.keyboard.press('Enter');
  const abierto = await p.locator('dialog[open]').count();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  const foco = await p.evaluate(() => document.activeElement?.matches('[data-nueva]'));
  comprobar('el diálogo se abre con Enter, se cierra con Escape y el foco vuelve', abierto === 1 && (await p.locator('dialog[open]').count()) === 0 && foco);
  const sinContorno = [];
  await p.locator('body').focus();
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press('Tab');
    const info = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { txt: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30), visible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
    });
    if (info && !info.visible) sinContorno.push(info.txt);
  }
  comprobar('el foco se ve en los primeros 40 tabuladores de la recepción', sinContorno.length === 0, sinContorno.join(' | '));

  // ── 6. Relevo real entre dos navegadores distintos (dos procesos de Chromium, perfiles separados) ──
  if (conRelevo) {
    await escritorio.unroute(/https:\/\/ntfy\.sh\//, callado);
    const navW = await chromium.launch();
    navegadores.push(navW);
    await p.goto(BASE + 'bandeja.html');
    await p.waitForSelector('.relevo-estado[data-estado="conectado"]', { timeout: 15000 }).catch(() => {});
    const conectado = await p.getAttribute('.relevo-estado', 'data-estado');
    const pendienteConEnlace = async () => {
      estado = await estadoDe(p);
      const st = estado.negocios.consultorio;
      return st.envios.filter((e) => e.estado === 'enviado' && e.citaId && e.enlace).map((e) => ({ e, c: st.citas.find((c) => c.id === e.citaId) }))
        .find(({ c }) => c && ['pendiente', 'reprogramada'].includes(c.estado) && c.inicio > estado.reloj.ahora + 3600e3);
    };
    // Si con los datos de ejemplo todavía no salió ningún recordatorio de una cita pendiente, se adelanta el reloj.
    let env = await pendienteConEnlace();
    for (let i = 0; i < 6 && !env; i++) { await p.click('[data-proximo]'); await p.waitForTimeout(120); env = await pendienteConEnlace(); }
    if (!env) comprobar('relevo: hay una cita pendiente con enlace enviado para probar', false);
    else {
      const ctxW = await navW.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-PA' });
      const telW = await ctxW.newPage();
      vigilar(telW, 'teléfono (otro navegador)');
      const t0 = Date.now();
      await telW.goto(env.e.enlace);
      await telW.click('[data-r="confirmo"]');
      // «ok» = llegó el acuse de la recepción; «error» = no se pudo publicar. Si se publicó pero no hubo acuse (ntfy
      // limita las conexiones), queda «enviando».
      const entrega = await telW.waitForSelector('.entrega[data-estado="ok"], .entrega[data-estado="error"]', { timeout: 30000 })
        .then(() => telW.getAttribute('.entrega', 'data-estado')).catch(() => 'enviando, sin acuse');
      let llego = false;
      for (let i = 0; i < 40 && !llego; i++) {
        await esperar(250);
        const e2 = await estadoDe(p);
        llego = e2.negocios.consultorio.citas.find((c) => c.id === env.c.id)?.estado === 'confirmada';
      }
      comprobar(`relevo ntfy entre dos navegadores separados (escucha: ${conectado}, teléfono: ${entrega})`, llego, llego ? `llegó en ${((Date.now() - t0) / 1000).toFixed(1)} s` : 'no llegó');
      if (llego) comprobar('el teléfono recibe el acuse de la recepción y lo muestra', entrega === 'ok' && /quedó confirmada/.test(await telW.textContent('.resultado__titulo')), entrega);
      if (conCapturas) await telW.screenshot({ path: CAP + 'recorrido-relevo-otro-navegador-390.png', fullPage: true });
      await ctxW.close();
    }
  }
  await escritorio.close();
} catch (e) {
  comprobar('el recorrido terminó sin excepciones', false, e.message.split('\n')[0]);
} finally {
  for (const n of navegadores) await n.close();
}

// El único error esperado: el intento de leer la URL de Booking, que la especificación pide hacer para mostrar que el
// CORS lo impide. Chrome lo anota en la consola aunque la página lo capture. Se cuenta aparte.
const esperados = errores.filter((x) => /admin\.booking\.com|blocked by CORS|net::ERR_FAILED/.test(x));
const limite = ntfy429 ? errores.filter((x) => /status of 429/.test(x)) : [];
const inesperados = errores.filter((x) => !esperados.includes(x) && !limite.includes(x));
if (ntfy429) console.log(`AVISO ntfy.sh respondió 429 (límite de conexiones) ${ntfy429} veces; ${limite.length} líneas de consola por eso, contadas aparte.`);
comprobar('consola sin errores en todo el recorrido', inesperados.length === 0, `${inesperados.length} inesperados${inesperados.length ? `: ${inesperados.slice(0, 5).join(' | ')}` : ''}; ${esperados.length} esperados del intento de CORS`);
const fallan = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallan.length} de ${resultados.length} comprobaciones pasaron.`);
process.exitCode = fallan.length ? 1 : 0;
