// Enlace de confirmación: los datos de la cita van en el fragmento (#), que el navegador no manda a ningún servidor
// ni queda en los registros. JSON corto → UTF-8 → base64url. En producción iría un identificador aleatorio de un
// solo uso que resuelve el servidor; aquí no hay servidor.

export const VERSION_ENLACE = 1;

export function aBase64url(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deBase64url(cadena) {
  if (!/^[A-Za-z0-9_-]*$/.test(cadena)) throw new Error('caracteres no válidos');
  const b64 = cadena.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((cadena.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const esTexto = (x, max = 80) => typeof x === 'string' && x.length > 0 && x.length <= max;
const esMinuto = (x) => Number.isInteger(x) && x > 20000000 && x < 60000000; // minutos desde 1970: entre ~2008 y ~2084

/**
 * Forma de los datos:
 *   cita:   { v, k:'c', pl, c, n, i, pr, sv, sl, hs:[minutos…], s? }
 *   oferta: { v, k:'o', pl, o, e, n, i, pr, sv, sl, s? }   (o = oferta, e = puesto en la lista de espera)
 * i y hs van en minutos desde 1970 (UTC) para que el enlace sea corto. s es la sala del relevo entre dispositivos.
 */
export function codificar(datos) {
  return aBase64url(JSON.stringify({ v: VERSION_ENLACE, ...datos }));
}

/**
 * Textos de error del enlace. Dicen qué hacer: pedir uno nuevo. `alNegocio` es el vocabulario del negocio
 * («al consultorio», «a la barbería»); si no se sabe de qué negocio es el enlace, «a quien te lo mandó».
 */
export const errorEnlace = (alNegocio = 'a quien te lo mandó') => `Este enlace está incompleto o dañado. Pide un enlace nuevo ${alNegocio}.`;
export const ERROR_ENLACE = errorEnlace();

export function decodificar(fragmento, alNegocio = 'a quien te lo mandó') {
  const dañado = { ok: false, error: errorEnlace(alNegocio) };
  const limpio = String(fragmento || '').replace(/^#/, '').trim();
  if (!limpio) return { ok: false, error: `Este enlace no trae los datos de la cita. Ábrelo desde el mensaje que te llegó o pide uno nuevo ${alNegocio}.` };
  let datos;
  try {
    datos = JSON.parse(deBase64url(limpio));
  } catch {
    return dañado;
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return dañado;
  if (datos.v !== VERSION_ENLACE) {
    return { ok: false, error: `Este enlace es de una versión anterior. Pide un enlace nuevo ${alNegocio}.` };
  }
  const comunes = esTexto(datos.pl, 20) && esTexto(datos.n, 60) && esMinuto(datos.i) &&
    esTexto(datos.pr, 20) && esTexto(datos.sv, 20) && esTexto(datos.sl, 20) &&
    (datos.s === undefined || /^[a-z0-9]{10}$/.test(datos.s));
  if (datos.k === 'c') {
    const ok = comunes && esTexto(datos.c, 40) && Array.isArray(datos.hs) && datos.hs.length <= 3 && datos.hs.every(esMinuto);
    return ok ? { ok: true, datos } : dañado;
  }
  if (datos.k === 'o') {
    const ok = comunes && esTexto(datos.o, 40) && esTexto(datos.e, 40);
    return ok ? { ok: true, datos } : dañado;
  }
  return dañado;
}

export const aMinutos = (ms) => Math.round(ms / 60000);
export const deMinutos = (min) => min * 60000;
