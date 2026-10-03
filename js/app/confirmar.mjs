// Página del paciente: se abre desde el enlace del recordatorio. Los datos de la cita vienen en el fragmento (#), que
// no viaja a ningún servidor. Responde con un toque; si la agenda está en este mismo navegador se actualiza al
// momento, y si está en otro dispositivo la respuesta viaja por el relevo de pruebas (ntfy.sh).

import { esc, icono, $, descargar } from './ui.mjs';
import { leer, transaccion, respuestasGuardadas, guardarRespuesta, preferencia } from './almacen.mjs';
import { iniciarBarra } from './demo.mjs';
import { publicar, AVISO_RELEVO } from './relevo.mjs';
import { decodificar, deMinutos } from '../nucleo/enlace.mjs';
import { NEGOCIOS_CITAS, negocioCitas } from '../nucleo/negocios.mjs';
import { fechaLarga, horaTexto, fechaISO, fechaCorta, MIN } from '../nucleo/tiempo.mjs';
import { profesionalDe, servicioDe, salaDe, validarCita } from '../nucleo/agenda.mjs';
import { responder, aceptarOferta, citaDe, negocioEfectivo } from '../nucleo/operaciones.mjs';
import { mensajeRespuesta, mensajeOferta } from '../nucleo/mensajes-relevo.mjs';
import { exportarCita } from '../nucleo/ical.mjs';
import { mostrarTelefono } from '../nucleo/contacto.mjs';

const main = $('#principal');
// Otro enlace en la misma pestaña: volver a leer todo.
addEventListener('hashchange', () => location.reload());
const lectura = decodificar(location.hash);

function pintarMarcaPaciente(negocio) {
  $('#marca').innerHTML = `<div class="marca__dentro"><div class="marca__logo"><span class="marca__nombre">${esc(negocio.nombre)}</span><span class="marca__rotulo">${esc(negocio.rotulo)} · ${esc(negocio.ciudad)}</span></div></div>`;
}

function pintarError(texto) {
  main.innerHTML = `<h1>No pudimos abrir tu cita</h1><div class="alerta error-enlace" role="alert"><p class="alerta__titulo">${icono('aviso')} El enlace no sirve</p><p>${esc(texto)}</p></div>
    <p class="pie-paciente">Si te llegó por WhatsApp, revisa que el enlace esté completo: a veces se corta al copiarlo.</p>`;
}

const nuevoId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

if (!lectura.ok) {
  document.documentElement.dataset.marca = 'consultorio';
  iniciarBarra({ pagina: 'confirmar.html', tipo: 'paciente' });
  pintarMarcaPaciente(NEGOCIOS_CITAS.consultorio);
  pintarError(lectura.error);
} else {
  const d = lectura.datos;
  const negocio = negocioCitas(d.pl);
  if (!negocio || !profesionalDe(negocio, d.pr) || !salaDe(negocio, d.sl) || (d.k === 'c' && !servicioDe(negocio, d.sv))) {
    document.documentElement.dataset.marca = 'consultorio';
    iniciarBarra({ pagina: 'confirmar.html', tipo: 'paciente' });
    pintarMarcaPaciente(NEGOCIOS_CITAS.consultorio);
    pintarError('Este enlace es de un negocio o una cita que ya no existe. Pide un enlace nuevo al consultorio.');
  } else {
    document.documentElement.dataset.marca = d.pl;
    preferencia('plantilla', d.pl);
    iniciarBarra({ pagina: 'confirmar.html', tipo: 'paciente' });
    pintarMarcaPaciente(negocio);
    document.title = `${d.k === 'o' ? 'Espacio libre' : 'Tu cita'} · ${negocio.nombre} (${negocio.rotulo})`;
    if (d.k === 'c') iniciarCita(d, negocio);
    else iniciarOferta(d, negocio);
  }
}

/** ¿La agenda de esta cita está en este mismo navegador? (misma sala de la demo) */
function agendaLocal(d) {
  const e = leer();
  return e && d.s && e.sala === d.s ? e : null;
}

function htmlTarjeta(d, negocio, { titulo = null } = {}) {
  const inicio = deMinutos(d.i);
  const s = servicioDe(negocio, d.sv);
  const v = negocio.vocab;
  return `<div class="tarjeta-cita">
    ${titulo ? `<p class="paso__num">${esc(titulo)}</p>` : ''}
    <div class="tarjeta-cita__cuando"><p class="tarjeta-cita__fecha">${esc(fechaLarga(inicio).replace(/^./, (c) => c.toUpperCase()))}</p><p class="tarjeta-cita__hora"><time>${esc(horaTexto(inicio))}</time></p></div>
    <dl class="datos">
      <dt>${esc(v.Profesional)}</dt><dd>${esc(profesionalDe(negocio, d.pr).nombre)}</dd>
      ${s ? `<dt>Servicio</dt><dd>${esc(s.nombre)} (${s.min} min)</dd>` : ''}
      <dt>${esc(v.Sala)}</dt><dd>${esc(salaDe(negocio, d.sl).nombre)}</dd>
      <dt>Dirección</dt><dd>${esc(negocio.direccion)}</dd>
      <dt>Teléfono</dt><dd><a href="tel:${esc(negocio.telefono)}">${esc(mostrarTelefono(negocio.telefono))}</a> (de ejemplo)</dd>
    </dl>
  </div>`;
}

function htmlEntrega(estado, texto) {
  return `<p class="entrega" data-estado="${estado}" role="status">${esc(texto)}</p>`;
}

// ── Cita ──────────────────────────────────────────────────────────────

function iniciarCita(d, negocio) {
  const clave = `${d.pl}:${d.c}`;
  const v = negocio.vocab;

  const estadoActual = () => {
    const local = agendaLocal(d);
    if (local) {
      const c = citaDe(local.negocios[d.pl], d.c);
      if (!c) return { noExiste: true };
      return { cita: c, local };
    }
    return { guardada: respuestasGuardadas()[clave] || null };
  };

  const pintar = (resultado = null, entrega = null) => {
    const ea = estadoActual();
    if (ea.noExiste) { pintarError(`Esta cita ya no está en la agenda de ${negocio.nombre}. Pide un enlace nuevo al consultorio.`); return; }
    const c = ea.cita;
    // Si la cita se movió, la tarjeta muestra la hora vigente.
    const vista = c ? { ...d, i: Math.round(c.inicio / MIN), pr: c.profesionalId, sl: c.salaId } : (ea.guardada && ea.guardada.hueco ? { ...d, i: ea.guardada.hueco } : d);
    let html = `<h1>Hola, ${esc(d.n)}</h1><p class="paciente__intro">${c && c.estado === 'cancelada' ? 'Esta era tu cita:' : 'Esta es tu cita:'}</p>${htmlTarjeta(vista, negocio)}`;
    const ya = c
      ? (c.estado === 'confirmada' ? 'confirmo' : c.estado === 'cancelada' ? 'cancelo' : c.respuesta && c.respuesta.tipo === 'llamenme' ? 'llamenme' : ['atendida', 'no_asistio'].includes(c.estado) ? 'pasada' : null)
      : ea.guardada ? ea.guardada.tipo : null;
    if (resultado || ya) html += htmlResultado(resultado || ya, vista, negocio, c, ea.guardada, entrega);
    if (!ya || ya === 'confirmo' || ya === 'cambio' || ya === 'llamenme') {
      html += `<div class="respuestas" data-respuestas>
        ${ya === 'confirmo' || ya === 'cambio' ? '<p class="campo__ayuda">¿Cambió algo?</p>' : `<button type="button" class="boton boton--primario boton--grande" data-r="confirmo">Confirmo mi cita</button>`}
        <button type="button" class="boton boton--grande" data-r="cambiar">Necesito cambiarla</button>
        <button type="button" class="boton boton--grande boton--texto-peligro" data-r="cancelar">No podré ir</button>
      </div><div data-panel></div>`;
    }
    html += `<div class="pie-paciente"><p>${esc(AVISO_RELEVO)}</p><p>Página de ejemplo hecha por alphateklab. ${esc(negocio.nombre)} es un negocio ficticio.</p></div>`;
    main.innerHTML = html;
  };

  async function enviar(tipo, hueco = null) {
    const id = nuevoId();
    const local = agendaLocal(d);
    let resultado = tipo;
    if (local) {
      let r;
      transaccion((e) => { r = responder(e.negocios[d.pl], negocio, { id, citaId: d.c, tipo, hueco: hueco ? deMinutos(hueco) : null, via: 'enlace' }, e.reloj.ahora); }, 'respuesta');
      if (r.resultado === 'hueco_ocupado') resultado = 'ocupado';
      else if (r.resultado === 'reprogramada') resultado = 'cambio';
      else if (r.resultado === 'llamar') resultado = 'llamenme';
      else if (r.resultado === 'cerrada') resultado = 'cerrada';
    }
    guardarRespuesta(`${d.pl}:${d.c}`, { tipo: resultado === 'ocupado' ? 'llamenme' : resultado, t: Date.now(), hueco });
    pintar(resultado, local ? { estado: 'ok', texto: `La agenda de ${negocio.nombre} ya lo muestra (está en este mismo navegador).` } : { estado: 'enviando', texto: 'Avisando a la recepción…' });
    if (!d.s) return;
    const pub = await publicar(d.s, mensajeRespuesta({ id, pl: d.pl, citaId: d.c, respuesta: tipo, hueco }));
    if (!local) {
      const e = main.querySelector('.entrega');
      if (e) e.outerHTML = pub.ok
        ? htmlEntrega('ok', 'Enviado a la recepción por el relevo de pruebas. Si su pantalla está abierta, ya lo ve.')
        : htmlEntrega('error', `No pudimos avisar a la recepción (${pub.error}). Llama al ${mostrarTelefono(negocio.telefono)} para avisar.`);
    }
  }

  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-r]');
    if (b) {
      const r = b.dataset.r;
      const panel = main.querySelector('[data-panel]');
      if (r === 'confirmo') { await enviar('confirmo'); main.querySelector('.resultado')?.focus(); return; }
      if (r === 'cambiar') { pintarCambio(panel, d, negocio); return; }
      if (r === 'cancelar') {
        panel.innerHTML = `<div class="panel-respuesta"><h2 tabindex="-1">¿No podrás ir?</h2><p>Liberamos tu horario para otra persona que lo está esperando. Si quieres otra fecha, mejor elige «Necesito cambiarla».</p>
          <div class="respuestas"><button type="button" class="boton boton--peligro boton--grande" data-confirmar-cancelar>Sí, no podré ir</button><button type="button" class="boton boton--grande" data-volver>Volver</button></div></div>`;
        panel.querySelector('h2').focus();
        return;
      }
    }
    if (ev.target.closest('[data-confirmar-cancelar]')) { await enviar('cancelo'); main.querySelector('.resultado')?.focus(); return; }
    if (ev.target.closest('[data-volver]')) { main.querySelector('[data-panel]').innerHTML = ''; main.querySelector('[data-r]')?.focus(); return; }
    if (ev.target.closest('[data-llamenme]')) { await enviar('llamenme'); main.querySelector('.resultado')?.focus(); return; }
    if (ev.target.closest('[data-ics]')) {
      const ea = estadoActual();
      const c = ea.cita;
      const inicio = c ? c.inicio : deMinutos(ea.guardada?.hueco || d.i);
      const s = servicioDe(negocio, d.sv);
      const prof = profesionalDe(negocio, c ? c.profesionalId : d.pr);
      descargar(`cita-${fechaISO(inicio)}.ics`, exportarCita({
        uid: `${d.c}@reservas.alphateklab`, inicio, fin: inicio + s.min * MIN, dtstamp: Date.now(),
        resumen: `Cita en ${negocio.nombre}`, lugar: negocio.direccion, descripcion: `Con ${prof.nombre}. ${negocio.nombre} (${negocio.rotulo}).`,
      }));
    }
  });
  main.addEventListener('submit', async (ev) => {
    if (!ev.target.matches('[data-form-cambio]')) return;
    ev.preventDefault();
    const elegido = ev.target.querySelector('input[name="hueco"]:checked');
    const err = ev.target.querySelector('[data-error-cambio]');
    if (!elegido) { err.hidden = false; err.textContent = 'Elige uno de los horarios, o toca «Prefiero que me llamen».'; err.focus(); return; }
    await enviar('cambio', +elegido.value);
    main.querySelector('.resultado')?.focus();
  });

  addEventListener('storage', () => pintar());
  pintar();
}

function pintarCambio(panel, d, negocio) {
  const local = agendaLocal(d);
  const st = local ? local.negocios[d.pl] : null;
  const neg = st ? negocioEfectivo(negocio, st) : negocio;
  // Con la agenda en este navegador se puede saber si el horario sigue libre; si no, se ofrece y decide la recepción.
  const opciones = d.hs.map((m) => {
    const inicio = deMinutos(m);
    return { m, inicio, libre: !st || libreConAlgunaSala(neg, st, d, inicio, local) };
  });
  panel.innerHTML = `<form class="panel-respuesta" data-form-cambio novalidate>
    <h2 tabindex="-1">Elige otro horario</h2>
    <p class="campo__ayuda">Con ${esc(profesionalDe(negocio, d.pr).nombre)}. Son los espacios libres cuando te escribimos.</p>
    <div class="opciones-hueco" role="radiogroup" aria-label="Horarios disponibles">
      ${opciones.length ? opciones.map((o, i) => `<label class="opcion-hueco"><input type="radio" name="hueco" value="${o.m}"${o.libre ? '' : ' disabled'}><span><strong>${esc(fechaLarga(o.inicio).replace(/^./, (c) => c.toUpperCase()))}</strong> · ${esc(horaTexto(o.inicio))}${o.libre ? '' : '<small>Ya lo tomó otra persona</small>'}</span></label>`).join('') : '<p class="vacio">No hay horarios alternativos en este enlace.</p>'}
    </div>
    <p class="campo__error" data-error-cambio tabindex="-1" hidden></p>
    <div class="respuestas">
      ${opciones.length ? '<button type="submit" class="boton boton--primario boton--grande">Cambiar a este horario</button>' : ''}
      <button type="button" class="boton boton--grande" data-llamenme>Prefiero que me llamen</button>
      <button type="button" class="boton boton--grande" data-volver>Volver</button>
    </div>
  </form>`;
  panel.querySelector('h2').focus();
}

function libreConAlgunaSala(neg, st, d, inicio, local) {
  if (!st) return true;
  return neg.salas.some((s) => validarCita(neg, st.citas, { inicio, servicioId: d.sv, profesionalId: d.pr, salaId: s.id }, local.reloj.ahora, { excluirCitaId: d.c }).length === 0);
}

function htmlResultado(tipo, vista, negocio, cita, guardada, entrega) {
  const inicio = deMinutos(vista.i);
  const cuandoResp = cita && cita.respuesta ? ` el ${fechaCorta(cita.respuesta.t)} a las ${horaTexto(cita.respuesta.t)}` : '';
  const ent = entrega ? htmlEntrega(entrega.estado, entrega.texto) : '';
  const ics = `<button type="button" class="boton" data-ics>${icono('descargar')} Agregar a mi calendario (.ics)</button>`;
  const check = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.6" class="relleno"/><path class="sobre resultado__marca" d="M5 8.3l2 2 4-4.3"/></svg>';
  if (tipo === 'confirmo') return `<div class="resultado resultado--ok" tabindex="-1"><p class="resultado__titulo">${check} Tu cita quedó confirmada</p><p>Te esperamos el ${esc(fechaLarga(inicio))} a las ${esc(horaTexto(inicio))}</p>${cuandoResp ? `<p class="campo__ayuda">Confirmaste${esc(cuandoResp)}</p>` : ''}${ent}<div class="acciones">${ics}</div></div>`;
  if (tipo === 'cambio') return `<div class="resultado resultado--ok" tabindex="-1"><p class="resultado__titulo">${check} Cambiamos tu cita</p><p>Ahora es el ${esc(fechaLarga(inicio))} a las ${esc(horaTexto(inicio))}. No hace falta que confirmes otra vez.</p>${ent}<div class="acciones">${ics}</div></div>`;
  if (tipo === 'cancelo') return `<div class="resultado resultado--cancelada" tabindex="-1"><p class="resultado__titulo">${icono('cancelada')} Avisamos que no podrás ir</p><p>Gracias por avisar: ese horario ya se le puede dar a otra persona. Si quieres otra cita, escríbenos o llama al ${esc(mostrarTelefono(negocio.telefono))}.</p>${ent}</div>`;
  if (tipo === 'llamenme') return `<div class="resultado resultado--aviso" tabindex="-1"><p class="resultado__titulo">${icono('llamar')} Te vamos a llamar</p><p>La recepción te llama para buscar otro horario. Mientras, tu cita sigue como está.</p>${ent}</div>`;
  if (tipo === 'ocupado') return `<div class="resultado resultado--aviso" tabindex="-1"><p class="resultado__titulo">${icono('aviso')} Ese horario se ocupó</p><p>Alguien lo tomó hace un momento. La recepción te llamará para buscar otro; tu cita sigue como estaba.</p>${ent}</div>`;
  if (tipo === 'cerrada' || tipo === 'pasada') return `<div class="resultado resultado--aviso" tabindex="-1"><p class="resultado__titulo">${icono('aviso')} Esta cita ya no se puede cambiar</p><p>Ya pasó o la recepción la cerró. Si necesitas algo, llama al ${esc(mostrarTelefono(negocio.telefono))}.</p></div>`;
  return '';
}

// ── Oferta de la lista de espera ─────────────────────────────────────

function iniciarOferta(d, negocio) {
  const clave = `${d.pl}:oferta:${d.o}:${d.e}`;
  const pintar = (resultado = null, entrega = null) => {
    const guardada = respuestasGuardadas()[clave];
    const local = agendaLocal(d);
    const oferta = local ? local.negocios[d.pl].ofertas.find((o) => o.id === d.o) : null;
    let estado = resultado || guardada?.tipo || null;
    if (!resultado && oferta && oferta.estado === 'tomada') estado = oferta.tomadaPor === d.e ? 'tuya' : 'tomada';
    let html = `<h1>Hola, ${esc(d.n)}</h1><p class="paciente__intro">Estás en la lista de espera y se liberó este espacio:</p>${htmlTarjeta(d, negocio)}`;
    if (!estado) {
      html += `<p style="margin-top:14px">Es del primero que lo acepte.</p><div class="respuestas"><button type="button" class="boton boton--primario boton--grande" data-oferta="si">Quiero ese espacio</button><button type="button" class="boton boton--grande" data-oferta="no">No me sirve</button></div>`;
    } else {
      const ent = entrega ? htmlEntrega(entrega.estado, entrega.texto) : '';
      const t = {
        tuya: ['ok', 'El espacio es tuyo', `Tu cita quedó confirmada para el ${fechaLarga(deMinutos(d.i))} a las ${horaTexto(deMinutos(d.i))}`],
        tomada: ['aviso', 'Otra persona lo tomó primero', 'Sigues en la lista de espera: te escribimos con el próximo espacio.'],
        enviada: ['ok', 'Recibimos tu respuesta', 'Si el espacio sigue libre, es tuyo; la recepción te confirma por WhatsApp.'],
        no: ['cancelada', 'Listo, sigues en la lista', 'Te avisamos cuando se libere otro espacio.'],
        vencida: ['aviso', 'Ese espacio ya no está libre', 'Sigues en la lista de espera.'],
      }[estado] || ['aviso', 'Respuesta registrada', ''];
      html += `<div class="resultado resultado--${t[0]}" tabindex="-1"><p class="resultado__titulo">${icono(t[0] === 'ok' ? 'confirmada' : 'aviso')} ${esc(t[1])}</p><p>${esc(t[2])}</p>${ent}</div>`;
    }
    html += `<div class="pie-paciente"><p>${esc(AVISO_RELEVO)}</p><p>Página de ejemplo hecha por alphateklab. ${esc(negocio.nombre)} es un negocio ficticio.</p></div>`;
    main.innerHTML = html;
  };
  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-oferta]');
    if (!b) return;
    const acepta = b.dataset.oferta === 'si';
    const id = nuevoId();
    const local = agendaLocal(d);
    let resultado = acepta ? 'enviada' : 'no';
    if (local && acepta) {
      let r;
      transaccion((e) => { r = aceptarOferta(e.negocios[d.pl], negocio, { id, ofertaId: d.o, esperaId: d.e }, e.reloj.ahora); }, 'oferta');
      resultado = r.resultado === 'tomada' || r.resultado === 'ya_es_tuya' ? (r.ok || r.resultado === 'ya_es_tuya' ? 'tuya' : 'tomada') : r.resultado === 'ya_no_libre' || r.resultado === 'vencida' ? 'vencida' : 'enviada';
    }
    guardarRespuesta(clave, { tipo: resultado, t: Date.now() });
    pintar(resultado, local ? null : { estado: 'enviando', texto: 'Avisando a la recepción…' });
    main.querySelector('.resultado')?.focus();
    if (!d.s) return;
    const pub = await publicar(d.s, mensajeOferta({ id, pl: d.pl, ofertaId: d.o, esperaId: d.e, acepta }));
    if (!local) {
      const e = main.querySelector('.entrega');
      if (e) e.outerHTML = pub.ok ? htmlEntrega('ok', 'Enviado a la recepción por el relevo de pruebas.') : htmlEntrega('error', `No pudimos avisar a la recepción (${pub.error}). Llama al ${mostrarTelefono(negocio.telefono)}.`);
    }
  });
  pintar();
}
