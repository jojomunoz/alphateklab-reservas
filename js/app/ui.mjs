// Utilidades de interfaz compartidas: escapar texto, íconos, diálogos, avisos para lectores de pantalla.

/** Escapa texto para insertarlo en HTML. TODO lo que viene de datos (nombres, notas, mensajes) pasa por aquí. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// Íconos dibujados a mano para este proyecto (trazo 1.6, 16×16). Siempre acompañan a un texto.
const TRAZOS = {
  pendiente: '<circle cx="8" cy="8" r="5.6"/>',
  confirmada: '<circle cx="8" cy="8" r="6.2" class="relleno"/><path d="M5.2 8.2l1.9 1.9 3.8-4" class="sobre"/>',
  reprogramada: '<path d="M12.6 6.4A4.9 4.9 0 1 0 12.8 9.6"/><path d="M13 3.6v3h-3"/>',
  cancelada: '<circle cx="8" cy="8" r="5.6"/><path d="M4.2 11.8l7.6-7.6"/>',
  atendida: '<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1" class="relleno"/><path d="M5.2 8.2l1.9 1.9 3.8-4" class="sobre"/>',
  no_asistio: '<path d="M8 2.2l6.2 11.2H1.8z" class="relleno"/><path d="M8 6.4v3.2M8 11.4v.1" class="sobre"/>',
  whatsapp: '<path d="M3.2 13l.8-2.6A5.6 5.6 0 1 1 6 12.4z"/>',
  sms: '<rect x="2.2" y="3" width="11.6" height="8.4" rx="1.2"/><path d="M5 13.4l1.6-2"/>',
  correo: '<rect x="2" y="3.6" width="12" height="8.8" rx="1"/><path d="M2.4 4.4L8 8.6l5.6-4.2"/>',
  llamar: '<path d="M4.6 2.4l2 3-1.3 1.4a8 8 0 0 0 3.9 3.9l1.4-1.3 3 2-1 2a2 2 0 0 1-2 .9A11 11 0 0 1 1.7 5.4a2 2 0 0 1 .9-2z"/>',
  reloj: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.6V8l2.4 1.6"/>',
  sala: '<path d="M2.5 13.5V6.2L8 2.5l5.5 3.7v7.3"/><path d="M6.4 13.5V9.4h3.2v4.1"/>',
  aviso: '<path d="M8 2.2l6.2 11.2H1.8z"/><path d="M8 6.4v3.2M8 11.4v.1"/>',
  cerrar: '<path d="M4 4l8 8M12 4l-8 8"/>',
  mas: '<path d="M8 3v10M3 8h10"/>',
  izq: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  der: '<path d="M6 3.5L10.5 8 6 12.5"/>',
  enlace: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7"/>',
  descargar: '<path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 13.5h10"/>',
  candado: '<rect x="3.2" y="7" width="9.6" height="6.6" rx="1"/><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7"/>',
};

export function icono(nombre, clase = '') {
  const t = TRAZOS[nombre];
  if (!t) return '';
  return `<svg class="ico ico-${nombre} ${clase}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${t}</svg>`;
}

/**
 * Región viva para anunciar cambios («Salieron 3 mensajes») a lectores de pantalla y mostrarlos un momento.
 * Un aviso nuevo reemplaza al anterior: apilados tapaban la pantalla del teléfono.
 */
export function anunciar(texto, { tipo = 'info', duracion = 5000 } = {}) {
  let zona = document.getElementById('avisos');
  if (!zona) {
    zona = document.createElement('div');
    zona.id = 'avisos';
    zona.className = 'avisos';
    zona.setAttribute('role', 'status');
    zona.setAttribute('aria-live', 'polite');
    document.body.append(zona);
  }
  const el = document.createElement('p');
  el.className = `aviso-flotante aviso-${tipo}`;
  el.textContent = texto;
  zona.replaceChildren(el);
  setTimeout(() => {
    el.classList.add('saliendo');
    setTimeout(() => el.remove(), 260);
  }, duracion);
}

/**
 * Cómo volver a encontrar un elemento si la vista se vuelve a pintar (el botón original deja de existir):
 * por su id o por su primer atributo data-*.
 */
export function claveDeFoco(el) {
  if (!el || el === document.body || !el.tagName) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  for (const a of el.attributes) {
    if (a.name.startsWith('data-')) return `${el.tagName.toLowerCase()}[${a.name}="${CSS.escape(a.value)}"]`;
  }
  return null;
}

/** Devuelve el foco a `previo` o, si ya no existe, a su equivalente en la vista nueva; si no hay, al contenido. */
export function devolverFoco(previo, clave) {
  if (previo && previo.isConnected && !previo.disabled) { previo.focus(); return; }
  const otro = clave ? document.querySelector(clave) : null;
  if (otro && !otro.disabled) { otro.focus(); return; }
  document.getElementById('principal')?.focus({ preventScroll: true });
}

/** Abre un <dialog> modal con el HTML dado. Devuelve el elemento; se elimina al cerrarse. */
export function abrirDialogo({ titulo, cuerpo, clase = '', alAbrir, alCerrar, etiquetaCerrar = 'Cerrar' }) {
  const d = document.createElement('dialog');
  d.className = `dialogo ${clase}`;
  const idTitulo = `t-${Math.random().toString(36).slice(2, 8)}`;
  d.setAttribute('aria-labelledby', idTitulo);
  d.innerHTML = `
    <div class="dialogo__cabeza">
      <h2 id="${idTitulo}" class="dialogo__titulo">${titulo}</h2>
      <button type="button" class="boton-icono" data-cerrar aria-label="${esc(etiquetaCerrar)}">${icono('cerrar')}</button>
    </div>
    <div class="dialogo__cuerpo">${cuerpo}</div>`;
  document.body.append(d);
  const previo = document.activeElement;
  const clavePrevio = claveDeFoco(previo);
  d.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-cerrar]')) d.close();
    else if (ev.target === d) d.close(); // clic en el fondo
  });
  d.addEventListener('close', () => {
    alCerrar && alCerrar(d);
    d.remove();
    // Si al guardar se volvió a pintar la vista, el botón de origen ya no existe: se busca su equivalente.
    devolverFoco(previo, clavePrevio);
  });
  d.showModal();
  alAbrir && alAbrir(d);
  return d;
}

/** Pide confirmación con dos botones que dicen qué pasa. Devuelve una promesa con true/false. */
export function confirmar({ titulo, texto, si, no = 'Volver', peligro = false }) {
  return new Promise((ok) => {
    let resultado = false;
    abrirDialogo({
      titulo: esc(titulo),
      clase: 'dialogo--chico',
      cuerpo: `<p>${texto}</p><div class="acciones"><button type="button" class="boton ${peligro ? 'boton--peligro' : 'boton--primario'}" data-si>${esc(si)}</button><button type="button" class="boton" data-cerrar>${esc(no)}</button></div>`,
      alAbrir: (d) => {
        d.querySelector('[data-si]').addEventListener('click', () => { resultado = true; d.close(); });
        d.querySelector('[data-si]').focus();
      },
      alCerrar: () => ok(resultado),
    });
  });
}

/** Descarga un texto como archivo. */
export function descargar(nombre, contenido, tipo = 'text/calendar;charset=utf-8') {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/**
 * Muestra errores de un formulario junto a cada campo (aria-describedby) y un resumen arriba con TODOS los errores,
 * cada uno enlazado a su campo (el foco va al resumen: quien usa lector de pantalla oye la lista completa).
 * `titulo` cambia el encabezado del resumen cuando no se está guardando nada («Revisa las fechas:»).
 */
export function mostrarErrores(form, errores, { titulo = null } = {}) {
  for (const el of form.querySelectorAll('.campo__error')) el.remove();
  for (const el of form.querySelectorAll('[aria-invalid]')) {
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
  }
  const resumen = form.querySelector('[data-errores]');
  if (resumen) {
    resumen.innerHTML = '';
    resumen.hidden = !errores.length;
  }
  if (!errores.length) return;
  const items = [];
  for (const e of errores) {
    const campo = e.campo && form.querySelector(`[name="${CSS.escape(e.campo)}"]`);
    if (campo) {
      if (!campo.id) campo.id = `campo-${e.campo}-${Math.random().toString(36).slice(2, 6)}`;
      const id = `err-${e.campo}-${Math.random().toString(36).slice(2, 6)}`;
      const p = document.createElement('p');
      p.className = 'campo__error';
      p.id = id;
      p.textContent = e.mensaje;
      const contenedor = campo.closest('.campo') || campo.parentElement;
      contenedor.append(p);
      campo.setAttribute('aria-invalid', 'true');
      campo.setAttribute('aria-describedby', [campo.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
      items.push({ mensaje: e.mensaje, campoId: campo.id });
    } else items.push({ mensaje: e.mensaje });
  }
  if (resumen) {
    const t = titulo || (items.length === 1 ? 'No se pudo guardar:' : 'No se pudo guardar, por esto:');
    resumen.innerHTML = `<p class="resumen-errores__titulo">${esc(t)}</p><ul>${items.map((i) => `<li>${i.campoId ? `<a href="#${esc(i.campoId)}" data-ir-campo="${esc(i.campoId)}">${esc(i.mensaje)}</a>` : esc(i.mensaje)}</li>`).join('')}</ul>`;
    // Los enlaces llevan al campo sin tocar la dirección (en reservar.html el # guarda la sala del relevo).
    resumen.onclick = (ev) => {
      const a = ev.target.closest('[data-ir-campo]');
      if (!a) return;
      ev.preventDefault();
      document.getElementById(a.dataset.irCampo)?.focus();
    };
    resumen.hidden = false;
    resumen.focus();
  } else {
    const primero = form.querySelector('[aria-invalid]');
    primero && primero.focus();
  }
}

export function reduceMovimiento() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
