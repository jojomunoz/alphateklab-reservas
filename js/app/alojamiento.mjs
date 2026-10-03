// Alojamiento: calendario de cabañas por canal, reservas, choques, canales iCal y vigilante de sincronización.

import { esc, icono, $, anunciar, abrirDialogo, confirmar, mostrarErrores, descargar } from './ui.mjs';
import { cargar, transaccion, alCambiar, adelantarReloj, preferencia } from './almacen.mjs';
import { iniciarBarra, pintarMarca } from './demo.mjs';
import { NEGOCIO_ALOJAMIENTO as negocio } from '../nucleo/negocios.mjs';
import { fechaISO, fechaLarga, fechaCorta, horaTexto, sumarDias, diferenciaDias, diaSemana, leerISO, DIAS_CORTOS, MESES, HORA, haceTexto, esISO } from '../nucleo/tiempo.mjs';
import {
  CANALES_ALOJ, activa, cabanaDe, rangoTexto, temporadaDe, minimoNoches, cotizar, detectarChoques, proponerReubicacion, vigilar,
  eventosParaExportar, crearReserva, cancelarReserva, verificarSena, moverReserva, simularCaida, restablecerCanal, simularReservaOta,
  activarCierre, reabrirVenta, cierreVigente, aplicarImportacion, nochesEntre, MAX_HORAS_POR_DEFECTO,
} from '../nucleo/alojamiento.mjs';
import { exportarCalendario, importarCalendario } from '../nucleo/ical.mjs';
import { balboas } from '../nucleo/mensajes.mjs';
import { normalizarTelefono, mostrarTelefono } from '../nucleo/contacto.mjs';

const vista = { desde: null, noches: preferencia('aloj-noches') === '30' ? 30 : 14 };
let recienCreada = null;

const datos = () => {
  const estado = cargar();
  return { estado, aloj: estado.alojamiento, ahora: estado.reloj.ahora, hoy: fechaISO(estado.reloj.ahora) };
};
const operar = (fn, motivo = 'alojamiento') => transaccion((e) => fn(e.alojamiento, e.reloj.ahora, fechaISO(e.reloj.ahora)), motivo);
const nombres = (ids) => {
  const n = ids.map((u) => cabanaDe(negocio, u).nombre);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n.at(-1)}` : n[0] || '';
};
const etiquetaReserva = (r) => r.canal === 'directo' ? `Directo · ${r.huesped?.nombre?.replace(/\s*\(ejemplo\)/, '') || ''}` : r.canal === 'bloqueo' ? `Bloqueo${r.nota ? ` · ${r.nota}` : ''}` : CANALES_ALOJ[r.canal].nombre;

// ── Encabezado ────────────────────────────────────────────────────────

function pintarCabeza() {
  const { aloj, ahora } = datos();
  const choques = detectarChoques(aloj.reservas).length;
  pintarMarca($('#marca'), { ...negocio, ciudad: negocio.lugar }, {
    enlace: 'alojamiento.html',
    extra: `<p class="reloj-chip">${icono('reloj')}<span><span class="reloj-chip__etiqueta">Reloj de la demo</span> <time>${esc(fechaCorta(ahora))}, ${esc(horaTexto(ahora))}</time></span></p>
      <nav class="pestanas marca__nav" aria-label="Secciones">
        <a href="#calendario">Calendario</a><a href="#choques">Choques${choques ? ` <span class="cuenta">${choques}</span>` : ''}</a><a href="#reservas">Reservas</a><a href="#canales">Canales y vigilante</a><a href="alojamiento-reservar.html">Página del huésped</a>
      </nav>`,
  });
}

// ── Alertas del vigilante, cierre y choques ───────────────────────────

function htmlAlertas() {
  const { aloj, ahora } = datos();
  const cierre = cierreVigente(aloj);
  const vencidos = vigilar(aloj.canales, ahora).filter((v) => v.vencido);
  const choques = detectarChoques(aloj.reservas);
  let html = '';
  for (const v of vencidos) {
    const yaCerrado = (aloj.cierres || []).some((c) => c.canalId === v.canalId);
    html += `<div class="alerta" role="alert">
      <p class="alerta__titulo">${icono('aviso')} ${esc(v.nombre)} no sincroniza desde hace ${Math.floor(v.horas)} h: las fechas que se vendan ahí no se están bloqueando aquí.</p>
      <p>El máximo permitido es ${v.max} h. Cabañas conectadas a ${esc(v.nombre)}: ${esc(nombres(v.unidades))}. Revisa la conexión del canal; mientras tanto, cierra también esas fechas en el extranet de ${esc(v.nombre)} si puedes.</p>
      <div class="acciones">${yaCerrado ? '' : `<button type="button" class="boton boton--peligro" data-cierre="${v.canalId}">Cierre preventivo: dejar de vender ${esc(nombres(v.unidades))} en la página</button>`}<a class="boton" href="#canales">Ver canales</a></div>
    </div>`;
  }
  for (const c of cierre.cierres) {
    const canal = aloj.canales.find((x) => x.id === c.canalId);
    const sigue = vencidos.some((v) => v.canalId === c.canalId);
    html += `<div class="cierre-activo"><p class="cierre-activo__titulo">${icono('candado')} Venta directa cerrada en ${esc(nombres(c.unidades))}</p>
      <p>Desde el ${esc(fechaCorta(c.desde))} a las ${esc(horaTexto(c.desde))}, por ${esc(canal ? canal.nombre : c.canalId)}. La página del huésped no ofrece esas cabañas.${sigue ? ` ${esc(canal.nombre)} sigue sin sincronizar.` : ` ${esc(canal ? canal.nombre : '')} ya sincroniza.`}</p>
      <div class="acciones"><button type="button" class="boton" data-reabrir="${c.canalId}">Reabrir la venta directa</button><a class="boton" href="alojamiento-reservar.html">Ver la página del huésped</a></div></div>`;
  }
  if (choques.length) {
    html += `<div class="alerta"><p class="alerta__titulo">${icono('aviso')} ${choques.length === 1 ? 'Hay 1 choque' : `Hay ${choques.length} choques`}: dos reservas en la misma cabaña y noche</p>
      <p>${choques.map((c) => `${esc(cabanaDe(negocio, c.unidadId).nombre)}, ${esc(rangoTexto(c.desde, c.hasta))} (${esc(CANALES_ALOJ[c.a.canal].nombre)} y ${esc(CANALES_ALOJ[c.b.canal].nombre)})`).join('; ')}.</p>
      <div class="acciones"><a class="boton" href="#choques">Ver la propuesta de reubicación</a></div></div>`;
  }
  return html;
}

// ── Calendario de cabañas ─────────────────────────────────────────────

function carriles(reservas) {
  const fin = [];
  return reservas.map((r) => {
    let i = fin.findIndex((f) => f <= r.llegada);
    if (i < 0) { i = fin.length; fin.push(r.salida); } else fin[i] = r.salida;
    return { r, carril: i + 1 };
  });
}

function htmlCalendario() {
  const { aloj, hoy } = datos();
  if (!vista.desde) vista.desde = sumarDias(hoy, -1);
  const N = vista.noches, desde = vista.desde, hasta = sumarDias(desde, N);
  const dias = Array.from({ length: N }, (_, i) => sumarDias(desde, i));
  const cierre = cierreVigente(aloj);
  const enChoque = new Set(detectarChoques(aloj.reservas).flatMap((c) => [`${c.a.id}|${c.unidadId}`, `${c.b.id}|${c.unidadId}`]));
  const finde = (f) => [5, 6].includes(diaSemana(f));
  const meses = [...new Set(dias.map((f) => MESES[leerISO(f).mes - 1]))];
  let html = `<div class="ocupacion" style="--noches:${N}" role="grid" aria-label="Ocupación por cabaña y noche, del ${esc(fechaLarga(desde))} al ${esc(fechaLarga(sumarDias(hasta, -1)))}">
    <div class="ocu-fila ocu-cabeza" role="row"><div class="ocu-mes" role="columnheader">${esc(meses.join(' / '))}</div>
    ${dias.map((f, i) => `<div class="ocu-dia${finde(f) ? ' ocu-dia--finde' : ''}${f === hoy ? ' ocu-dia--hoy' : ''}${temporadaDe(negocio, f) === 'alta' ? ' ocu-dia--alta' : ''}" style="grid-column:${i + 2}" role="columnheader" aria-label="Noche del ${esc(fechaLarga(f))}${temporadaDe(negocio, f) === 'alta' ? ', temporada alta' : ''}">${DIAS_CORTOS[diaSemana(f)]}<strong>${leerISO(f).dia}</strong></div>`).join('')}</div>`;
  for (const c of negocio.cabanas) {
    const suyas = aloj.reservas.filter((r) => activa(r) && r.unidades.includes(c.id) && r.llegada < hasta && r.salida > desde)
      .sort((a, b) => (a.llegada < b.llegada ? -1 : a.llegada > b.llegada ? 1 : (a.creada || 0) - (b.creada || 0)));
    const conCarril = carriles(suyas);
    const L = Math.max(1, ...conCarril.map((x) => x.carril));
    const cerrada = cierre.unidades.includes(c.id);
    html += `<div class="ocu-fila" role="row" style="--carriles:${L}">
      <div class="ocu-nombre" role="rowheader" style="grid-row:1 / span ${L}"><strong>${esc(c.nombre)}</strong><small>${c.capacidad} personas · ${balboas(c.tarifa.baja * 100)}</small>${cerrada ? `<span class="insignia insignia--aviso">${icono('candado')} Venta directa cerrada</span>` : ''}</div>
      ${dias.map((f, i) => `<span class="ocu-celda${finde(f) ? ' ocu-celda--finde' : ''}${f === hoy ? ' ocu-celda--hoy' : ''}${cerrada && f >= hoy ? ' ocu-celda--cerrada' : ''}" style="grid-column:${i + 2};grid-row:1 / span ${L}" data-celda="${c.id}|${f}" aria-hidden="true"></span>`).join('')}
      ${conCarril.map(({ r, carril }) => {
        const s = Math.max(0, diferenciaDias(desde, r.llegada));
        const antes = r.llegada < desde, despues = r.salida >= hasta;
        const e = despues ? N : diferenciaDias(desde, r.salida);
        const span = despues ? N - s : e - s + 1;
        const choque = enChoque.has(`${r.id}|${c.id}`);
        const texto = etiquetaReserva(r);
        const aria = `${CANALES_ALOJ[r.canal].largo}: ${r.huesped ? r.huesped.nombre + ', ' : ''}${rangoTexto(r.llegada, r.salida)}, ${diferenciaDias(r.llegada, r.salida)} noches${r.unidades.length > 1 ? `, grupo de ${r.unidades.length} cabañas` : ''}${choque ? ', en choque con otra reserva' : ''}`;
        return `<button type="button" class="barra-res barra-res--${r.canal}${antes ? ' barra-res--antes' : ''}${despues ? ' barra-res--despues' : ''}${choque ? ' barra-res--choque' : ''}${r.id === recienCreada ? ' barra-res--nueva' : ''}" style="grid-column:${s + 2} / span ${span};grid-row:${carril}" data-reserva="${r.id}" aria-label="${esc(aria)}" title="${esc(aria)}"><span class="barra-res__texto">${esc(texto)}</span></button>`;
      }).join('')}
    </div>`;
  }
  return html + '</div>';
}

function htmlSeccionCalendario() {
  const { aloj, hoy } = datos();
  if (!vista.desde) vista.desde = sumarDias(hoy, -1);
  const booking = aloj.canales.find((c) => c.id === 'booking');
  const titulo = rangoTexto(vista.desde, sumarDias(vista.desde, vista.noches - 1));
  return `
    <div class="seccion__cabeza"><h2 id="t-cal">Calendario de cabañas</h2><p>Cada barra es una estancia: empieza a media celda (llegada por la tarde) y termina a media celda del día de salida.</p></div>
    <div class="herramientas">
      <div class="herramientas__fecha">
        <button type="button" class="boton-icono" data-mover="-7" aria-label="Semana anterior">${icono('izq')}</button>
        <button type="button" class="boton" data-mover="hoy">Hoy</button>
        <button type="button" class="boton-icono" data-mover="7" aria-label="Semana siguiente">${icono('der')}</button>
      </div>
      <h3 class="herramientas__titulo" aria-live="polite"><small>Noches</small>Del ${esc(titulo)}</h3>
      <div class="segmentado" role="group" aria-label="Rango"><button type="button" data-noches="14" aria-pressed="${vista.noches === 14}">2 semanas</button><button type="button" data-noches="30" aria-pressed="${vista.noches === 30}">30 noches</button></div>
      <button type="button" class="boton boton--primario" data-nueva>${icono('mas')} Nueva reserva o bloqueo</button>
    </div>
    <div class="simulador" style="margin-bottom:12px">
      <p class="simulador__titulo">Solo en la demo: el caso de la doble reserva</p>
      <div class="acciones">
        ${booking.caido
          ? `<button type="button" class="boton" data-restablecer="booking">Booking vuelve a sincronizar</button>`
          : `<button type="button" class="boton" data-caida="booking">Simular que Booking deja de sincronizar</button>`}
        <button type="button" class="boton" data-simular-ota="booking"${booking.caido ? '' : ' disabled aria-describedby="ayuda-sim"'}>Simular una reserva que entra por Booking mientras tanto</button>
      </div>
      ${booking.caido ? '' : '<p class="campo__ayuda" id="ayuda-sim">Primero simula la caída: con Booking sincronizado, esas fechas ya estarían bloqueadas allá.</p>'}
    </div>
    <div class="ocupacion-scroll" tabindex="0" aria-label="Calendario; en el teléfono desplázate hacia los lados">${htmlCalendario()}</div>
    <div class="leyenda-canales" aria-label="Canales">
      ${['directo', 'airbnb', 'booking', 'expedia', 'bloqueo'].map((k) => `<span><span class="muestra-canal barra-res--${k}"></span>${esc(CANALES_ALOJ[k].largo)}</span>`).join('')}
      <span><span class="muestra-canal" style="background:var(--aviso);height:3px;vertical-align:4px"></span>Temporada alta (dic-abr)</span>
    </div>`;
}

// ── Choques ───────────────────────────────────────────────────────────

function htmlChoques() {
  const { aloj } = datos();
  const choques = detectarChoques(aloj.reservas);
  const quien = (r) => r.canal === 'directo' ? `reserva directa de ${r.huesped?.nombre || 'un huésped'}` : r.canal === 'bloqueo' ? 'Bloqueo manual' : `Reserva de ${CANALES_ALOJ[r.canal].largo} (el iCal no trae el nombre)`;
  const propuesta = (r, u, etiqueta) => {
    const libres = proponerReubicacion(negocio, aloj.reservas, r, u);
    if (!libres.length) {
      const tel = r.huesped?.telefono;
      return `<div class="propuesta"><p><strong>${esc(etiqueta)}:</strong> sin cabaña libre de igual o mayor capacidad esas noches. Contactar al huésped${r.canal !== 'directo' && r.canal !== 'bloqueo' ? ` por ${esc(CANALES_ALOJ[r.canal].largo)}` : ''}.</p>${tel ? `<div class="acciones"><a class="boton" href="tel:${esc(tel)}">${icono('llamar')} Llamar</a></div>` : ''}</div>`;
    }
    const c = libres[0];
    return `<div class="propuesta"><p><strong>${esc(etiqueta)}:</strong> mover a ${esc(c.nombre)} (${c.capacidad} personas), libre del ${esc(rangoTexto(r.llegada, r.salida))}.${libres.length > 1 ? ` También: ${esc(libres.slice(1).map((x) => x.nombre).join(', '))}.` : ''}</p>
      <div class="acciones"><button type="button" class="boton boton--primario" data-mover-res="${r.id}|${u}|${c.id}" aria-label="Mover la ${esc(r.canal === 'directo' ? 'reserva directa' : `reserva de ${CANALES_ALOJ[r.canal].largo}`)} a ${esc(c.nombre)}">Mover a ${esc(c.nombre)}</button></div></div>`;
  };
  return `
    <div class="seccion__cabeza"><h2 id="t-ch">Choques</h2><p>Dos reservas en la misma cabaña y noche. Se propone mover primero la que entró después.</p></div>
    <div class="panel">${choques.length ? `<ul class="filas">${choques.map((c) => `<li class="choque">
      <p class="choque__titulo">${icono('aviso')} ${esc(cabanaDe(negocio, c.unidadId).nombre)}: ${esc(rangoTexto(c.desde, c.hasta))} (${c.noches} ${c.noches === 1 ? 'noche' : 'noches'})</p>
      <div class="choque__pares"><p>Primero: ${esc(quien(c.a).replace(/^./, (x) => x.toUpperCase()))}, del ${esc(rangoTexto(c.a.llegada, c.a.salida))}.</p><p>Después: ${esc(quien(c.b).replace(/^./, (x) => x.toUpperCase()))}, del ${esc(rangoTexto(c.b.llegada, c.b.salida))}${c.b.simulada ? ' (simulada)' : ''}.</p></div>
      ${propuesta(c.b, c.unidadId, 'Propuesta')}
      ${propuesta(c.a, c.unidadId, 'Otra opción, mover la primera')}
    </li>`).join('')}</ul>` : '<p class="vacio"><strong>Sin choques.</strong>Ninguna cabaña tiene dos reservas la misma noche.</p>'}</div>`;
}

// ── Reservas ──────────────────────────────────────────────────────────

function htmlReservas() {
  const { aloj, hoy } = datos();
  const prox = aloj.reservas.filter((r) => activa(r) && r.salida >= hoy).sort((a, b) => (a.llegada < b.llegada ? -1 : 1));
  return `
    <div class="seccion__cabeza"><h2 id="t-res">Reservas de hoy en adelante</h2><p>${prox.length} activas</p></div>
    <div class="panel" style="overflow-x:auto">${prox.length ? `<table class="tabla tabla--apilable"><thead><tr><th scope="col">Llegada</th><th scope="col">Salida</th><th scope="col">Cabañas</th><th scope="col">Canal</th><th scope="col">Huésped</th><th scope="col">Seña</th></tr></thead><tbody>
      ${prox.map((r) => `<tr><td data-etiqueta="Llegada"><button type="button" class="persona__nombre" data-reserva="${r.id}">${esc(fechaCorta(r.llegada))}</button></td><td data-etiqueta="Salida">${esc(fechaCorta(r.salida))} · ${diferenciaDias(r.llegada, r.salida)} n.</td><td data-etiqueta="Cabañas">${esc(nombres(r.unidades))}</td><td data-etiqueta="Canal"><span class="muestra-canal barra-res--${r.canal}" aria-hidden="true"></span>${esc(CANALES_ALOJ[r.canal].nombre)}</td><td data-etiqueta="Huésped">${r.huesped ? esc(r.huesped.nombre) : r.canal === 'bloqueo' ? esc(r.nota || '—') : '<span class="campo__ayuda">no viene en el iCal</span>'}</td><td data-etiqueta="Seña">${r.sena ? (r.sena.estado === 'verificada' ? '<span class="insignia insignia--ok">Verificada</span>' : '<span class="insignia insignia--aviso">Por verificar</span>') : '—'}</td></tr>`).join('')}
    </tbody></table>` : '<p class="vacio"><strong>No hay reservas por delante.</strong></p>'}</div>`;
}

// ── Canales y vigilante ───────────────────────────────────────────────

function htmlCanales() {
  const { aloj, ahora } = datos();
  const estados = vigilar(aloj.canales, ahora);
  return `
    <div class="seccion__cabeza"><h2 id="t-can">Canales y vigilante de sincronización</h2></div>
    <div class="texto-largo" style="margin-bottom:16px">
      <p>Cada cabaña se conecta a Airbnb, Booking y Expedia con calendarios iCal: este sistema les da un enlace con las fechas ocupadas y lee el de ellos. <strong>El iCal no es tiempo real</strong>: Airbnb relee los calendarios cada 3 horas más o menos y Booking cada 2, así que en ese rato dos personas pueden reservar la misma noche. Para eliminar la doble reserva hace falta un channel manager conectado por API, que empuja la disponibilidad al instante.</p>
      <p>El vigilante es la red de seguridad: anota la última sincronización correcta de cada canal y, si pasa del máximo (${MAX_HORAS_POR_DEFECTO} h por defecto, el doble del intervalo de Airbnb), pone la alerta roja arriba de todo y ofrece el cierre preventivo de la venta directa.</p>
    </div>
    <div class="reloj" style="margin-bottom:16px">
      <div class="reloj__arriba"><div><p class="reloj__etiqueta">Reloj de la demo</p><p class="reloj__fecha"><strong>${esc(fechaLarga(ahora).replace(/^./, (c) => c.toUpperCase()))}, ${esc(horaTexto(ahora))}</strong></p></div>
      <div class="reloj__botones"><button type="button" class="boton" data-avanzar="${HORA}">+1 hora</button><button type="button" class="boton" data-avanzar="${6 * HORA}">+6 horas</button></div></div>
      <p class="reloj__nota">Los canales que funcionan se actualizan solos al adelantar el reloj; uno caído se queda atrás hasta que el vigilante lo marca.</p>
    </div>
    <div class="panel">
      ${aloj.canales.map((c) => {
        const v = estados.find((x) => x.canalId === c.id);
        return `<section class="canal" aria-labelledby="canal-${c.id}">
          <div class="canal__cabeza"><h3 id="canal-${c.id}">${esc(c.nombre)}</h3><span class="semaforo ${v.vencido ? 'semaforo--vencido' : 'semaforo--al-dia'}">${v.vencido ? `Atrasado: ${Math.floor(v.horas)} h sin sincronizar` : 'Al día'}</span></div>
          <div class="canal__datos">
            <span>Última sincronización correcta: <strong>${esc(fechaCorta(c.ultimaSync))}, ${esc(horaTexto(c.ultimaSync))}</strong> (${esc(haceTexto(c.ultimaSync, ahora))})</span>
            <label>Máximo permitido <select data-max="${c.id}">${[2, 3, 4, 6, 8, 12, 24].map((h) => `<option value="${h}"${h === (c.maxHoras || MAX_HORAS_POR_DEFECTO) ? ' selected' : ''}>${h} h</option>`).join('')}</select></label>
            <span>Relee cada ~${c.intervaloHoras} h${c.caido ? ' · <strong>caído (simulado)</strong>' : ''}</span>
          </div>
          <details><summary class="boton boton--plano" style="justify-content:flex-start">Calendarios que se importan de ${esc(c.nombre)} (${Object.keys(c.urls).length} cabañas)</summary>
            <div class="import-filas">${Object.entries(c.urls).map(([u, url]) => `
              <div class="import-fila" data-import="${c.id}|${u}">
                <div class="import-fila__cabeza"><strong>${esc(cabanaDe(negocio, u).nombre)}</strong><span class="campo__ayuda">${aloj.reservas.filter((r) => activa(r) && r.canal === c.id && r.unidades.includes(u)).length} reservas de ${esc(c.nombre)}</span></div>
                <div class="import-fila__url"><label class="sr-only" for="url-${c.id}-${u}">URL del calendario de ${esc(c.nombre)} para ${esc(cabanaDe(negocio, u).nombre)}</label><input id="url-${c.id}-${u}" type="url" value="${esc(url)}" data-url><button type="button" class="boton" data-leer-url>Leer la URL</button></div>
                <div class="acciones"><label class="boton" style="cursor:pointer">Subir el .ics<input type="file" accept=".ics,text/calendar" data-archivo class="sr-only"></label><button type="button" class="boton" data-pegar>Pegar el contenido</button></div>
                <div data-mensaje></div>
              </div>`).join('')}</div>
          </details>
        </section>`;
      }).join('')}
    </div>
    <div class="seccion__cabeza" style="margin-top:24px"><h3>Calendarios que exportas</h3><p>Uno por cabaña, con las reservas directas y los bloqueos manuales. Las de Airbnb, Booking y Expedia no van: si fueran, cada canal recibiría de vuelta sus propias reservas (el «eco»).</p></div>
    <div class="panel"><div class="panel__cuerpo export-filas">
      ${negocio.cabanas.map((c) => `<div class="export-fila"><span><strong>${esc(c.nombre)}</strong> · ${((n) => `${n} ${n === 1 ? 'evento' : 'eventos'}`)(eventosParaExportar(aloj.reservas, c.id).length)}<br><code>En producción: https://tu-dominio.com/ical/${c.id}.ics</code></span><button type="button" class="boton" data-exportar="${c.id}">${icono('descargar')} Descargar ${esc(c.nombre)}.ics</button></div>`).join('')}
    </div></div>
    <div class="seccion__cabeza" style="margin-top:24px"><h3>Comprobar un archivo .ics</h3><p>Pega o sube cualquier calendario para ver qué fechas lee el sistema, sin aplicarlo. Archivos de prueba con la forma real: <a href="pruebas/fixtures/airbnb.ics" download>airbnb.ics</a>, <a href="pruebas/fixtures/booking.ics" download>booking.ics</a>, <a href="pruebas/fixtures/rfc5545.ics" download>rfc5545.ics</a>.</p></div>
    <form class="panel panel__cuerpo formulario" data-comprobar novalidate>
      <div class="campo"><label for="ics-texto">Contenido del .ics</label><textarea id="ics-texto" name="ics" rows="5" spellcheck="false" placeholder="BEGIN:VCALENDAR…"></textarea></div>
      <div class="acciones"><button type="submit" class="boton">Leer las fechas</button><label class="boton" style="cursor:pointer">Subir un archivo<input type="file" accept=".ics,text/calendar" class="sr-only" data-archivo-comprobar></label></div>
      <div data-resultado-comprobar aria-live="polite"></div>
    </form>
    <div class="seccion__cabeza" style="margin-top:24px"><h3>Bitácora</h3></div>
    <ol class="panel bitacora">${(aloj.bitacora || []).slice(0, 15).map((b) => `<li><time>${esc(fechaCorta(b.t).split(' ').slice(0, 2).join(' '))}<br>${esc(horaTexto(b.t))}</time><span>${esc(b.texto)}</span></li>`).join('')}</ol>`;
}

// ── Diálogos ──────────────────────────────────────────────────────────

function abrirNuevaReserva(preset = {}) {
  const { hoy } = datos();
  const llegada = preset.llegada && preset.llegada >= hoy ? preset.llegada : hoy;
  const salida = sumarDias(llegada, minimoNoches(negocio, llegada));
  const d = abrirDialogo({
    titulo: 'Nueva reserva o bloqueo',
    cuerpo: `<form class="formulario" novalidate>
      <div class="resumen-errores" data-errores tabindex="-1" hidden></div>
      <fieldset class="campo"><legend class="etiqueta">Tipo</legend><div class="acciones">
        <label class="opcion"><input type="radio" name="canal" value="directo" checked> Reserva directa (teléfono, WhatsApp, en persona)</label>
        <label class="opcion"><input type="radio" name="canal" value="bloqueo"> Bloqueo manual (mantenimiento, uso propio)</label></div></fieldset>
      <fieldset class="campo"><legend class="etiqueta">Cabañas</legend><div class="formulario__fila formulario__fila--3">
        ${negocio.cabanas.map((c) => `<label class="opcion"><input type="checkbox" name="unidades" value="${c.id}"${preset.unidad === c.id ? ' checked' : ''}> ${esc(c.nombre)} · ${c.capacidad} p.</label>`).join('')}
      </div><p class="campo__ayuda">Para un grupo, marca varias: queda una sola reserva con varias cabañas.</p></fieldset>
      <div class="formulario__fila formulario__fila--3">
        <div class="campo"><label for="nr-llegada">Llegada</label><input id="nr-llegada" type="date" name="llegada" min="${hoy}" value="${llegada}"></div>
        <div class="campo"><label for="nr-salida">Salida</label><input id="nr-salida" type="date" name="salida" min="${sumarDias(hoy, 1)}" value="${salida}"></div>
        <div class="campo" data-solo-directo><label for="nr-personas">Personas</label><input id="nr-personas" type="number" name="personas" min="1" max="30" value="2" inputmode="numeric"></div>
      </div>
      <div data-solo-directo class="formulario">
        <div class="formulario__fila formulario__fila--2">
          <div class="campo"><label for="nr-nombre">Nombre de quien reserva</label><input id="nr-nombre" type="text" name="nombre" autocomplete="off"></div>
          <div class="campo"><label for="nr-tel">Celular</label><input id="nr-tel" type="tel" name="telefono" inputmode="tel" placeholder="6000-0000"></div>
        </div>
        <div class="campo"><label for="nr-sena">Seña</label><select id="nr-sena" name="sena"><option value="por_verificar">Por verificar (Yappy o transferencia)</option><option value="verificada">Ya verificada</option></select></div>
        <div class="consentimiento campo"><label class="opcion"><input type="checkbox" name="consentimiento"> <span>El huésped autorizó guardar sus datos para esta reserva (Ley 81 de 2019).</span></label></div>
        <label class="opcion"><input type="checkbox" name="ignorarMinimo"> Aceptar menos noches que el mínimo de la temporada</label>
      </div>
      <div data-solo-bloqueo hidden class="campo"><label for="nr-nota">Motivo</label><input id="nr-nota" type="text" name="nota" maxlength="60" placeholder="Por ejemplo: pintura"></div>
      <div data-cotizacion class="resumen-pedido" aria-live="polite"></div>
      <div class="acciones"><button type="submit" class="boton boton--primario" data-guardar>Guardar la reserva</button><button type="button" class="boton" data-cerrar>Cancelar</button></div>
    </form>`,
  });
  const form = d.querySelector('form');
  const f = form.elements;
  const unidades = () => [...form.querySelectorAll('[name="unidades"]:checked')].map((x) => x.value);
  const actualizar = () => {
    const directo = f.canal.value === 'directo';
    for (const el of form.querySelectorAll('[data-solo-directo]')) el.hidden = !directo;
    form.querySelector('[data-solo-bloqueo]').hidden = directo;
    form.querySelector('[data-guardar]').textContent = directo ? 'Guardar la reserva' : 'Guardar el bloqueo';
    const cont = form.querySelector('[data-cotizacion]');
    const u = unidades();
    if (!directo || !u.length || !esISO(f.llegada.value) || !esISO(f.salida.value) || f.salida.value <= f.llegada.value) { cont.innerHTML = ''; cont.hidden = true; return; }
    const c = cotizar(negocio, u, f.llegada.value, f.salida.value);
    cont.hidden = false;
    cont.innerHTML = `<span>${c.noches} ${c.noches === 1 ? 'noche' : 'noches'} · ${esc(nombres(u))} · mínimo ${c.minimo} en temporada ${temporadaDe(negocio, f.llegada.value)}${c.cumpleMinimo ? '' : ' <strong>(no lo cumple)</strong>'}</span><span>Subtotal ${balboas(c.subtotal)} + ITBMS 10 % ${balboas(c.impuesto)}</span><strong>Total ${balboas(c.total)} · seña ${balboas(c.sena)}</strong>`;
  };
  form.addEventListener('change', actualizar);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const directo = f.canal.value === 'directo';
    if (directo && f.telefono.value.trim() && !normalizarTelefono(f.telefono.value).ok) {
      mostrarErrores(form, [{ campo: 'telefono', mensaje: normalizarTelefono(f.telefono.value).error }]);
      return;
    }
    const r = operar((aloj, ahora, hoy2) => crearReserva(aloj, negocio, {
      canal: f.canal.value, unidades: unidades(), llegada: f.llegada.value, salida: f.salida.value,
      personas: directo ? +f.personas.value : null, nota: directo ? '' : f.nota.value,
      huesped: directo ? { nombre: f.nombre.value, telefono: f.telefono.value.trim() ? normalizarTelefono(f.telefono.value).e164 : '', consentimiento: f.consentimiento.checked, canalConsentimiento: 'por teléfono' } : null,
      sena: { estado: f.sena.value }, ignorarMinimo: f.ignorarMinimo.checked,
    }, ahora, hoy2));
    if (!r.ok) { mostrarErrores(form, r.errores); return; }
    recienCreada = r.reserva.id;
    d.close();
    anunciar(directo ? `Reserva guardada: ${nombres(r.reserva.unidades)}, ${rangoTexto(r.reserva.llegada, r.reserva.salida)}.` : `Bloqueo guardado: ${nombres(r.reserva.unidades)}.`);
    setTimeout(() => { recienCreada = null; }, 1000);
  });
  actualizar();
  (preset.unidad ? f.llegada : form.querySelector('[name="unidades"]')).focus();
}

function abrirReserva(id) {
  const { aloj } = datos();
  const r = aloj.reservas.find((x) => x.id === id);
  if (!r) return;
  const canal = CANALES_ALOJ[r.canal];
  const cot = r.canal === 'directo' ? cotizar(negocio, r.unidades, r.llegada, r.salida) : null;
  const opcionesMover = r.unidades.map((u) => ({ u, libres: proponerReubicacion(negocio, aloj.reservas, r, u) })).filter((x) => x.libres.length);
  const d = abrirDialogo({
    titulo: esc(r.huesped ? r.huesped.nombre : r.canal === 'bloqueo' ? 'Bloqueo manual' : `Reserva de ${canal.largo}`),
    cuerpo: `<div class="bloque-dialogo"><dl class="datos">
      <dt>Canal</dt><dd><span class="muestra-canal barra-res--${r.canal}" aria-hidden="true"></span>${esc(canal.largo)}${r.simulada ? ' (simulada)' : ''}</dd>
      <dt>Cabañas</dt><dd>${esc(nombres(r.unidades))}${r.unidades.length > 1 ? ' (grupo, una sola reserva)' : ''}</dd>
      <dt>Fechas</dt><dd>Llega el ${esc(fechaLarga(r.llegada))}, sale el ${esc(fechaLarga(r.salida))} · ${diferenciaDias(r.llegada, r.salida)} noches</dd>
      ${r.huesped ? `<dt>Huésped</dt><dd>${esc(r.huesped.nombre)}${r.huesped.personas ? ` · ${r.huesped.personas} personas` : ''}${r.huesped.telefono ? ` · <a href="tel:${esc(r.huesped.telefono)}">${esc(mostrarTelefono(r.huesped.telefono))}</a>` : ''}</dd>` : r.canal !== 'bloqueo' ? `<dt>Huésped</dt><dd>${esc(canal.largo)} no comparte el nombre en el iCal${r.resumen ? ` (dice «${esc(r.resumen)}»)` : ''}.</dd>` : `<dt>Motivo</dt><dd>${esc(r.nota || '—')}</dd>`}
      ${cot ? `<dt>Total</dt><dd>${balboas(cot.total)} (incluye ITBMS de hospedaje ${balboas(cot.impuesto)})</dd><dt>Seña</dt><dd>${balboas(r.sena?.monto ?? cot.sena)} · ${r.sena?.estado === 'verificada' ? '<span class="insignia insignia--ok">Verificada</span>' : '<span class="insignia insignia--aviso">Por verificar</span>'}</dd>` : ''}
      ${r.uidExterno ? `<dt>UID</dt><dd><code style="font-size:0.75rem">${esc(r.uidExterno)}</code></dd>` : ''}
    </dl>
    <div class="resumen-errores" data-errores tabindex="-1" hidden style="margin-top:10px"></div>
    <div class="acciones" style="margin-top:14px">
      ${r.sena && r.sena.estado !== 'verificada' ? '<button type="button" class="boton boton--primario" data-verificar>Marcar la seña como verificada</button>' : ''}
      ${['directo', 'bloqueo'].includes(r.canal) ? `<button type="button" class="boton boton--peligro" data-cancelar>${r.canal === 'bloqueo' ? 'Quitar el bloqueo' : 'Cancelar la reserva'}</button>` : `<p class="campo__ayuda">Para cancelarla, se hace en ${esc(canal.largo)}; aquí desaparece en la próxima sincronización.</p>`}
    </div></div>
    ${opcionesMover.length ? `<div class="bloque-dialogo"><h3>Mover a otra cabaña</h3><p class="campo__ayuda" style="margin-bottom:8px">Solo cabañas libres esas noches y de igual o mayor capacidad.</p>${opcionesMover.map((o) => `<div class="acciones" style="margin-bottom:6px"><span>De ${esc(cabanaDe(negocio, o.u).nombre)} a:</span>${o.libres.map((c) => `<button type="button" class="boton" data-mover-res="${r.id}|${o.u}|${c.id}">${esc(c.nombre)}</button>`).join('')}</div>`).join('')}</div>` : ''}`,
  });
  d.addEventListener('click', async (ev) => {
    const errores = d.querySelector('[data-errores]');
    const fallo = (res) => { errores.hidden = false; errores.innerHTML = `<p>${esc(res.errores[0].mensaje)}</p>`; errores.focus(); };
    if (ev.target.closest('[data-verificar]')) { operar((a, ahora) => verificarSena(a, id, ahora)); d.close(); anunciar('Seña verificada.'); }
    if (ev.target.closest('[data-cancelar]')) {
      const ok = await confirmar({ titulo: r.canal === 'bloqueo' ? 'Quitar el bloqueo' : 'Cancelar la reserva', texto: `Las noches del ${esc(rangoTexto(r.llegada, r.salida))} vuelven a quedar libres en ${esc(nombres(r.unidades))}.`, si: r.canal === 'bloqueo' ? 'Quitar el bloqueo' : 'Cancelar la reserva', no: 'Volver', peligro: true });
      if (!ok) return;
      const res = operar((a, ahora) => cancelarReserva(a, id, ahora));
      if (!res.ok) fallo(res); else { d.close(); anunciar('Listo: esas noches quedaron libres.'); }
    }
    const m = ev.target.closest('[data-mover-res]');
    if (m) {
      const [rid, de, a] = m.dataset.moverRes.split('|');
      const res = operar((al, ahora) => moverReserva(al, negocio, rid, de, a, ahora));
      if (!res.ok) fallo(res); else { d.close(); anunciar(`Movida a ${cabanaDe(negocio, a).nombre}.`); }
    }
  });
}

function abrirPegar(canalId, unidadId) {
  const { aloj } = datos();
  const canal = aloj.canales.find((c) => c.id === canalId);
  const d = abrirDialogo({
    titulo: `Pegar el calendario de ${esc(canal.nombre)} para ${esc(cabanaDe(negocio, unidadId).nombre)}`,
    cuerpo: `<form class="formulario" novalidate><div class="campo"><label for="pg-ics">Contenido del .ics</label><textarea id="pg-ics" name="ics" rows="8" spellcheck="false" placeholder="BEGIN:VCALENDAR…"></textarea></div>
      <div data-vista></div>
      <div class="acciones"><button type="submit" class="boton boton--primario">Leer y revisar</button><button type="button" class="boton" data-cerrar>Cancelar</button></div></form>`,
  });
  const form = d.querySelector('form');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    revisarImportacion(form.querySelector('[data-vista]'), canalId, unidadId, form.elements.ics.value, () => d.close());
  });
  form.elements.ics.focus();
}

/** Lee un .ics, muestra lo que se va a aplicar y lo aplica con un botón. */
function revisarImportacion(cont, canalId, unidadId, texto, alAplicar) {
  let leido;
  try { leido = importarCalendario(texto); } catch (e) {
    cont.innerHTML = `<p class="mensaje-import mensaje-import--error" role="alert">${esc(e.message)} Revisa que copiaste el archivo completo, desde BEGIN:VCALENDAR hasta END:VCALENDAR.</p>`;
    return;
  }
  const { aloj } = datos();
  const canal = aloj.canales.find((c) => c.id === canalId);
  const ecos = leido.eventos.filter((e) => e.uid.endsWith('@reservas.alphateklab')).length;
  cont.innerHTML = `<div class="mensaje-import mensaje-import--ok" role="status"><p>Se leyeron ${leido.eventos.length} ${leido.eventos.length === 1 ? 'estancia' : 'estancias'}${leido.ignorados.length ? ` y se ignoraron ${leido.ignorados.length} (${esc(leido.ignorados.map((i) => i.motivo).join(', '))})` : ''}${ecos ? `; ${ecos} salieron de aquí (eco) y no se duplican` : ''}.</p></div>
    <ul class="eventos-leidos">${leido.eventos.map((e) => `<li>${esc(rangoTexto(e.inicio, e.fin))} · ${nochesEntre(e.inicio, e.fin).length} noches · ${esc(e.resumen || 'sin resumen')}</li>`).join('')}</ul>
    <div class="acciones" style="margin-top:8px"><button type="button" class="boton boton--primario" data-aplicar>Aplicar a ${esc(cabanaDe(negocio, unidadId).nombre)} (${esc(canal.nombre)})</button></div>`;
  cont.querySelector('[data-aplicar]').addEventListener('click', () => {
    const r = operar((a, ahora) => aplicarImportacion(a, canalId, unidadId, leido.eventos, ahora));
    anunciar(`Calendario de ${canal.nombre} aplicado: ${r.nuevas.length} nuevas, ${r.cambiadas.length} cambiadas, ${r.quitadas.length} quitadas.`);
    alAplicar && alAplicar();
  });
}

// ── Pintar y eventos ─────────────────────────────────────────────────

function pintar() {
  pintarCabeza();
  $('#alertas').innerHTML = htmlAlertas();
  $('#calendario').innerHTML = htmlSeccionCalendario();
  $('#choques').innerHTML = htmlChoques();
  $('#reservas').innerHTML = htmlReservas();
  const abiertos = [...document.querySelectorAll('#canales details[open]')].map((x) => x.querySelector('h3, summary')?.textContent);
  $('#canales').innerHTML = htmlCanales();
  if (abiertos.length) for (const det of document.querySelectorAll('#canales details')) if (abiertos.includes(det.querySelector('summary').textContent)) det.open = true;
}

document.addEventListener('click', async (ev) => {
  const t = ev.target;
  if (!$('#principal').contains(t)) return;
  const b = (s) => t.closest(s);
  const { hoy, ahora } = datos();
  if (b('[data-mover]')) { const m = b('[data-mover]').dataset.mover; vista.desde = m === 'hoy' ? sumarDias(hoy, -1) : sumarDias(vista.desde, +m); pintar(); return; }
  if (b('[data-noches]')) { vista.noches = +b('[data-noches]').dataset.noches; preferencia('aloj-noches', String(vista.noches)); pintar(); return; }
  if (b('[data-nueva]')) { abrirNuevaReserva(); return; }
  if (b('[data-celda]')) { const [u, f] = b('[data-celda]').dataset.celda.split('|'); abrirNuevaReserva({ unidad: u, llegada: f }); return; }
  if (b('[data-reserva]')) { abrirReserva(b('[data-reserva]').dataset.reserva); return; }
  if (b('[data-caida]')) { operar((a, ahora2) => simularCaida(a, b('[data-caida]').dataset.caida, ahora2)); anunciar('Booking dejó de sincronizar (simulado). Mira la alerta arriba.'); scrollTo({ top: 0, behavior: 'auto' }); $('#alertas .alerta')?.setAttribute('tabindex', '-1'); $('#alertas .alerta')?.focus(); return; }
  if (b('[data-restablecer]')) { operar((a, ahora2) => restablecerCanal(a, b('[data-restablecer]').dataset.restablecer, ahora2)); anunciar('Booking volvió a sincronizar. Si cerraste la venta directa, reábrela cuando revises los choques.'); return; }
  if (b('[data-simular-ota]')) {
    const r = operar((a, ahora2, hoy2) => simularReservaOta(a, b('[data-simular-ota]').dataset.simularOta, ahora2, hoy2));
    if (!r.ok) anunciar(r.errores[0].mensaje); else { recienCreada = r.reserva.id; anunciar(`Entró una reserva por Booking en ${nombres(r.reserva.unidades)}, ${rangoTexto(r.reserva.llegada, r.reserva.salida)}. Hay un choque.`); setTimeout(() => { recienCreada = null; }, 1000); }
    return;
  }
  if (b('[data-cierre]')) { operar((a, ahora2) => activarCierre(a, b('[data-cierre]').dataset.cierre, ahora2)); anunciar('Cierre preventivo activado: la página del huésped ya no ofrece esas cabañas.'); return; }
  if (b('[data-reabrir]')) {
    const canalId = b('[data-reabrir]').dataset.reabrir;
    const sigue = vigilar(datos().aloj.canales, ahora).some((v) => v.canalId === canalId && v.vencido);
    if (sigue && !(await confirmar({ titulo: 'Reabrir la venta directa', texto: 'El canal sigue sin sincronizar: si reabres, la página puede vender noches que ya se vendieron allá.', si: 'Reabrir de todos modos', no: 'Dejar cerrada', peligro: true }))) return;
    operar((a, ahora2) => reabrirVenta(a, canalId, ahora2));
    anunciar('Venta directa reabierta.');
    return;
  }
  if (b('[data-mover-res]')) {
    const [rid, de, a] = b('[data-mover-res]').dataset.moverRes.split('|');
    const r = operar((al, ahora2) => moverReserva(al, negocio, rid, de, a, ahora2));
    anunciar(r.ok ? `Reubicada en ${cabanaDe(negocio, a).nombre}. El choque se resolvió.` : r.errores[0].mensaje);
    return;
  }
  if (b('[data-avanzar]')) { adelantarReloj(ahora + +b('[data-avanzar]').dataset.avanzar); return; }
  if (b('[data-exportar]')) {
    const id = b('[data-exportar]').dataset.exportar;
    const cab = cabanaDe(negocio, id);
    const ics = exportarCalendario({ nombre: `${cab.nombre} · ${negocio.nombre} (ejemplo)`, eventos: eventosParaExportar(datos().aloj.reservas, id), dtstamp: Date.now() });
    descargar(`${id}.ics`, ics);
    anunciar(`Descargado ${id}.ics.`);
    return;
  }
  if (b('[data-pegar]')) { const [c, u] = b('[data-import]').dataset.import.split('|'); abrirPegar(c, u); return; }
  if (b('[data-leer-url]')) {
    const fila = b('[data-import]');
    const [c, u] = fila.dataset.import.split('|');
    const url = fila.querySelector('[data-url]').value.trim();
    const msj = fila.querySelector('[data-mensaje]');
    msj.innerHTML = '<p class="mensaje-import" role="status">Leyendo…</p>';
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error(`respondió ${resp.status}`);
      revisarImportacion(msj, c, u, await resp.text());
    } catch {
      const canal = datos().aloj.canales.find((x) => x.id === c);
      msj.innerHTML = `<p class="mensaje-import mensaje-import--error" role="alert">El navegador no pudo leer esa URL. ${esc(canal.nombre)} no deja que otra página lea su calendario (CORS), así que en la demo sube el archivo .ics o pega su contenido. En producción lo lee el servidor cada 15 a 30 minutos, donde el CORS no aplica.</p>`;
    }
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.matches('[data-max]')) { const id = t.dataset.max, v = +t.value; operar((a) => { a.canales.find((c) => c.id === id).maxHoras = v; }); anunciar(`Máximo sin sincronizar: ${v} h.`); return; }
  if (t.matches('[data-archivo]') && t.files[0]) {
    const fila = t.closest('[data-import]');
    const [c, u] = fila.dataset.import.split('|');
    revisarImportacion(fila.querySelector('[data-mensaje]'), c, u, await t.files[0].text());
    return;
  }
  if (t.matches('[data-archivo-comprobar]') && t.files[0]) {
    const form = t.closest('form');
    form.elements.ics.value = await t.files[0].text();
    form.requestSubmit();
  }
});

document.addEventListener('submit', (ev) => {
  if (!ev.target.matches('[data-comprobar]')) return;
  ev.preventDefault();
  const cont = ev.target.querySelector('[data-resultado-comprobar]');
  try {
    const r = importarCalendario(ev.target.elements.ics.value);
    cont.innerHTML = `<p class="mensaje-import mensaje-import--ok">${r.eventos.length} ${r.eventos.length === 1 ? 'estancia leída' : 'estancias leídas'}${r.prodid ? ` · origen: ${esc(r.prodid)}` : ''}${r.ignorados.length ? ` · ${r.ignorados.length} ignoradas (${esc(r.ignorados.map((i) => i.motivo).join(', '))})` : ''}</p>
      <ul class="eventos-leidos" data-eventos-leidos>${r.eventos.map((e) => `<li data-inicio="${e.inicio}" data-fin="${e.fin}">${esc(rangoTexto(e.inicio, e.fin))} · ${nochesEntre(e.inicio, e.fin).length} noches · ${esc(e.resumen || 'sin resumen')} · <code>${esc(e.uid)}</code></li>`).join('')}</ul>`;
  } catch (e) {
    cont.innerHTML = `<p class="mensaje-import mensaje-import--error" role="alert">${esc(e.message)}</p>`;
  }
});

iniciarBarra({ pagina: 'alojamiento.html', tipo: 'alojamiento' });
pintar();
alCambiar(() => pintar());
if (location.hash === '#canales') requestAnimationFrame(() => $('#canales').scrollIntoView());
