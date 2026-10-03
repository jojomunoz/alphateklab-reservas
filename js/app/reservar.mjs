// Autoagendamiento: servicio → profesional (o el primero disponible) → día → hora libre → datos y consentimiento.
// La solicitud queda pendiente en recepción (o confirmada, si el negocio lo configuró así).

import { esc, icono, $, mostrarErrores, descargar } from './ui.mjs';
import { cargar, transaccion, alCambiar } from './almacen.mjs';
import { iniciarBarra, plantillaCitas } from './demo.mjs';
import { publicar, AVISO_RELEVO } from './relevo.mjs';
import { NEGOCIOS_CITAS, textoConsentimiento } from '../nucleo/negocios.mjs';
import { fechaISO, fechaLarga, horaTexto, sumarDias, lunesDe, diaSemana, leerISO, DIAS_CORTOS, MESES, MIN } from '../nucleo/tiempo.mjs';
import { huecosDelDia, horasUnicas, motivoCierre, servicioDe, profesionalDe } from '../nucleo/agenda.mjs';
import { solicitarCita, negocioEfectivo } from '../nucleo/operaciones.mjs';
import { mensajeSolicitud } from '../nucleo/mensajes-relevo.mjs';
import { balboas } from '../nucleo/mensajes.mjs';
import { exportarCita } from '../nucleo/ical.mjs';
import { pintarHoras } from './componentes-citas.mjs';
import { mostrarTelefono } from '../nucleo/contacto.mjs';

let plantilla = plantillaCitas();
const salaRemota = (() => { const s = new URLSearchParams(location.hash.slice(1)).get('s'); return /^[a-z0-9]{10}$/.test(s || '') ? s : null; })();
const eleccion = { servicioId: null, profesionalId: null, fecha: null, inicio: null };
const main = $('#principal');

function negocioActual() {
  const estado = cargar();
  return { estado, negocio: NEGOCIOS_CITAS[plantilla], st: estado.negocios[plantilla], ahora: estado.reloj.ahora };
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
  pintarMarcaPaciente(negocio);
  document.title = `Pedir cita · ${negocio.nombre} (${negocio.rotulo})`;
  const s = eleccion.servicioId ? servicioDe(negocio, eleccion.servicioId) : null;
  const paso2 = !!s, paso3 = paso2, paso4 = paso3 && !!eleccion.fecha, paso5 = paso4 && !!eleccion.inicio;
  const hoy = fechaISO(ahora);
  const mes = (f) => MESES[leerISO(f).mes - 1];
  main.innerHTML = `
    <h1>Pide tu cita</h1>
    <p class="paciente__intro">${esc(negocio.nombre)} · ${esc(negocio.direccion)}. La recepción ${negocio.ajustes.autoConfirmar || st.ajustes.autoConfirmar ? 'te la confirma al momento' : 'la confirma y te escribe por WhatsApp'}.</p>
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
        <p class="nota nota--relevo">Demo: escribe datos inventados. ${salaRemota ? esc(AVISO_RELEVO) : 'La solicitud queda en este navegador.'}</p>
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
  for (const k of ['nombre', 'cedula', 'telefono', 'correo']) f.elements[k].value = p[k];
  f.elements.consentimiento.checked = p.consentimiento;
}

main.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const persona = leerPersona();
  if (!eleccion.servicioId || !eleccion.inicio) { mostrarErrores(form, [{ mensaje: 'Elige el servicio, el día y la hora.' }]); return; }
  const r = transaccion((e) => solicitarCita(e.negocios[plantilla], NEGOCIOS_CITAS[plantilla], { persona, servicioId: eleccion.servicioId, profesionalId: eleccion.profesionalId, inicio: eleccion.inicio }, e.reloj.ahora), 'autoagenda');
  if (!r.ok) {
    mostrarErrores(form, r.errores);
    if (r.errores.some((e) => /se acaba de ocupar/.test(e.mensaje))) { eleccion.inicio = null; }
    return;
  }
  let relevo = null;
  if (salaRemota) {
    relevo = await publicar(salaRemota, mensajeSolicitud({ id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, pl: plantilla, cita: { servicioId: eleccion.servicioId, profesionalId: eleccion.profesionalId, inicio: Math.round(eleccion.inicio / MIN) }, paciente: persona }));
  }
  pintarListo(r.cita, r.paciente, relevo);
});

function pintarListo(cita, paciente, relevo) {
  const { negocio } = negocioActual();
  const confirmada = cita.estado === 'confirmada';
  main.innerHTML = `
    <h1>Listo, ${esc(paciente.nombre.split(' ')[0])}</h1>
    <div class="resultado resultado--ok" tabindex="-1">
      <p class="resultado__titulo">${icono('confirmada')} ${confirmada ? 'Tu cita quedó confirmada' : 'Tu solicitud llegó a la recepción'}</p>
      <p><strong>${esc(fechaLarga(cita.inicio).replace(/^./, (c) => c.toUpperCase()))}, ${esc(horaTexto(cita.inicio))}</strong></p>
      <p>${esc(servicioDe(negocio, cita.servicioId).nombre)} con ${esc(profesionalDe(negocio, cita.profesionalId).nombre)}.</p>
      <p>${confirmada ? 'Te escribiremos por WhatsApp un día antes para recordártela.' : `Te escribiremos por WhatsApp a ${esc(mostrarTelefono(paciente.telefono))} para confirmarla. Si no puedes ir, avísanos desde ese mensaje.`}</p>
      ${relevo ? `<p class="entrega" data-estado="${relevo.ok ? 'ok' : 'error'}">${relevo.ok ? 'Enviada también a la pantalla de recepción por el relevo de pruebas.' : `No llegó a la otra pantalla (${esc(relevo.error)}); quedó en este navegador.`}</p>` : ''}
      <div class="acciones"><button type="button" class="boton" data-ics>${icono('descargar')} Agregar a mi calendario (.ics)</button><a class="boton" href="reservar.html${salaRemota ? `#s=${salaRemota}` : ''}" data-otra>Pedir otra cita</a></div>
    </div>
    <p class="pie-paciente">¿Eres de la recepción? Mira la cita en la <a href="citas.html">agenda</a>.</p>`;
  main.querySelector('.resultado').focus();
  main.querySelector('[data-ics]').addEventListener('click', () => {
    descargar(`cita-${fechaISO(cita.inicio)}.ics`, exportarCita({ uid: `${cita.id}@reservas.alphateklab`, inicio: cita.inicio, fin: cita.fin, dtstamp: Date.now(), resumen: `Cita en ${negocio.nombre}`, lugar: negocio.direccion, descripcion: `${negocio.nombre} (${negocio.rotulo}).` }));
  });
  main.querySelector('[data-otra]').addEventListener('click', (e) => { e.preventDefault(); Object.assign(eleccion, { servicioId: null, profesionalId: null, fecha: null, inicio: null }); pintar(); });
}

iniciarBarra({ pagina: 'reservar.html', tipo: 'citas', alCambiarPlantilla: (id) => { plantilla = id; Object.assign(eleccion, { servicioId: null, profesionalId: null, fecha: null, inicio: null }); pintar(); } });
pintar();
alCambiar((e, info) => { if (!info.local) { const p = leerPersona(); pintar(); ponerPersona(p); } });
