// El ida y vuelta del relevo entre dos navegadores, con un ntfy.sh simulado en memoria (determinista: no depende del
// servidor público ni de su límite de conexiones). El «teléfono» y la «recepción» son dos contextos de Chromium sin
// almacenamiento compartido. Comprueba que el teléfono no da nada por hecho hasta que la recepción contesta (acuse) y
// que muestra el resultado real: confirmada, horario ocupado, solicitud rechazada por una hora que ya pasó.
// Requiere el servidor: python3 -m http.server 4730 -d ~/alphateklab/repos
// Uso: node herramientas/relevo-simulado.mjs
import { chromium } from '/home/jonathan/alphatend-do/sitio/node_modules/playwright/index.mjs';

const BASE = `http://localhost:${process.env.PUERTO || 4730}/alphateklab-reservas/`;
const resultados = [];
const errores = [];
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok });
  console.log(`${ok ? 'OK ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
}

// ── ntfy en memoria: POST guarda, /sse devuelve lo posterior a `since` y pide reconectar en 300 ms ──
const temas = new Map();
let secuencia = 0;
async function ntfyFalso(ctx) {
  await ctx.route(/https:\/\/ntfy\.sh\//, async (ruta) => {
    const req = ruta.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*' };
    const partes = url.pathname.split('/').filter(Boolean);
    const tema = partes[0];
    if (!temas.has(tema)) temas.set(tema, []);
    const lista = temas.get(tema);
    if (req.method() === 'POST') {
      const m = { id: `m${String(++secuencia).padStart(8, '0')}`, time: Math.floor(Date.now() / 1000), event: 'message', topic: tema, message: req.postData() };
      lista.push(m);
      return ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(m) });
    }
    if (partes[1] === 'sse') {
      const desde = url.searchParams.get('since');
      const i = /^m\d+$/.test(desde || '') ? lista.findIndex((m) => m.id === desde) + 1 : 0;
      const cuerpo = 'retry: 300\n\n' + lista.slice(i).map((m) => `data: ${JSON.stringify(m)}\n\n`).join('');
      return ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: cuerpo });
    }
    return ruta.fulfill({ status: 404, headers: cors, body: '' });
  });
}
function vigilar(p, etiqueta) {
  p.on('pageerror', (e) => errores.push(`${etiqueta}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|EventSource/.test(m.text())) errores.push(`${etiqueta}: ${m.text()}`); });
}
const estadoDe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('atk-reservas')));

const nav = await chromium.launch();
try {
  const recepcion = await nav.newContext({ viewport: { width: 1280, height: 860 }, locale: 'es-PA', timezoneId: 'America/Panama' });
  const telefono = await nav.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-PA', timezoneId: 'America/Panama' });
  await ntfyFalso(recepcion);
  await ntfyFalso(telefono);
  const r = await recepcion.newPage();
  vigilar(r, 'recepción');
  await r.goto(BASE + 'bandeja.html');
  await r.waitForSelector('#reloj .reloj__hora');
  // Que salgan recordatorios con enlace para tener citas pendientes a las que responder.
  for (let i = 0; i < 3; i++) { await r.click('[data-proximo]'); await r.waitForTimeout(100); }
  let e = await estadoDe(r);
  const st = e.negocios.consultorio;
  const conEnlace = st.envios.filter((x) => x.estado === 'enviado' && x.enlace && x.citaId)
    .map((x) => ({ x, c: st.citas.find((c) => c.id === x.citaId) }))
    .filter(({ c }) => c && ['pendiente', 'reprogramada'].includes(c.estado) && c.inicio > e.reloj.ahora + 26 * 3600e3)
    .filter(({ c }, i, todos) => todos.findIndex((y) => y.c.id === c.id) === i); // una por cita
  comprobar('hay citas pendientes con enlace enviado', conEnlace.length >= 2, `${conEnlace.length}`);

  // ── 1. Confirmar desde el teléfono: primero «enviamos», después «confirmada» con el acuse ──
  const t = await telefono.newPage();
  vigilar(t, 'teléfono');
  await t.goto(conEnlace[0].x.enlace);
  await t.click('[data-r="confirmo"]');
  await t.waitForSelector('.resultado__titulo');
  const antes = await t.textContent('.resultado__titulo');
  comprobar('sin acuse, el teléfono dice que envió, no que quedó confirmada', /Enviamos tu confirmación/.test(antes), antes.trim());
  await t.waitForSelector('.resultado--ok', { timeout: 15000 });
  const despues = await t.textContent('.resultado');
  comprobar('con el acuse de la recepción, dice que quedó confirmada', /Tu cita quedó confirmada/.test(despues) && /La recepción lo recibió/.test(despues), despues.replace(/\s+/g, ' ').trim().slice(0, 90));
  e = await estadoDe(r);
  comprobar('la agenda de la recepción la tiene confirmada', e.negocios.consultorio.citas.find((c) => c.id === conEnlace[0].c.id).estado === 'confirmada');
  await t.reload();
  await t.waitForSelector('.resultado__titulo');
  comprobar('al recargar, el teléfono recuerda el resultado real', /quedó confirmada/.test(await t.textContent('.resultado__titulo')));

  // ── 2. Cambiar a un horario que la recepción ya dio a otra persona: «Ese horario se ocupó» ──
  const objetivo = conEnlace[1];
  await t.goto('about:blank');
  await t.goto(objetivo.x.enlace);
  await t.click('[data-r="cambiar"]');
  const hueco = +(await t.locator('[name="hueco"]:not([disabled])').first().getAttribute('value'));
  // En la recepción, otra persona toma ese horario con el mismo profesional (por el núcleo, en su almacenamiento).
  await r.evaluate(async ({ hueco, prof, servicio, pacienteDeLaCita }) => {
    const { crearCita } = await import('./js/nucleo/operaciones.mjs');
    const { NEGOCIOS_CITAS } = await import('./js/nucleo/negocios.mjs');
    const e = JSON.parse(localStorage.getItem('atk-reservas'));
    const st = e.negocios.consultorio;
    const otro = st.pacientes.find((p) => p.id !== pacienteDeLaCita && !st.citas.some((c) => c.pacienteId === p.id && Math.abs(c.inicio - hueco * 60000) < 3 * 3600e3));
    const res = crearCita(st, NEGOCIOS_CITAS.consultorio, { pacienteId: otro.id, servicioId: servicio, profesionalId: prof, salaId: null, inicio: hueco * 60000 }, e.reloj.ahora);
    // Si ya estaba ocupado (los horarios del enlace son de cuando se envió), el caso es el mismo.
    if (!res.ok && !res.errores.some((x) => x.codigo.startsWith('solape'))) throw new Error(JSON.stringify(res.errores));
    if (res.ok) localStorage.setItem('atk-reservas', JSON.stringify(e));
  }, { hueco, prof: objetivo.c.profesionalId, servicio: objetivo.c.servicioId, pacienteDeLaCita: objetivo.c.pacienteId });
  await r.reload();
  await r.waitForSelector('#reloj .reloj__hora');
  await t.locator(`[name="hueco"][value="${hueco}"]`).check();
  await t.click('[data-form-cambio] button[type=submit]');
  await t.waitForSelector('.resultado__titulo');
  const pedido = await t.textContent('.resultado__titulo');
  comprobar('al pedir el cambio, el teléfono dice que lo pidió (no «Cambiamos tu cita»)', /Pediste cambiarla/.test(pedido), pedido.trim());
  await t.waitForFunction(() => /se ocupó/.test(document.querySelector('.resultado__titulo')?.textContent || ''), null, { timeout: 15000 })
    .catch(async (err) => { console.log('teléfono:', (await t.textContent('main')).replace(/\s+/g, ' ').slice(0, 400)); console.log('recepción:', JSON.stringify((await estadoDe(r)).negocios.consultorio.bitacora.slice(0, 3))); console.log('relevo:', JSON.stringify([...temas.values()].flat().slice(-3).map((m) => m.message))); throw err; });
  comprobar('con el acuse, dice que ese horario se ocupó y que la cita sigue como estaba', /sigue como estaba/.test(await t.textContent('.resultado')));
  e = await estadoDe(r);
  comprobar('en la recepción la cita no se movió y queda para llamar', e.negocios.consultorio.citas.find((c) => c.id === objetivo.c.id).inicio === objetivo.c.inicio && e.negocios.consultorio.tareas.some((x) => x.citaId === objetivo.c.id && !x.hecha));

  // ── 3. Pedir cita desde otro teléfono con otro reloj: la hora ya pasó en la recepción ──
  await r.click('[data-avanzar="86400000"]');
  await r.waitForTimeout(150);
  const sala = (await estadoDe(r)).sala;
  await t.goto(BASE + `reservar.html#s=${sala}`);
  await t.locator('label.tarjeta-opcion').first().click();
  await t.locator('.dia input:not([disabled]) + label').first().click();
  await t.locator('[data-horas] label').first().click();
  await t.fill('#rs-nombre', 'Remota Prueba');
  await t.fill('#rs-cedula', '8-000-5555');
  await t.fill('#rs-tel', '6000-0555');
  await t.check('[name=consentimiento]');
  const pacientesAntes = (await estadoDe(t)).negocios.consultorio.pacientes.length;
  await t.click('[data-form] button[type=submit]');
  await t.waitForSelector('.resultado__titulo');
  comprobar('la solicitud remota se muestra como enviada, sin darla por hecha', /Enviamos tu solicitud|Enviando/.test(await t.textContent('.resultado__titulo')));
  comprobar('el teléfono no guarda la cita en su propia copia de la demo', (await estadoDe(t)).negocios.consultorio.pacientes.length === pacientesAntes);
  await t.waitForFunction(() => /no pudo agendarla/.test(document.querySelector('.resultado__titulo')?.textContent || ''), null, { timeout: 15000 });
  const motivo = await t.textContent('.resultado');
  comprobar('con el acuse, dice que no se pudo y por qué (la hora ya pasó en la recepción)', /ya pasó/.test(motivo), motivo.replace(/\s+/g, ' ').trim().slice(0, 120));
  e = await estadoDe(r);
  comprobar('en la recepción no quedó registrada la persona ni la bitácora dice que se registró', !e.negocios.consultorio.pacientes.some((p) => p.nombre === 'Remota Prueba') && !JSON.stringify(e.negocios.consultorio.bitacora).includes('Remota Prueba'));
  await t.click('[data-otra-hora]');
  comprobar('«Elegir otra hora» vuelve al formulario con los datos escritos', (await t.inputValue('#rs-nombre')) === 'Remota Prueba');
  await recepcion.close();
  await telefono.close();
} catch (err) {
  comprobar('el recorrido terminó sin excepciones', false, err.message.split('\n')[0]);
} finally {
  await nav.close();
}
comprobar('consola sin errores', errores.length === 0, errores.slice(0, 3).join(' | '));
const fallan = resultados.filter((x) => !x.ok);
console.log(`\n${resultados.length - fallan.length} de ${resultados.length} comprobaciones pasaron.`);
process.exitCode = fallan.length ? 1 : 0;
