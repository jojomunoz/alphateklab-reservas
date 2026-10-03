// Estado completo de la demo y el reloj simulado. Sin DOM.
//
// estado = {
//   version, creado, plantilla, sala,
//   reloj: { ahora },                 hora de la demo (ms UTC)
//   negocios: { consultorio, barberia, taller },   estado de cada negocio de citas
//   alojamiento,                      reservas, canales, cierre preventivo
// }

import { NEGOCIOS_CITAS, NEGOCIO_ALOJAMIENTO } from './negocios.mjs';
import { semillaCitas, semillaAlojamiento, horaInicialDemo } from './semilla.mjs';
import { avanzarReloj } from './operaciones.mjs';
import { actualizarSincronizaciones } from './alojamiento.mjs';
import { proximoEnvio } from './recordatorios.mjs';

export const VERSION_ESQUEMA = 3;

export function nuevaSala(rand = Math.random) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 10 }, () => abc[Math.floor(rand() * abc.length)]).join('');
}

export function crearEstadoInicial(real, { urlBase = 'confirmar.html', plantilla = 'consultorio', sala = nuevaSala() } = {}) {
  const ahora = horaInicialDemo(real);
  const negocios = {};
  let base = 101;
  for (const [id, neg] of Object.entries(NEGOCIOS_CITAS)) {
    negocios[id] = semillaCitas(neg, ahora, { urlBase, sala, baseTelefono: base });
    base += 100;
  }
  return {
    version: VERSION_ESQUEMA,
    creado: real,
    plantilla,
    sala,
    reloj: { ahora, inicial: ahora },
    negocios,
    alojamiento: semillaAlojamiento(ahora, NEGOCIO_ALOJAMIENTO),
  };
}

/** ¿El estado guardado tiene la forma que espera esta versión? */
export function esEstadoValido(e) {
  return !!e && e.version === VERSION_ESQUEMA && e.reloj && Number.isFinite(e.reloj.ahora) &&
    e.negocios && Object.keys(NEGOCIOS_CITAS).every((k) => e.negocios[k] && Array.isArray(e.negocios[k].citas)) &&
    e.alojamiento && Array.isArray(e.alojamiento.reservas) && /^[a-z0-9]{10}$/.test(e.sala || '');
}

/**
 * Adelanta el reloj de la demo hasta `hasta`: en cada negocio sale lo que vencía, y los canales del alojamiento que
 * funcionan avanzan su última sincronización. Devuelve lo que salió por negocio.
 */
export function adelantar(estado, hasta, opciones) {
  if (hasta < estado.reloj.ahora) hasta = estado.reloj.ahora;
  const salieron = {};
  for (const [id, neg] of Object.entries(NEGOCIOS_CITAS)) {
    salieron[id] = avanzarReloj(estado.negocios[id], neg, hasta, opciones);
  }
  estado.alojamiento.canales = actualizarSincronizaciones(estado.alojamiento.canales, hasta);
  estado.reloj.ahora = hasta;
  return salieron;
}

/** Próximo momento con algo programado en un negocio, o null. */
export function proximoDelNegocio(estado, negocioId) {
  return proximoEnvio(estado.negocios[negocioId].envios, estado.reloj.ahora);
}
