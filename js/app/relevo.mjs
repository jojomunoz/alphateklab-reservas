// Relevo entre dispositivos por https://ntfy.sh (servidor público de pruebas, CORS abierto).
// Publicar = POST al tema; escuchar = EventSource sobre /sse. El tema es atk-reservas-<sala>.
// Por aquí solo viajan identificadores y la respuesta («confirmo», «no podré ir»), salvo la solicitud de cita
// hecha desde otro teléfono, que lleva lo que la persona escribió: por eso el aviso de no poner datos reales.
// Si ntfy no responde, la demo sigue funcionando en el mismo dispositivo.

export const AVISO_RELEVO = 'Modo demostración entre dispositivos: los datos pasan por un servidor público de pruebas (ntfy.sh). No escribas datos reales.';

const BASE = 'https://ntfy.sh/';
export const temaDe = (sala) => `atk-reservas-${sala}`;

export async function publicar(sala, mensaje, { tiempoMax = 8000 } = {}) {
  if (!/^[a-z0-9]{10}$/.test(sala || '')) return { ok: false, error: 'sin sala' };
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), tiempoMax);
  try {
    const r = await fetch(BASE + temaDe(sala), { method: 'POST', body: JSON.stringify(mensaje), signal: ctrl.signal });
    return r.ok ? { ok: true } : { ok: false, error: `ntfy respondió ${r.status}` };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'ntfy no respondió a tiempo' : 'sin conexión con ntfy' };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Escucha el tema. Al conectar pide lo guardado de las últimas 12 h (ntfy lo cachea), así una respuesta que llegó
 * con la pestaña cerrada también se aplica; las repetidas se descartan por id en el núcleo.
 * @param alMensaje (mensaje, idNtfy) => void
 * @param alEstado ('conectando'|'conectado'|'sin-conexion') => void
 */
export function escuchar(sala, alMensaje, alEstado = () => {}) {
  if (typeof EventSource === 'undefined' || !/^[a-z0-9]{10}$/.test(sala || '')) {
    alEstado('sin-conexion');
    return () => {};
  }
  alEstado('conectando');
  let es;
  try {
    es = new EventSource(`${BASE}${temaDe(sala)}/sse?since=12h`);
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
    <p>alphateklab hace páginas web, apps, software a medida y automatizaciones, y además lo instala en tu local. Los negocios de esta demo son de ejemplo.</p>
  </div>`;
}
