// Relevo entre dispositivos por https://ntfy.sh (servidor público de pruebas, CORS abierto).
// Publicar = POST al tema; escuchar = EventSource sobre /sse. El tema es atk-reservas-<sala>.
// Solo se usa cuando la agenda está en OTRO dispositivo: con la agenda en este mismo navegador, la respuesta se
// aplica aquí y no sale nada. Viajan identificadores y la respuesta («confirmo», «no podré ir»), salvo la solicitud
// de cita hecha desde otro teléfono, que lleva lo que la persona escribió: por eso el aviso de no poner datos reales.
// La recepción contesta cada mensaje con un acuse (el resultado real) y el teléfono lo espera antes de darlo por hecho.
// Si ntfy no responde, la demo sigue funcionando en el mismo dispositivo.

import { aplicarMensaje, acuseDe } from '../nucleo/mensajes-relevo.mjs';

export const AVISO_RELEVO = 'Modo demostración entre dispositivos: los datos pasan por un servidor público de pruebas (ntfy.sh). No escribas datos reales.';

const BASE = 'https://ntfy.sh/';
export const temaDe = (sala) => `atk-reservas-${sala}`;

export async function publicar(sala, mensaje, { tiempoMax = 8000 } = {}) {
  if (!/^[a-z0-9]{10}$/.test(sala || '')) return { ok: false, error: 'sin sala' };
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), tiempoMax);
  try {
    const r = await fetch(BASE + temaDe(sala), { method: 'POST', body: JSON.stringify(mensaje), signal: ctrl.signal });
    if (!r.ok) return { ok: false, error: `ntfy respondió ${r.status}` };
    // ntfy devuelve el mensaje publicado con su id: sirve para escuchar solo lo que llegue después.
    const publicado = await r.json().catch(() => null);
    return { ok: true, idRelevo: publicado && /^[A-Za-z0-9]{6,20}$/.test(publicado.id || '') ? publicado.id : null };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'ntfy no respondió a tiempo' : 'sin conexión con ntfy' };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Escucha el tema. Al conectar pide lo guardado (ntfy lo cachea 12 h): por defecto, todo lo de las últimas 12 h,
 * así una respuesta que llegó con la pestaña cerrada también se aplica (las repetidas se descartan por id en el
 * núcleo); con `desde` (id de un mensaje de ntfy), solo lo posterior.
 * @param alMensaje (mensaje, idNtfy) => void
 * @param alEstado ('conectando'|'conectado'|'sin-conexion') => void
 */
export function escuchar(sala, alMensaje, alEstado = () => {}, { desde = null } = {}) {
  if (typeof EventSource === 'undefined' || !/^[a-z0-9]{10}$/.test(sala || '')) {
    alEstado('sin-conexion');
    return () => {};
  }
  alEstado('conectando');
  let es;
  try {
    es = new EventSource(`${BASE}${temaDe(sala)}/sse?since=${desde && /^[A-Za-z0-9]{6,20}$/.test(desde) ? desde : '12h'}`);
  } catch {
    alEstado('sin-conexion');
    return () => {};
  }
  es.addEventListener('open', () => alEstado('conectado'));
  es.onopen = () => alEstado('conectado');
  es.onerror = () => alEstado(es.readyState === EventSource.CLOSED ? 'sin-conexion' : 'conectando');
  es.onmessage = (ev) => {
    let datos;
    try { datos = JSON.parse(ev.data); } catch { return; }
    if (datos.event !== 'message' || typeof datos.message !== 'string') return;
    let mensaje;
    try { mensaje = JSON.parse(datos.message); } catch { return; }
    if (!mensaje || mensaje.v !== 1 || typeof mensaje.tipo !== 'string') return;
    alMensaje(mensaje, datos.id);
  };
  return () => es.close();
}

/**
 * La pantalla de recepción: aplica lo que llega desde otro teléfono, lo anuncia y le contesta al teléfono con el
 * resultado real (acuse). `transaccion` es la del almacén; `anunciar`, la región viva; `alEstado`, el pie.
 */
export function escucharEnRecepcion(sala, { transaccion, anunciar, alEstado }) {
  return escuchar(sala, (mensaje) => {
    if (mensaje.tipo === 'acuse') return;
    let r;
    transaccion((e) => { r = aplicarMensaje(e, mensaje); return r.resultado === 'repetida' || r.resultado === 'forma' ? { ok: false } : { ok: true }; }, 'relevo');
    if (!r || r.resultado === 'repetida' || r.resultado === 'forma') return;
    if (r.aviso) anunciar(r.aviso);
    const acuse = acuseDe(mensaje, r);
    if (acuse) publicar(sala, acuse);
  }, alEstado);
}

const ESTADOS_RELEVO = {
  conectando: 'conectando con ntfy.sh…',
  conectado: 'conectado: las respuestas desde otro teléfono llegan aquí',
  'sin-conexion': 'sin conexión con ntfy.sh: la demo sigue funcionando en este dispositivo',
};

/** Pie con el aviso obligatorio del relevo y su estado. */
export function pintarPieRelevo(pie, estado) {
  if (!pie) return;
  pie.innerHTML = `<div class="pie__dentro">
    <p><span class="relevo-estado" data-estado="${estado}">Entre dispositivos: ${ESTADOS_RELEVO[estado] || estado}</span></p>
    <p>${AVISO_RELEVO}</p>
    <p>alphateklab hace páginas web, apps, software a medida y automatizaciones, y además instala en tu local cámaras, sensores y pantallas. Los negocios de esta demo son de ejemplo.</p>
  </div>`;
}
