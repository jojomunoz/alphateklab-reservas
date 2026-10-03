// Motor de reservas directo del alojamiento: fechas y personas → cabañas disponibles (respeta el cierre preventivo)
// → total con ITBMS de hospedaje → datos → depósito por Yappy (simulada y rotulada).

import { esc, icono, $, mostrarErrores } from './ui.mjs';
import { cargar, transaccion, alCambiar } from './almacen.mjs';
import { iniciarBarra } from './demo.mjs';
import { NEGOCIO_ALOJAMIENTO as negocio } from '../nucleo/negocios.mjs';
import { fechaISO, fechaLarga, sumarDias, diferenciaDias, esISO } from '../nucleo/tiempo.mjs';
import { disponiblesParaVenta, cierreVigente, cotizar, minimoNoches, temporadaDe, rangoTexto, crearReserva, cabanaDe } from '../nucleo/alojamiento.mjs';
import { balboas } from '../nucleo/mensajes.mjs';
import { normalizarTelefono, validarCorreo, mostrarTelefono } from '../nucleo/contacto.mjs';

const main = $('#principal');
const busqueda = { llegada: null, salida: null, personas: 2, elegidas: [] };
let paso = 'buscar';

const datos = () => { const e = cargar(); return { aloj: e.alojamiento, ahora: e.reloj.ahora, hoy: fechaISO(e.reloj.ahora) }; };

function pintarMarca() {
  $('#marca').innerHTML = `<div class="marca__dentro"><div class="marca__logo"><span class="marca__nombre">${esc(negocio.nombre)}</span><span class="marca__rotulo">${esc(negocio.rotulo)} · ${esc(negocio.lugar)}</span></div></div>`;
}

function htmlBuscar() {
  const { hoy } = datos();
  if (!busqueda.llegada) { busqueda.llegada = sumarDias(hoy, 7); busqueda.salida = sumarDias(busqueda.llegada, minimoNoches(negocio, busqueda.llegada)); }
  return `<h1>Reserva tu cabaña</h1>
    <p class="paciente__intro">${negocio.cabanas.length} cabañas en las tierras altas de Chiriquí, de 2 a 6 personas. Mínimo ${negocio.temporadas.baja.minNoches} noches (${negocio.temporadas.alta.minNoches} en temporada alta, de diciembre a abril).</p>
    <form class="buscar-fechas" data-buscar novalidate>
      <div class="resumen-errores" data-errores tabindex="-1" hidden style="grid-column:1/-1"></div>
      <div class="campo"><label for="ar-llegada">Llegada</label><input id="ar-llegada" type="date" name="llegada" min="${hoy}" value="${busqueda.llegada}"></div>
      <div class="campo"><label for="ar-salida">Salida</label><input id="ar-salida" type="date" name="salida" min="${sumarDias(hoy, 1)}" value="${busqueda.salida}"></div>
      <div class="campo" style="grid-column:1/-1"><label for="ar-personas">Personas</label><select id="ar-personas" name="personas">${Array.from({ length: 24 }, (_, i) => i + 1).map((n) => `<option value="${n}"${n === busqueda.personas ? ' selected' : ''}>${n} ${n === 1 ? 'persona' : 'personas'}</option>`).join('')}</select></div>
      <button type="submit" class="boton boton--primario boton--grande">Ver cabañas disponibles</button>
    </form>
    <div data-resultados aria-live="polite"></div>`;
}

function validarBusqueda() {
  const { hoy } = datos();
  const e = [];
  if (!esISO(busqueda.llegada)) e.push({ campo: 'llegada', mensaje: 'Elige la fecha de llegada.' });
  else if (busqueda.llegada < hoy) e.push({ campo: 'llegada', mensaje: 'La llegada no puede ser antes de hoy.' });
  if (!esISO(busqueda.salida)) e.push({ campo: 'salida', mensaje: 'Elige la fecha de salida.' });
  else if (esISO(busqueda.llegada) && busqueda.salida <= busqueda.llegada) e.push({ campo: 'salida', mensaje: 'La salida tiene que ser al menos un día después de la llegada.' });
  if (!e.length) {
    const n = diferenciaDias(busqueda.llegada, busqueda.salida), min = minimoNoches(negocio, busqueda.llegada);
    if (n < min) e.push({ campo: 'salida', mensaje: `Llegando el ${fechaLarga(busqueda.llegada)} (temporada ${temporadaDe(negocio, busqueda.llegada)}) el mínimo es de ${min} noches; elegiste ${n}.` });
  }
  return e;
}

function htmlResultados() {
  const { aloj } = datos();
  const v = disponiblesParaVenta(negocio, aloj.reservas, cierreVigente(aloj), busqueda.llegada, busqueda.salida);
  const noches = diferenciaDias(busqueda.llegada, busqueda.salida);
  const capElegida = busqueda.elegidas.reduce((s, id) => s + cabanaDe(negocio, id).capacidad, 0);
  const capTotal = v.disponibles.reduce((s, c) => s + c.capacidad, 0);
  let html = `<h2 style="margin-top:24px;font-size:1.25rem">Del ${esc(rangoTexto(busqueda.llegada, busqueda.salida))} · ${noches} ${noches === 1 ? 'noche' : 'noches'}</h2>`;
  if (!v.disponibles.length) {
    html += `<div class="vacio"><strong>No quedan cabañas libres esas noches.</strong>Prueba otras fechas o escríbenos por WhatsApp al ${esc(mostrarTelefono(negocio.telefono))} (de ejemplo).</div>`;
  } else if (capTotal < busqueda.personas) {
    html += `<div class="vacio"><strong>Para ${busqueda.personas} personas no alcanzan las cabañas libres esas noches (caben ${capTotal}).</strong>Prueba otras fechas o escríbenos.</div>`;
  } else {
    html += `<p class="campo__ayuda" style="margin:6px 0 10px">${busqueda.personas > Math.max(...v.disponibles.map((c) => c.capacidad)) ? `Son ${busqueda.personas} personas: elige varias cabañas hasta sumar la capacidad. Quedan en una sola reserva.` : 'Elige una cabaña (o varias, si vienen en grupo).'}</p>
      <div class="lista-opciones">${v.disponibles.map((c) => {
        const cot = cotizar(negocio, [c.id], busqueda.llegada, busqueda.salida);
        return `<label class="cabana-opcion"><input type="checkbox" name="cabana" value="${c.id}"${busqueda.elegidas.includes(c.id) ? ' checked' : ''}><span><strong>${esc(c.nombre)}</strong><small>Hasta ${c.capacidad} personas</small></span><span class="cabana-opcion__precio">${balboas(cot.subtotal)}<small><br>${noches} ${noches === 1 ? 'noche' : 'noches'}, sin ITBMS</small></span></label>`;
      }).join('')}</div>
      <p class="campo__ayuda" style="margin-top:8px" aria-live="polite">Capacidad elegida: <strong>${capElegida}</strong> ${capElegida === 1 ? 'lugar' : 'lugares'} para ${busqueda.personas} ${busqueda.personas === 1 ? 'persona' : 'personas'}${capElegida < busqueda.personas ? `: faltan ${busqueda.personas - capElegida}` : ''}.</p>`;
    if (v.enCierre.length) html += `<p class="nota" style="margin-top:10px">${v.enCierre.length === 1 ? 'Una cabaña no se puede' : `${v.enCierre.length} cabañas no se pueden`} reservar en línea en este momento. Para esas, escríbenos por WhatsApp.</p>`;
    if (busqueda.elegidas.length && capElegida >= busqueda.personas) html += htmlTotal();
  }
  return html;
}

function htmlTotal() {
  const c = cotizar(negocio, busqueda.elegidas, busqueda.llegada, busqueda.salida);
  return `<div class="panel panel__cuerpo" style="margin-top:16px">
    <h2 style="font-size:1.125rem;margin-bottom:8px">Total</h2>
    <table class="desglose"><tbody>
      ${c.lineas.map((l) => Object.entries(l.porTemporada).map(([t, x]) => `<tr><td>${esc(l.nombre)} · ${x.noches} ${x.noches === 1 ? 'noche' : 'noches'} × ${balboas(x.tarifa)} (temporada ${t})</td><td>${balboas(x.subtotal)}</td></tr>`).join('')).join('')}
      <tr><td>ITBMS de hospedaje, 10 % (<a href="https://dgi.mef.gob.pa/itbms/Generalidades" rel="noopener">DGI</a>)</td><td>${balboas(c.impuesto)}</td></tr>
      <tr class="total"><td>Total</td><td>${balboas(c.total)}</td></tr>
      <tr class="sena"><td>Depósito para apartar (${Math.round(negocio.sena * 100)} %)</td><td>${balboas(c.sena)}</td></tr>
    </tbody></table>
    <p class="campo__ayuda" style="margin-top:6px">El resto (${balboas(c.total - c.sena)}) se paga al llegar. Precios y depósito de ejemplo.</p>
    <button type="button" class="boton boton--primario boton--grande" style="margin-top:12px" data-continuar>Continuar con mis datos</button>
  </div>`;
}

function htmlDatos() {
  const c = cotizar(negocio, busqueda.elegidas, busqueda.llegada, busqueda.salida);
  return `<h1>Tus datos</h1>
    <p class="paciente__intro">${esc(busqueda.elegidas.map((id) => cabanaDe(negocio, id).nombre).join(', '))} · del ${esc(rangoTexto(busqueda.llegada, busqueda.salida))} · ${busqueda.personas} ${busqueda.personas === 1 ? 'persona' : 'personas'} · total ${balboas(c.total)}</p>
    <form class="formulario" data-datos novalidate>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      <div class="campo"><label for="ad-nombre">Nombre y apellido</label><input id="ad-nombre" name="nombre" type="text" autocomplete="name"></div>
      <div class="campo"><label for="ad-tel">Celular (WhatsApp)</label><input id="ad-tel" name="telefono" type="tel" inputmode="tel" autocomplete="tel" placeholder="6000-0000"><p class="campo__ayuda">Por ahí te mandamos cómo llegar.</p></div>
      <div class="campo"><label for="ad-correo">Correo <span class="campo__ayuda">(opcional)</span></label><input id="ad-correo" name="correo" type="email" autocomplete="email"></div>
      <div class="consentimiento campo"><label class="opcion"><input type="checkbox" name="consentimiento"> <span>Autorizo a ${esc(negocio.nombre)} a guardar mis datos para esta reserva y a escribirme por WhatsApp o correo sobre ella, según la Ley 81 de 2019 de protección de datos personales. Puedo retirar este permiso cuando quiera.</span></label></div>
      <p class="nota nota--relevo">Demo: escribe datos inventados. La reserva queda solo en este navegador.</p>
      <div class="acciones"><button type="submit" class="boton boton--primario boton--grande">Ir a pagar el depósito de ${balboas(c.sena)}</button><button type="button" class="boton boton--grande" data-volver>Cambiar fechas o cabañas</button></div>
    </form>`;
}

function htmlPago(huesped) {
  const c = cotizar(negocio, busqueda.elegidas, busqueda.llegada, busqueda.salida);
  return `<h1>Paga el depósito</h1>
    <p class="paciente__intro">${balboas(c.sena)} para apartar ${esc(busqueda.elegidas.map((id) => cabanaDe(negocio, id).nombre).join(', '))} del ${esc(rangoTexto(busqueda.llegada, busqueda.salida))}.</p>
    <div class="yappy">
      <p class="yappy__rotulo">Simulado: este QR y este directorio son de ejemplo y no cobran</p>
      <p>Paga por Yappy al directorio <strong>${esc(negocio.yappy)}</strong>, o escanea el código desde tu app de Yappy:</p>
      <div class="yappy__qr" role="img" aria-label="Código QR de ejemplo, no cobra" data-qr></div>
      <p class="campo__ayuda">El depósito queda «por verificar» hasta que el alojamiento lo vea en su Yappy Comercial. Sin servidor no se puede confirmar el pago al momento: para eso hace falta el botón de pago de Yappy (pide un servidor que reciba el aviso del banco) o un enlace de pago de Tilopay con Yappy (2 %, mínimo US$0.30).</p>
      <div class="acciones"><button type="button" class="boton boton--primario boton--grande" data-pague>Ya hice el pago</button><button type="button" class="boton boton--grande" data-volver-datos>Volver</button></div>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
    </div>`;
}

function htmlListo(r) {
  return `<h1>Reserva recibida</h1>
    <div class="resultado resultado--ok" tabindex="-1">
      <p class="resultado__titulo">${icono('confirmada')} Te esperamos, ${esc(r.huesped.nombre.split(' ')[0])}</p>
      <p><strong>${esc(r.unidades.map((id) => cabanaDe(negocio, id).nombre).join(', '))}</strong>: llegas el ${esc(fechaLarga(r.llegada))} y sales el ${esc(fechaLarga(r.salida))}.</p>
      <p>Total ${balboas(r.total)}; depósito de ${balboas(r.sena.monto)} <strong>por verificar</strong>. Te escribimos por WhatsApp a ${esc(mostrarTelefono(r.huesped.telefono))} cuando la veamos, con las indicaciones para llegar.</p>
    </div>
    <p class="pie-paciente">¿Eres del alojamiento? Mírala en el <a href="alojamiento.html">calendario de cabañas</a>.</p>`;
}

let huespedPendiente = null;

function pintar() {
  pintarMarca();
  if (paso === 'buscar') {
    main.innerHTML = htmlBuscar() + '<div class="pie-paciente"><p>Página de ejemplo hecha por alphateklab. Cabañas Quebrada Honda es un alojamiento ficticio.</p></div>';
    if (busqueda.buscado) main.querySelector('[data-resultados]').innerHTML = htmlResultados();
  } else if (paso === 'datos') main.innerHTML = htmlDatos();
  else if (paso === 'pago') { main.innerHTML = htmlPago(huespedPendiente); qrEjemplo(main.querySelector('[data-qr]')); }
}

async function qrEjemplo(cont) {
  try {
    const qr = (await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm')).default(0, 'M');
    qr.addData('Ejemplo de alphateklab: aquí iría el QR de Yappy del alojamiento. Este no cobra.');
    qr.make();
    cont.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch {
    cont.innerHTML = '<p class="campo__ayuda" style="padding:8px;color:#14262b">QR de ejemplo (no se pudo cargar el generador)</p>';
  }
}

main.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (form.matches('[data-buscar]')) {
    busqueda.llegada = form.elements.llegada.value;
    busqueda.salida = form.elements.salida.value;
    busqueda.personas = +form.elements.personas.value;
    busqueda.elegidas = [];
    const e = validarBusqueda();
    if (e.length) { mostrarErrores(form, e, { titulo: e.length === 1 ? 'Revisa las fechas:' : 'Revisa esto:' }); main.querySelector('[data-resultados]').innerHTML = ''; return; }
    busqueda.buscado = true;
    mostrarErrores(form, []);
    main.querySelector('[data-resultados]').innerHTML = htmlResultados();
    main.querySelector('[data-resultados] h2').setAttribute('tabindex', '-1');
    main.querySelector('[data-resultados] h2').focus();
    return;
  }
  if (form.matches('[data-datos]')) {
    const f = form.elements;
    const e = [];
    if (f.nombre.value.trim().length < 3 || !f.nombre.value.trim().includes(' ')) e.push({ campo: 'nombre', mensaje: 'Escribe nombre y apellido.' });
    const tel = normalizarTelefono(f.telefono.value);
    if (!tel.ok) e.push({ campo: 'telefono', mensaje: tel.error });
    const correo = validarCorreo(f.correo.value);
    if (!correo.ok) e.push({ campo: 'correo', mensaje: correo.error });
    if (!f.consentimiento.checked) e.push({ campo: 'consentimiento', mensaje: 'Marca la casilla para que podamos guardar tu reserva.' });
    if (e.length) { mostrarErrores(form, e, { titulo: e.length === 1 ? 'Revisa tus datos:' : 'Revisa tus datos, por esto:' }); return; }
    huespedPendiente = { nombre: f.nombre.value.trim(), telefono: tel.e164, correo: correo.valor, consentimiento: true, canalConsentimiento: 'en la página de reservas' };
    paso = 'pago';
    pintar();
    main.querySelector('h1').setAttribute('tabindex', '-1');
    main.querySelector('h1').focus();
  }
});

main.addEventListener('change', (ev) => {
  if (ev.target.name !== 'cabana') return;
  busqueda.elegidas = [...main.querySelectorAll('[name="cabana"]:checked')].map((x) => x.value);
  const id = ev.target.value;
  main.querySelector('[data-resultados]').innerHTML = htmlResultados();
  main.querySelector(`[name="cabana"][value="${id}"]`)?.focus();
});

main.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-continuar]')) { paso = 'datos'; pintar(); main.querySelector('#ad-nombre').focus(); return; }
  if (ev.target.closest('[data-volver]')) { paso = 'buscar'; pintar(); return; }
  if (ev.target.closest('[data-volver-datos]')) { paso = 'datos'; pintar(); return; }
  if (ev.target.closest('[data-pague]')) {
    const r = transaccion((e) => crearReserva(e.alojamiento, negocio, {
      canal: 'directo', unidades: busqueda.elegidas, llegada: busqueda.llegada, salida: busqueda.salida, personas: busqueda.personas,
      huesped: huespedPendiente, sena: { estado: 'por_verificar', metodo: 'Yappy' }, respetarCierre: true, origen: 'pagina',
    }, e.reloj.ahora, fechaISO(e.reloj.ahora)), 'reserva-directa');
    if (!r.ok) {
      const z = main.querySelector('[data-errores]');
      z.hidden = false;
      z.innerHTML = `<p class="resumen-errores__titulo">No se pudo guardar la reserva:</p><ul>${r.errores.map((x) => `<li>${esc(x.mensaje)}</li>`).join('')}</ul><p>Vuelve a elegir fechas o cabañas.</p>`;
      z.focus();
      return;
    }
    paso = 'listo';
    main.innerHTML = htmlListo(r.reserva);
    main.querySelector('.resultado').focus();
    Object.assign(busqueda, { elegidas: [], buscado: false });
  }
});

iniciarBarra({ pagina: 'alojamiento-reservar.html', tipo: 'alojamiento' });
pintar();
alCambiar((e, info) => { if (!info.local && paso === 'buscar' && busqueda.buscado) main.querySelector('[data-resultados]').innerHTML = htmlResultados(); });
