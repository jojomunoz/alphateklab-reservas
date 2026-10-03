// Recepción de citas: agenda (día y semana, por profesional o por sala), hoy en recepción, pacientes, lista de
// espera y panel de riesgo.

import { esc, icono, anunciar, $ } from './ui.mjs';
import { cargar, alCambiar, transaccion, preferencia } from './almacen.mjs';
import { iniciarBarra, pintarMarca, relojChip, plantillaCitas } from './demo.mjs';
import { escuchar, pintarPieRelevo } from './relevo.mjs';
import { aplicarMensaje } from '../nucleo/mensajes-relevo.mjs';
import { NEGOCIOS_CITAS } from '../nucleo/negocios.mjs';
import {
  fechaISO, fechaLarga, fechaCorta, horaTexto, horaCorta, horaDeMinutos, sumarDias, lunesDe, msDeFecha, minutosDelDia, diaSemana,
  DIAS_CORTOS, MESES, leerISO, MIN,
} from '../nucleo/tiempo.mjs';
import { tramosDelDia, motivoCierre, libresDelRecurso, servicioDe, profesionalDe, salaDe, ESTADOS } from '../nucleo/agenda.mjs';
import { pacienteDe, resolverTarea, retirarDeEspera, citaDe, cambiarEstado } from '../nucleo/operaciones.mjs';
import { sinConfirmar, conInasistencias, porProfesional, costoMensajesDelMes, asistenciaDe, porcentaje, ENLACE_PRODUCCION } from '../nucleo/riesgo.mjs';
import { CANALES } from '../nucleo/recordatorios.mjs';
import { TARIFAS, dolares } from '../nucleo/mensajes.mjs';
import { mostrarTelefono, buscarPersonas, enlaceWhatsApp } from '../nucleo/contacto.mjs';
import {
  datos, operar, abrirNuevaCita, abrirCita, abrirPaciente, abrirRegistro, abrirAgregarEspera, insigniaEstado, textoServicio, cuando,
} from './componentes-citas.mjs';

const PESTANAS = ['agenda', 'pacientes', 'espera', 'riesgo'];
const vista = {
  pestana: PESTANAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'agenda',
  modo: preferencia('modo') === 'semana' ? 'semana' : 'dia',
  recurso: preferencia('recurso') === 'sala' ? 'sala' : 'profesional',
  fecha: null,
  busqueda: '',
};
let plantilla = plantillaCitas();
const ctx = {
  plantilla: () => plantilla,
  alCambiar: (fn) => alCambiar(fn),
};

// ── Encabezado y pestañas ───────────────────────────────────────────────

function pintarCabeza() {
  const { negocio, st, ahora } = datos(ctx);
  const v = negocio.vocab;
  const tareas = st.tareas.filter((t) => !t.hecha).length;
  const enEspera = st.espera.filter((e) => e.estado === 'esperando').length;
  const pest = [
    ['agenda', 'Agenda', ''],
    ['pacientes', v.Personas, ''],
    ['espera', '', enEspera ? `<span class="cuenta">${enEspera}</span>` : ''],
    ['riesgo', 'Riesgo', ''],
  ];
  pintarMarca($('#marca'), negocio, {
    enlace: 'citas.html',
    extra: `${relojChip(ahora)}
      <nav class="pestanas marca__nav" aria-label="Recepción">
        ${pest.map(([id, txt, extra]) => `<a href="#${id}"${vista.pestana === id ? ' aria-current="page"' : ''}>${id === 'espera' ? '<span class="t-largo">Lista de espera</span><span class="t-corto">Espera</span>' : esc(txt)}${extra}</a>`).join('')}
        <a href="bandeja.html">Bandeja ${icono('reloj')}</a>
      </nav>`,
  });
  document.title = `${tituloPestana(v)} · ${negocio.nombre} (${negocio.rotulo}) · alphateklab Reservas`;
}

const tituloPestana = (v) => ({ agenda: 'Agenda', pacientes: v.Personas, espera: 'Lista de espera', riesgo: 'Riesgo' }[vista.pestana]);

// ── Agenda ─────────────────────────────────────────────────────────────

/** «5 al 10 de octubre» o «28 de septiembre al 3 de octubre» (ambos días incluidos). */
function rangoSemana(a, b) {
  const x = leerISO(a), y = leerISO(b);
  const mes = (m) => MESES[m - 1];
  return x.mes === y.mes ? `${x.dia} al ${y.dia} de ${mes(y.mes)}` : `${x.dia} de ${mes(x.mes)} al ${y.dia} de ${mes(y.mes)}`;
}

function recursos(negocio) {
  return vista.recurso === 'profesional'
    ? negocio.profesionales.map((p) => ({ tipo: 'profesional', id: p.id, nombre: p.nombre, corto: p.corto }))
    : negocio.salas.map((s) => ({ tipo: 'sala', id: s.id, nombre: s.nombre, corto: s.corto }));
}

function rangoHoras(negocio, fechas) {
  let a = 24 * 60, b = 0;
  for (const f of fechas) for (const [x, y] of negocio.horario[diaSemana(f)] || []) { a = Math.min(a, x); b = Math.max(b, y); }
  if (a >= b) { a = 8 * 60; b = 17 * 60; }
  return [Math.floor(a / 60) * 60, Math.ceil(b / 60) * 60];
}

function htmlBloque(c, st, negocio, ahora, semana) {
  const p = pacienteDe(st, c.pacienteId);
  const s = servicioDe(negocio, c.servicioId);
  const durMin = (c.fin - c.inicio) / MIN;
  const corto = semana || durMin < 30;
  const otro = vista.recurso === 'profesional' ? salaDe(negocio, c.salaId).corto : profesionalDe(negocio, c.profesionalId).corto;
  const nombre = p ? (semana ? p.nombre.split(' ').slice(-1)[0] : p.nombre) : '—';
  const etiqueta = `${p ? p.nombre : 'Cita'}, ${horaTexto(c.inicio)} a ${horaTexto(c.fin)}, ${s.nombre}, ${ESTADOS[c.estado]}${c.enSala ? ', en sala' : ''}`;
  return `<button type="button" class="bloque bloque--${c.estado}${corto ? ' bloque--corto' : ''}${c.enSala ? ' bloque--en-sala' : ''}" data-cita="${c.id}"
      style="top:calc(var(--escala) * ${c.top});height:calc(var(--escala) * ${durMin} - 2px)" aria-label="${esc(etiqueta)}">
      <span class="bloque__linea"><span class="bloque__hora">${horaCorta(c.inicio)}</span><span class="bloque__nombre">${esc(nombre)}</span></span>
      <span class="bloque__linea">${insigniaEstado(c.estado)}<span class="bloque__meta">${esc(s.nombre)} · ${esc(otro)}</span></span>
    </button>`;
}

function htmlColumna({ negocio, st, ahora, fecha, recurso, inicioMin, finMin, semana, primera }) {
  const altura = finMin - inicioMin;
  const motivo = motivoCierre(negocio, fecha);
  const hoy = fecha === fechaISO(ahora);
  let html = `<div class="columna${primera ? ' columna--primera-del-dia' : ''}${hoy ? ' columna--hoy' : ''}" style="height:calc(var(--escala) * ${altura})">`;
  if (motivo) {
    html += `<div class="cerrado cerrado--dia" style="top:0;bottom:0">${semana && !primera ? '' : esc(motivo)}</div>`;
  } else {
    // Lo cerrado dentro del rango visible (antes de abrir, almuerzo, después de cerrar).
    const tramos = tramosDelDia(negocio, fecha);
    let cursor = inicioMin;
    tramos.forEach(([a, b], i) => {
      if (a > cursor) html += `<div class="cerrado" style="top:calc(var(--escala) * ${cursor - inicioMin});height:calc(var(--escala) * ${a - cursor})">${!semana && i > 0 ? 'Almuerzo' : ''}</div>`;
      cursor = b;
    });
    if (cursor < finMin) html += `<div class="cerrado" style="top:calc(var(--escala) * ${cursor - inicioMin});height:calc(var(--escala) * ${finMin - cursor})"></div>`;
    if (!semana) {
      for (const l of libresDelRecurso({ negocio: { ...negocio, ajustes: { ...negocio.ajustes, ...st.ajustes } }, citas: st.citas, fecha, recurso, ahora, minimoMin: Math.min(...negocio.servicios.map((s) => s.min)) })) {
        const top = minutosDelDia(l.inicio) - inicioMin, alto = (l.fin - l.inicio) / MIN;
        html += `<button type="button" class="libre" data-libre="${l.inicio}" data-recurso="${recurso.tipo}:${recurso.id}" style="top:calc(var(--escala) * ${top} + 1px);height:calc(var(--escala) * ${alto} - 3px)" aria-label="Agendar en el hueco libre de ${horaTexto(l.inicio)} a ${horaTexto(l.fin)} con ${esc(recurso.nombre)}">${alto >= 25 ? `${icono('mas')}<span>Libre ${horaCorta(l.inicio)}–${horaCorta(l.fin)}</span>` : ''}</button>`;
      }
    }
    const campo = recurso.tipo === 'profesional' ? 'profesionalId' : 'salaId';
    for (const c of st.citas) {
      if (c[campo] !== recurso.id || c.estado === 'cancelada' || fechaISO(c.inicio) !== fecha) continue;
      html += htmlBloque({ ...c, top: minutosDelDia(c.inicio) - inicioMin }, st, negocio, ahora, semana);
    }
    if (hoy) {
      const m = minutosDelDia(ahora);
      if (m >= inicioMin && m <= finMin) html += `<div class="ahora-linea" style="top:calc(var(--escala) * ${m - inicioMin})" aria-hidden="true"></div>`;
    }
  }
  return html + '</div>';
}

function pintarAgenda(main) {
  const { negocio, st, ahora } = datos(ctx);
  const v = negocio.vocab;
  if (!vista.fecha) vista.fecha = fechaISO(ahora);
  const hoy = fechaISO(ahora);
  const recs = recursos(negocio);
  const semana = vista.modo === 'semana';
  const fechas = semana ? Array.from({ length: 6 }, (_, i) => sumarDias(lunesDe(vista.fecha), i)) : [vista.fecha];
  const [inicioMin, finMin] = rangoHoras(negocio, fechas);
  const titulo = semana ? `Semana del ${rangoSemana(fechas[0], fechas[5])}` : fechaLarga(vista.fecha);
  const sub = semana ? '' : vista.fecha === hoy ? 'Hoy' : vista.fecha === sumarDias(hoy, 1) ? 'Mañana' : vista.fecha === sumarDias(hoy, -1) ? 'Ayer' : '';
  const citasVistas = st.citas.filter((c) => fechas.includes(fechaISO(c.inicio)));
  const canceladas = citasVistas.filter((c) => c.estado === 'cancelada');

  let horas = '';
  for (let m = inicioMin; m <= finMin; m += 60) horas += `<span class="agenda__hora" style="top:calc(var(--escala) * ${m - inicioMin})">${horaDeMinutos(m).replace(':00', '')}</span>`;
  const columnas = semana ? fechas.length * recs.length : recs.length;
  let cabeza = '<div class="agenda__cabeza" aria-hidden="true"></div>';
  let cuerpo = `<div class="agenda__horas" style="height:calc(var(--escala) * ${finMin - inicioMin})">${horas}</div>`;
  if (semana) {
    cabeza += fechas.map((f) => `<div class="agenda__cabeza agenda__cabeza--dia${f === hoy ? ' es-hoy' : ''}" style="--carriles:${recs.length}"><button type="button" data-ir-dia="${f}" aria-label="Ver el ${esc(fechaLarga(f))}"><span>${DIAS_CORTOS[diaSemana(f)]} ${leerISO(f).dia}</span><small>${st.citas.filter((c) => fechaISO(c.inicio) === f && c.estado !== 'cancelada').length} citas</small></button></div>`).join('');
    const carriles = '<div aria-hidden="true"></div>' + fechas.map(() => recs.map((r) => `<div class="agenda__carril-cabeza" title="${esc(r.nombre)}">${esc(r.corto)}</div>`).join('')).join('');
    cabeza += carriles;
    cuerpo += fechas.map((f) => recs.map((r, i) => htmlColumna({ negocio, st, ahora, fecha: f, recurso: r, inicioMin, finMin, semana: true, primera: i === 0 })).join('')).join('');
  } else {
    cabeza += recs.map((r) => {
      const n = st.citas.filter((c) => c[r.tipo === 'profesional' ? 'profesionalId' : 'salaId'] === r.id && fechaISO(c.inicio) === vista.fecha && c.estado !== 'cancelada').length;
      return `<div class="agenda__cabeza">${esc(r.nombre)}<small>${n} ${n === 1 ? 'cita' : 'citas'}</small></div>`;
    }).join('');
    cuerpo += recs.map((r) => htmlColumna({ negocio, st, ahora, fecha: vista.fecha, recurso: r, inicioMin, finMin, semana: false, primera: true })).join('');
  }

  const sc = sinConfirmar(st, ahora), tareas = st.tareas.filter((t) => !t.hecha), enSala = st.citas.filter((c) => c.enSala && fechaISO(c.inicio) === hoy && !['atendida', 'no_asistio', 'cancelada'].includes(c.estado));
  main.innerHTML = `
    <h1 class="sr-only">Agenda de ${esc(negocio.nombre)}</h1>
    <div class="herramientas">
      <div class="herramientas__fecha">
        <button type="button" class="boton-icono" data-mover="-1" aria-label="${semana ? 'Semana anterior' : 'Día anterior'}">${icono('izq')}</button>
        <button type="button" class="boton" data-mover="hoy"${(semana ? lunesDe(vista.fecha) === lunesDe(hoy) : vista.fecha === hoy) ? ' aria-disabled="true"' : ''}>Hoy</button>
        <button type="button" class="boton-icono" data-mover="1" aria-label="${semana ? 'Semana siguiente' : 'Día siguiente'}">${icono('der')}</button>
      </div>
      <h2 class="herramientas__titulo" aria-live="polite">${sub ? `<small>${sub}</small>` : ''}${esc(titulo.charAt(0).toUpperCase() + titulo.slice(1))}</h2>
      <div class="segmentado" role="group" aria-label="Vista">
        <button type="button" data-modo="dia" aria-pressed="${!semana}">Día</button><button type="button" data-modo="semana" aria-pressed="${semana}">Semana</button>
      </div>
      <div class="segmentado" role="group" aria-label="Columnas">
        <button type="button" data-recurso="profesional" aria-pressed="${vista.recurso === 'profesional'}">Por ${esc(v.profesional)}</button><button type="button" data-recurso="sala" aria-pressed="${vista.recurso === 'sala'}">Por ${esc(v.sala)}</button>
      </div>
      <button type="button" class="boton boton--primario" data-nueva>${icono('mas')} Agendar cita</button>
    </div>
    <p class="resumen-hoy"><a href="#hoy-recepcion">Hoy en recepción:</a> <span>${sc.length} sin confirmar</span> <span>${tareas.length} por llamar</span> <span>${enSala.length} en sala</span></p>
    <div class="disposicion${semana ? ' disposicion--semana' : ''}">
      <div>
        <div class="agenda-scroll" tabindex="0" aria-label="Agenda; desplázate para ver más columnas u horas">
          <div class="agenda${semana ? ' agenda--semana' : ''}" style="--columnas:${columnas}">${cabeza}${cuerpo}</div>
        </div>
        <div class="leyenda" aria-label="Leyenda">${['pendiente', 'confirmada', 'reprogramada', 'atendida', 'no_asistio'].map(insigniaEstado).join('')}<span><span class="libre" style="position:static;display:inline-flex;padding:0 6px">Libre</span> = hueco para agendar</span></div>
        ${canceladas.length ? `<details class="canceladas-dia"><summary>${canceladas.length} ${canceladas.length === 1 ? 'cita cancelada' : 'citas canceladas'} ${semana ? 'esta semana' : 'este día'} (no ocupan lugar)</summary><ul class="filas">${canceladas.map((c) => { const p = pacienteDe(st, c.pacienteId); return `<li style="padding:6px 0"><button type="button" class="persona__nombre" data-cita="${c.id}">${esc(cuando(c.inicio))} · ${esc(p ? p.nombre : '—')}</button></li>`; }).join('')}</ul></details>` : ''}
      </div>
      <aside class="lateral" id="hoy-recepcion" aria-label="Hoy en recepción">${htmlLateral(st, negocio, ahora, sc, tareas, enSala)}</aside>
    </div>`;
}

function htmlLateral(st, negocio, ahora, sc, tareas, enSala) {
  const v = negocio.vocab;
  const fila = (c, extra = '', acciones = '') => {
    const p = pacienteDe(st, c.pacienteId);
    return `<li class="fila-recepcion"><div class="fila-recepcion__cabeza"><button type="button" class="fila-recepcion__quien" data-cita="${c.id}">${esc(p ? p.nombre : '—')}</button><span class="fila-recepcion__cuando">${fechaISO(c.inicio) === fechaISO(ahora) ? 'hoy' : 'mañana'} ${esc(horaTexto(c.inicio))}</span></div>${extra}${acciones ? `<div class="acciones">${acciones}</div>` : ''}</li>`;
  };
  const tel = (p) => p && p.telefono ? `<a class="boton" href="tel:${esc(p.telefono)}">${icono('llamar')} Llamar</a>` : '';
  return `
    <section class="panel" aria-labelledby="t-sc">
      <div class="panel__cabeza"><h2 id="t-sc">Sin confirmar, hoy y mañana <span class="cuenta">${sc.length}</span></h2></div>
      ${sc.length ? `<ul class="filas">${sc.map((c) => {
        const enviados = st.envios.filter((e) => e.citaId === c.id && e.estado === 'enviado').length;
        const proximo = st.envios.filter((e) => e.citaId === c.id && e.estado === 'programado').sort((a, b) => a.momento - b.momento)[0];
        return fila(c, `<p class="fila-recepcion__motivo">${enviados ? `${enviados} ${enviados === 1 ? 'mensaje enviado' : 'mensajes enviados'}` : 'Aún sin mensajes'}${proximo ? ` · ${proximo.tipo === 'llamar' ? 'llamar' : 'el próximo'} ${esc(cuando(proximo.momento))}` : ''}</p>`, tel(pacienteDe(st, c.pacienteId)));
      }).join('')}</ul>` : '<p class="vacio"><strong>Nada pendiente.</strong>Todas las citas de hoy y mañana tienen respuesta.</p>'}
    </section>
    <section class="panel" aria-labelledby="t-ll">
      <div class="panel__cabeza"><h2 id="t-ll">Por llamar <span class="cuenta">${tareas.length}</span></h2></div>
      ${tareas.length ? `<ul class="filas">${tareas.map((t) => {
        const c = citaDe(st, t.citaId);
        if (!c) return '';
        const p = pacienteDe(st, t.pacienteId);
        return fila(c, `<p class="fila-recepcion__motivo">${esc(t.motivo)}${t.intentos.length ? ` · ${t.intentos.length} ${t.intentos.length === 1 ? 'llamada' : 'llamadas'} sin respuesta` : ''}</p>`,
          `${tel(p)}<button type="button" class="boton" data-tarea="${t.id}" data-resultado="confirmo">Confirmó</button><button type="button" class="boton" data-tarea="${t.id}" data-resultado="cancelo">Canceló</button><button type="button" class="boton" data-tarea="${t.id}" data-resultado="no_contesto">No contestó</button>`);
      }).join('')}</ul>` : `<p class="vacio"><strong>Nadie por llamar.</strong>Aquí aparece quien no respondió a los mensajes o pidió que lo llamen.</p>`}
    </section>
    <section class="panel" aria-labelledby="t-sa">
      <div class="panel__cabeza"><h2 id="t-sa">En sala de espera <span class="cuenta">${enSala.length}</span></h2></div>
      ${enSala.length ? `<ul class="filas">${enSala.map((c) => fila(c, `<p class="fila-recepcion__motivo">Llegó a las ${esc(horaTexto(c.enSala))}</p>`, `<button type="button" class="boton" data-estado-rapido="atendida" data-cita-id="${c.id}">Atendida</button>`)).join('')}</ul>` : '<p class="vacio"><strong>La sala está vacía.</strong>Marca «Llegó» desde la cita cuando alguien entre.</p>'}
    </section>`;
}

// ── Pacientes ─────────────────────────────────────────────────────────

function pintarPacientes(main) {
  const { negocio, st, ahora } = datos(ctx);
  const v = negocio.vocab;
  const todos = st.pacientes.filter((p) => !p.eliminado);
  const lista = vista.busqueda.trim() ? buscarPersonas(todos, vista.busqueda) : [...todos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  main.innerHTML = `
    <div class="seccion__cabeza"><h1 style="font-size:1.375rem">${esc(v.Personas)}</h1><p>${todos.length} registrados en ${esc(negocio.nombre)}</p></div>
    <div class="barra-lista">
      <div class="campo"><label for="buscar-p">Buscar por nombre, teléfono o cédula</label><input id="buscar-p" type="search" value="${esc(vista.busqueda)}" autocomplete="off"></div>
      <button type="button" class="boton boton--primario" data-registrar>${icono('mas')} Registrar ${esc(v.persona)}</button>
    </div>
    <div class="lista-personas" aria-live="polite">
      ${lista.length ? `<ul class="filas">${lista.map((p) => {
        const a = asistenciaDe(st, p.id);
        const prox = st.citas.filter((c) => c.pacienteId === p.id && c.inicio > ahora && c.estado !== 'cancelada').sort((x, y) => x.inicio - y.inicio)[0];
        return `<li class="persona"><div><button type="button" class="persona__nombre" data-persona="${p.id}">${esc(p.nombre)}</button>
          <p class="persona__datos"><span>${esc(mostrarTelefono(p.telefono))}</span><span>${esc(p.cedula)}</span>${!p.consentimiento || p.revocado ? '<span class="insignia insignia--aviso">Sin permiso para mensajes</span>' : ''}</p></div>
          <div class="persona__lado">${prox ? `<span>Próxima: ${esc(cuando(prox.inicio))}</span>` : '<span class="campo__ayuda">Sin cita próxima</span>'}${a.de ? `<span class="${a.faltas ? 'insignia insignia--peligro' : 'campo__ayuda'}">Vino a ${a.atendidas} de ${a.de}</span>` : ''}</div></li>`;
      }).join('')}</ul>` : `<p class="vacio"><strong>Nadie coincide con «${esc(vista.busqueda)}».</strong>Revisa cómo está escrito, o regístralo.</p>`}
    </div>`;
  const input = $('#buscar-p', main);
  input.addEventListener('input', () => {
    vista.busqueda = input.value;
    const pos = input.selectionStart;
    pintarPacientes(main);
    const nuevo = $('#buscar-p', main);
    nuevo.focus();
    nuevo.setSelectionRange(pos, pos);
  });
}

// ── Lista de espera ──────────────────────────────────────────────────

function pintarEspera(main) {
  const { negocio, st } = datos(ctx);
  const v = negocio.vocab;
  const esperando = st.espera.filter((e) => e.estado === 'esperando').sort((a, b) => a.desde - b.desde);
  const ofertas = [...st.ofertas].sort((a, b) => b.creada - a.creada);
  main.innerHTML = `
    <div class="seccion__cabeza"><h1 style="font-size:1.375rem">Lista de espera</h1><p>Cuando alguien cancela, el horario se ofrece por WhatsApp a quienes esperan ese servicio. El primero que acepta se lo queda.</p></div>
    <div class="barra-lista"><button type="button" class="boton boton--primario" data-agregar-espera>${icono('mas')} Agregar a la lista</button></div>
    <section class="panel" aria-labelledby="t-esp">
      <div class="panel__cabeza"><h2 id="t-esp">Esperando (${esperando.length})</h2></div>
      ${esperando.length ? `<table class="tabla tabla--apilable"><thead><tr><th scope="col">${esc(v.Persona)}</th><th scope="col">Servicio</th><th scope="col">${esc(v.Profesional)}</th><th scope="col">Desde</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>
        ${esperando.map((e) => { const p = pacienteDe(st, e.pacienteId); return `<tr><td data-etiqueta="${esc(v.Persona)}"><button type="button" class="persona__nombre" data-persona="${e.pacienteId}">${esc(p ? p.nombre : '—')}</button>${e.nota ? `<br><small class="campo__ayuda">${esc(e.nota)}</small>` : ''}</td><td data-etiqueta="Servicio">${esc(servicioDe(negocio, e.servicioId).nombre)}</td><td data-etiqueta="${esc(v.Profesional)}">${e.profesionalId ? esc(profesionalDe(negocio, e.profesionalId).nombre) : 'Cualquiera'}</td><td data-etiqueta="Desde">${esc(fechaCorta(e.desde))}</td><td class="der"><button type="button" class="boton" data-retirar="${e.id}">Quitar</button></td></tr>`; }).join('')}
      </tbody></table>` : '<p class="vacio"><strong>Nadie esperando.</strong>Agrega a quien quiera una cita antes de la que consiguió.</p>'}
    </section>
    <section class="panel" aria-labelledby="t-of" style="margin-top:20px">
      <div class="panel__cabeza"><h2 id="t-of">Horarios liberados y ofrecidos (${ofertas.length})</h2></div>
      ${ofertas.length ? `<ul class="filas">${ofertas.map((o) => {
        const ganador = o.tomadaPor ? st.espera.find((e) => e.id === o.tomadaPor) : null;
        const pg = ganador ? pacienteDe(st, ganador.pacienteId) : null;
        return `<li class="fila-recepcion"><div class="fila-recepcion__cabeza"><strong>${esc(cuando(o.hueco.inicio))} · ${esc(profesionalDe(negocio, o.hueco.profesionalId).nombre)}</strong>${o.estado === 'tomada' ? '<span class="insignia insignia--ok">Tomado</span>' : o.estado === 'abierta' ? '<span class="insignia insignia--aviso">Ofrecido, sin respuesta</span>' : '<span class="insignia">Ya no está libre</span>'}</div><p class="fila-recepcion__motivo">Se ofreció a ${o.candidatos.length} ${o.candidatos.length === 1 ? 'persona' : 'personas'}${pg ? `; lo tomó ${esc(pg.nombre)}` : ''}.</p></li>`;
      }).join('')}</ul>` : '<p class="vacio"><strong>Todavía no se ha liberado ningún horario.</strong>Cuando alguien cancele desde el recordatorio o en recepción, aparece aquí.</p>'}
    </section>`;
}

// ── Riesgo ───────────────────────────────────────────────────────────

function barraTasa(x, mala) {
  if (x.tasa === null) return '<span class="campo__ayuda">sin datos aún</span>';
  return `<div class="barra-tasa${mala ? ' barra-tasa--mala' : ''}"><span>${porcentaje(x)}</span><span class="barra-tasa__pista" aria-hidden="true"><span class="barra-tasa__valor" style="width:${Math.round(x.tasa * 100)}%"></span></span><span class="barra-tasa__extremos" aria-hidden="true"><span>0 %</span><span>100 %</span></span></div>`;
}

function pintarRiesgo(main) {
  const { negocio, st, ahora } = datos(ctx);
  const v = negocio.vocab;
  const sc = sinConfirmar(st, ahora);
  const faltones = conInasistencias(st, ahora);
  const filas = porProfesional(st, negocio);
  const costo = costoMensajesDelMes(st, ahora);
  const nombreMes = fechaLarga(ahora).split(' de ')[1];
  main.innerHTML = `
    <div class="seccion__cabeza"><h1 style="font-size:1.375rem">Riesgo</h1><p>Lo que puede terminar en un hueco vacío, y lo que cuestan los mensajes.</p></div>
    <div class="rejilla-riesgo">
      <section class="panel" aria-labelledby="r-sc">
        <div class="panel__cabeza"><h2 id="r-sc">Sin confirmar hoy y mañana (${sc.length})</h2></div>
        ${sc.length ? `<ul class="filas">${sc.map((c) => { const p = pacienteDe(st, c.pacienteId); return `<li class="fila-recepcion"><div class="fila-recepcion__cabeza"><button type="button" class="fila-recepcion__quien" data-cita="${c.id}">${esc(p ? p.nombre : '—')}</button><span class="fila-recepcion__cuando">${esc(cuando(c.inicio))}</span></div></li>`; }).join('')}</ul>` : '<p class="vacio"><strong>Ninguna.</strong>Todo lo de hoy y mañana está confirmado o cerrado.</p>'}
      </section>
      <section class="panel" aria-labelledby="r-fa">
        <div class="panel__cabeza"><h2 id="r-fa">${esc(v.Personas)} que ya faltaron y tienen cita (${faltones.length})</h2></div>
        ${faltones.length ? `<ul class="filas">${faltones.map((x) => `<li class="fila-recepcion"><div class="fila-recepcion__cabeza"><button type="button" class="fila-recepcion__quien" data-persona="${x.paciente.id}">${esc(x.paciente.nombre)}</button><span class="insignia insignia--peligro">Faltó a ${x.faltas} de ${x.de}</span></div><p class="fila-recepcion__motivo">Próxima: <button type="button" class="persona__nombre" data-cita="${x.proxima.id}">${esc(cuando(x.proxima.inicio))}</button> ${insigniaEstado(x.proxima.estado)}</p></li>`).join('')}</ul>` : '<p class="vacio"><strong>Nadie.</strong>Ninguna persona con faltas previas tiene cita por delante.</p>'}
      </section>
      <section class="panel ancho" aria-labelledby="r-pr">
        <div class="panel__cabeza"><h2 id="r-pr">Por ${esc(v.profesional)}</h2></div>
        <div style="overflow-x:auto"><table class="tabla tabla--apilable"><thead><tr><th scope="col">${esc(v.Profesional)}</th><th scope="col">No asistió (de las citas ya pasadas)</th><th scope="col">Confirmó (de las que recibieron recordatorio)</th></tr></thead><tbody>
          ${filas.map((f) => `<tr><td class="tabla__titulo-fila">${esc(f.profesional.nombre)}</td><td data-etiqueta="No asistió">${barraTasa(f.inasistencia, true)}</td><td data-etiqueta="Confirmó">${barraTasa(f.confirmacion, false)}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="fuente" style="padding:0 16px 12px">Se cuentan solo las citas de esta demo. Referencia pública: en la Policlínica Generoso Guardia de la CSS faltó el 30 % de los pacientes de dermatología (<a href="https://www.tvn-2.com/nacionales/funciona-sistema-citas-policlinicas-concurridas-san-migueltito_1_2239674.html" rel="noopener">TVN, 6 de mayo de 2026</a>).</p>
      </section>
      <section class="panel ancho" aria-labelledby="r-co">
        <div class="panel__cabeza"><h2 id="r-co">Costo de mensajes de ${esc(nombreMes)}</h2><strong class="numeros">${dolares(costo.min)} a ${dolares(costo.max)}</strong></div>
        <div style="overflow-x:auto"><table class="tabla tabla--apilable"><thead><tr><th scope="col">Canal</th><th scope="col" class="der">Mensajes enviados</th><th scope="col" class="der">Se cobran</th><th scope="col">Precio por unidad</th><th scope="col" class="der">Estimado</th></tr></thead><tbody>
          ${Object.entries(costo.por).map(([k, f]) => `<tr><td class="tabla__titulo-fila">${CANALES[k]}</td><td class="der" data-etiqueta="Enviados">${f.mensajes}</td><td class="der" data-etiqueta="Se cobran">${f.unidades} ${k === 'sms' ? 'segmentos' : 'mensajes'}</td><td data-etiqueta="Precio por unidad">${TARIFAS[k].max ? `${dolares(TARIFAS[k].min, 3)} a ${dolares(TARIFAS[k].max, 3)}` : 'casi 0'}</td><td class="der" data-etiqueta="Estimado">${f.max ? `${dolares(f.min)} a ${dolares(f.max)}` : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="panel__cuerpo">
          <p class="fuente">El costo de los mensajes va aparte de la suscripción: así una clínica con mucho volumen no se come el margen. WhatsApp: plantilla de utilidad para Panamá («Rest of Latin America»), unos US$0.011 a 0.013 por mensaje entregado según tablas de terceros; la oficial es la de <a href="https://developers.facebook.com/docs/whatsapp/pricing" rel="noopener">Meta</a> y hay que revisarla antes de fijar precios. SMS por Twilio a Panamá: US$0.10 a 0.18 por segmento; un acento (á, í, ó, ú) baja el segmento de 160 a 70 caracteres. El cálculo usa un enlace corto como el de producción (${ENLACE_PRODUCCION.length} caracteres), no el largo de esta demo.</p>
        </div>
      </section>
    </div>`;
}

// ── Pintar y eventos ─────────────────────────────────────────────────

function pintar() {
  pintarCabeza();
  const main = $('#principal');
  if (vista.pestana === 'agenda') pintarAgenda(main);
  else if (vista.pestana === 'pacientes') pintarPacientes(main);
  else if (vista.pestana === 'espera') pintarEspera(main);
  else pintarRiesgo(main);
}

document.addEventListener('click', (ev) => {
  const main = $('#principal');
  if (!main.contains(ev.target)) return;
  const t = ev.target;
  const b = (sel) => t.closest(sel);
  const { ahora } = datos(ctx);
  if (b('[data-mover]')) {
    const m = b('[data-mover]').dataset.mover;
    if (m === 'hoy') vista.fecha = fechaISO(ahora);
    else vista.fecha = sumarDias(vista.fecha, (vista.modo === 'semana' ? 7 : 1) * +m);
    pintar();
    return;
  }
  if (b('[data-modo]')) { vista.modo = b('[data-modo]').dataset.modo; preferencia('modo', vista.modo); pintar(); main.querySelector(`[data-modo="${vista.modo}"]`).focus(); return; }
  if (b('[data-recurso]') && !b('.libre')) { vista.recurso = b('[data-recurso]').dataset.recurso; preferencia('recurso', vista.recurso); pintar(); main.querySelector(`[data-recurso="${vista.recurso}"]`).focus(); return; }
  if (b('[data-ir-dia]')) { vista.fecha = b('[data-ir-dia]').dataset.irDia; vista.modo = 'dia'; preferencia('modo', 'dia'); pintar(); return; }
  if (b('[data-nueva]')) { abrirNuevaCita(ctx, { fecha: vista.fecha && vista.fecha >= fechaISO(ahora) ? vista.fecha : fechaISO(ahora) }); return; }
  if (b('.libre')) {
    const l = b('.libre');
    const [tipo, id] = l.dataset.recurso.split(':');
    abrirNuevaCita(ctx, { fecha: fechaISO(+l.dataset.libre), inicio: +l.dataset.libre, ...(tipo === 'profesional' ? { profesionalId: id } : { salaId: id }) });
    return;
  }
  if (b('[data-cita]')) { abrirCita(ctx, b('[data-cita]').dataset.cita); return; }
  if (b('[data-persona]')) { abrirPaciente(ctx, b('[data-persona]').dataset.persona); return; }
  if (b('[data-registrar]')) { abrirRegistro(ctx, { alGuardar: (p) => abrirPaciente(ctx, p.id) }); return; }
  if (b('[data-agregar-espera]')) { abrirAgregarEspera(ctx); return; }
  if (b('[data-retirar]')) { operar(ctx, (s, n, a) => retirarDeEspera(s, b('[data-retirar]').dataset.retirar, a)); anunciar('Quitado de la lista de espera.'); return; }
  if (b('[data-tarea]')) {
    const x = b('[data-tarea]');
    const r = operar(ctx, (s, n, a) => resolverTarea(s, n, x.dataset.tarea, x.dataset.resultado, a));
    if (r.ok) anunciar({ confirmo: 'Anotado: confirmó por teléfono.', cancelo: 'Anotado: canceló por teléfono. El horario se ofrece a la lista de espera.', no_contesto: 'Anotado: no contestó. La tarea sigue en la lista.' }[x.dataset.resultado]);
    return;
  }
  if (b('[data-estado-rapido]')) {
    const x = b('[data-estado-rapido]');
    const r = operar(ctx, (s, n, a) => cambiarEstado(s, n, x.dataset.citaId, x.dataset.estadoRapido, a, { por: 'recepción' }));
    if (r.ok) anunciar('Marcada como atendida.');
  }
});

addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (PESTANAS.includes(h)) { vista.pestana = h; pintar(); $('#principal').focus({ preventScroll: true }); }
});

// ── Arranque ─────────────────────────────────────────────────────────

const estado = cargar();
vista.fecha = fechaISO(estado.reloj.ahora);
iniciarBarra({ pagina: 'citas.html', tipo: 'citas', alCambiarPlantilla: (id) => { plantilla = id; vista.fecha = fechaISO(cargar().reloj.ahora); pintar(); } });
pintar();
alCambiar((e, info) => {
  pintar();
  if (!info.local && info.motivo === 'reloj') anunciar('El reloj de la demo avanzó en otra pestaña.');
});

// Respuestas que llegan desde otro teléfono por el relevo.
pintarPieRelevo($('#pie'), 'conectando');
escuchar(estado.sala, (mensaje) => {
  let r;
  transaccion((e) => { r = aplicarMensaje(e, mensaje); return r.resultado === 'repetida' || r.resultado === 'forma' ? { ok: false } : { ok: true }; }, 'relevo');
  if (r && r.aviso && r.resultado !== 'repetida') anunciar(r.aviso);
}, (est) => pintarPieRelevo($('#pie'), est));
