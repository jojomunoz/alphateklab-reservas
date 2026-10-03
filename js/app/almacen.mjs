// Datos de la demo en localStorage, con versión de esquema. Toda lectura y escritura va en try/catch: si el
// navegador bloquea el almacenamiento (ventana privada estricta, datos de sitio bloqueados), la demo sigue en memoria
// y lo dice. Las pestañas del mismo navegador se avisan con BroadcastChannel (y el evento «storage» de respaldo).

import { crearEstadoInicial, esEstadoValido, adelantar } from '../nucleo/demo.mjs';

const CLAVE = 'atk-reservas';
const CLAVE_RESPUESTAS = 'atk-reservas-respuestas';
let memoria = null;
let almacenamientoOk = true;

export function urlConfirmar() {
  return new URL('confirmar.html', location.href).href;
}

export function opcionesEnlace(estado) {
  return { urlBase: urlConfirmar(), sala: estado.sala };
}

export function hayAlmacenamiento() { return almacenamientoOk; }

function leerCrudo() {
  try {
    const t = localStorage.getItem(CLAVE);
    almacenamientoOk = true;
    return t ? JSON.parse(t) : null;
  } catch {
    almacenamientoOk = false;
    return null;
  }
}

/** Estado guardado si existe y es de esta versión; si no, null (sin crear nada). */
export function leer() {
  const e = leerCrudo();
  if (esEstadoValido(e)) return e;
  return esEstadoValido(memoria) ? memoria : null;
}

function escribir(estado) {
  memoria = estado;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
    almacenamientoOk = true;
    return true;
  } catch {
    almacenamientoOk = false;
    return false;
  }
}

/** Estado actual; si no hay (o es de otra versión), crea los datos de ejemplo. */
export function cargar() {
  const e = leer();
  if (e) return e;
  const nuevo = crearEstadoInicial(Date.now(), { urlBase: urlConfirmar() });
  escribir(nuevo);
  return nuevo;
}

let canal = null;
try { canal = new BroadcastChannel('atk-reservas'); } catch { canal = null; }
const oyentes = new Set();

function avisar(motivo) {
  try { canal && canal.postMessage({ motivo, t: Date.now() }); } catch { /* sin canal: queda el evento storage */ }
}

/**
 * Lee el estado MÁS RECIENTE (otra pestaña pudo escribir), aplica `fn`, y guarda si fn no devuelve { ok:false }.
 * Así la validación de solapes se hace contra lo último guardado, justo antes de escribir.
 */
export function transaccion(fn, motivo = 'cambio') {
  const estado = cargar();
  const r = fn(estado);
  if (!r || r.ok !== false) {
    escribir(estado);
    avisar(motivo);
    for (const o of oyentes) o(estado, { local: true, motivo });
  }
  return r;
}

export function restablecer(plantilla) {
  const anterior = leer();
  const nuevo = crearEstadoInicial(Date.now(), { urlBase: urlConfirmar(), plantilla: plantilla || anterior?.plantilla || 'consultorio' });
  escribir(nuevo);
  avisar('restablecer');
  for (const o of oyentes) o(nuevo, { local: true, motivo: 'restablecer' });
  return nuevo;
}

/** Avísame cuando otra pestaña (o esta) cambie los datos. */
export function alCambiar(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function desdeFuera(motivo) {
  const e = leer();
  if (!e) return;
  memoria = e;
  for (const o of oyentes) o(e, { local: false, motivo });
}
if (canal) canal.onmessage = (ev) => desdeFuera(ev.data?.motivo || 'otra pestaña');
addEventListener('storage', (ev) => { if (ev.key === CLAVE) desdeFuera('otra pestaña'); });

export function adelantarReloj(hasta) {
  let salieron = null;
  transaccion((estado) => { salieron = adelantar(estado, hasta, opcionesEnlace(estado)); }, 'reloj');
  return salieron;
}

// ── Respuestas guardadas en el teléfono del paciente (para «ya respondiste») ──

export function respuestasGuardadas() {
  try { return JSON.parse(localStorage.getItem(CLAVE_RESPUESTAS) || '{}'); } catch { return {}; }
}

export function guardarRespuesta(clave, datos) {
  try {
    const r = respuestasGuardadas();
    r[clave] = datos;
    localStorage.setItem(CLAVE_RESPUESTAS, JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

// ── Preferencias de quien mira (no son datos de la demo) ──

export function preferencia(clave, valor) {
  const k = `atk-reservas-pref-${clave}`;
  try {
    if (valor === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, valor);
  } catch { /* sin almacenamiento: la preferencia dura lo que la página */ }
  return valor;
}
