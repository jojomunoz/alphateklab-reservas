// Segundo recorrido con Playwright: lo que el primero no toca. Autoagenda del paciente, cambiar la cita desde el
// enlace, cancelar y que el hueco se ofrezca a la lista de espera (el primero que acepta se lo queda), reprogramar
// desde recepción con validación, vocabulario de otra plantilla, reserva de grupo con solape rechazado y reserva
// directa del huésped con ITBMS y depósito. Requiere el servidor en el puerto 4730 (o el de la variable PUERTO).
// Uso: node herramientas/recorrido-extra.mjs
import { chromium } from '/home/jonathan/alphatend-do/sitio/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { fechaISO, sumarDias, diaSemana } from '../js/nucleo/tiempo.mjs';
import { feriado } from '../js/nucleo/feriados.mjs';

const BASE = `http://localhost:${process.env.PUERTO || 4730}/alphateklab-reservas/`;
const CAP = new URL('../capturas/', import.meta.url).pathname;
mkdirSync(CAP, { recursive: true });
const resultados = [];
const errores = [];
// ntfy.sh limita las conexiones por IP (429) cuando varias pruebas abren el relevo seguido. Chrome lo anota en la
// consola sin la URL; se cuenta aparte, como externo, solo si se vio de verdad una respuesta 429 de ntfy.sh.
let ntfy429 = 0;
function comprobar(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok: !!ok, detalle });
  console.log(`${ok ? 'OK ' : 'FALLA'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
}
function vigilar(p, etiqueta) {
  p.on('console', (m) => { if (m.type() === 'error') errores.push(`${etiqueta}: ${m.text()}`); });
  p.on('pageerror', (e) => errores.push(`${etiqueta}: ${e.message}`));
  p.on('response', (r) => {
    if (r.url().includes('ntfy.sh') && r.status() === 429) ntfy429++;
    else if (r.status() >= 400 && !r.url().includes('ntfy.sh')) errores.push(`${etiqueta}: ${r.status()} ${r.url()}`);
  });
}
const estadoDe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('atk-reservas')));
async function restablecer(p, vista) {
  await p.goto(BASE + vista);
  const visible = await p.locator('#btn-restablecer').isVisible();
  if (!visible) await p.click('.barra-demo__menu');
  await p.click('#btn-restablecer');
  await Promise.all([p.waitForNavigation(), p.click('dialog [data-si]')]);
}

const nav = await chromium.launch();
try {
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 860 }, locale: 'es-PA', timezoneId: 'America/Panama', acceptDownloads: true });
  const p = await ctx.newPage();
  vigilar(p, 'recepción');
  await restablecer(p, 'citas.html');
  await p.waitForSelector('.agenda');

  // ── 1. Autoagenda del paciente → queda pendiente en recepción ──
  const tel = await ctx.newPage();
  vigilar(tel, 'paciente');
  await tel.setViewportSize({ width: 390, height: 844 });
  await tel.goto(BASE + 'reservar.html');
  await tel.locator('label.tarjeta-opcion', { hasText: 'Control' }).click();
  await tel.locator('label.tarjeta-opcion', { hasText: 'El primero disponible' }).click();
  const diaLibre = tel.locator('.dias input[type=radio]:not([disabled])').nth(2);
  const fechaPedida = await diaLibre.getAttribute('value');
  await tel.locator(`label[for="dia-${fechaPedida}"]`).click();
  await tel.locator('[data-horas] label').first().click();
  await tel.fill('#rs-nombre', 'Paciente Autoagenda Prueba');
  await tel.fill('#rs-cedula', '8-000-9101');
  await tel.fill('#rs-tel', '6000-0911');
  await tel.click('button[type=submit]');
  const sinConsentimiento = await tel.locator('[data-errores]').textContent();
  comprobar('autoagenda: sin consentimiento no se envía y dice qué falta', /consentimiento|Ley 81|autoriza/i.test(sinConsentimiento), sinConsentimiento.trim().slice(0, 90));
  await tel.check('[name=consentimiento]');
  await tel.click('button[type=submit]');
  await tel.waitForSelector('.resultado--ok');
  await tel.screenshot({ path: CAP + 'extra-autoagenda-listo-390.png', fullPage: true });
  let e = await estadoDe(p);
  let st = e.negocios.consultorio;
  const pacAuto = st.pacientes.find((x) => x.cedula === '8-000-9101');
  const citaAuto = st.citas.find((c) => c.pacienteId === pacAuto?.id);
  comprobar('autoagenda: la solicitud llega a recepción como pendiente', citaAuto?.estado === 'pendiente' && fechaISO(citaAuto.inicio) === fechaPedida, citaAuto ? `${citaAuto.estado}, ${fechaPedida}` : 'no llegó');
  comprobar('autoagenda: el consentimiento queda con canal y texto', pacAuto?.consentimiento?.canal && /Ley 81/.test(pacAuto.consentimiento.texto), pacAuto?.consentimiento?.canal);

  // ── 2. «Necesito cambiarla» desde el enlace → elige uno de 3 horarios → la agenda la mueve ──
  await p.goto(BASE + 'bandeja.html');
  const conEnlace = async () => {
    const x = await estadoDe(p);
    const s = x.negocios.consultorio;
    return s.envios.filter((v) => v.estado === 'enviado' && v.citaId && v.enlace)
      .map((v) => ({ v, c: s.citas.find((c) => c.id === v.citaId) }))
      .filter(({ c }) => c && ['pendiente', 'reprogramada'].includes(c.estado) && c.inicio > x.reloj.ahora + 26 * 3600e3);
  };
  let candidatas = await conEnlace();
  for (let i = 0; i < 6 && candidatas.length < 2; i++) { await p.click('[data-proximo]'); await p.waitForTimeout(120); candidatas = await conEnlace(); }
  comprobar('hay citas con enlace enviado para probar las respuestas', candidatas.length >= 2, `${candidatas.length}`);
  const { v: envCambio, c: citaCambio } = candidatas[0];
  await tel.goto(envCambio.enlace);
  await tel.click('[data-r="cambiar"]');
  const opciones = await tel.locator('[name="hueco"]:not([disabled])').count();
  comprobar('cambiar: el enlace trae hasta 3 horarios libres', opciones >= 1 && opciones <= 3, `${opciones} horarios`);
  const nuevoMin = +(await tel.locator('[name="hueco"]:not([disabled])').first().getAttribute('value'));
  await tel.locator('[name="hueco"]:not([disabled])').first().check();
  await tel.screenshot({ path: CAP + 'extra-cambiar-390.png', fullPage: true });
  await tel.locator('[data-form-cambio] button[type=submit]').click();
  await tel.waitForSelector('.resultado');
  const tituloCambio = await tel.textContent('.resultado__titulo');
  await p.waitForTimeout(300);
  e = await estadoDe(p);
  const movida = e.negocios.consultorio.citas.find((c) => c.id === citaCambio.id);
  comprobar('cambiar: la cita queda en el horario elegido', /Cambiamos/.test(tituloCambio) && movida.inicio === nuevoMin * 60000, `${tituloCambio.trim()}`);
  // Ya no le llegan reintentos: solo el aviso de la hora nueva (la eligió la persona).
  const viejosEnCola = e.negocios.consultorio.envios.filter((v) => v.citaId === citaCambio.id && v.estado === 'programado' && v.clase !== 'aviso');
  comprobar('cambiar: queda confirmada y no le siguen llegando reintentos', movida.estado === 'confirmada' && viejosEnCola.length === 0, `${movida.estado}, ${viejosEnCola.length} en cola`);

  // ── 3. «No podré ir» → el hueco se ofrece a la lista de espera → el primero que acepta se lo queda ──
  // Se pone en la lista a dos pacientes para el servicio de la cita que se va a cancelar (desde la interfaz).
  const { c: citaCancela, v: envCancela } = candidatas[1];
  e = await estadoDe(p);
  st = e.negocios.consultorio;
  const otros = st.pacientes.filter((x) => x.id !== citaCancela.pacienteId && x.consentimiento && !x.consentimiento.revocado).slice(0, 2);
  await p.goto(BASE + 'citas.html#espera');
  for (const o of otros) {
    await p.locator('[data-agregar-espera]').first().click();
    const d = p.locator('dialog[open]').last();
    await d.locator('#ae-persona').selectOption(o.id);
    await d.locator('#ae-serv').selectOption(citaCancela.servicioId);
    await d.locator('button[type=submit]').click();
    await p.waitForTimeout(200);
  }
  e = await estadoDe(p);
  const enEspera = e.negocios.consultorio.espera.filter((x) => x.estado === 'esperando' && x.servicioId === citaCancela.servicioId && otros.some((o) => o.id === x.pacienteId));
  comprobar('lista de espera: dos pacientes agregados desde recepción', enEspera.length === 2, `${enEspera.length}`);
  await tel.goto(envCancela.enlace);
  await tel.click('[data-r="cancelar"]');
  await tel.click('[data-confirmar-cancelar]');
  await tel.waitForSelector('.resultado--cancelada');
  await p.waitForTimeout(300);
  e = await estadoDe(p);
  const oferta = e.negocios.consultorio.ofertas.at(-1);
  comprobar('cancelar: la cita queda cancelada y el hueco se ofrece', e.negocios.consultorio.citas.find((c) => c.id === citaCancela.id).estado === 'cancelada' && oferta && oferta.hueco.inicio === citaCancela.inicio, oferta ? `oferta ${oferta.id}` : 'sin oferta');
  await p.goto(BASE + 'bandeja.html');
  let avisos = [];
  for (let i = 0; i < 6; i++) {
    const x = await estadoDe(p);
    avisos = x.negocios.consultorio.envios.filter((v) => v.ofertaId === oferta.id && v.estado === 'enviado');
    if (avisos.length >= 2) break;
    await p.click('[data-proximo]');
    await p.waitForTimeout(150);
  }
  comprobar('lista de espera: el aviso sale a los dos', avisos.length >= 2, `${avisos.length} avisos`);
  if (avisos.length >= 2) {
    await tel.goto(avisos[0].enlace);
    await tel.click('[data-oferta="si"]');
    await tel.waitForSelector('.resultado');
    const t1 = await tel.textContent('.resultado__titulo');
    const otroTel = await ctx.newPage();
    vigilar(otroTel, 'segundo de la lista');
    await otroTel.setViewportSize({ width: 390, height: 844 });
    await otroTel.goto(avisos[1].enlace);
    const ya = (await otroTel.locator('[data-oferta="si"]').count()) ? (await otroTel.click('[data-oferta="si"]'), await otroTel.waitForSelector('.resultado'), await otroTel.textContent('.resultado__titulo')) : await otroTel.textContent('.resultado__titulo');
    await otroTel.screenshot({ path: CAP + 'extra-espera-tomada-390.png', fullPage: true });
    await p.waitForTimeout(300);
    e = await estadoDe(p);
    const nuevas = e.negocios.consultorio.citas.filter((c) => c.inicio === citaCancela.inicio && c.estado !== 'cancelada' && c.historial?.[0]?.texto?.includes('lista de espera'));
    comprobar('lista de espera: el primero que acepta se lo queda (una sola cita nueva)', nuevas.length === 1 && nuevas[0].pacienteId === avisos[0].pacienteId, t1.trim());
    comprobar('lista de espera: al segundo le dice que ya lo tomó otra persona', /tom|ocup/i.test(ya), ya.trim());
    await otroTel.close();
  }

  // ── 4. Reprogramar desde recepción: solo horas válidas ──
  await p.goto(BASE + 'citas.html');
  e = await estadoDe(p);
  st = e.negocios.consultorio;
  const aMover = st.citas.find((c) => c.estado === 'pendiente' && c.inicio > e.reloj.ahora + 48 * 3600e3);
  const mueveAntes = aMover.inicio;
  let fechaMover = sumarDias(fechaISO(aMover.inicio), 1);
  while ([0, 6].includes(diaSemana(fechaMover)) || feriado(fechaMover)) fechaMover = sumarDias(fechaMover, 1);
  await p.evaluate((id) => document.dispatchEvent(new CustomEvent('noop', { detail: id })), aMover.id);
  // Abrir la cita desde la agenda (se busca su bloque en la semana correspondiente).
  await p.click('[data-modo="semana"]').catch(() => {});
  for (let i = 0; i < 4 && !(await p.locator(`[data-cita="${aMover.id}"]`).count()); i++) await p.click('[data-mover="1"]');
  await p.locator(`[data-cita="${aMover.id}"]`).first().click();
  const det = p.locator('dialog[open]').last();
  await det.locator('[data-accion="reprogramar"]').click();
  const rd = p.locator('dialog[open]').last();
  await rd.locator('#rp-fecha').fill(fechaMover);
  await rd.locator('#rp-fecha').dispatchEvent('change');
  await p.waitForTimeout(150);
  const horasValidas = await rd.locator('.horas input').count();
  // Sábado medio día y domingo cerrado: el selector de horas lo refleja.
  await rd.locator('.horas label').first().click();
  await rd.locator('button[type=submit]').click();
  await p.waitForTimeout(250);
  e = await estadoDe(p);
  const movida2 = e.negocios.consultorio.citas.find((c) => c.id === aMover.id);
  comprobar('reprogramar en recepción: la cita cambia de día con una hora libre', fechaISO(movida2.inicio) === fechaMover && movida2.inicio !== mueveAntes && horasValidas > 0, `${horasValidas} horas válidas ese día; estado ${movida2.estado}`);
  const solapes = e.negocios.consultorio.citas.filter((c) => c.id !== movida2.id && !['cancelada', 'reprogramada_vieja'].includes(c.estado) && c.estado !== 'cancelada' && c.inicio < movida2.fin && movida2.inicio < c.fin && (c.profesionalId === movida2.profesionalId || c.salaId === movida2.salaId));
  comprobar('reprogramar: no queda encimada con otra del mismo profesional ni consultorio', solapes.length === 0, `${solapes.length} solapes`);

  // ── 5. Otra plantilla: mismo motor, otro vocabulario ──
  await p.goto(BASE + 'citas.html');
  const sel = p.locator('#sel-plantilla');
  if (!(await sel.isVisible())) await p.click('.barra-demo__menu');
  await sel.selectOption('barberia');
  await p.waitForTimeout(300);
  const textoBarberia = (await p.textContent('#marca')) + (await p.textContent('main'));
  const marca = await p.textContent('#marca');
  comprobar('plantilla barbería: cambia la marca y el vocabulario, no la estructura', /Barber/i.test(marca) && /Clientes/.test(textoBarberia) && /Por silla/.test(textoBarberia) && (await p.locator('.agenda').count()) === 1, marca.trim().slice(0, 60));
  await p.screenshot({ path: CAP + 'extra-plantilla-barberia-1280.png' });
  // Ningún texto del consultorio se cuela en la barbería: ni en la recepción, ni en la bandeja, ni en el enlace del cliente.
  const fuga = /paciente|consultorio|clínica/i;
  const textos = [];
  for (const pestana of ['agenda', 'pacientes', 'espera', 'riesgo']) {
    await p.goto(BASE + `citas.html#${pestana}`);
    await p.waitForTimeout(250);
    textos.push([`citas #${pestana}`, (await p.textContent('#marca')) + (await p.textContent('main'))]);
  }
  await p.goto(BASE + 'bandeja.html');
  await p.waitForTimeout(250);
  textos.push(['bandeja', await p.textContent('main')]);
  const eb = await estadoDe(p);
  const enlaceBarberia = eb.negocios.barberia.envios.find((v) => v.estado === 'enviado' && v.enlace)?.enlace;
  if (enlaceBarberia) {
    await tel.goto(enlaceBarberia);
    await tel.waitForSelector('.tarjeta-cita');
    textos.push(['enlace del cliente', await tel.textContent('main')]);
    await tel.goto(BASE + 'confirmar.html#' + 'x'.repeat(30));
    await tel.waitForSelector('.error-enlace');
    textos.push(['enlace roto', await tel.textContent('main')]);
  }
  const con = textos.filter(([, t]) => fuga.test(t)).map(([d, t]) => `${d}: «${t.match(new RegExp(`.{0,40}${fuga.source}.{0,20}`, 'i'))[0].trim()}»`);
  comprobar('plantilla barbería: ningún texto dice paciente, consultorio ni clínica', con.length === 0, con.slice(0, 3).join(' | '));
  await p.goto(BASE + 'citas.html');
  await sel.selectOption('consultorio').catch(async () => { await p.click('.barra-demo__menu'); await sel.selectOption('consultorio'); });

  // ── 6. Alojamiento: reserva de grupo (3 cabañas) y solape rechazado ──
  await restablecer(p, 'alojamiento.html');
  await p.waitForSelector('.tape, .calendario-cabanas, [data-nueva-reserva], button:has-text("Nueva reserva")');
  e = await estadoDe(p);
  const hoyA = fechaISO(e.reloj.ahora);
  await p.locator('button:has-text("Nueva reserva o bloqueo")').first().click();
  const rdlg = p.locator('dialog[open]').last();
  const llegada = sumarDias(hoyA, 40), salida = sumarDias(hoyA, 43);
  const fechas = rdlg.locator('input[type=date]');
  await fechas.nth(0).fill(llegada);
  await fechas.nth(0).dispatchEvent('change');
  await fechas.nth(1).fill(salida);
  await fechas.nth(1).dispatchEvent('change');
  await p.waitForTimeout(150);
  const casillas = rdlg.locator('input[type=checkbox][name="unidad"], input[type=checkbox][name="cabana"], input[type=checkbox][name="unidades"]');
  const nCas = await casillas.count();
  for (let i = 0; i < Math.min(3, nCas); i++) await casillas.nth(i).check();
  const nombreH = rdlg.locator('input[name="nombre"], input[name="huesped"]').first();
  if (await nombreH.count()) await nombreH.fill('Grupo de prueba del recorrido');
  const cons = rdlg.locator('input[name="consentimiento"]');
  if (await cons.count()) await cons.check();
  await p.screenshot({ path: CAP + 'extra-grupo-dialogo-1280.png' });
  await rdlg.locator('button[type=submit]').click();
  await p.waitForTimeout(300);
  e = await estadoDe(p);
  const grupo = e.alojamiento.reservas.find((r) => r.llegada === llegada && r.salida === salida && r.unidades.length === 3);
  comprobar('alojamiento: una reserva de grupo con 3 cabañas', !!grupo, grupo ? grupo.unidades.join(', ') : `${nCas} casillas`);
  // La misma cabaña, una noche encimada: rechazada. Salida el día X permite llegada el día X.
  await p.locator('button:has-text("Nueva reserva o bloqueo")').first().click();
  const r2 = p.locator('dialog[open]').last();
  await r2.locator('input[type=date]').nth(0).fill(sumarDias(llegada, 2));
  await r2.locator('input[type=date]').nth(0).dispatchEvent('change');
  await r2.locator('input[type=date]').nth(1).fill(sumarDias(salida, 2));
  await r2.locator('input[type=date]').nth(1).dispatchEvent('change');
  await p.waitForTimeout(150);
  const cas2 = r2.locator(`input[type=checkbox][value="${grupo?.unidades[0]}"]`);
  const deshabilitada = await cas2.isDisabled().catch(() => false);
  if (!deshabilitada) {
    await cas2.check();
    const n2 = r2.locator('input[name="nombre"], input[name="huesped"]').first();
    if (await n2.count()) await n2.fill('Otra persona');
    const c2 = r2.locator('input[name="consentimiento"]');
    if (await c2.count()) await c2.check();
    await r2.locator('button[type=submit]').click();
    await p.waitForTimeout(200);
  }
  const errTxt = deshabilitada ? 'la cabaña ocupada no se puede marcar' : (await r2.locator('[data-errores], .resumen-errores').first().textContent().catch(() => '')).trim();
  e = await estadoDe(p);
  const encimada = e.alojamiento.reservas.filter((r) => r.unidades.includes(grupo?.unidades[0]) && r.llegada < sumarDias(salida, 2) && sumarDias(llegada, 2) < r.salida && r.estado !== 'cancelada').length;
  comprobar('alojamiento: una noche encimada en la misma cabaña se rechaza', encimada === 1, errTxt.slice(0, 100));
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');

  // ── 7. Huésped: fechas → cabañas → total con ITBMS 10 % → datos → depósito por verificar ──
  const h = await ctx.newPage();
  vigilar(h, 'huésped');
  await h.setViewportSize({ width: 390, height: 844 });
  await h.goto(BASE + 'alojamiento-reservar.html');
  const lleg = sumarDias(hoyA, 20), sal = sumarDias(hoyA, 22);
  await h.fill('#ar-llegada', lleg);
  await h.fill('#ar-salida', sal);
  await h.selectOption('#ar-personas', '2');
  await h.click('[data-buscar] button[type=submit]');
  await h.waitForSelector('[name=cabana]');
  await h.locator('[name=cabana]').first().check();
  await h.waitForTimeout(150);
  const resumen = await h.textContent('[data-resultados]');
  const montos = [...resumen.matchAll(/B\/\.([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const tieneItbms = /ITBMS[^\n]*10\s?%/.test(resumen);
  comprobar('huésped: el total muestra el ITBMS de hospedaje al 10 %', tieneItbms, montos.slice(-3).join(' · '));
  await h.screenshot({ path: CAP + 'extra-huesped-total-390.png', fullPage: true });
  await h.click('[data-continuar]');
  await h.fill('#ad-nombre', 'Huésped de Prueba');
  await h.fill('#ad-tel', '6000-0933');
  await h.check('[data-datos] [name=consentimiento]');
  await h.click('[data-datos] button[type=submit]');
  await h.waitForSelector('[data-pague]');
  await h.screenshot({ path: CAP + 'extra-huesped-yappy-390.png', fullPage: true });
  await h.click('[data-pague]');
  await h.waitForTimeout(300);
  e = await estadoDe(p);
  const directa = e.alojamiento.reservas.find((r) => r.llegada === lleg && r.salida === sal && r.canal === 'directo' && r.huesped?.nombre === 'Huésped de Prueba');
  comprobar('huésped: la reserva directa entra con el depósito «por verificar»', directa && directa.sena && directa.sena.estado !== 'verificada', directa ? JSON.stringify(directa.sena) : 'no entró');
  await h.screenshot({ path: CAP + 'extra-huesped-listo-390.png', fullPage: true });
  await ctx.close();
} catch (err) {
  comprobar('el recorrido terminó sin excepciones', false, err.message.split('\n')[0]);
} finally {
  await nav.close();
}
const limite = ntfy429 ? errores.filter((x) => /status of 429/.test(x)) : [];
const propios = errores.filter((x) => !limite.includes(x));
if (ntfy429) console.log(`AVISO ntfy.sh respondió 429 (límite de conexiones) ${ntfy429} veces; ${limite.length} líneas de consola por eso, contadas aparte.`);
comprobar('consola sin errores propios en todo el recorrido', propios.length === 0, propios.slice(0, 4).join(' | '));
const fallan = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallan.length} de ${resultados.length} comprobaciones pasaron.`);
process.exitCode = fallan.length ? 1 : 0;
