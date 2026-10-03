// Bandeja de envíos con el reloj de la demo: la cola de mensajes programados, los enviados, lo que se detuvo y por
// qué, y las plantillas. El reloj no corre solo: se adelanta con botones para ver en minutos lo que en la vida real
// pasa en dos días.

import { esc, icono, anunciar, abrirDialogo, copiar, $, reduceMovimiento, claveDeFoco, devolverFoco } from './ui.mjs';
import { cargar, alCambiar, transaccion, adelantarReloj } from './almacen.mjs';
import { iniciarBarra, pintarMarca, plantillaCitas } from './demo.mjs';
import { escucharEnRecepcion, pintarPieRelevo, AVISO_RELEVO } from './relevo.mjs';
import { fechaISO, fechaLarga, fechaCorta, horaTexto, inicioDelDia, sumarDias, msDeFecha, HORA, DIA, DIAS_CORTOS, diaSemana, leerISO } from '../nucleo/tiempo.mjs';
import { proximoEnvio, CANALES, VENTANA } from '../nucleo/recordatorios.mjs';
import { pacienteDe, citaDe } from '../nucleo/operaciones.mjs';
import { mostrarTelefono } from '../nucleo/contacto.mjs';
import { PLANTILLAS_POR_DEFECTO, VARIABLES, revisarPlantilla, rellenar, segmentosSMS } from '../nucleo/mensajes.mjs';
import { datos, abrirCita, previsualizarEnvio, cuando, botonAbrirEnvio } from './componentes-citas.mjs';

let plantilla = plantillaCitas();
const ctx = { plantilla: () => plantilla, alCambiar: (fn) => alCambiar(fn) };
let recien = new Set();
let bitacoraVista = 0;

// 72 h en pantallas anchas; 48 h en el teléfono, para que las marcas de 4 en 4 horas no se encimen.
const angosto = matchMedia('(max-width: 599px)');
const rielHoras = () => (angosto.matches ? 48 : 72);
angosto.addEventListener?.('change', () => pintarReloj($('#reloj')));
// Hasta 1000 px las listas no tienen scroll propio (en el teléfono atrapaban el dedo): se muestran por tandas.
const listasLargas = matchMedia('(min-width: 1000px)');
const TANDA = 8;
const mostrar = { cola: TANDA, salio: TANDA };
listasLargas.addEventListener?.('change', () => pintarListas($('#listas')));

// ── Encabezado ────────────────────────────────────────────────────────

function pintarCabeza() {
  const { negocio } = datos(ctx);
  pintarMarca($('#marca'), negocio, {
    enlace: 'citas.html',
    extra: `<nav class="pestanas marca__nav" aria-label="Recepción">
      <a href="citas.html#agenda">Agenda</a><a href="citas.html#pacientes">${esc(negocio.vocab.Personas)}</a><a href="citas.html#espera"><span class="t-largo">Lista de espera</span><span class="t-corto">Espera</span></a><a href="citas.html#riesgo">Riesgo</a><a href="bandeja.html" aria-current="page">Bandeja ${icono('reloj')}</a>
    </nav>`,
  });
  document.title = `Bandeja de envíos · ${negocio.nombre} (${negocio.rotulo}) · alphateklab Reservas`;
}

// ── Reloj y riel ──────────────────────────────────────────────────────

function htmlRiel(st, ahora) {
  const desde = inicioDelDia(ahora);
  const hasta = desde + rielHoras() * HORA;
  const x = (ms) => ((ms - desde) / (hasta - desde)) * 100;
  let html = '<div class="riel__pista"></div>';
  for (let d = 0; d < rielHoras() / 24; d++) {
    const dia = sumarDias(fechaISO(desde), d);
    const a = msDeFecha(dia, VENTANA[0]), b = msDeFecha(dia, VENTANA[1]);
    html += `<div class="riel__ventana" style="left:${x(a)}%;width:${x(b) - x(a)}%"></div>`;
    html += `<div class="riel__corte" style="left:${x(msDeFecha(dia, 0))}%"></div>`;
    html += `<div class="riel__dia" style="left:${x(msDeFecha(dia, 14 * 60))}%">${DIAS_CORTOS[diaSemana(dia)]} ${leerISO(dia).dia}</div>`;
  }
  // Marcas agrupadas por momento y estado.
  const grupos = new Map();
  for (const e of st.envios) {
    if (e.momento < desde || e.momento >= hasta) continue;
    const clase = e.tipo === 'llamar' ? (e.estado === 'tarea' ? 'tarea' : e.estado === 'cancelado' ? 'cancelado' : 'llamar') : e.estado === 'enviado' ? 'enviado' : e.estado === 'cancelado' ? 'cancelado' : 'programado';
    const k = `${e.momento}|${clase}`;
    grupos.set(k, { momento: e.momento, clase, n: (grupos.get(k)?.n || 0) + 1, sms: e.canal === 'sms' });
  }
  // Carriles: arriba las llamadas, al centro lo que sale o salió, abajo lo que se detuvo.
  const carril = { llamar: 22, tarea: 22, programado: 47, enviado: 47, cancelado: 74 };
  for (const g of [...grupos.values()].sort((a, b) => a.momento - b.momento)) {
    html += `<span class="riel__marca riel__marca--${g.clase}${g.sms ? ' riel__marca--sms' : ''}" style="left:${x(g.momento)}%;top:${carril[g.clase]}px">${g.n > 1 ? g.n : ''}</span>`;
  }
  // La aguja ocupa todo el ancho y se mueve con transform (no con «left»): su borde izquierdo marca la hora.
  const xa = x(ahora);
  html += `<div class="riel__ahora${xa > 88 ? ' riel__ahora--fin' : ''}" style="transform:translateX(${xa}%)"><span>ahora</span></div>`;
  return html;
}

function pintarReloj(cont) {
  const { negocio, st, ahora } = datos(ctx);
  const prox = proximoEnvio(st.envios, ahora);
  const desde = inicioDelDia(ahora), hasta = desde + rielHoras() * HORA;
  const enRango = st.envios.filter((e) => e.momento >= desde && e.momento < hasta);
  const cola = enRango.filter((e) => e.estado === 'programado').length;
  const salidos = enRango.filter((e) => e.estado === 'enviado').length;
  const detenidos = enRango.filter((e) => e.estado === 'cancelado').length;
  const anterior = cont.querySelector('.riel__ahora');
  const mismoRango = cont.dataset.desde === String(desde);
  const posicionAnterior = anterior && mismoRango ? anterior.style.transform : null;
  cont.dataset.desde = String(desde);
  const fin = fechaLarga(hasta - 1);
  cont.innerHTML = `
    <div class="reloj__arriba">
      <div>
        <p class="reloj__etiqueta">Reloj de la demo</p>
        <p class="reloj__hora" aria-live="polite"><time>${esc(horaTexto(ahora))}</time></p>
        <p class="reloj__fecha">${esc(fechaLarga(ahora).replace(/^./, (c) => c.toUpperCase()))}</p>
      </div>
      <div class="reloj__botones" role="group" aria-label="Adelantar el reloj">
        <button type="button" class="boton" data-avanzar="${HORA}">+1 hora</button>
        <button type="button" class="boton" data-avanzar="${6 * HORA}">+6 horas</button>
        <button type="button" class="boton" data-avanzar="${DIA}">+1 día</button>
        <button type="button" class="boton boton--primario" data-proximo="${prox || ''}"${prox ? '' : ' disabled'}>${prox ? `<span>Hasta el próximo envío <span class="sin-corte">(${esc(cuando(prox))})</span></span>` : 'No hay nada en cola'}</button>
      </div>
    </div>
    <div>
      <p class="riel__alcance">En el riel, del ${esc(fechaLarga(desde))} al ${esc(fin)} (${rielHoras()} h): <strong>${cola}</strong> en cola, <strong>${salidos}</strong> ${salidos === 1 ? 'enviado' : 'enviados'} y <strong>${detenidos}</strong> ${detenidos === 1 ? 'detenido' : 'detenidos'}. Las listas de abajo cuentan todas las fechas.</p>
      <div class="riel" aria-hidden="true">${htmlRiel(st, ahora)}</div>
      <div class="riel__leyenda" aria-hidden="true">
        <span><span class="riel__muestra riel__muestra--ventana"></span>Ventana de envío (8:00 a. m. a 8:00 p. m.)</span>
        <span><span class="riel__muestra"></span>En cola</span>
        <span><span class="riel__muestra riel__muestra--enviado"></span>Enviado</span>
        <span><span class="riel__muestra riel__muestra--cancelado"></span>Detenido</span>
        <span><span class="riel__muestra riel__muestra--llamar"></span>Tarea de llamar</span>
      </div>
    </div>
    <p class="reloj__nota">El reloj no corre solo: adelántalo y mira cómo salen los recordatorios y los reintentos, y cómo se detienen cuando ${esc(negocio.vocab.persona === 'paciente' ? 'el paciente' : 'el cliente')} confirma o cancela. En esta demo nada sale solo: cada mensaje se manda a mano con su botón («Abrir en WhatsApp», en SMS o en el correo). Con un servidor, salen solos a su hora.</p>`;
  // Que la aguja viaje desde donde estaba (si no cambió de día y no se pidió reducir movimiento).
  const aguja = cont.querySelector('.riel__ahora');
  if (posicionAnterior && !reduceMovimiento() && posicionAnterior !== aguja.style.transform) {
    const destino = aguja.style.transform;
    aguja.style.transition = 'none';
    aguja.style.transform = posicionAnterior;
    aguja.getBoundingClientRect();
    aguja.style.transition = '';
    aguja.style.transform = destino;
  }
}

// ── Listas ────────────────────────────────────────────────────────────

function etiquetaClase(e) {
  if (e.tipo === 'llamar') return 'Llamar si no respondió';
  if (e.clase === 'oferta') return 'Aviso de la lista de espera';
  if (e.clase === 'aviso') return `Aviso de cita confirmada · ${e.etiqueta}`;
  if (e.clase === 'reintento') return `Reintento · ${e.intento} de ${e.de}`;
  return `Recordatorio ${e.etiqueta} · ${e.intento} de ${e.de}`;
}

/** El texto del mensaje con el enlace largo de la demo abreviado (el enlace completo sigue en «Ver como…»). */
function textoConEnlaceCorto(e) {
  if (!e.enlace || !e.texto.includes(e.enlace)) return esc(e.texto);
  const [antes, despues] = e.texto.split(e.enlace);
  const corto = `…/confirmar.html#${(e.enlace.split('#')[1] || '').slice(0, 10)}…`;
  return `${esc(antes)}<a href="${esc(e.enlace)}" target="_blank" rel="noopener">${esc(corto)}</a>${esc(despues)}`;
}

function htmlEnvio(e, st, negocio, { conTexto = false } = {}) {
  const p = pacienteDe(st, e.pacienteId);
  const cita = e.citaId ? citaDe(st, e.citaId) : null;
  const oferta = e.ofertaId ? st.ofertas.find((o) => o.id === e.ofertaId) : null;
  const sobre = cita ? `Cita: ${cuando(cita.inicio)}` : oferta ? `Espacio: ${cuando(oferta.hueco.inicio)}` : '';
  const canal = e.tipo === 'llamar' ? `${icono('llamar')} Recepción` : `${icono(e.canal)} ${CANALES[e.canal]}`;
  let acciones = `<button type="button" class="boton" data-ver-envio="${e.id}">Ver mensaje</button>`;
  if (e.borrado) acciones = '';
  else if (e.estado === 'enviado' && p) {
    acciones = `${botonAbrirEnvio(e, p)}
      <a class="boton" href="${esc(e.enlace)}" target="_blank" rel="noopener">Ver como ${esc(negocio.vocab.persona)}</a>
      <button type="button" class="boton" data-ver-envio="${e.id}">Más</button>`;
  }
  if (e.tipo === 'llamar') acciones = cita ? `<button type="button" class="boton" data-ver-cita="${cita.id}">Ver la cita</button>` : '';
  const motivo = e.estado === 'cancelado' ? `<span class="insignia">Se detuvo: ${esc(e.motivoCancelacion)}</span>`
    : e.borrado ? '<span class="insignia">Texto borrado junto con los datos de la persona</span>' : '';
  return `<li class="envio${recien.has(e.id) ? ' envio--nuevo' : ''}">
    <div class="envio__cabeza"><span class="envio__quien">${esc(p ? p.nombre : '—')}</span><span class="envio__cuando">${esc(cuando(e.estado === 'enviado' ? e.salioEn : e.momento))}</span></div>
    <p class="envio__meta"><span>${canal}</span><span>${esc(etiquetaClase(e))}</span>${sobre ? `<span>${esc(sobre)}</span>` : ''}${e.atrasado ? '<span>salió al agendar</span>' : ''}</p>
    ${motivo}
    ${conTexto && e.texto ? `<p class="envio__texto">${textoConEnlaceCorto(e)}</p>` : ''}
    ${acciones ? `<div class="acciones">${acciones}</div>` : ''}
  </li>`;
}

function porDia(lista, campo, st, negocio, opciones) {
  let html = '', dia = null;
  for (const e of lista) {
    const d = fechaISO(e[campo] ?? e.momento);
    if (d !== dia) { dia = d; html += `<li class="grupo-dia">${esc(fechaLarga(d).replace(/^./, (c) => c.toUpperCase()))}</li>`; }
    html += htmlEnvio(e, st, negocio, opciones);
  }
  return html;
}

/** Lista con scroll propio en pantallas anchas; en el teléfono, por tandas con «Ver los N siguientes». */
function htmlLista(lista, clave, etiqueta, campo, st, negocio, opciones) {
  const MAX = 60;
  if (listasLargas.matches) {
    return `<ul class="filas lista-scroll" tabindex="0" aria-label="${etiqueta}">${porDia(lista.slice(0, MAX), campo, st, negocio, opciones)}</ul>${lista.length > MAX ? `<p class="vacio">Y ${lista.length - MAX} más después.</p>` : ''}`;
  }
  const n = Math.min(mostrar[clave], lista.length);
  const quedan = lista.length - n;
  return `<ul class="filas" aria-label="${etiqueta}">${porDia(lista.slice(0, n), campo, st, negocio, opciones)}</ul>${quedan ? `<p class="mas-lista"><button type="button" class="boton" data-ver-mas="${clave}">Ver ${Math.min(quedan, 20) === quedan ? `los ${quedan} que faltan` : 'los 20 siguientes'} (de ${lista.length})</button></p>` : ''}`;
}

function pintarListas(cont) {
  const { negocio, st, ahora } = datos(ctx);
  const cola = st.envios.filter((e) => e.estado === 'programado').sort((a, b) => a.momento - b.momento);
  const enviados = st.envios.filter((e) => e.estado === 'enviado' || e.estado === 'tarea').sort((a, b) => (b.salioEn ?? b.momento) - (a.salioEn ?? a.momento));
  const detenidos = st.envios.filter((e) => e.estado === 'cancelado').sort((a, b) => (b.canceladoEn ?? 0) - (a.canceladoEn ?? 0));
  const bit = st.bitacora.slice(0, 40);
  const nuevosBit = Math.max(0, st.bitacora.length - bitacoraVista);
  bitacoraVista = st.bitacora.length;
  const MAX = 60;
  cont.innerHTML = `
    <section class="panel" aria-labelledby="b-cola">
      <div class="panel__cabeza"><h2 id="b-cola">En cola <span class="cuenta">${cola.length}</span></h2></div>
      ${cola.length ? htmlLista(cola, 'cola', 'Mensajes en cola', 'momento', st, negocio) : '<p class="vacio"><strong>La cola está vacía.</strong>Agenda una cita con recordatorio y aparece aquí.</p>'}
    </section>
    <section class="panel" aria-labelledby="b-env">
      <div class="panel__cabeza"><h2 id="b-env">Ya salió <span class="cuenta">${enviados.length}</span></h2></div>
      ${enviados.length ? htmlLista(enviados, 'salio', 'Mensajes enviados', 'salioEn', st, negocio, { conTexto: true }) : '<p class="vacio"><strong>Todavía no ha salido nada.</strong>Adelanta el reloj.</p>'}
    </section>
    <section class="panel" aria-labelledby="b-bit">
      <div class="panel__cabeza"><h2 id="b-bit">Lo que pasó</h2></div>
      <ol class="bitacora${listasLargas.matches ? ' lista-scroll' : ''}"${listasLargas.matches ? ' tabindex="0"' : ''} aria-label="Bitácora">${bit.map((b, i) => `<li class="${i < nuevosBit && recien.size ? 'nuevo' : ''}"><time>${esc(fechaCorta(b.t).split(' ').slice(0, 2).join(' '))}<br>${esc(horaTexto(b.t))}</time><span>${esc(b.texto)}</span></li>`).join('')}</ol>
    </section>
    <section class="panel" aria-labelledby="b-det">
      <div class="panel__cabeza"><h2 id="b-det">Detenidos <span class="cuenta">${detenidos.length}</span></h2></div>
      <details><summary class="vacio" style="cursor:pointer">Ver los que no salieron porque ${esc(negocio.vocab.persona === 'paciente' ? 'el paciente' : 'el cliente')} ya respondió, se canceló o se reprogramó la cita</summary>
      ${detenidos.length ? `<ul class="filas">${detenidos.slice(0, MAX).map((e) => htmlEnvio(e, st, negocio)).join('')}</ul>` : '<p class="vacio">Ninguno todavía.</p>'}</details>
    </section>
    <section class="panel ancho" aria-labelledby="b-pla">
      <div class="panel__cabeza"><h2 id="b-pla">Plantillas de mensaje</h2></div>
      <div class="panel__cuerpo" data-plantillas></div>
    </section>`;
  pintarPlantillas(cont.querySelector('[data-plantillas]'));
}

// ── Plantillas ────────────────────────────────────────────────────────

const NOMBRES_PLANTILLA = { recordatorio: 'Recordatorio', reintento: 'Reintento (si no respondió)', aviso: 'Aviso de cita ya confirmada', oferta: 'Aviso a la lista de espera' };

function pintarPlantillas(cont) {
  const { negocio, st } = datos(ctx);
  const ejemplo = {
    nombre: 'Carmen', negocio: negocio.nombre, fecha: 'martes 6 de octubre', hora: '9:30 a. m.',
    profesional: negocio.profesionales[0].nombre, enlace: 'https://…/confirmar.html#…',
  };
  cont.innerHTML = `
    <form class="formulario" novalidate data-form-plantillas>
      <p class="campo__ayuda">Variables: ${VARIABLES.map((v) => `{${v}}`).join(', ')}. No hay variable de servicio a propósito: la vista previa de WhatsApp se ve con el teléfono bloqueado, así que el mensaje no lleva datos clínicos. Los cambios valen para lo que salga desde ahora.</p>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      ${Object.keys(NOMBRES_PLANTILLA).map((k) => `
        <div class="campo">
          <label for="pl-${k}">${NOMBRES_PLANTILLA[k]}</label>
          <textarea id="pl-${k}" name="${k}" rows="3" maxlength="700">${esc(st.plantillas[k] ?? PLANTILLAS_POR_DEFECTO[k])}</textarea>
          <div class="variables" role="group" aria-label="Insertar variable en ${NOMBRES_PLANTILLA[k].toLowerCase()}">${VARIABLES.map((v) => `<button type="button" data-insertar="${v}" data-en="${k}">{${v}}</button>`).join('')}</div>
          <p class="etiqueta" style="font-size:0.8125rem;color:var(--tinta-3);margin-top:4px">Así se lee (con datos de ejemplo):</p>
          <p class="vista-previa" data-previa="${k}">${esc(rellenar(st.plantillas[k] ?? PLANTILLAS_POR_DEFECTO[k], ejemplo))}</p>
        </div>`).join('')}
      <div class="acciones"><button type="submit" class="boton boton--primario">Guardar plantillas</button><button type="button" class="boton" data-plantillas-original>Volver al texto original</button></div>
    </form>`;
  const form = cont.querySelector('form');
  form.addEventListener('input', (ev) => {
    const k = ev.target.name;
    if (!NOMBRES_PLANTILLA[k]) return;
    form.querySelector(`[data-previa="${k}"]`).textContent = rellenar(ev.target.value, ejemplo);
  });
  form.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-insertar]');
    if (b) {
      const ta = form.elements[b.dataset.en];
      const ini = ta.selectionStart ?? ta.value.length, fin = ta.selectionEnd ?? ta.value.length;
      const t = `{${b.dataset.insertar}}`;
      ta.value = ta.value.slice(0, ini) + t + ta.value.slice(fin);
      ta.focus();
      ta.setSelectionRange(ini + t.length, ini + t.length);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (ev.target.closest('[data-plantillas-original]')) {
      for (const k of Object.keys(NOMBRES_PLANTILLA)) { form.elements[k].value = PLANTILLAS_POR_DEFECTO[k]; form.elements[k].dispatchEvent(new Event('input', { bubbles: true })); }
      anunciar('Texto original puesto. Guarda para que valga.');
    }
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const errores = [];
    for (const k of Object.keys(NOMBRES_PLANTILLA)) {
      for (const m of revisarPlantilla(form.elements[k].value, k)) errores.push({ campo: k, mensaje: `${NOMBRES_PLANTILLA[k]}: ${m}` });
    }
    const zona = form.querySelector('[data-errores]');
    if (errores.length) {
      zona.hidden = false;
      zona.innerHTML = `<p class="resumen-errores__titulo">No se guardó, por esto:</p><ul>${errores.map((e) => `<li>${esc(e.mensaje)}</li>`).join('')}</ul>`;
      zona.focus();
      return;
    }
    zona.hidden = true;
    transaccion((e) => { const s = e.negocios[plantilla]; for (const k of Object.keys(NOMBRES_PLANTILLA)) s.plantillas[k] = form.elements[k].value.trim(); }, 'plantillas');
    anunciar('Plantillas guardadas. Valen para lo que salga desde ahora.');
  });
}

// ── Ver un mensaje ────────────────────────────────────────────────────

let qrLib = null;
async function qrSvg(texto) {
  try {
    if (!qrLib) qrLib = (await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm')).default;
    const qr = qrLib(0, 'L');
    qr.addData(texto);
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  } catch {
    return null;
  }
}

function abrirEnvio(id) {
  const { negocio, st } = datos(ctx);
  const e = st.envios.find((x) => x.id === id);
  if (!e) return;
  const p = pacienteDe(st, e.pacienteId);
  const { texto, enlace } = previsualizarEnvio(ctx, e);
  const sms = e.canal === 'sms' ? segmentosSMS(texto) : null;
  const d = abrirDialogo({
    titulo: e.estado === 'enviado' ? 'Mensaje enviado' : 'Mensaje en cola',
    cuerpo: `
      <dl class="datos">
        <dt>Para</dt><dd>${esc(p ? p.nombre : '—')} · ${esc(p ? mostrarTelefono(p.telefono) : '')}</dd>
        <dt>Canal</dt><dd>${CANALES[e.canal]} · ${esc(etiquetaClase(e))}</dd>
        <dt>${e.estado === 'enviado' ? 'Salió' : 'Sale'}</dt><dd>${esc(cuando(e.estado === 'enviado' ? e.salioEn : e.momento))}</dd>
        ${sms ? `<dt>SMS</dt><dd>${sms.segmentos} ${sms.segmentos === 1 ? 'segmento' : 'segmentos'} (${sms.codificacion}, ${sms.largo} caracteres con este enlace largo de la demo)</dd>` : ''}
      </dl>
      <p class="envio__texto" style="margin-top:12px">${esc(texto)}</p>
      ${e.estado !== 'enviado' ? '<p class="campo__ayuda" style="margin-top:6px">Así saldría si saliera ahora; el texto final se arma al salir.</p>' : ''}
      <div class="acciones" style="margin-top:14px">
        ${p ? botonAbrirEnvio(e, p, { clase: 'boton boton--primario', texto }) : ''}
        <a class="boton" href="${esc(enlace)}" target="_blank" rel="noopener">Ver como ${esc(negocio.vocab.persona)}</a>
        <button type="button" class="boton" data-copiar>${icono('enlace')} Copiar enlace</button>
      </div>
      <div class="bloque-dialogo" style="margin-top:18px">
        <h3>Ábrelo en tu teléfono</h3>
        <div class="qr" data-qr><p class="campo__ayuda">Generando el código QR…</p></div>
        <p class="campo__ayuda" style="margin-top:6px">Escanéalo para ver el enlace como lo vería ${esc(negocio.vocab.persona === 'paciente' ? 'el paciente' : 'el cliente')}. Si respondes desde el teléfono, esta pantalla se entera por el relevo de pruebas (ntfy.sh). Desde «localhost» el teléfono no llega; desde la dirección publicada, sí.</p>
        <p class="nota nota--relevo" style="margin-top:8px">${esc(AVISO_RELEVO)}</p>
        <p class="enlace-largo" style="margin-top:8px">${esc(enlace)}</p>
      </div>`,
  });
  d.querySelector('[data-copiar]').addEventListener('click', async () => anunciar(await copiar(enlace) ? 'Enlace copiado.' : 'No se pudo copiar: selecciona el enlace de abajo y cópialo.'));
  qrSvg(enlace).then((svg) => {
    const q = d.querySelector('[data-qr]');
    if (!q) return;
    q.innerHTML = svg ? `<div role="img" aria-label="Código QR del enlace de confirmación">${svg}</div>` : '<p class="campo__ayuda">No se pudo cargar el generador de QR (sin conexión a jsDelivr). Copia el enlace y ábrelo en el teléfono.</p>';
  });
}

// ── Pintar y eventos ─────────────────────────────────────────────────

function pintar() {
  pintarCabeza();
  pintarReloj($('#reloj'));
  pintarListas($('#listas'));
}

function avanzar(hasta) {
  const previo = document.activeElement;
  // El botón se vuelve a pintar: se recuerda cuál era para devolverle el foco (si quedó deshabilitado, al primero).
  const clave = previo && previo.matches?.('[data-proximo]') ? '[data-proximo]' : claveDeFoco(previo);
  const antes = new Set(datos(ctx).st.envios.filter((e) => e.estado === 'enviado' || e.estado === 'tarea').map((e) => e.id));
  const salieron = adelantarReloj(hasta)?.[plantilla] || [];
  recien = new Set(salieron.map((e) => e.id).filter((x) => !antes.has(x)));
  pintar();
  if (previo && previo.closest?.('.reloj__botones')) {
    const otro = clave ? document.querySelector(clave) : null;
    devolverFoco(null, otro && !otro.disabled ? clave : '[data-avanzar]');
  }
  const msj = salieron.filter((e) => e.tipo === 'mensaje').length, llamar = salieron.filter((e) => e.tipo === 'llamar').length;
  const { ahora } = datos(ctx);
  anunciar(msj || llamar
    ? `${horaTexto(ahora)}: ${msj ? `${msj === 1 ? 'salió 1 mensaje' : `salieron ${msj} mensajes`}` : ''}${msj && llamar ? ' y ' : ''}${llamar ? `${llamar === 1 ? 'quedó 1 llamada' : `quedaron ${llamar} llamadas`} para recepción` : ''}`
    : `${horaTexto(ahora)}: no salió nada en ese tiempo.`);
  setTimeout(() => { recien = new Set(); }, 1200);
}

document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (!$('#principal').contains(t)) return;
  const b = (s) => t.closest(s);
  const { ahora } = datos(ctx);
  if (b('[data-avanzar]')) { avanzar(ahora + +b('[data-avanzar]').dataset.avanzar); return; }
  if (b('[data-proximo]')) { const v = +b('[data-proximo]').dataset.proximo; if (v) avanzar(v); return; }
  if (b('[data-ver-envio]')) { abrirEnvio(b('[data-ver-envio]').dataset.verEnvio); return; }
  if (b('[data-ver-mas]')) {
    const k = b('[data-ver-mas]').dataset.verMas;
    const lista = $('#' + (k === 'cola' ? 'b-cola' : 'b-env')).closest('section');
    const antes = lista.querySelectorAll('.envio').length;
    mostrar[k] += 20;
    pintarListas($('#listas'));
    // El foco va al primero de los que aparecieron.
    const nuevo = $('#' + (k === 'cola' ? 'b-cola' : 'b-env')).closest('section').querySelectorAll('.envio')[antes];
    if (nuevo) { nuevo.setAttribute('tabindex', '-1'); nuevo.focus(); }
    return;
  }
  if (b('[data-ver-cita]')) { abrirCita(ctx, b('[data-ver-cita]').dataset.verCita); }
});

const estado = cargar();
bitacoraVista = estado.negocios[plantilla].bitacora.length;
iniciarBarra({ pagina: 'bandeja.html', tipo: 'citas', alCambiarPlantilla: (id) => { plantilla = id; bitacoraVista = cargar().negocios[id].bitacora.length; pintar(); } });
pintar();
alCambiar((e, info) => {
  if (info.local && info.motivo === 'reloj') return; // ya se pintó en avanzar()
  pintar();
});
pintarPieRelevo($('#pie'), 'conectando');
escucharEnRecepcion(estado.sala, { transaccion, anunciar, alEstado: (est) => pintarPieRelevo($('#pie'), est) });
