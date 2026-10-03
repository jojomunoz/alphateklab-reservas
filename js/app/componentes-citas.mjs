// Diálogos y piezas de la recepción de citas: agendar, ver una cita, reprogramar, ficha y registro de pacientes,
// selector de horas libres y formulario de la regla de recordatorio.

import { esc, icono, abrirDialogo, confirmar, anunciar, mostrarErrores } from './ui.mjs';
import { transaccion, cargar, opcionesEnlace } from './almacen.mjs';
import { NEGOCIOS_CITAS, textoConsentimiento } from '../nucleo/negocios.mjs';
import {
  fechaISO, fechaLarga, fechaCorta, horaTexto, horaDeMinutos, minutosDelDia, sumarDias, msDeFecha, MIN,
} from '../nucleo/tiempo.mjs';
import { huecosDelDia, horasUnicas, proximoDiaConHueco, motivoCierre, servicioDe, profesionalDe, salaDe, ESTADOS, siguienteMomentoAbierto } from '../nucleo/agenda.mjs';
import { planificar, VENTANA, CANALES } from '../nucleo/recordatorios.mjs';
import {
  crearCita, reprogramarCita, cambiarEstado, marcarEnSala, registrarPaciente, revocarConsentimiento, renovarConsentimiento,
  eliminarPaciente, cambiarRegla, validarRegla, pacienteDe, citaDe, canalesDe, transicionesDe, agregarAEspera, componerEnvio,
} from '../nucleo/operaciones.mjs';
import { buscarPersonas, mostrarTelefono, enlaceWhatsApp, enlaceSMS, enlaceCorreo } from '../nucleo/contacto.mjs';
import { asistenciaDe } from '../nucleo/riesgo.mjs';
import { balboas } from '../nucleo/mensajes.mjs';
import { exportarCita } from '../nucleo/ical.mjs';
import { descargar } from './ui.mjs';

// ── Contexto ───────────────────────────────────────────────────────────────
// ctx.plantilla() → id del negocio de citas activo. Todo lo demás se lee fresco del almacén.
export function datos(ctx) {
  const estado = cargar();
  const id = ctx.plantilla();
  return { estado, st: estado.negocios[id], negocio: NEGOCIOS_CITAS[id], ahora: estado.reloj.ahora, id };
}

/** Ejecuta una operación del núcleo sobre el negocio activo, con el estado más reciente. */
export function operar(ctx, fn) {
  const id = ctx.plantilla();
  return transaccion((estado) => fn(estado.negocios[id], NEGOCIOS_CITAS[id], estado.reloj.ahora, estado));
}

export const insigniaEstado = (estado) =>
  `<span class="estado estado--${estado}">${icono(estado)}<span class="estado__texto">${ESTADOS[estado]}</span></span>`;

export const textoServicio = (s) => `${s.nombre} · ${s.min} min · ${balboas(s.precio * 100)}`;
const cuando = (ms) => `${fechaCorta(ms)}, ${horaTexto(ms)}`;

// ── Selector de horas libres ─────────────────────────────────────────────

/**
 * Pinta las horas libres de un día como botones de opción. Si no hay, dice por qué y ofrece el próximo día con espacio.
 * @returns {number[]} los inicios ofrecidos
 */
export function pintarHoras(cont, { negocio, st, ahora, fecha, servicioId, profesionalId, salaId, excluirCitaId, pacienteId = null, elegido, nombre = 'hora', alElegirDia }) {
  // Con la persona elegida, tampoco se ofrecen las horas en que ya tiene otra cita (con cualquier profesional).
  const args = { negocio: { ...negocio, ajustes: { ...negocio.ajustes, ...st.ajustes } }, citas: st.citas, fecha, servicioId, profesionalId: profesionalId || null, salaId: salaId || null, ahora, excluirCitaId, pacienteId };
  if (!fecha) { cont.innerHTML = '<p class="sin-horas">Elige una fecha para ver las horas libres.</p>'; return []; }
  if (fecha < fechaISO(ahora)) { cont.innerHTML = '<p class="sin-horas">Esa fecha ya pasó. Elige hoy o un día siguiente.</p>'; return []; }
  const horas = horasUnicas(huecosDelDia(args));
  if (!horas.length) {
    const motivo = motivoCierre(negocio, fecha);
    const prox = proximoDiaConHueco(args, 45);
    const prof = profesionalId ? profesionalDe(negocio, profesionalId).nombre : null;
    const porque = motivo
      ? (motivo.startsWith('Feriado') ? `El ${fechaLarga(fecha)} es feriado (${esc(motivo.slice(9))}): no se atiende.` : `El ${fechaLarga(fecha)} no se atiende.`)
      : `No quedan horas libres el ${fechaLarga(fecha)} para ${esc(servicioDe(negocio, servicioId).nombre.toLowerCase())}${prof ? ` con ${esc(prof)}` : ''}.`;
    cont.innerHTML = `<div class="sin-horas"><p>${porque}</p>${prox ? `<button type="button" class="boton" data-ir-dia="${prox}">Ver el ${esc(fechaLarga(prox))}, el próximo día con espacio</button>` : ''}</div>`;
    const b = cont.querySelector('[data-ir-dia]');
    if (b && alElegirDia) b.addEventListener('click', () => alElegirDia(prox));
    return [];
  }
  const manana = horas.filter((h) => minutosDelDia(h.inicio) < 12 * 60);
  const tarde = horas.filter((h) => minutosDelDia(h.inicio) >= 12 * 60);
  const grupo = (titulo, lista) => !lista.length ? '' : `
    <div class="horas__grupo"><p class="horas__titulo">${titulo}</p><div class="horas">
      ${lista.map((h, i) => {
        const idx = `${nombre}-${h.inicio}`;
        return `<input type="radio" id="${idx}" name="${nombre}" value="${h.inicio}"${h.inicio === elegido ? ' checked' : ''}><label for="${idx}">${horaTexto(h.inicio).replace(' a. m.', '').replace(' p. m.', '')}<span class="sr-only"> ${minutosDelDia(h.inicio) < 720 ? 'a. m.' : 'p. m.'}</span></label>`;
      }).join('')}
    </div></div>`;
  cont.innerHTML = grupo('Mañana', manana) + grupo('Tarde (p. m.)', tarde);
  return horas.map((h) => h.inicio);
}

// ── Regla de recordatorio ─────────────────────────────────────────────────

export function htmlRegla(regla, p = 'r') {
  const horas = [];
  for (let m = VENTANA[0]; m < VENTANA[1]; m += 30) horas.push(m);
  const op = (v, t, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${t}</option>`;
  const respaldo = regla.respaldo || '';
  return `
  <fieldset class="regla" data-regla>
    <legend>Recordatorio</legend>
    <div class="regla__dias">
      <label class="opcion"><input type="checkbox" name="dia2"${regla.dias.includes(2) ? ' checked' : ''}> 2 días antes</label>
      <label class="opcion"><input type="checkbox" name="dia1"${regla.dias.includes(1) ? ' checked' : ''}> 1 día antes</label>
    </div>
    <div class="formulario__fila formulario__fila--2">
      <div class="campo"><label for="${p}-hora">Hora de envío</label><select id="${p}-hora" name="horaRegla">${horas.map((m) => op(m, horaDeMinutos(m), m === regla.hora)).join('')}</select></div>
      <div class="campo"><label for="${p}-canal">Canal</label><select id="${p}-canal" name="canal">${Object.entries(CANALES).map(([k, t]) => op(k, t, k === regla.canal)).join('')}</select></div>
    </div>
    <label class="interruptor"><input type="checkbox" role="switch" name="insistir"${regla.insistir ? ' checked' : ''}> Insistir hasta que responda</label>
    <div class="regla__insistir" data-insistir${regla.insistir ? '' : ' hidden'}>
      <div class="formulario__fila formulario__fila--3">
        <div class="campo"><label for="${p}-cada">Volver a escribir cada</label><select id="${p}-cada" name="cadaHoras">${[2, 3, 4, 6, 8, 12].map((h) => op(h, `${h} horas`, h === regla.cadaHoras)).join('')}</select></div>
        <div class="campo"><label for="${p}-max">Máximo de mensajes</label><select id="${p}-max" name="maxIntentos">${[2, 3, 4, 5, 6].map((n) => op(n, `${n}`, n === regla.maxIntentos)).join('')}</select></div>
        <div class="campo"><label for="${p}-resp">Último intento por</label><select id="${p}-resp" name="respaldo">${op('', 'El mismo canal', !respaldo)}${op('sms', 'SMS', respaldo === 'sms')}${op('correo', 'Correo', respaldo === 'correo')}</select></div>
      </div>
      <p class="campo__ayuda">Solo se escribe entre las 8:00 a. m. y las 8:00 p. m., y nunca en la última hora antes de la cita; los mensajes salen también los días que el negocio cierra. Si se agotan sin respuesta, aparece «Llamar» en la lista de recepción, a una hora en que el negocio está abierto.</p>
    </div>
    <div><p class="etiqueta" id="${p}-plan-t">Así saldrían</p><ol class="plan" data-plan aria-labelledby="${p}-plan-t"></ol></div>
  </fieldset>`;
}

export function leerRegla(form) {
  const f = (n) => form.elements[n];
  const dias = [];
  if (f('dia2').checked) dias.push(2);
  if (f('dia1').checked) dias.push(1);
  const max = +f('maxIntentos').value;
  const respaldo = f('respaldo').value || null;
  return {
    dias,
    hora: +f('horaRegla').value,
    canal: f('canal').value,
    insistir: f('insistir').checked,
    cadaHoras: +f('cadaHoras').value,
    maxIntentos: max,
    respaldo,
    respaldoDesde: respaldo ? max : null,
    llamar: true,
  };
}

/**
 * Vista previa del plan con la regla del formulario: es la misma función, con las mismas opciones, que programa los
 * envíos (lo ya enviado cuenta y la tarea de llamar cae con el negocio abierto).
 */
export function pintarPlan(cont, { inicio, fin, regla, ahora, canales, vocab, negocio = null, previos = [] }) {
  if (!inicio) { cont.innerHTML = '<li class="plan__vacio">Elige la hora para ver cuándo saldrían.</li>'; return; }
  const siguienteAbierto = negocio ? (ms) => siguienteMomentoAbierto(negocio, ms) : undefined;
  const plan = planificar({ estado: 'pendiente', inicio, fin }, regla, ahora, { canales, previos, siguienteAbierto });
  if (!canales.length) { cont.innerHTML = '<li class="plan__vacio">Sin consentimiento para mensajes: no se le escribirá. Toca llamar.</li>'; return; }
  if (!plan.length) { cont.innerHTML = `<li class="plan__vacio">${previos.length ? 'Con lo que ya se le envió, esta regla no agrega más mensajes antes de la cita.' : 'No queda un momento razonable antes de la cita para escribir (de 8:00 a. m. a 8:00 p. m. y antes de la última hora). Si hace falta, llama.'}</li>`; return; }
  cont.innerHTML = plan.map((p) => p.tipo === 'llamar'
    ? `<li class="plan__llamar"><time>${esc(cuando(p.momento))}</time> <span>si no respondió: «${esc(vocab.llamar)}»</span></li>`
    : `<li><time>${esc(cuando(p.momento))}</time> <span>${CANALES[p.canal]} · ${p.intento} de ${p.de} · ${esc(p.etiqueta)}</span></li>`).join('');
}

function enlazarRegla(form, actualizar) {
  const ins = form.querySelector('[data-insistir]');
  form.elements.insistir.addEventListener('change', () => { ins.hidden = !form.elements.insistir.checked; actualizar(); });
  for (const n of ['dia2', 'dia1', 'horaRegla', 'canal', 'cadaHoras', 'maxIntentos', 'respaldo']) form.elements[n].addEventListener('change', actualizar);
}

// ── Agendar cita ──────────────────────────────────────────────────────────

/**
 * @param preset { pacienteId?, servicioId?, profesionalId?, salaId?, fecha?, inicio? }
 */
export function abrirNuevaCita(ctx, preset = {}) {
  const { negocio, st, ahora } = datos(ctx);
  const v = negocio.vocab;
  const hoy = fechaISO(ahora);
  let paciente = preset.pacienteId ? pacienteDe(st, preset.pacienteId) : null;
  const servicioInicial = preset.servicioId || negocio.servicios[0].id;
  const fechaInicial = preset.fecha || (preset.inicio ? fechaISO(preset.inicio) : hoy);
  const d = abrirDialogo({
    titulo: 'Agendar cita',
    clase: 'dialogo--ancho',
    cuerpo: `
    <form class="formulario" novalidate>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      <fieldset class="campo">
        <legend class="etiqueta">${esc(v.Persona)}</legend>
        <div data-elegido></div>
        <div class="buscador" data-buscador>
          <label for="nc-buscar" class="sr-only">Buscar ${esc(v.persona)}</label>
          <input id="nc-buscar" type="search" name="paciente" placeholder="Nombre, teléfono o cédula" autocomplete="off" aria-describedby="nc-buscar-ayuda" aria-controls="nc-resultados">
          <p id="nc-buscar-ayuda" class="campo__ayuda">Escribe al menos 2 letras o 3 números.</p>
          <ul class="resultados" id="nc-resultados" data-resultados hidden></ul>
          <p><button type="button" class="boton boton--plano" data-registrar>${icono('mas')} Registrar ${esc(v.persona)} nuevo</button></p>
        </div>
      </fieldset>
      <div class="formulario__fila formulario__fila--3 formulario__fila--servicio">
        <div class="campo"><label for="nc-servicio">Servicio</label><select id="nc-servicio" name="servicio">${negocio.servicios.map((s) => `<option value="${s.id}"${s.id === servicioInicial ? ' selected' : ''}>${esc(textoServicio(s))}</option>`).join('')}</select></div>
        <div class="campo"><label for="nc-prof">${esc(v.Profesional)}</label><select id="nc-prof" name="profesional"><option value="">El primero disponible</option>${negocio.profesionales.map((p) => `<option value="${p.id}"${p.id === preset.profesionalId ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="nc-sala">${esc(v.Sala)}</label><select id="nc-sala" name="sala"></select></div>
      </div>
      <div class="formulario__fila formulario__fila--2">
        <div class="campo"><label for="nc-fecha">Fecha</label><input id="nc-fecha" type="date" name="fecha" min="${hoy}" value="${fechaInicial}" aria-describedby="nc-fecha-texto"><p class="campo__ayuda" id="nc-fecha-texto" data-fecha-texto></p></div>
      </div>
      <fieldset class="campo"><legend class="etiqueta">Hora libre</legend><div data-horas></div></fieldset>
      ${htmlRegla(st.regla, 'nc')}
      <div class="acciones"><button type="submit" class="boton boton--primario">Agendar cita</button><button type="button" class="boton" data-cerrar>Cancelar</button></div>
    </form>`,
  });
  const form = d.querySelector('form');
  const el = (n) => form.elements[n];
  let elegido = preset.inicio || null;

  const pintarElegido = () => {
    const cont = form.querySelector('[data-elegido]');
    const busc = form.querySelector('[data-buscador]');
    if (!paciente) { cont.innerHTML = ''; busc.hidden = false; return; }
    const sin = !canalesDe(paciente).length;
    cont.innerHTML = `<div class="elegido"><div><strong>${esc(paciente.nombre)}</strong><small>${esc(mostrarTelefono(paciente.telefono))} · ${esc(paciente.cedula)}${sin ? ' · sin permiso para mensajes' : ''}</small></div><button type="button" class="boton" data-cambiar-persona>Cambiar</button></div>`;
    busc.hidden = true;
    cont.querySelector('[data-cambiar-persona]').addEventListener('click', () => { paciente = null; pintarElegido(); actualizarHoras(); el('paciente').focus(); });
  };

  const pintarSalas = () => {
    const s = servicioDe(negocio, el('servicio').value);
    const actual = el('sala').value || preset.salaId || '';
    el('sala').innerHTML = `<option value="">Asignar sola</option>` + negocio.salas.map((x) => {
      const permitida = !s.salas || s.salas.includes(x.id);
      return `<option value="${x.id}"${permitida ? '' : ' disabled'}${x.id === actual && permitida ? ' selected' : ''}>${esc(x.nombre)}${permitida ? '' : ' (no para este servicio)'}</option>`;
    }).join('');
  };

  const actualizarHoras = () => {
    const { st: s2, ahora: a2 } = datos(ctx);
    const ft = form.querySelector('[data-fecha-texto]');
    ft.textContent = /^\d{4}-\d{2}-\d{2}$/.test(el('fecha').value) ? fechaLarga(el('fecha').value) : '';
    pintarHoras(form.querySelector('[data-horas]'), {
      negocio, st: s2, ahora: a2, fecha: el('fecha').value, servicioId: el('servicio').value,
      profesionalId: el('profesional').value, salaId: el('sala').value, pacienteId: paciente ? paciente.id : null, elegido, nombre: 'hora',
      alElegirDia: (f) => { el('fecha').value = f; elegido = null; actualizarHoras(); form.querySelector('[name="hora"]')?.focus(); },
    });
    if (!form.querySelector(`[name="hora"][value="${elegido}"]`)) elegido = null;
    actualizarPlan();
  };

  const actualizarPlan = () => {
    const s = servicioDe(negocio, el('servicio').value);
    const canales = paciente ? canalesDe(paciente) : ['whatsapp', 'sms', 'correo'];
    pintarPlan(form.querySelector('[data-plan]'), { inicio: elegido, fin: elegido ? elegido + s.min * MIN : null, regla: leerRegla(form), ahora: datos(ctx).ahora, canales, vocab: v, negocio });
  };

  // Búsqueda de paciente.
  const res = form.querySelector('[data-resultados]');
  el('paciente').addEventListener('input', () => {
    const q = el('paciente').value.trim();
    const lista = q.length >= 2 ? buscarPersonas(datos(ctx).st.pacientes.filter((p) => !p.eliminado), q).slice(0, 8) : [];
    res.hidden = !q || q.length < 2;
    res.innerHTML = lista.length
      ? lista.map((p) => `<li><button type="button" data-persona="${p.id}"><span>${esc(p.nombre)}</span><small>${esc(mostrarTelefono(p.telefono))} · ${esc(p.cedula)}</small></button></li>`).join('')
      : `<li class="vacio">No hay nadie con «${esc(q)}». Revisa cómo lo escribiste o regístralo.</li>`;
  });
  res.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-persona]');
    if (!b) return;
    paciente = pacienteDe(datos(ctx).st, b.dataset.persona);
    res.hidden = true;
    el('paciente').value = '';
    pintarElegido();
    actualizarHoras();
    el('servicio').focus();
  });
  form.querySelector('[data-registrar]').addEventListener('click', () => {
    abrirRegistro(ctx, {
      nombreInicial: /\d/.test(el('paciente').value) ? '' : el('paciente').value,
      alGuardar: (p) => { paciente = p; pintarElegido(); actualizarHoras(); el('servicio').focus(); },
    });
  });

  el('servicio').addEventListener('change', () => { pintarSalas(); actualizarHoras(); });
  el('profesional').addEventListener('change', actualizarHoras);
  el('sala').addEventListener('change', actualizarHoras);
  el('fecha').addEventListener('change', () => { elegido = null; actualizarHoras(); });
  form.querySelector('[data-horas]').addEventListener('change', (ev) => { if (ev.target.name === 'hora') { elegido = +ev.target.value; actualizarPlan(); } });
  enlazarRegla(form, actualizarPlan);

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const errores = [];
    if (!paciente) errores.push({ campo: 'paciente', mensaje: `Elige ${v.persona === 'paciente' ? 'un paciente' : 'un cliente'} o regístralo.` });
    if (!elegido) errores.push({ campo: 'hora', mensaje: 'Elige una hora libre.' });
    const regla = leerRegla(form);
    errores.push(...validarRegla(regla).map((e) => ({ ...e, campo: e.campo === 'dias' ? 'dia2' : e.campo })));
    if (errores.length) { mostrarErrores(form, errores); return; }
    const r = operar(ctx, (st2, neg, ahora2) => crearCita(st2, neg, {
      pacienteId: paciente.id, servicioId: el('servicio').value, profesionalId: el('profesional').value || null,
      salaId: el('sala').value || null, inicio: elegido, regla,
    }, ahora2));
    if (!r.ok) {
      actualizarHoras();
      mostrarErrores(form, r.errores.map((e) => ({ mensaje: e.mensaje })));
      return;
    }
    d.close();
    anunciar(`Cita agendada: ${paciente.nombre}, ${fechaLarga(r.cita.inicio)} a las ${horaTexto(r.cita.inicio)}`);
    ctx.alCrear && ctx.alCrear(r.cita);
  });

  pintarElegido();
  pintarSalas();
  actualizarHoras();
  (paciente ? el('servicio') : el('paciente')).focus();
  return d;
}

// ── Ver una cita ──────────────────────────────────────────────────────────

function htmlEnvios(st, negocio, cita, ahora, estado) {
  const envios = st.envios.filter((e) => e.citaId === cita.id).sort((a, b) => a.momento - b.momento);
  if (!envios.length) return '<p class="vacio">Esta cita no tiene recordatorios programados.</p>';
  const p = pacienteDe(st, cita.pacienteId);
  return `<ul class="linea-envios">${envios.map((e) => {
    const quePasa = e.tipo === 'llamar'
      ? (e.estado === 'tarea' ? 'Pasó a «Llamar» en recepción' : e.estado === 'cancelado' ? `Llamada no necesaria: ${esc(e.motivoCancelacion)}` : 'Si no responde: tarea de llamar')
      : `${CANALES[e.canal]} · intento ${e.intento} de ${e.de} · ${esc(e.etiqueta)}`;
    const est = e.estado === 'enviado' ? '<span class="insignia insignia--ok">Enviado</span>'
      : e.estado === 'cancelado' ? `<span class="insignia">Detenido: ${esc(e.motivoCancelacion)}</span>`
        : e.estado === 'tarea' ? '<span class="insignia insignia--aviso">Tarea</span>' : '<span class="insignia insignia--primario">En cola</span>';
    let acciones = '';
    if (e.tipo === 'mensaje' && e.estado === 'enviado' && e.borrado) acciones = '<p class="campo__ayuda">Texto borrado junto con los datos de la persona.</p>';
    else if (e.tipo === 'mensaje' && e.estado === 'enviado' && p) {
      const abrir = botonAbrirEnvio(e, p);
      acciones = `<div class="acciones">${abrir}<a class="boton" href="${esc(e.enlace)}" target="_blank" rel="noopener">Ver como ${esc(negocio.vocab.persona)}</a></div>`;
    }
    return `<li><span class="${e.estado === 'cancelado' ? 'tachado' : ''}"><time>${esc(cuando(e.momento))}</time> · ${quePasa}</span>${est}${acciones}</li>`;
  }).join('')}</ul>`;
}

/**
 * El botón para mandar a mano un mensaje, según su canal: WhatsApp (wa.me), SMS (sms:) o correo (mailto:).
 * Sin el dato de contacto de ese canal, no hay botón.
 */
export function botonAbrirEnvio(e, p, { clase = 'boton', texto = null } = {}) {
  if (e.canal === 'sms' && p.telefono) return `<a class="${clase}" href="${esc(enlaceSMS(p.telefono, texto ?? e.texto))}">${icono('sms')} Abrir en SMS</a>`;
  if (e.canal === 'correo' && p.correo) return `<a class="${clase}" href="${esc(enlaceCorreo(p.correo, 'Tu cita', texto ?? e.texto))}">${icono('correo')} Abrir en el correo</a>`;
  if (p.telefono && e.canal !== 'correo') return `<a class="${clase}" href="${esc(enlaceWhatsApp(p.telefono, texto ?? e.texto))}" target="_blank" rel="noopener">${icono('whatsapp')} Abrir en WhatsApp</a>`;
  return '';
}

export function abrirCita(ctx, citaId) {
  let dlg = null;
  const pintar = () => {
    const { negocio, st, ahora, estado } = datos(ctx);
    const cita = citaDe(st, citaId);
    if (!cita) { dlg && dlg.close(); return; }
    const v = negocio.vocab;
    const p = pacienteDe(st, cita.pacienteId);
    const s = servicioDe(negocio, cita.servicioId);
    const trans = transicionesDe(cita);
    const yaEs = cita.inicio <= ahora + 15 * MIN;
    const botones = [];
    if (trans.includes('confirmada')) botones.push(`<button type="button" class="boton boton--primario" data-accion="confirmada">Marcar confirmada</button>`);
    if (['pendiente', 'reprogramada', 'confirmada'].includes(cita.estado)) {
      botones.push(`<button type="button" class="boton" data-accion="reprogramar">Reprogramar</button>`);
      if (fechaISO(cita.inicio) === fechaISO(ahora)) botones.push(`<button type="button" class="boton" data-accion="sala">${cita.enSala ? 'Quitar de la sala de espera' : 'Llegó: está en la sala'}</button>`);
    }
    if (trans.includes('atendida') && yaEs) botones.push(`<button type="button" class="boton" data-accion="atendida">${cita.estado === 'no_asistio' ? 'Corregir: sí fue atendida' : 'Atendida'}</button>`);
    if (trans.includes('no_asistio') && yaEs) botones.push(`<button type="button" class="boton" data-accion="no_asistio">${cita.estado === 'atendida' ? 'Corregir: no asistió' : 'No asistió'}</button>`);
    if (trans.includes('cancelada')) botones.push(`<button type="button" class="boton boton--peligro" data-accion="cancelada">Cancelar cita</button>`);
    const puedeRegla = ['pendiente', 'reprogramada'].includes(cita.estado);
    const respuesta = cita.respuesta ? `${{ confirmo: 'Confirmó', cancelo: 'Canceló', cambio: 'Pidió cambiarla', llamenme: 'Pidió que lo llamen' }[cita.respuesta.tipo] || cita.respuesta.tipo} ${cita.respuesta.via === 'relevo' ? 'desde otro dispositivo' : 'por el enlace'}` : 'Todavía no responde';
    const cuerpo = `
      <div class="bloque-dialogo">
        <p style="margin-bottom:10px">${insigniaEstado(cita.estado)} ${cita.enSala ? `<span class="insignia insignia--primario">${icono('sala')} En sala desde las ${esc(horaTexto(cita.enSala))}</span>` : ''}</p>
        <dl class="datos">
          <dt>Cuándo</dt><dd><strong>${esc(fechaLarga(cita.inicio))}</strong>, ${esc(horaTexto(cita.inicio))} a ${esc(horaTexto(cita.fin))}</dd>
          <dt>Servicio</dt><dd>${esc(textoServicio(s))}</dd>
          <dt>${esc(v.Profesional)}</dt><dd>${esc(profesionalDe(negocio, cita.profesionalId).nombre)}</dd>
          <dt>${esc(v.Sala)}</dt><dd>${esc(salaDe(negocio, cita.salaId).nombre)}</dd>
          <dt>${esc(v.Persona)}</dt><dd><button type="button" class="persona__nombre" data-accion="ficha">${esc(p ? p.nombre : '—')}</button>${p && p.telefono ? ` · <a href="tel:${esc(p.telefono)}">${esc(mostrarTelefono(p.telefono))}</a>` : ''}</dd>
          <dt>Respuesta</dt><dd>${esc(respuesta)}</dd>
          <dt>Origen</dt><dd>${cita.origen === 'autoagenda' ? 'La pidió en la página' : cita.origen === 'lista_espera' ? 'Lista de espera' : 'Recepción'}</dd>
        </dl>
        ${botones.length ? `<div class="acciones" style="margin-top:14px">${botones.join('')}</div>` : ''}
        <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      </div>
      <div class="bloque-dialogo">
        <h3>Recordatorios</h3>
        <p class="campo__ayuda" style="margin-bottom:6px">${esc(resumenRegla(cita.regla, cita))}</p>
        ${htmlEnvios(st, negocio, cita, ahora, estado)}
        ${puedeRegla ? '<p style="margin-top:8px"><button type="button" class="boton" data-accion="regla">Cambiar el recordatorio</button></p>' : ''}
        <div data-editar-regla></div>
      </div>
      <div class="bloque-dialogo">
        <h3>Historial</h3>
        <ul class="historial">${[...cita.historial].reverse().map((h) => `<li><time>${esc(cuando(h.t))}</time>${esc(h.texto)}</li>`).join('')}</ul>
        <p style="margin-top:10px"><button type="button" class="boton" data-accion="ics">${icono('descargar')} Descargar .ics de la cita</button></p>
      </div>`;
    if (!dlg) {
      dlg = abrirDialogo({ titulo: esc(p ? p.nombre : 'Cita'), cuerpo, alCerrar: () => { quitar(); } });
      dlg.addEventListener('click', alClic);
    } else {
      dlg.querySelector('.dialogo__titulo').textContent = p ? p.nombre : 'Cita';
      dlg.querySelector('.dialogo__cuerpo').innerHTML = cuerpo;
    }
  };
  const alClic = async (ev) => {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const accion = b.dataset.accion;
    const { negocio, st } = datos(ctx);
    const cita = citaDe(st, citaId);
    const p = pacienteDe(st, cita.pacienteId);
    const errores = dlg.querySelector('[data-errores]');
    const fallo = (r) => { if (r && r.ok === false) { mostrarErrores(dlg.querySelector('.bloque-dialogo'), r.errores || []); errores && (errores.hidden = false); } };
    if (accion === 'ficha') { abrirPaciente(ctx, cita.pacienteId); return; }
    if (accion === 'reprogramar') { abrirReprogramar(ctx, citaId); return; }
    if (accion === 'ics') { descargarIcsCita(negocio, cita); return; }
    if (accion === 'regla') { editarRegla(ctx, citaId, dlg.querySelector('[data-editar-regla]')); return; }
    if (accion === 'sala') { operar(ctx, (s) => marcarEnSala(s, citaId, datos(ctx).ahora)); return; }
    if (accion === 'cancelada') {
      const ok = await confirmar({
        titulo: 'Cancelar la cita',
        // horaTexto termina en «m.»: la frase no lleva otro punto.
        texto: `Se cancela la cita de ${esc(p ? p.nombre : '')} del ${esc(fechaLarga(cita.inicio))} a las ${esc(horaTexto(cita.inicio))} Se detienen sus recordatorios y el horario se ofrece a la lista de espera.`,
        si: 'Cancelar la cita', no: 'No cancelar', peligro: true,
      });
      if (!ok) return;
    }
    const r = operar(ctx, (s, neg, ahora) => cambiarEstado(s, neg, citaId, accion, ahora, { por: 'recepción' }));
    if (r.ok) {
      anunciar(`${p ? p.nombre : 'Cita'}: ${ESTADOS[accion].toLowerCase()}.${r.oferta ? ` El horario se ofreció a ${r.oferta.candidatos.length} de la lista de espera.` : ''}`);
    } else fallo(r);
  };
  const quitar = ctx.alCambiar ? ctx.alCambiar(() => { if (dlg && dlg.open) pintar(); }) : () => {};
  pintar();
  return dlg;
}

/** La regla en una frase. Para una cita confirmada, lo que de verdad aplica: un aviso, sin insistir. */
export function resumenRegla(regla, cita = null) {
  if (!regla) return 'Sin regla.';
  if (cita && cita.estado === 'confirmada') {
    const cercano = Math.min(...regla.dias);
    return `Confirmada: se le recuerda ${cercano === 0 ? 'el mismo día' : cercano === 1 ? '1 día antes' : `${cercano} días antes`}, a las ${horaDeMinutos(regla.hora)}, por ${CANALES[regla.canal]}, sin insistir.`;
  }
  const dias = regla.dias.length === 2 ? '2 días y 1 día antes' : regla.dias[0] === 2 ? '2 días antes' : '1 día antes';
  let t = `${dias}, a las ${horaDeMinutos(regla.hora)}, por ${CANALES[regla.canal]}.`;
  if (regla.insistir) t += ` Insiste cada ${regla.cadaHoras} h, hasta ${regla.maxIntentos} mensajes${regla.respaldo ? ` (el último por ${CANALES[regla.respaldo]})` : ''}; luego, llamar.`;
  return t;
}

function editarRegla(ctx, citaId, cont) {
  const { st, negocio } = datos(ctx);
  const cita = citaDe(st, citaId);
  cont.innerHTML = `<form class="formulario" style="margin-top:12px" novalidate>
    <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
    ${htmlRegla(cita.regla, 'er')}
    <div class="acciones"><button type="submit" class="boton boton--primario">Guardar el recordatorio</button><button type="button" class="boton" data-cancelar-regla>Dejarlo como estaba</button></div>
  </form>`;
  const form = cont.querySelector('form');
  if (st.envios.some((e) => e.citaId === citaId && e.tipo === 'mensaje' && e.estado === 'enviado')) {
    form.querySelector('[data-plan]').insertAdjacentHTML('beforebegin', '<p class="campo__ayuda">Lo que ya se le envió cuenta para el máximo: no se vuelve a empezar.</p>');
  }
  const paciente = pacienteDe(st, cita.pacienteId);
  const previos = st.envios.filter((e) => e.citaId === citaId && e.tipo === 'mensaje' && e.estado === 'enviado').map((e) => e.salioEn ?? e.momento);
  const actualizar = () => pintarPlan(form.querySelector('[data-plan]'), { inicio: cita.inicio, fin: cita.fin, regla: leerRegla(form), ahora: datos(ctx).ahora, canales: canalesDe(paciente), vocab: negocio.vocab, negocio, previos });
  enlazarRegla(form, actualizar);
  actualizar();
  form.querySelector('[data-cancelar-regla]').addEventListener('click', () => { cont.innerHTML = ''; });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const regla = leerRegla(form);
    const r = operar(ctx, (s, n, ahora) => cambiarRegla(s, citaId, regla, ahora, n));
    if (!r.ok) { mostrarErrores(form, r.errores.map((e) => ({ ...e, campo: e.campo === 'dias' ? 'dia2' : e.campo }))); return; }
    anunciar('Recordatorio actualizado: lo que faltaba se volvió a planificar.');
  });
  form.querySelector('select, input').focus();
}

export function descargarIcsCita(negocio, cita) {
  const prof = profesionalDe(negocio, cita.profesionalId);
  const ics = exportarCita({
    uid: `${cita.id}@reservas.alphateklab`, inicio: cita.inicio, fin: cita.fin, dtstamp: Date.now(),
    resumen: `Cita en ${negocio.nombre}`, lugar: negocio.direccion, descripcion: `Con ${prof.nombre}. ${negocio.nombre} (${negocio.rotulo}).`,
  });
  descargar(`cita-${fechaISO(cita.inicio)}.ics`, ics);
}

// ── Reprogramar ───────────────────────────────────────────────────────────

export function abrirReprogramar(ctx, citaId) {
  const { negocio, st, ahora } = datos(ctx);
  const cita = citaDe(st, citaId);
  const p = pacienteDe(st, cita.pacienteId);
  const v = negocio.vocab;
  const d = abrirDialogo({
    titulo: `Reprogramar a ${esc(p ? p.nombre : '')}`,
    cuerpo: `<form class="formulario" novalidate>
      <p>Ahora: <strong>${esc(fechaLarga(cita.inicio))}, ${esc(horaTexto(cita.inicio))}</strong> con ${esc(profesionalDe(negocio, cita.profesionalId).nombre)}.</p>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      <div class="formulario__fila formulario__fila--2">
        <div class="campo"><label for="rp-prof">${esc(v.Profesional)}</label><select id="rp-prof" name="profesional">${negocio.profesionales.map((x) => `<option value="${x.id}"${x.id === cita.profesionalId ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="rp-fecha">Fecha nueva</label><input id="rp-fecha" type="date" name="fecha" min="${fechaISO(ahora)}" value="${fechaISO(Math.max(cita.inicio, ahora))}"></div>
      </div>
      <fieldset class="campo"><legend class="etiqueta">Hora libre</legend><div data-horas></div></fieldset>
      <p class="campo__ayuda">Los recordatorios que faltaban se detienen y se vuelven a planificar para la hora nueva.</p>
      <div class="acciones"><button type="submit" class="boton boton--primario">Mover la cita</button><button type="button" class="boton" data-cerrar>Cancelar</button></div>
    </form>`,
  });
  const form = d.querySelector('form');
  let elegido = null;
  const pintar = () => {
    const x = datos(ctx);
    pintarHoras(form.querySelector('[data-horas]'), {
      negocio, st: x.st, ahora: x.ahora, fecha: form.elements.fecha.value, servicioId: cita.servicioId,
      profesionalId: form.elements.profesional.value, excluirCitaId: cita.id, pacienteId: cita.pacienteId, elegido, nombre: 'hora-rp',
      alElegirDia: (f) => { form.elements.fecha.value = f; elegido = null; pintar(); },
    });
  };
  form.elements.fecha.addEventListener('change', () => { elegido = null; pintar(); });
  form.elements.profesional.addEventListener('change', () => { elegido = null; pintar(); });
  form.querySelector('[data-horas]').addEventListener('change', (ev) => { if (ev.target.name === 'hora-rp') elegido = +ev.target.value; });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!elegido) { mostrarErrores(form, [{ campo: 'hora-rp', mensaje: 'Elige la hora nueva.' }]); return; }
    const r = operar(ctx, (s, neg, a) => reprogramarCita(s, neg, citaId, { inicio: elegido, profesionalId: form.elements.profesional.value }, a));
    if (!r.ok) { mostrarErrores(form, r.errores.map((e) => ({ mensaje: e.mensaje }))); pintar(); return; }
    d.close();
    // horaTexto termina en «m.»: ese punto cierra la frase (no se escribe otro).
    anunciar(`Cita movida al ${fechaLarga(r.cita.inicio)}, ${horaTexto(r.cita.inicio)} Los recordatorios se replanificaron.`);
  });
  pintar();
  form.elements.fecha.focus();
}

// ── Registro de paciente ─────────────────────────────────────────────────

export function abrirRegistro(ctx, { alGuardar, nombreInicial = '' } = {}) {
  const { negocio } = datos(ctx);
  const v = negocio.vocab;
  const d = abrirDialogo({
    titulo: `Registrar ${esc(v.persona)}`,
    cuerpo: `<form class="formulario" novalidate>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      <div class="campo"><label for="rg-nombre">Nombre y apellido</label><input id="rg-nombre" name="nombre" type="text" autocomplete="off" value="${esc(nombreInicial)}" required></div>
      <div class="formulario__fila formulario__fila--2">
        <div class="campo"><label for="rg-cedula">Cédula</label><input id="rg-cedula" name="cedula" type="text" autocomplete="off" placeholder="8-123-4567" required></div>
        <div class="campo"><label for="rg-tel">Celular</label><input id="rg-tel" name="telefono" type="tel" inputmode="tel" autocomplete="off" placeholder="+507 6000-0000" required><p class="campo__ayuda">8 dígitos, empieza por 6. Ahí le llega el WhatsApp.</p></div>
      </div>
      <div class="formulario__fila formulario__fila--2">
        <div class="campo"><label for="rg-correo">Correo <span class="campo__ayuda">(opcional)</span></label><input id="rg-correo" name="correo" type="email" autocomplete="off"></div>
        <div class="campo"><label for="rg-nac">Fecha de nacimiento <span class="campo__ayuda">(opcional)</span></label><input id="rg-nac" name="nacimiento" type="date"></div>
      </div>
      <div class="campo"><label for="rg-notas">Notas para recepción <span class="campo__ayuda">(opcional; nada clínico)</span></label><textarea id="rg-notas" name="notas" maxlength="300" placeholder="Por ejemplo: prefiere las tardes"></textarea></div>
      <div class="consentimiento campo">
        <label class="opcion"><input type="checkbox" name="consentimiento"> <span><strong>Dio su consentimiento expreso</strong></span></label>
        <p class="consentimiento__texto">${esc(textoConsentimiento(negocio))}</p>
        <div class="campo" style="max-width:280px"><label for="rg-canal">Cómo lo dio</label><select id="rg-canal" name="canalConsentimiento"><option>en persona</option><option>por teléfono</option><option>por WhatsApp</option></select></div>
        <p class="campo__ayuda">Se guarda la fecha, el canal y este texto. Se puede retirar desde su ficha.</p>
      </div>
      <p class="nota nota--relevo">Demo: escribe datos inventados. Lo que guardes queda solo en este navegador.</p>
      <div class="acciones"><button type="submit" class="boton boton--primario">Registrar ${esc(v.persona)}</button><button type="button" class="boton" data-cerrar>Cancelar</button></div>
    </form>`,
  });
  const form = d.querySelector('form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = form.elements;
    const r = operar(ctx, (s, neg, ahora) => registrarPaciente(s, neg, {
      nombre: f.nombre.value, cedula: f.cedula.value, telefono: f.telefono.value, correo: f.correo.value,
      nacimiento: f.nacimiento.value, notas: f.notas.value, consentimiento: f.consentimiento.checked, canalConsentimiento: f.canalConsentimiento.value,
    }, ahora));
    if (!r.ok) { mostrarErrores(form, r.errores); return; }
    d.close();
    anunciar(`${r.paciente.nombre} quedó registrado.`);
    alGuardar && alGuardar(r.paciente);
  });
  form.elements.nombre.focus();
}

// ── Ficha del paciente ───────────────────────────────────────────────────

export function abrirPaciente(ctx, pacienteId) {
  let dlg = null;
  const pintar = () => {
    const { negocio, st, ahora } = datos(ctx);
    const p = pacienteDe(st, pacienteId);
    if (!p) { dlg && dlg.close(); return; }
    const v = negocio.vocab;
    const a = asistenciaDe(st, p.id);
    const citas = st.citas.filter((c) => c.pacienteId === p.id).sort((x, y) => y.inicio - x.inicio);
    const cons = p.consentimiento;
    const cuerpo = `
      <div class="bloque-dialogo">
        <dl class="datos">
          <dt>Celular</dt><dd>${p.telefono ? `<a href="tel:${esc(p.telefono)}">${esc(mostrarTelefono(p.telefono))}</a>` : '—'}</dd>
          <dt>Cédula</dt><dd>${esc(p.cedula || '—')}</dd>
          <dt>Correo</dt><dd>${esc(p.correo || '—')}</dd>
          ${p.nacimiento ? `<dt>Nacimiento</dt><dd>${esc(fechaLarga(p.nacimiento))} de ${esc(p.nacimiento.slice(0, 4))}</dd>` : ''}
          ${p.notas ? `<dt>Notas</dt><dd>${esc(p.notas)}</dd>` : ''}
          <dt>Asistencia</dt><dd>${a.de ? `Vino a ${a.atendidas} de ${a.de} citas pasadas${a.faltas ? ` · <strong>faltó a ${a.faltas}</strong>` : ''}` : 'Sin citas pasadas todavía'}</dd>
        </dl>
        <div class="acciones" style="margin-top:12px">
          ${p.eliminado ? '' : `<button type="button" class="boton boton--primario" data-accion="agendar">Agendar cita</button><button type="button" class="boton" data-accion="espera">Agregar a la lista de espera</button>`}
        </div>
      </div>
      <div class="bloque-dialogo">
        <h3>Consentimiento (Ley 81 de 2019)</h3>
        ${p.eliminado ? '<p>Datos borrados a pedido de la persona.</p>' : cons && !p.revocado
          ? `<p>Lo dio ${esc(cons.canal)} el ${esc(fechaLarga(cons.fecha))} de ${esc(fechaISO(cons.fecha).slice(0, 4))}, a las ${esc(horaTexto(cons.fecha))}</p><p class="consentimiento__texto" style="margin-top:6px">«${esc(cons.texto)}»</p>
             <p style="margin-top:10px"><button type="button" class="boton" data-accion="revocar">Retiró su permiso</button></p>`
          : `<p class="alerta"><span class="alerta__titulo">${icono('aviso')} Sin permiso para mensajes</span>${p.revocado ? `Lo retiró el ${esc(fechaLarga(p.revocado.fecha))}.` : ''} No se le envían recordatorios: hay que llamar.</p>
             <p style="margin-top:10px"><button type="button" class="boton" data-accion="renovar">Volvió a dar su permiso (en persona)</button></p>`}
      </div>
      <div class="bloque-dialogo">
        <h3>Citas (${citas.length})</h3>
        ${citas.length ? `<ul class="filas">${citas.map((c) => `<li style="padding:8px 0;display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap"><button type="button" class="persona__nombre" data-cita="${c.id}">${esc(cuando(c.inicio))} · ${esc(servicioDe(negocio, c.servicioId).nombre)}</button>${insigniaEstado(c.estado)}</li>`).join('')}</ul>` : '<p class="vacio">Todavía no tiene citas.</p>'}
      </div>
      ${p.eliminado ? '' : `<div class="bloque-dialogo"><h3>Sus datos</h3><p class="campo__ayuda" style="margin-bottom:8px">Si pide que se borren (derecho de cancelación), se quitan nombre, cédula, teléfono y correo, también de la bitácora y de los mensajes enviados; las citas pasadas quedan anónimas para la estadística.</p><button type="button" class="boton boton--peligro" data-accion="borrar">Borrar sus datos</button><div class="resumen-errores" data-errores tabindex="-1" hidden style="margin-top:10px"></div></div>`}`;
    if (!dlg) {
      dlg = abrirDialogo({ titulo: esc(p.nombre), cuerpo, alCerrar: () => quitar() });
      dlg.addEventListener('click', alClic);
    } else {
      dlg.querySelector('.dialogo__titulo').textContent = p.nombre;
      dlg.querySelector('.dialogo__cuerpo').innerHTML = cuerpo;
    }
  };
  const alClic = async (ev) => {
    const c = ev.target.closest('[data-cita]');
    if (c) { abrirCita(ctx, c.dataset.cita); return; }
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const { st, negocio } = datos(ctx);
    const p = pacienteDe(st, pacienteId);
    const accion = b.dataset.accion;
    if (accion === 'agendar') { abrirNuevaCita(ctx, { pacienteId }); return; }
    if (accion === 'espera') { abrirAgregarEspera(ctx, { pacienteId }); return; }
    if (accion === 'revocar') {
      const ok = await confirmar({ titulo: 'Retirar el permiso', texto: `No se le volverá a escribir a ${esc(p.nombre)} y se detienen los mensajes en cola. Sus citas siguen en la agenda.`, si: 'Retirar el permiso', no: 'Volver' });
      if (ok) operar(ctx, (s, n, a) => revocarConsentimiento(s, pacienteId, a));
      return;
    }
    if (accion === 'renovar') { operar(ctx, (s, n, a) => renovarConsentimiento(s, negocio, pacienteId, 'en persona', a)); return; }
    if (accion === 'borrar') {
      const ok = await confirmar({ titulo: 'Borrar sus datos', texto: `Se borran el nombre, la cédula, el teléfono y el correo de ${esc(p.nombre)}, también de la bitácora y del texto de los mensajes ya enviados. Sus citas pasadas quedan sin nombre para la estadística. No se puede deshacer.`, si: 'Borrar sus datos', no: 'No borrar', peligro: true });
      if (!ok) return;
      const r = operar(ctx, (s, n, a) => eliminarPaciente(s, pacienteId, a));
      if (!r.ok) { const z = dlg.querySelector('[data-errores]'); z.hidden = false; z.innerHTML = `<p>${esc(r.errores[0].mensaje)}</p>`; z.focus(); }
      else anunciar('Datos borrados.');
    }
  };
  const quitar = ctx.alCambiar ? ctx.alCambiar(() => { if (dlg && dlg.open) pintar(); }) : () => {};
  pintar();
}

// ── Lista de espera: agregar ─────────────────────────────────────────────

export function abrirAgregarEspera(ctx, { pacienteId = null } = {}) {
  const { negocio, st } = datos(ctx);
  const v = negocio.vocab;
  let paciente = pacienteId ? pacienteDe(st, pacienteId) : null;
  const d = abrirDialogo({
    titulo: 'Agregar a la lista de espera',
    cuerpo: `<form class="formulario" novalidate>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      <div class="campo"><label for="ae-persona">${esc(v.Persona)}</label>
        <select id="ae-persona" name="paciente"><option value="">Elige…</option>${st.pacientes.filter((p) => !p.eliminado).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((p) => `<option value="${p.id}"${paciente && p.id === paciente.id ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>
      <div class="formulario__fila formulario__fila--2">
        <div class="campo"><label for="ae-serv">Servicio</label><select id="ae-serv" name="servicio">${negocio.servicios.map((s) => `<option value="${s.id}">${esc(textoServicio(s))}</option>`).join('')}</select></div>
        <div class="campo"><label for="ae-prof">${esc(v.Profesional)}</label><select id="ae-prof" name="profesional"><option value="">Cualquiera</option>${negocio.profesionales.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></div>
      </div>
      <div class="campo"><label for="ae-nota">Nota <span class="campo__ayuda">(opcional)</span></label><input id="ae-nota" name="nota" type="text" maxlength="200" placeholder="Por ejemplo: solo por la mañana"></div>
      <p class="campo__ayuda">Cuando se libere un horario que le sirva, le llega un WhatsApp con un enlace para tomarlo. Se les escribe a todos los que encajan a la vez: el primero que acepta se lo queda.</p>
      <div class="acciones"><button type="submit" class="boton boton--primario">Agregar a la lista</button><button type="button" class="boton" data-cerrar>Cancelar</button></div>
    </form>`,
  });
  const form = d.querySelector('form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = form.elements;
    const r = operar(ctx, (s, neg, a) => agregarAEspera(s, neg, { pacienteId: f.paciente.value, servicioId: f.servicio.value, profesionalId: f.profesional.value || null, nota: f.nota.value }, a));
    if (!r.ok) { mostrarErrores(form, r.errores); return; }
    d.close();
    anunciar('Agregado a la lista de espera.');
  });
  form.elements.paciente.focus();
}

/** Texto y enlace que tendría un envío si saliera ahora (para los que aún están en cola). */
export function previsualizarEnvio(ctx, envio) {
  const { estado, st, negocio } = datos(ctx);
  if (envio.texto) return { texto: envio.texto, enlace: envio.enlace };
  const copia = JSON.parse(JSON.stringify(st));
  return componerEnvio(copia, negocio, envio, estado.reloj.ahora, opcionesEnlace(estado));
}

export { cuando, msDeFecha, sumarDias };
