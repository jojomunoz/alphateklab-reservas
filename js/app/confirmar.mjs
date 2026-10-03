// Página del paciente: se abre desde el enlace del recordatorio. Los datos de la cita vienen en el fragmento (#), que
// no viaja a ningún servidor. Responde con un toque.
// - Si la agenda de la recepción está en este mismo navegador, la respuesta se aplica aquí y no sale nada.
// - Si está en otro dispositivo, la respuesta viaja por el relevo de pruebas (ntfy.sh) y la página no da nada por
//   hecho hasta que la recepción contesta con el resultado real (acuse): el teléfono no conoce su agenda ni su reloj.

import { esc, icono, $, descargar } from './ui.mjs';
import { leer, transaccion, respuestasGuardadas, guardarRespuesta, preferencia } from './almacen.mjs';
import { iniciarBarra, plantillaCitas } from './demo.mjs';
import { publicar, escuchar, AVISO_RELEVO } from './relevo.mjs';
import { decodificar, deMinutos } from '../nucleo/enlace.mjs';
import { NEGOCIOS_CITAS, negocioCitas } from '../nucleo/negocios.mjs';
import { fechaLarga, horaTexto, fechaISO, fechaCorta, MIN } from '../nucleo/tiempo.mjs';
import { profesionalDe, servicioDe, salaDe, validarCita } from '../nucleo/agenda.mjs';
import { responder, aceptarOferta, citaDe, negocioEfectivo } from '../nucleo/operaciones.mjs';
import { mensajeRespuesta, mensajeOferta, esAcuseDe } from '../nucleo/mensajes-relevo.mjs';
import { exportarCita } from '../nucleo/ical.mjs';
import { mostrarTelefono } from '../nucleo/contacto.mjs';

const main = $('#principal');
// Otro enlace en la misma pestaña: volver a leer todo.
addEventListener('hashchange', () => location.reload());
// Sin saber de qué negocio es el enlace, la página lleva la marca del negocio que se está viendo en la demo.
const negocioDemo = NEGOCIOS_CITAS[plantillaCitas()];
const lectura = decodificar(location.hash, negocioDemo.vocab.alNegocio);
// Cuánto esperar el acuse de la recepción antes de decir que su pantalla puede estar cerrada.
const ESPERA_ACUSE_MS = 20000;
// Solo los datos de la demo y las respuestas guardadas cambian lo que se ve aquí (no las preferencias ni la prueba de
// almacenamiento de otras pestañas).
const CLAVES_QUE_PINTAN = new Set(['atk-reservas', 'atk-reservas-respuestas']);

function pintarMarcaPaciente(negocio) {
  $('#marca').innerHTML = `<div class="marca__dentro"><div class="marca__logo"><span class="marca__nombre">${esc(negocio.nombre)}</span><span class="marca__rotulo">${esc(negocio.rotulo)} · ${esc(negocio.ciudad)}</span></div></div>`;
}

function pintarError(texto) {
  main.innerHTML = `<h1>No pudimos abrir tu cita</h1><div class="alerta error-enlace" role="alert"><p class="alerta__titulo">${icono('aviso')} El enlace no sirve</p><p>${esc(texto)}</p></div>
    <p class="pie-paciente">Si te llegó por WhatsApp, revisa que el enlace esté completo: a veces se corta al copiarlo.</p>`;
}

const nuevoId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const mayuscula = (t) => t.replace(/^./, (c) => c.toUpperCase());

/** ¿La agenda de esta cita está en este mismo navegador? (misma sala de la demo) */
function agendaLocal(d) {
  const e = leer();
  return e && d.s && e.sala === d.s ? e : null;
}

function htmlTarjeta(d, negocio) {
  const inicio = deMinutos(d.i);
  const s = servicioDe(negocio, d.sv);
  const v = negocio.vocab;
  return `<div class="tarjeta-cita">
    <div class="tarjeta-cita__cuando"><p class="tarjeta-cita__fecha">${esc(mayuscula(fechaLarga(inicio)))}</p><p class="tarjeta-cita__hora"><time>${esc(horaTexto(inicio))}</time></p></div>
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

const pie = (negocio) => `<div class="pie-paciente"><p>${esc(AVISO_RELEVO)}</p><p>Página de ejemplo hecha por alphateklab. ${esc(negocio.nombre)} es un negocio ficticio.</p></div>`;

/** Escucha el acuse de la recepción para el mensaje `id`. Devuelve la función que deja de escuchar. */
function esperarAcuse(sala, id, idRelevo, alLlegar) {
  let listo = false;
  const cerrar = escuchar(sala, (m) => {
    if (listo || !esAcuseDe(m, id)) return;
    listo = true;
    cerrar();
    alLlegar(m);
  }, () => {}, { desde: idRelevo });
  return () => { listo = true; cerrar(); };
}

// ── Cita ──────────────────────────────────────────────────────────────

/** Lo que dice el acuse, en el vocabulario de la página. */
const DESDE_ACUSE = { confirmada: 'confirmo', cancelada: 'cancelo', reprogramada: 'cambio', llamar: 'llamenme', hueco_ocupado: 'ocupado', hueco_pasado: 'hueco_pasado', cerrada: 'cerrada', no_existe: 'no_existe' };

function iniciarCita(d, negocio) {
  const clave = `${d.pl}:${d.c}`;
  let dejarDeEsperar = null;
  let esperaVencida = false;

  const estadoActual = () => {
    const local = agendaLocal(d);
    if (local) {
      const c = citaDe(local.negocios[d.pl], d.c);
      if (!c) return { noExiste: true };
      return { local, cita: c, ahora: local.reloj.ahora };
    }
    return { guardada: respuestasGuardadas()[clave] || null };
  };

  /** En la agenda local, qué ve la persona según el estado real de su cita. */
  const resultadoLocal = (c, ahora) => {
    if (c.estado === 'cancelada') return c.respuesta && c.respuesta.tipo === 'cancelo' ? 'cancelo' : 'cancelada_negocio';
    if (['atendida', 'no_asistio'].includes(c.estado) || c.inicio <= ahora) return 'pasada';
    if (c.estado === 'confirmada') return 'confirmo';
    if (c.respuesta && ['llamenme', 'cambio'].includes(c.respuesta.tipo)) return 'llamenme';
    return null;
  };

  /** Desde lo guardado en el teléfono (agenda en otro dispositivo). */
  const resultadoRemoto = (g) => {
    if (!g || !g.estado) return null;
    if (g.estado === 'fallida') return 'fallida';
    if (g.estado === 'acusada' && g.acuse) return DESDE_ACUSE[g.acuse.resultado] || 'cerrada';
    return `pend_${g.tipo}`;
  };

  const pintar = (entrega = null) => {
    const ea = estadoActual();
    if (ea.noExiste) { pintarError(`Esta cita ya no está en la agenda de ${negocio.nombre}. Pide un enlace nuevo ${negocio.vocab.alNegocio}.`); return; }
    const c = ea.cita, g = ea.guardada;
    const resultado = c ? resultadoLocal(c, ea.ahora) : resultadoRemoto(g);
    if (resultado === 'no_existe') { pintarError(`Esta cita ya no está en la agenda de ${negocio.nombre}. Pide un enlace nuevo ${negocio.vocab.alNegocio}.`); return; }
    // La tarjeta muestra la hora vigente: la de la agenda local o la que confirmó la recepción en su acuse.
    const iAcuse = g && g.estado === 'acusada' && g.acuse && Number.isInteger(g.acuse.inicio) ? g.acuse.inicio : null;
    const vista = c ? { ...d, i: Math.round(c.inicio / MIN), pr: c.profesionalId, sl: c.salaId } : iAcuse ? { ...d, i: iAcuse } : d;
    const cerrada = ['cancelo', 'cancelada_negocio', 'pasada', 'cerrada'].includes(resultado);
    let html = `<h1>Hola, ${esc(d.n)}</h1><p class="paciente__intro">${cerrada ? 'Esta era tu cita:' : 'Esta es tu cita:'}</p>${htmlTarjeta(vista, negocio)}`;
    if (resultado) html += htmlResultado(resultado, { vista, negocio, cita: c, guardada: g, entrega, esperaVencida });
    const conBotones = !resultado || ['confirmo', 'cambio', 'llamenme', 'ocupado', 'hueco_pasado', 'fallida'].includes(resultado);
    if (conBotones) {
      const yaConfirmada = resultado === 'confirmo' || resultado === 'cambio';
      html += `<div class="respuestas" data-respuestas>
        ${yaConfirmada ? '<p class="campo__ayuda">¿Cambió algo?</p>' : '<button type="button" class="boton boton--primario boton--grande" data-r="confirmo">Confirmo mi cita</button>'}
        <button type="button" class="boton boton--grande" data-r="cambiar">Necesito cambiarla</button>
        <button type="button" class="boton boton--grande boton--texto-peligro" data-r="cancelar">No podré ir</button>
      </div><div data-panel></div>`;
    } else if (resultado && resultado.startsWith('pend_')) {
      html += `<p class="campo__ayuda" style="margin-top:14px">Si necesitas otra cosa mientras tanto, llama al ${esc(mostrarTelefono(negocio.telefono))}.</p>`;
    }
    html += pie(negocio);
    main.innerHTML = html;
  };

  /** Si quedó una respuesta enviada sin acuse (la página se recargó), se vuelve a escuchar. */
  const reanudarEspera = () => {
    const g = respuestasGuardadas()[clave];
    if (!g || g.estado !== 'enviada' || !d.s || agendaLocal(d) || dejarDeEsperar) return;
    escucharAcuse(g.id, g.idRelevo || null);
  };

  const escucharAcuse = (id, idRelevo) => {
    if (dejarDeEsperar) dejarDeEsperar();
    esperaVencida = false;
    const reloj = setTimeout(() => { esperaVencida = true; pintar(); }, ESPERA_ACUSE_MS);
    dejarDeEsperar = esperarAcuse(d.s, id, idRelevo, (acuse) => {
      clearTimeout(reloj);
      dejarDeEsperar = null;
      const g = respuestasGuardadas()[clave] || {};
      guardarRespuesta(clave, { ...g, estado: 'acusada', acuse: { resultado: acuse.resultado, inicio: acuse.inicio ?? null } });
      pintar({ estado: 'ok', texto: 'La recepción lo recibió y su agenda ya lo muestra.' });
      main.querySelector('.resultado')?.focus();
    });
  };

  async function enviar(tipo, hueco = null) {
    const id = nuevoId();
    const local = agendaLocal(d);
    if (local) {
      // La agenda está aquí: se aplica aquí y no sale nada por el relevo.
      let r;
      transaccion((e) => { r = responder(e.negocios[d.pl], negocio, { id, citaId: d.c, tipo, hueco: hueco ? deMinutos(hueco) : null, via: 'enlace' }, e.reloj.ahora); }, 'respuesta');
      const inmediato = r.resultado === 'reprogramada' ? 'cambio' : r.resultado === 'hueco_ocupado' ? 'ocupado' : r.resultado === 'hueco_pasado' ? 'hueco_pasado' : null;
      pintar({ estado: 'ok', texto: `La agenda de ${negocio.nombre} ya lo muestra (está en este mismo navegador).` });
      if (inmediato) {
        // Pintar con el resultado del momento (cambio hecho, u horario ocupado o pasado): la cita ya refleja el estado.
        const res = main.querySelector('.resultado');
        const html = htmlResultado(inmediato, { vista: { ...d, i: Math.round(citaDe(leer().negocios[d.pl], d.c).inicio / MIN) }, negocio, cita: null, guardada: null, entrega: { estado: 'ok', texto: `La agenda de ${negocio.nombre} ya lo muestra (está en este mismo navegador).` } });
        if (res) res.outerHTML = html; else main.querySelector('.tarjeta-cita').insertAdjacentHTML('afterend', html);
      }
      return;
    }
    if (!d.s) {
      guardarRespuesta(clave, { tipo, hueco, t: Date.now(), id, estado: 'fallida', error: 'este enlace no trae cómo avisar a la recepción' });
      pintar();
      return;
    }
    guardarRespuesta(clave, { tipo, hueco, t: Date.now(), id, estado: 'enviada' });
    pintar({ estado: 'enviando', texto: 'Avisando a la recepción…' });
    const pub = await publicar(d.s, mensajeRespuesta({ id, pl: d.pl, citaId: d.c, respuesta: tipo, hueco }));
    if (!pub.ok) {
      guardarRespuesta(clave, { tipo, hueco, t: Date.now(), id, estado: 'fallida', error: pub.error });
      pintar();
      return;
    }
    guardarRespuesta(clave, { tipo, hueco, t: Date.now(), id, estado: 'enviada', idRelevo: pub.idRelevo });
    escucharAcuse(id, pub.idRelevo);
    pintar({ estado: 'enviando', texto: 'Enviado por el relevo de pruebas. Esperando la respuesta de la recepción…' });
  }

  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-r]');
    if (b) {
      const r = b.dataset.r;
      const panel = main.querySelector('[data-panel]');
      if (r === 'confirmo') { await enviar('confirmo'); main.querySelector('.resultado')?.focus(); return; }
      if (r === 'cambiar') { pintarCambio(panel, d, negocio); return; }
      if (r === 'cancelar') {
        panel.innerHTML = `<div class="panel-respuesta"><h2 tabindex="-1">¿No podrás ir?</h2><p>Avisamos a la recepción y tu horario queda libre para otra persona. Si quieres otra fecha, elige «Necesito cambiarla».</p>
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
      const g = ea.guardada;
      const iAcuse = g && g.estado === 'acusada' && g.acuse && Number.isInteger(g.acuse.inicio) ? g.acuse.inicio : null;
      const inicio = c ? c.inicio : deMinutos(iAcuse ?? d.i);
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

  addEventListener('storage', (ev) => { if (CLAVES_QUE_PINTAN.has(ev.key)) pintar(); });
  pintar();
  reanudarEspera();
}

function pintarCambio(panel, d, negocio) {
  const local = agendaLocal(d);
  const st = local ? local.negocios[d.pl] : null;
  const neg = st ? negocioEfectivo(negocio, st) : negocio;
  // Con la agenda en este navegador se sabe si el horario sigue libre o si ya pasó. Desde otro dispositivo no: se
  // ofrece y la recepción contesta si todavía sirve.
  const opciones = d.hs.map((m) => {
    const inicio = deMinutos(m);
    return { m, inicio, estado: st ? estadoDelHueco(neg, st, d, inicio, local.reloj.ahora) : 'libre' };
  });
  const nota = { pasado: 'Ese horario ya pasó', ocupado: 'Ya lo tomó otra persona' };
  panel.innerHTML = `<form class="panel-respuesta" data-form-cambio novalidate>
    <h2 tabindex="-1">Elige otro horario</h2>
    <p class="campo__ayuda">Con ${esc(profesionalDe(negocio, d.pr).nombre)}. Son los espacios que estaban libres cuando te escribimos${st ? '' : '; la recepción confirma que sigan libres'}.</p>
    <div class="opciones-hueco" role="radiogroup" aria-label="Horarios disponibles">
      ${opciones.length ? opciones.map((o) => `<label class="opcion-hueco"><input type="radio" name="hueco" value="${o.m}"${o.estado === 'libre' ? '' : ' disabled'}><span><strong>${esc(mayuscula(fechaLarga(o.inicio)))}</strong> · ${esc(horaTexto(o.inicio))}${o.estado === 'libre' ? '' : `<small>${nota[o.estado]}</small>`}</span></label>`).join('') : '<p class="vacio">No hay horarios alternativos en este enlace.</p>'}
    </div>
    <p class="campo__error" data-error-cambio tabindex="-1" hidden></p>
    <div class="respuestas">
      ${opciones.some((o) => o.estado === 'libre') ? '<button type="submit" class="boton boton--primario boton--grande">Cambiar a este horario</button>' : ''}
      <button type="button" class="boton boton--grande" data-llamenme>Prefiero que me llamen</button>
      <button type="button" class="boton boton--grande" data-volver>Volver</button>
    </div>
  </form>`;
  panel.querySelector('h2').focus();
}

/** 'libre', 'pasado' (ya pasó en el reloj de la agenda) u 'ocupado' (choca con otra cita en todas las salas). */
function estadoDelHueco(neg, st, d, inicio, ahora) {
  if (inicio < ahora) return 'pasado';
  const cita = citaDe(st, d.c);
  const libre = neg.salas.some((s) => validarCita(neg, st.citas, { inicio, servicioId: d.sv, profesionalId: d.pr, salaId: s.id, pacienteId: cita ? cita.pacienteId : null }, ahora, { excluirCitaId: d.c }).length === 0);
  return libre ? 'libre' : 'ocupado';
}

function htmlResultado(tipo, { vista, negocio, cita, guardada, entrega, esperaVencida = false }) {
  const inicio = deMinutos(vista.i);
  const tel = esc(mostrarTelefono(negocio.telefono));
  const cuandoResp = cita && cita.respuesta ? ` el ${fechaCorta(cita.respuesta.t)} a las ${horaTexto(cita.respuesta.t)}` : '';
  let ent = entrega ? htmlEntrega(entrega.estado, entrega.texto) : '';
  if (!entrega && tipo === 'fallida' && guardada && guardada.error) ent = htmlEntrega('error', `No se pudo enviar: ${guardada.error}.`);
  if (!entrega && tipo.startsWith('pend_')) {
    ent = esperaVencida
      ? htmlEntrega('enviando', `La pantalla de recepción no ha contestado todavía (puede estar cerrada). Lo verá al abrirla; si es urgente, llama al ${mostrarTelefono(negocio.telefono)}.`)
      : htmlEntrega('enviando', 'Enviado por el relevo de pruebas. Esperando la respuesta de la recepción…');
  }
  const ics = `<button type="button" class="boton" data-ics>${icono('descargar')} Agregar a mi calendario (.ics)</button>`;
  const check = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.6" class="relleno"/><path class="sobre resultado__marca" d="M5 8.3l2 2 4-4.3"/></svg>';
  const caja = (clase, ico, titulo, cuerpo, extra = '') => `<div class="resultado resultado--${clase}" tabindex="-1"><p class="resultado__titulo">${ico} ${esc(titulo)}</p>${cuerpo}${ent}${extra}</div>`;
  const cuando = `${fechaLarga(inicio)} a las ${horaTexto(inicio)}`;
  const pedido = guardada && guardada.hueco ? deMinutos(guardada.hueco) : null;
  switch (tipo) {
    case 'confirmo': return caja('ok', check, 'Tu cita quedó confirmada', `<p>Te esperamos el ${esc(cuando)}</p>${cuandoResp ? `<p class="campo__ayuda">Confirmaste${esc(cuandoResp)}</p>` : ''}`, `<div class="acciones">${ics}</div>`);
    // horaTexto termina en «m.»: no se le pone otro punto.
    case 'cambio': return caja('ok', check, 'Cambiamos tu cita', `<p>Ahora es el ${esc(cuando)} No hace falta que confirmes otra vez.</p>`, `<div class="acciones">${ics}</div>`);
    case 'cancelo': return caja('cancelada', icono('cancelada'), 'Avisamos que no podrás ir', `<p>Gracias por avisar: ese horario ya se le puede dar a otra persona. Si quieres otra cita, escríbenos o llama al ${tel}.</p>`);
    case 'cancelada_negocio': return caja('cancelada', icono('cancelada'), `${negocio.nombre} canceló esta cita`, `<p>Si quieres buscar otra fecha, llama al ${tel}.</p>`);
    case 'llamenme': return caja('aviso', icono('llamar'), 'Te vamos a llamar', '<p>La recepción te llama para buscar otro horario. Mientras, tu cita sigue como está.</p>');
    case 'ocupado': return caja('aviso', icono('aviso'), 'Ese horario se ocupó', '<p>Alguien lo tomó hace un momento. La recepción te llamará para buscar otro; tu cita sigue como estaba.</p>');
    case 'hueco_pasado': return caja('aviso', icono('aviso'), 'Ese horario ya pasó', '<p>La recepción te llamará para buscar otro; tu cita sigue como estaba.</p>');
    case 'pasada':
    case 'cerrada': return caja('aviso', icono('aviso'), 'Esta cita ya no se puede cambiar', `<p>Ya pasó o la recepción la cerró. Si necesitas algo, llama al ${tel}.</p>`);
    case 'fallida': return caja('aviso', icono('aviso'), 'Tu respuesta no llegó a la recepción', `<p>Vuelve a intentarlo con los botones de abajo o llama al ${tel}.</p>`);
    // Enviado por el relevo, sin acuse todavía: se dice lo que pasó (se envió), no lo que no se sabe.
    case 'pend_confirmo': return caja('enviado', icono('reloj'), 'Enviamos tu confirmación', `<p>Tu cita es el ${esc(cuando)} La recepción la marca en su agenda cuando le llega.</p>`);
    case 'pend_cambio': return caja('enviado', icono('reloj'), pedido ? `Pediste cambiarla al ${fechaLarga(pedido)} a las ${horaTexto(pedido)}` : 'Pediste cambiarla', `<p>La recepción revisa que ese horario siga libre y te contesta aquí mismo. Mientras, tu cita sigue el ${esc(cuando)}</p>`);
    case 'pend_cancelo': return caja('enviado', icono('reloj'), 'Enviamos tu aviso', `<p>Le avisamos a la recepción que no podrás ir. Si quieres otra cita, llama al ${tel}.</p>`);
    case 'pend_llamenme': return caja('enviado', icono('reloj'), 'Pediste que te llamen', '<p>La recepción te llama para buscar otro horario. Mientras, tu cita sigue como está.</p>');
    default: return '';
  }
}

// ── Oferta de la lista de espera ─────────────────────────────────────

function iniciarOferta(d, negocio) {
  const clave = `${d.pl}:oferta:${d.o}:${d.e}`;
  let dejarDeEsperar = null;
  let esperaVencida = false;
  const TEXTOS = {
    tuya: ['ok', 'El espacio es tuyo', `Tu cita quedó confirmada para el ${fechaLarga(deMinutos(d.i))} a las ${horaTexto(deMinutos(d.i))}`],
    tomada: ['aviso', 'Otra persona lo tomó primero', 'Sigues en la lista de espera: te escribimos con el próximo espacio.'],
    enviada: ['enviado', 'Enviamos tu respuesta', 'Si el espacio sigue libre, es tuyo: la recepción te contesta aquí mismo.'],
    no: ['cancelada', 'Listo, sigues en la lista', 'Te avisamos cuando se libere otro espacio.'],
    vencida: ['aviso', 'Ese espacio ya no está libre', 'Sigues en la lista de espera.'],
    fallida: ['aviso', 'Tu respuesta no llegó a la recepción', `Vuelve a intentarlo o llama al ${mostrarTelefono(negocio.telefono)}.`],
  };
  const estadoDe = () => {
    const local = agendaLocal(d);
    const oferta = local ? local.negocios[d.pl].ofertas.find((o) => o.id === d.o) : null;
    if (oferta && oferta.estado === 'tomada') return oferta.tomadaPor === d.e ? 'tuya' : 'tomada';
    if (oferta && oferta.estado === 'vencida') return 'vencida';
    const g = respuestasGuardadas()[clave];
    if (!g) return null;
    if (g.estado === 'acusada' && g.acuse) return g.acuse;
    return g.estado === 'fallida' ? 'fallida' : g.tipo;
  };
  const pintar = (entrega = null) => {
    const estado = estadoDe();
    let html = `<h1>Hola, ${esc(d.n)}</h1><p class="paciente__intro">Estás en la lista de espera y se liberó este espacio:</p>${htmlTarjeta(d, negocio)}`;
    if (estado && estado !== 'fallida') {
      const t = TEXTOS[estado] || ['aviso', 'Respuesta registrada', ''];
      let ent = entrega ? htmlEntrega(entrega.estado, entrega.texto) : '';
      if (!entrega && estado === 'enviada') ent = htmlEntrega('enviando', esperaVencida ? `La pantalla de recepción no ha contestado todavía (puede estar cerrada). Si es urgente, llama al ${mostrarTelefono(negocio.telefono)}.` : 'Esperando la respuesta de la recepción…');
      html += `<div class="resultado resultado--${t[0]}" tabindex="-1"><p class="resultado__titulo">${icono(t[0] === 'ok' ? 'confirmada' : t[0] === 'enviado' ? 'reloj' : 'aviso')} ${esc(t[1])}</p><p>${esc(t[2])}</p>${ent}</div>`;
    } else {
      const g = respuestasGuardadas()[clave];
      if (estado === 'fallida') html += `<div class="resultado resultado--aviso" tabindex="-1"><p class="resultado__titulo">${icono('aviso')} ${esc(TEXTOS.fallida[1])}</p><p>${esc(TEXTOS.fallida[2])}</p>${g && g.error ? htmlEntrega('error', `No se pudo enviar: ${g.error}.`) : ''}</div>`;
      html += `<p style="margin-top:14px">Es del primero que lo acepte.</p><div class="respuestas"><button type="button" class="boton boton--primario boton--grande" data-oferta="si">Quiero ese espacio</button><button type="button" class="boton boton--grande" data-oferta="no">No me sirve</button></div>`;
    }
    html += pie(negocio);
    main.innerHTML = html;
  };
  const escucharAcuse = (id, idRelevo) => {
    if (dejarDeEsperar) dejarDeEsperar();
    esperaVencida = false;
    const reloj = setTimeout(() => { esperaVencida = true; pintar(); }, ESPERA_ACUSE_MS);
    dejarDeEsperar = esperarAcuse(d.s, id, idRelevo, (acuse) => {
      clearTimeout(reloj);
      dejarDeEsperar = null;
      const resultado = ['tuya', 'tomada', 'vencida'].includes(acuse.resultado) ? acuse.resultado : 'vencida';
      guardarRespuesta(clave, { ...(respuestasGuardadas()[clave] || {}), estado: 'acusada', acuse: resultado });
      pintar({ estado: 'ok', texto: 'La recepción lo recibió.' });
      main.querySelector('.resultado')?.focus();
    });
  };
  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-oferta]');
    if (!b) return;
    const acepta = b.dataset.oferta === 'si';
    const id = nuevoId();
    const local = agendaLocal(d);
    if (local) {
      // La agenda está aquí: se aplica aquí y no sale nada por el relevo.
      let resultado = 'no';
      if (acepta) {
        let r;
        transaccion((e) => (r = aceptarOferta(e.negocios[d.pl], negocio, { id, ofertaId: d.o, esperaId: d.e }, e.reloj.ahora)), 'oferta');
        resultado = r.ok || r.resultado === 'ya_es_tuya' ? 'tuya' : r.resultado === 'tomada' ? 'tomada' : 'vencida';
      }
      guardarRespuesta(clave, { tipo: acepta ? 'enviada' : 'no', t: Date.now(), id, estado: 'acusada', acuse: resultado });
      pintar(acepta ? { estado: 'ok', texto: `La agenda de ${negocio.nombre} ya lo muestra (está en este mismo navegador).` } : null);
      main.querySelector('.resultado')?.focus();
      return;
    }
    const tipo = acepta ? 'enviada' : 'no';
    if (!d.s) {
      guardarRespuesta(clave, { tipo, t: Date.now(), id, estado: 'fallida' });
      pintar();
      return;
    }
    guardarRespuesta(clave, { tipo, t: Date.now(), id, estado: 'enviada' });
    pintar({ estado: 'enviando', texto: 'Avisando a la recepción…' });
    main.querySelector('.resultado')?.focus();
    const pub = await publicar(d.s, mensajeOferta({ id, pl: d.pl, ofertaId: d.o, esperaId: d.e, acepta }));
    if (!pub.ok) {
      guardarRespuesta(clave, { tipo, t: Date.now(), id, estado: 'fallida', error: pub.error });
      pintar();
      main.querySelector('.resultado')?.focus();
      return;
    }
    guardarRespuesta(clave, { tipo, t: Date.now(), id, estado: acepta ? 'enviada' : 'acusada', acuse: acepta ? undefined : 'no', idRelevo: pub.idRelevo });
    if (acepta) escucharAcuse(id, pub.idRelevo);
    pintar(acepta ? null : { estado: 'ok', texto: 'Enviado a la recepción por el relevo de pruebas.' });
  });
  addEventListener('storage', (ev) => { if (CLAVES_QUE_PINTAN.has(ev.key)) pintar(); });
  pintar();
  const g = respuestasGuardadas()[clave];
  if (g && g.estado === 'enviada' && g.tipo === 'enviada' && d.s && !agendaLocal(d)) escucharAcuse(g.id, g.idRelevo || null);
}

// ── Arranque (al final: usa las funciones y constantes de arriba) ─────

if (!lectura.ok) {
  document.documentElement.dataset.marca = negocioDemo.id;
  iniciarBarra({ pagina: 'confirmar.html', tipo: 'paciente' });
  pintarMarcaPaciente(negocioDemo);
  pintarError(lectura.error);
} else {
  const d = lectura.datos;
  const negocio = negocioCitas(d.pl);
  if (!negocio || !profesionalDe(negocio, d.pr) || !salaDe(negocio, d.sl) || (d.k === 'c' && !servicioDe(negocio, d.sv))) {
    document.documentElement.dataset.marca = negocioDemo.id;
    iniciarBarra({ pagina: 'confirmar.html', tipo: 'paciente' });
    pintarMarcaPaciente(negocioDemo);
    pintarError(`Este enlace es de un negocio o de una cita que ya no existe. Pide un enlace nuevo ${negocio ? negocio.vocab.alNegocio : 'a quien te lo mandó'}.`);
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
