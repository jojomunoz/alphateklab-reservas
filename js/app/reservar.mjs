// Autoagendamiento: servicio → profesional (o el primero disponible) → día → hora libre → datos y consentimiento.
// La solicitud queda pendiente en recepción (o confirmada, si el negocio lo configuró así).
// Con #s=<sala> de OTRO navegador, la solicitud viaja por el relevo de pruebas y la página no la da por hecha hasta
// que la recepción contesta (acuse): las horas de esta página salen de la copia de la demo que tiene este teléfono,
// que puede tener otro reloj y otras citas.

import { esc, icono, $, mostrarErrores, descargar } from './ui.mjs';
import { cargar, transaccion, alCambiar } from './almacen.mjs';
import { iniciarBarra, plantillaCitas } from './demo.mjs';
import { publicar, escuchar, AVISO_RELEVO } from './relevo.mjs';
import { NEGOCIOS_CITAS, textoConsentimiento } from '../nucleo/negocios.mjs';
import { fechaISO, fechaLarga, fechaCorta, horaTexto, sumarDias, lunesDe, leerISO, DIAS_CORTOS, MESES, MIN } from '../nucleo/tiempo.mjs';
import { huecosDelDia, horasUnicas, motivoCierre, servicioDe, profesionalDe } from '../nucleo/agenda.mjs';
import { solicitarCita, negocioEfectivo, revisarDatosPersona } from '../nucleo/operaciones.mjs';
import { mensajeSolicitud, esAcuseDe } from '../nucleo/mensajes-relevo.mjs';
import { CANALES } from '../nucleo/recordatorios.mjs';
import { balboas } from '../nucleo/mensajes.mjs';
import { exportarCita } from '../nucleo/ical.mjs';
import { pintarHoras } from './componentes-citas.mjs';
import { mostrarTelefono } from '../nucleo/contacto.mjs';

let plantilla = plantillaCitas();
const salaDelEnlace = (() => { const s = new URLSearchParams(location.hash.slice(1)).get('s'); return /^[a-z0-9]{10}$/.test(s || '') ? s : null; })();
const eleccion = { servicioId: null, profesionalId: null, fecha: null, inicio: null };
const main = $('#principal');
const ESPERA_ACUSE_MS = 20000;
let dejarDeEsperar = null;

function negocioActual() {
  const estado = cargar();
  return { estado, negocio: NEGOCIOS_CITAS[plantilla], st: estado.negocios[plantilla], ahora: estado.reloj.ahora };
}

/** La sala de otro navegador, o null si el enlace no trae sala o es la de este mismo navegador. */
function salaRemota() {
  return salaDelEnlace && salaDelEnlace !== cargar().sala ? salaDelEnlace : null;
}

function pintarMarcaPaciente(negocio) {
  $('#marca').innerHTML = `<div class="marca__dentro"><div class="marca__logo"><span class="marca__nombre">${esc(negocio.nombre)}</span><span class="marca__rotulo">${esc(negocio.rotulo)} · ${esc(negocio.ciudad)}</span></div></div>`;
}

function libresPorDia(negocio, st, ahora, fecha) {
  return horasUnicas(huecosDelDia({ negocio: negocioEfectivo(negocio, st), citas: st.citas, fecha, servicioId: eleccion.servicioId, profesionalId: eleccion.profesionalId, ahora })).length;
}

function htmlDias(negocio, st, ahora) {
  const hoy = fechaISO(ahora);
  const inicio = lunesDe(hoy);
  let html = `<div class="dias" role="radiogroup" aria-label="Día">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<span class="dias__cabeza" aria-hidden="true">${DIAS_CORTOS[d]}</span>`).join('')}`;
  for (let i = 0; i < 21; i++) {
    const f = sumarDias(inicio, i);
    const pasado = f < hoy;
    const cierre = pasado ? null : motivoCierre(negocio, f);
    const n = pasado || cierre ? 0 : libresPorDia(negocio, st, ahora, f);
    const nota = pasado ? '' : cierre ? (cierre.startsWith('Feriado') ? 'feriado' : 'cerrado') : n ? `${n} libres` : 'lleno';
    const etiqueta = `${fechaLarga(f)}${pasado ? ', ya pasó' : cierre ? `, ${cierre.toLowerCase()}` : n ? `, ${n} horas libres` : ', sin horas libres'}`;
    html += `<div class="dia"><input type="radio" name="dia" id="dia-${f}" value="${f}"${!n ? ' disabled' : ''}${eleccion.fecha === f ? ' checked' : ''} aria-label="${esc(etiqueta)}"><label for="dia-${f}" aria-hidden="true">${leerISO(f).dia}<small>${nota}</small></label></div>`;
  }
  return html + '</div>';
}

function pintar() {
  const { negocio, st, ahora } = negocioActual();
  const v = negocio.vocab;
  const remota = salaRemota();
  pintarMarcaPaciente(negocio);
  document.title = `Pedir cita · ${negocio.nombre} (${negocio.rotulo})`;
  const s = eleccion.servicioId ? servicioDe(negocio, eleccion.servicioId) : null;
  const paso2 = !!s, paso3 = paso2, paso4 = paso3 && !!eleccion.fecha, paso5 = paso4 && !!eleccion.inicio;
  const hoy = fechaISO(ahora);
  const mes = (f) => MESES[leerISO(f).mes - 1];
  main.innerHTML = `
    <h1>Pide tu cita</h1>
    <p class="paciente__intro">${esc(negocio.nombre)} · ${esc(negocio.direccion)}. ${negocioEfectivo(negocio, st).ajustes.autoConfirmar ? 'La cita queda confirmada al momento.' : 'La recepción la confirma y te escribe por WhatsApp.'}</p>
    <form class="pasos" novalidate data-form>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      <fieldset class="paso">
        <legend><span class="paso__num">Paso 1 de 5</span>Servicio</legend>
        <div class="lista-opciones">${negocio.servicios.map((x) => `<label class="tarjeta-opcion"><input type="radio" name="servicio" value="${x.id}"${x.id === eleccion.servicioId ? ' checked' : ''}><span class="tarjeta-opcion__texto">${esc(x.nombre)}<small>${x.min} minutos</small></span><span class="tarjeta-opcion__precio">${balboas(x.precio * 100)}</span></label>`).join('')}</div>
        <p class="campo__ayuda">Precios de ejemplo.</p>
      </fieldset>
      <fieldset class="paso${paso2 ? '' : ' paso--bloqueado'}">
        <legend><span class="paso__num">Paso 2 de 5</span>${esc(v.Profesional)}</legend>
        <div class="lista-opciones">
          <label class="tarjeta-opcion"><input type="radio" name="profesional" value=""${!eleccion.profesionalId ? ' checked' : ''}><span class="tarjeta-opcion__texto">El primero disponible<small>Más horas para elegir</small></span></label>
          ${negocio.profesionales.filter((p) => !s || !p.servicios || p.servicios.includes(s.id)).map((p) => `<label class="tarjeta-opcion"><input type="radio" name="profesional" value="${p.id}"${p.id === eleccion.profesionalId ? ' checked' : ''}><span class="tarjeta-opcion__texto">${esc(p.nombre)}</span></label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="paso${paso3 ? '' : ' paso--bloqueado'}">
        <legend><span class="paso__num">Paso 3 de 5</span>Día · ${esc(mes(lunesDe(hoy)))}${mes(sumarDias(lunesDe(hoy), 20)) !== mes(lunesDe(hoy)) ? ` y ${esc(mes(sumarDias(lunesDe(hoy), 20)))}` : ''}</legend>
        ${paso3 ? htmlDias(negocio, st, ahora) : ''}
      </fieldset>
      <fieldset class="paso${paso4 ? '' : ' paso--bloqueado'}">
        <legend><span class="paso__num">Paso 4 de 5</span>Hora${eleccion.fecha ? ` · ${esc(fechaLarga(eleccion.fecha))}` : ''}</legend>
        ${remota ? '<p class="campo__ayuda">Estas horas salen de la copia de la agenda que tiene este teléfono; la recepción confirma con la suya.</p>' : ''}
        <div data-horas></div>
      </fieldset>
      <fieldset class="paso${paso5 ? '' : ' paso--bloqueado'}">
        <legend><span class="paso__num">Paso 5 de 5</span>Tus datos</legend>
        <div class="campo"><label for="rs-nombre">Nombre y apellido</label><input id="rs-nombre" name="nombre" type="text" autocomplete="name"></div>
        <div class="campo"><label for="rs-cedula">Cédula</label><input id="rs-cedula" name="cedula" type="text" autocomplete="off" placeholder="8-123-4567"></div>
        <div class="campo"><label for="rs-tel">Celular (WhatsApp)</label><input id="rs-tel" name="telefono" type="tel" inputmode="tel" autocomplete="tel" placeholder="6000-0000"></div>
        <div class="campo"><label for="rs-correo">Correo <span class="campo__ayuda">(opcional)</span></label><input id="rs-correo" name="correo" type="email" autocomplete="email"></div>
        <div class="consentimiento campo">
          <label class="opcion"><input type="checkbox" name="consentimiento"> <span>${esc(textoConsentimiento(negocio))}</span></label>
        </div>
        ${eleccion.inicio && s ? `<div class="resumen-pedido"><span>${esc(s.nombre)} · ${s.min} min · ${balboas(s.precio * 100)}</span><strong>${esc(fechaLarga(eleccion.inicio).replace(/^./, (c) => c.toUpperCase()))}, ${esc(horaTexto(eleccion.inicio))}</strong><span>${eleccion.profesionalId ? esc(profesionalDe(negocio, eleccion.profesionalId).nombre) : 'El primero disponible'}</span></div>` : ''}
        <p class="nota nota--relevo">Demo: escribe datos inventados. ${remota ? esc(AVISO_RELEVO) : 'La solicitud queda en este navegador.'}</p>
        <div class="enviar-fijo"><button type="submit" class="boton boton--primario boton--grande">Pedir la cita</button></div>
      </fieldset>
    </form>
    <div class="pie-paciente"><p>Página de ejemplo hecha por alphateklab. ${esc(negocio.nombre)} es un negocio ficticio.</p></div>`;
  if (paso4) {
    pintarHoras(main.querySelector('[data-horas]'), {
      negocio, st, ahora, fecha: eleccion.fecha, servicioId: eleccion.servicioId, profesionalId: eleccion.profesionalId,
      elegido: eleccion.inicio, nombre: 'hora',
      alElegirDia: (f) => { eleccion.fecha = f; eleccion.inicio = null; pintar(); main.querySelector('[name="hora"]')?.focus(); },
    });
  }
}

main.addEventListener('change', (ev) => {
  const t = ev.target;
  const datosPersona = leerPersona();
  if (t.name === 'servicio') { eleccion.servicioId = t.value; eleccion.fecha = null; eleccion.inicio = null; }
  else if (t.name === 'profesional') { eleccion.profesionalId = t.value || null; eleccion.inicio = null; }
  else if (t.name === 'dia') { eleccion.fecha = t.value; eleccion.inicio = null; }
  else if (t.name === 'hora') { eleccion.inicio = +t.value; }
  else return;
  const nombre = t.name, valor = t.value;
  pintar();
  ponerPersona(datosPersona);
  const igual = main.querySelector(`[name="${nombre}"][value="${CSS.escape(valor)}"]`);
  if (igual) igual.focus();
});

function leerPersona() {
  const f = main.querySelector('[data-form]');
  if (!f) return null;
  return { nombre: f.elements.nombre.value, cedula: f.elements.cedula.value, telefono: f.elements.telefono.value, correo: f.elements.correo.value, consentimiento: f.elements.consentimiento.checked };
}
function ponerPersona(p) {
  if (!p) return;
  const f = main.querySelector('[data-form]');
  if (!f) return;
  for (const k of ['nombre', 'cedula', 'telefono', 'correo']) f.elements[k].value = p[k];
  f.elements.consentimiento.checked = p.consentimiento;
}

let personaGuardada = null;

main.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  if (!form.matches('[data-form]')) return;
  const persona = leerPersona();
  if (!eleccion.servicioId || !eleccion.inicio) { mostrarErrores(form, [{ mensaje: 'Elige el servicio, el día y la hora.' }], { titulo: 'Falta elegir:' }); return; }
  const remota = salaRemota();
  if (remota) {
    // La agenda está en otro dispositivo: aquí solo se revisa el formulario; no se guarda nada en este teléfono.
    const { ahora } = negocioActual();
    const errores = revisarDatosPersona(persona, ahora).errores;
    if (errores.length) { mostrarErrores(form, errores); return; }
    personaGuardada = persona;
    await enviarRemota(remota, persona);
    return;
  }
  const r = transaccion((e) => solicitarCita(e.negocios[plantilla], NEGOCIOS_CITAS[plantilla], { persona, servicioId: eleccion.servicioId, profesionalId: eleccion.profesionalId, inicio: eleccion.inicio }, e.reloj.ahora), 'autoagenda');
  if (!r.ok) {
    if (r.errores.some((e) => ['solape_profesional', 'solape_sala', 'pasado', 'solape_paciente'].includes(e.codigo))) {
      // La hora ya no sirve: se vuelven a pintar las horas libres (sin ella) y se dice por qué.
      eleccion.inicio = null;
      pintar();
      ponerPersona(persona);
      mostrarErrores(main.querySelector('[data-form]'), r.errores);
      return;
    }
    mostrarErrores(form, r.errores);
    return;
  }
  pintarListo(r.cita, r.paciente);
});

/** Lo que la persona puede esperar, sacado de lo que de verdad quedó programado para su cita. */
function queSigue(st, cita, negocio, telefono) {
  const proximo = st.envios.filter((e) => e.citaId === cita.id && e.tipo === 'mensaje' && e.estado === 'programado').sort((a, b) => a.momento - b.momento)[0];
  const tel = mostrarTelefono(negocio.telefono);
  if (proximo) {
    const cuando = `el ${fechaCorta(proximo.momento)} a las ${horaTexto(proximo.momento)}`;
    return proximo.clase === 'aviso'
      ? `Te escribiremos por ${CANALES[proximo.canal]} ${cuando} para recordártela. Si no puedes ir, avísanos desde ese mensaje o llama al ${tel}.`
      : `Te escribiremos por ${CANALES[proximo.canal]} a ${mostrarTelefono(telefono)} ${cuando} para confirmarla. Si no puedes ir, avísanos desde ese mensaje.`;
  }
  return cita.estado === 'confirmada'
    ? `Si no puedes ir, avísanos al ${tel}.`
    : `Queda pendiente en la recepción. Si no puedes ir, avísanos al ${tel}.`;
}

function pintarListo(cita, paciente) {
  const { negocio, st } = negocioActual();
  const confirmada = cita.estado === 'confirmada';
  main.innerHTML = `
    <h1>Listo, ${esc(paciente.nombre.split(' ')[0])}</h1>
    <div class="resultado resultado--ok" tabindex="-1">
      <p class="resultado__titulo">${icono('confirmada')} ${confirmada ? 'Tu cita quedó confirmada' : 'Tu solicitud llegó a la recepción'}</p>
      <p><strong>${esc(fechaLarga(cita.inicio).replace(/^./, (c) => c.toUpperCase()))}, ${esc(horaTexto(cita.inicio))}</strong></p>
      <p>${esc(servicioDe(negocio, cita.servicioId).nombre)} con ${esc(profesionalDe(negocio, cita.profesionalId).nombre)}.</p>
      <p>${esc(queSigue(st, cita, negocio, paciente.telefono))}</p>
      <div class="acciones"><button type="button" class="boton" data-ics>${icono('descargar')} Agregar a mi calendario (.ics)</button><a class="boton" href="reservar.html" data-otra>Pedir otra cita</a></div>
    </div>
    <p class="pie-paciente">¿Eres de la recepción? Mira la cita en la <a href="citas.html?cita=${encodeURIComponent(cita.id)}">agenda</a>.</p>`;
  main.querySelector('.resultado').focus();
  main.querySelector('[data-ics]').addEventListener('click', () => {
    descargar(`cita-${fechaISO(cita.inicio)}.ics`, exportarCita({ uid: `${cita.id}@reservas.alphateklab`, inicio: cita.inicio, fin: cita.fin, dtstamp: Date.now(), resumen: `Cita en ${negocio.nombre}`, lugar: negocio.direccion, descripcion: `${negocio.nombre} (${negocio.rotulo}).` }));
  });
  main.querySelector('[data-otra]').addEventListener('click', (e) => { e.preventDefault(); reiniciar(); });
}

function reiniciar() {
  if (dejarDeEsperar) { dejarDeEsperar(); dejarDeEsperar = null; }
  Object.assign(eleccion, { servicioId: null, profesionalId: null, fecha: null, inicio: null });
  personaGuardada = null;
  pintar();
}

// ── Solicitud a una recepción en otro dispositivo ─────────────────────

async function enviarRemota(sala, persona) {
  const { negocio } = negocioActual();
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const pedido = { ...eleccion };
  pintarRemota({ estado: 'enviando', pedido, negocio, persona });
  const pub = await publicar(sala, mensajeSolicitud({ id, pl: plantilla, cita: { servicioId: pedido.servicioId, profesionalId: pedido.profesionalId, inicio: Math.round(pedido.inicio / MIN) }, paciente: persona }));
  if (!pub.ok) { pintarRemota({ estado: 'fallida', pedido, negocio, persona, error: pub.error }); return; }
  pintarRemota({ estado: 'esperando', pedido, negocio, persona });
  let listo = false;
  const reloj = setTimeout(() => { if (!listo) pintarRemota({ estado: 'sin-respuesta', pedido, negocio, persona }); }, ESPERA_ACUSE_MS);
  const cerrar = escuchar(sala, (m) => {
    if (listo || !esAcuseDe(m, id)) return;
    listo = true;
    clearTimeout(reloj);
    cerrar();
    dejarDeEsperar = null;
    pintarRemota({ estado: m.resultado === 'creada' ? 'creada' : 'rechazada', pedido, negocio, persona, acuse: m });
  }, () => {}, { desde: pub.idRelevo });
  dejarDeEsperar = () => { listo = true; clearTimeout(reloj); cerrar(); };
}

function pintarRemota({ estado, pedido, negocio, persona, error = null, acuse = null }) {
  const nombre = persona.nombre.trim().split(/\s+/)[0] || '';
  const inicio = acuse && Number.isInteger(acuse.inicio) ? acuse.inicio * MIN : pedido.inicio;
  const servicio = servicioDe(negocio, pedido.servicioId);
  const prof = pedido.profesionalId ? profesionalDe(negocio, pedido.profesionalId).nombre : 'el primero disponible';
  const tel = esc(mostrarTelefono(negocio.telefono));
  const cuando = `<p><strong>${esc(fechaLarga(inicio).replace(/^./, (c) => c.toUpperCase()))}, ${esc(horaTexto(inicio))}</strong></p><p>${esc(servicio.nombre)} con ${esc(prof)}.</p>`;
  const entrega = (e, t) => `<p class="entrega" data-estado="${e}" role="status">${esc(t)}</p>`;
  const caja = {
    enviando: ['enviado', 'reloj', 'Enviando tu solicitud', cuando + entrega('enviando', 'Avisando a la recepción…')],
    esperando: ['enviado', 'reloj', 'Enviamos tu solicitud', `${cuando}<p>La recepción revisa que la hora siga libre en su agenda y te contesta aquí mismo.</p>${entrega('enviando', 'Enviada por el relevo de pruebas. Esperando la respuesta de la recepción…')}`],
    'sin-respuesta': ['enviado', 'reloj', 'Enviamos tu solicitud', `${cuando}${entrega('enviando', `La pantalla de recepción no ha contestado todavía (puede estar cerrada). La verá al abrirla; si es urgente, llama al ${mostrarTelefono(negocio.telefono)}.`)}`],
    creada: ['ok', 'confirmada', acuse && acuse.estado === 'confirmada' ? 'Tu cita quedó confirmada' : 'Tu solicitud llegó a la recepción', `${cuando}<p>${acuse && acuse.estado === 'confirmada' ? `Si no puedes ir, avísanos al ${tel}.` : 'Queda pendiente: la recepción te escribe por WhatsApp para confirmarla.'}</p>${entrega('ok', 'La recepción la recibió y su agenda ya la muestra.')}`],
    rechazada: ['aviso', 'aviso', 'La recepción no pudo agendarla', `${cuando}<p>${esc(acuse && acuse.motivo ? acuse.motivo : 'Esa hora ya no está libre en su agenda.')}</p><div class="acciones"><button type="button" class="boton boton--primario" data-otra-hora>Elegir otra hora</button></div>`],
    fallida: ['aviso', 'aviso', 'Tu solicitud no llegó a la recepción', `${cuando}<p>No pudimos enviarla${error ? ` (${esc(error)})` : ''}. Vuelve a intentarlo o llama al ${tel}.</p><div class="acciones"><button type="button" class="boton boton--primario" data-otra-hora>Volver a intentarlo</button></div>`],
  }[estado];
  main.innerHTML = `
    <h1>${estado === 'creada' ? `Listo, ${esc(nombre)}` : `Hola, ${esc(nombre)}`}</h1>
    <div class="resultado resultado--${caja[0]}" tabindex="-1">
      <p class="resultado__titulo">${icono(caja[1])} ${esc(caja[2])}</p>
      ${caja[3]}
    </div>
    <div class="pie-paciente"><p>${esc(AVISO_RELEVO)}</p><p>Página de ejemplo hecha por alphateklab. ${esc(negocio.nombre)} es un negocio ficticio.</p></div>`;
  const res = main.querySelector('.resultado');
  if (['esperando', 'creada', 'rechazada', 'fallida'].includes(estado)) res.focus();
  main.querySelector('[data-otra-hora]')?.addEventListener('click', () => {
    if (estado === 'rechazada') eleccion.inicio = null;
    pintar();
    ponerPersona(personaGuardada);
    (main.querySelector('[name="hora"]') || main.querySelector('[name="servicio"]'))?.focus();
  });
}

iniciarBarra({ pagina: 'reservar.html', tipo: 'citas', alCambiarPlantilla: (id) => { plantilla = id; reiniciar(); } });
pintar();
alCambiar((e, info) => { if (!info.local && main.querySelector('[data-form]')) { const p = leerPersona(); pintar(); ponerPersona(p); } });
