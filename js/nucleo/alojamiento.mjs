// Alojamiento: estancias por noches [llegada, salida). La noche de salida no cuenta: si alguien sale el día 8,
// otro puede llegar el día 8. Una reserva puede llevar varias cabañas (un grupo); se valida cabaña por cabaña.

import { sumarDias, diferenciaDias, esISO, leerISO, fechaLarga, MESES, HORA } from './tiempo.mjs';

export const DOMINIO_UID = 'reservas.alphateklab';

export const CANALES_ALOJ = {
  directo: { nombre: 'Directo', largo: 'Página propia o teléfono' },
  airbnb: { nombre: 'Airbnb', largo: 'Airbnb' },
  booking: { nombre: 'Booking', largo: 'Booking.com' },
  expedia: { nombre: 'Expedia', largo: 'Expedia' },
  bloqueo: { nombre: 'Bloqueo', largo: 'Bloqueo manual' },
};

/** Canales cuyas reservas sí salen en el .ics que se exporta. Las de otros canales no: sería el «eco». */
export const CANALES_EXPORTABLES = new Set(['directo', 'bloqueo']);

export const activa = (r) => r.estado !== 'cancelada';

/**
 * La cabaña en la que el canal tiene la reserva (la del calendario de donde vino). Si se reubica aquí, el canal no
 * se entera: sigue mandándola en el calendario de esa cabaña, que es contra el que se sincroniza.
 */
export const unidadDeCanal = (r) => r.unidadCanal || r.unidades[0];

export function nochesEntre(llegada, salida) {
  const n = diferenciaDias(llegada, salida);
  return Array.from({ length: Math.max(0, n) }, (_, i) => sumarDias(llegada, i));
}

export function estanciasSolapan(a, b) {
  return a.llegada < b.salida && b.llegada < a.salida;
}

export function cabanaDe(negocio, id) { return negocio.cabanas.find((c) => c.id === id) || null; }

/** «12 al 14 de octubre» o «30 de septiembre al 2 de octubre» (la segunda fecha es la salida). */
export function rangoTexto(llegada, salida) {
  const a = leerISO(llegada), b = leerISO(salida);
  if (a.mes === b.mes && a.anio === b.anio) return `${a.dia} al ${b.dia} de ${MESES[b.mes - 1]}`;
  return `${a.dia} de ${MESES[a.mes - 1]} al ${b.dia} de ${MESES[b.mes - 1]}`;
}

export function temporadaDe(negocio, iso) {
  return negocio.temporadas.alta.meses.includes(leerISO(iso).mes) ? 'alta' : 'baja';
}

/** Mínimo de noches según la temporada de la noche de llegada (la regla que usan Airbnb y Booking). */
export function minimoNoches(negocio, llegada) {
  return negocio.temporadas[temporadaDe(negocio, llegada)].minNoches;
}

/** Reservas activas que ocupan esa cabaña en esas noches. */
export function choquesDeUnidad(reservas, unidadId, llegada, salida, excluirId = null) {
  return reservas.filter((r) => activa(r) && r.id !== excluirId && r.unidades.includes(unidadId) &&
    estanciasSolapan(r, { llegada, salida }));
}

const centavos = (b) => Math.round(b * 100);

/**
 * Precio de una estancia: cada noche con la tarifa de su temporada, más el ITBMS de hospedaje.
 * La DGI fija el 10 % para «servicio de hospedaje o alojamiento en todas las modalidades»
 * (https://dgi.mef.gob.pa/itbms/Generalidades, consultado el 3-oct-2026).
 * Importes en centavos para no arrastrar errores de coma flotante.
 */
export function cotizar(negocio, unidades, llegada, salida) {
  const noches = nochesEntre(llegada, salida);
  const lineas = unidades.map((id) => {
    const cab = cabanaDe(negocio, id);
    const porTemporada = {};
    let subtotal = 0;
    for (const n of noches) {
      const t = temporadaDe(negocio, n);
      const precio = centavos(cab.tarifa[t]);
      porTemporada[t] = porTemporada[t] || { noches: 0, tarifa: precio, subtotal: 0 };
      porTemporada[t].noches++;
      porTemporada[t].subtotal += precio;
      subtotal += precio;
    }
    return { unidadId: id, nombre: cab.nombre, porTemporada, subtotal };
  });
  const subtotal = lineas.reduce((s, l) => s + l.subtotal, 0);
  const impuesto = Math.round(subtotal * negocio.itbms);
  const total = subtotal + impuesto;
  const minimo = noches.length ? minimoNoches(negocio, llegada) : 0;
  return {
    noches: noches.length,
    lineas,
    subtotal,
    impuesto,
    total,
    sena: Math.round(total * negocio.sena),
    minimo,
    cumpleMinimo: noches.length >= minimo,
  };
}

/** Errores de una reserva propuesta, o lista vacía. */
export function validarReserva(negocio, reservas, prop, { excluirId = null, hoy = null, ignorarMinimo = false } = {}) {
  const errores = [];
  if (!esISO(prop.llegada) || !esISO(prop.salida)) {
    return [{ codigo: 'fechas', mensaje: 'Elige la fecha de llegada y la de salida.' }];
  }
  if (prop.salida <= prop.llegada) {
    return [{ codigo: 'fechas', mensaje: 'La salida tiene que ser al menos un día después de la llegada.' }];
  }
  if (hoy && prop.llegada < hoy) errores.push({ codigo: 'pasado', mensaje: 'La llegada no puede ser antes de hoy.' });
  if (!prop.unidades || !prop.unidades.length) {
    errores.push({ codigo: 'unidades', mensaje: 'Elige al menos una cabaña.' });
    return errores;
  }
  const cabs = prop.unidades.map((id) => cabanaDe(negocio, id));
  if (cabs.some((c) => !c)) return [...errores, { codigo: 'unidades', mensaje: 'Una de las cabañas no existe.' }];
  if (prop.personas) {
    const cap = cabs.reduce((s, c) => s + c.capacidad, 0);
    if (prop.personas > cap) {
      errores.push({ codigo: 'capacidad', mensaje: `Son ${prop.personas} personas y ${cabs.length === 1 ? 'la cabaña admite' : 'las cabañas elegidas admiten'} ${cap}. Agrega otra cabaña.` });
    }
  }
  for (const c of cabs) {
    for (const r of choquesDeUnidad(reservas, c.id, prop.llegada, prop.salida, excluirId)) {
      const desde = r.llegada > prop.llegada ? r.llegada : prop.llegada;
      const hasta = r.salida < prop.salida ? r.salida : prop.salida;
      errores.push({
        codigo: 'choque', unidadId: c.id, reservaId: r.id,
        mensaje: `${c.nombre} ya está ocupada las noches del ${rangoTexto(desde, hasta)} (${CANALES_ALOJ[r.canal].nombre}).`,
      });
    }
  }
  if (!ignorarMinimo && prop.canal !== 'bloqueo') {
    const n = diferenciaDias(prop.llegada, prop.salida), min = minimoNoches(negocio, prop.llegada);
    if (n < min) {
      errores.push({ codigo: 'minimo', mensaje: `En temporada ${temporadaDe(negocio, prop.llegada)} el mínimo es de ${min} noches desde la llegada; elegiste ${n}.` });
    }
  }
  return errores;
}

/**
 * Pares de reservas activas que se pisan en la misma cabaña.
 * @returns {Array<{unidadId, a, b, desde, hasta, noches, canalesDistintos}>} a es la que entró primero.
 */
export function detectarChoques(reservas) {
  const salida = [];
  const act = reservas.filter(activa);
  for (let i = 0; i < act.length; i++) {
    for (let j = i + 1; j < act.length; j++) {
      const x = act[i], y = act[j];
      if (!estanciasSolapan(x, y)) continue;
      for (const u of x.unidades) {
        if (!y.unidades.includes(u)) continue;
        const [a, b] = (x.creada || 0) <= (y.creada || 0) ? [x, y] : [y, x];
        const desde = a.llegada > b.llegada ? a.llegada : b.llegada;
        const hasta = a.salida < b.salida ? a.salida : b.salida;
        salida.push({ unidadId: u, a, b, desde, hasta, noches: diferenciaDias(desde, hasta), canalesDistintos: a.canal !== b.canal });
      }
    }
  }
  return salida.sort((p, q) => (p.desde < q.desde ? -1 : p.desde > q.desde ? 1 : 0));
}

/**
 * Cabañas libres para TODA la estancia de una reserva, de igual o mayor capacidad que la que ocupa.
 * Primero las que no están en riesgo (en cierre preventivo o conectadas a un canal que no sincroniza: allá podrían
 * venderlas otra vez), y dentro de cada grupo de menor a mayor capacidad (la más justa primero). Cada una lleva
 * `riesgo`. Vacía = «sin cabaña libre: contactar al huésped».
 */
export function proponerReubicacion(negocio, reservas, reserva, unidadId, { riesgo = new Set() } = {}) {
  const origen = cabanaDe(negocio, unidadId);
  return negocio.cabanas
    .filter((c) => c.id !== unidadId && !reserva.unidades.includes(c.id) && c.capacidad >= origen.capacidad)
    .filter((c) => choquesDeUnidad(reservas, c.id, reserva.llegada, reserva.salida, reserva.id).length === 0)
    .map((c) => ({ ...c, riesgo: riesgo.has(c.id) }))
    .sort((a, b) => a.riesgo - b.riesgo || a.capacidad - b.capacidad || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Cambia una cabaña de una reserva por otra. Devuelve la lista nueva. */
export function moverUnidad(reservas, reservaId, deUnidad, aUnidad) {
  return reservas.map((r) => (r.id !== reservaId ? r : {
    ...r,
    unidades: r.unidades.map((u) => (u === deUnidad ? aUnidad : u)),
    movida: [...(r.movida || []), { de: deUnidad, a: aUnidad }],
  }));
}

// ── Vigilante de sincronización ─────────────────────────────────────────────

export const MAX_HORAS_POR_DEFECTO = 6; // el doble del intervalo de Airbnb (~3 h)

/**
 * Estado de cada canal: horas sin sincronizar, si pasó del máximo permitido y cómo está:
 * 'vencido' (pasó del máximo: alerta roja), 'retrasado' (ya debía haber releído y no lo hizo, aunque siga dentro del
 * máximo) o 'al_dia'. Subir el máximo apaga la alerta, pero no hace que el canal esté al día.
 */
export function vigilar(canales, ahora) {
  return canales.map((c) => {
    const max = c.maxHoras || MAX_HORAS_POR_DEFECTO;
    const horas = (ahora - c.ultimaSync) / HORA;
    const vencido = horas > max;
    const estado = vencido ? 'vencido' : horas >= (c.intervaloHoras || 2) ? 'retrasado' : 'al_dia';
    return { canalId: c.id, nombre: c.nombre, horas, max, vencido, estado, unidades: Object.keys(c.urls || {}) };
  });
}

/** ¿El canal sincronizó después de que se cerró la venta por él? (Es lo único que permite decir «ya sincroniza».) */
export function sincronizoDespuesDe(canal, cierre) {
  return !!canal && !!cierre && canal.ultimaSync > cierre.desde;
}

/** Cabañas en riesgo de venderse dos veces: en cierre preventivo o conectadas a un canal que no está al día. */
export function unidadesEnRiesgo(aloj, ahora) {
  const riesgo = new Set(cierreVigente(aloj).unidades);
  for (const v of vigilar(aloj.canales || [], ahora)) if (v.estado !== 'al_dia') for (const u of v.unidades) riesgo.add(u);
  return riesgo;
}

/**
 * Simula el paso del tiempo para los canales que funcionan: su «última sincronización correcta» avanza de
 * intervalo en intervalo. Un canal caído no avanza (es lo que pasó el 25-sep: nadie se enteró).
 */
export function actualizarSincronizaciones(canales, ahora) {
  return canales.map((c) => {
    if (c.caido) return c;
    const paso = (c.intervaloHoras || 2) * HORA;
    if (ahora - c.ultimaSync < paso) return c;
    const saltos = Math.floor((ahora - c.ultimaSync) / paso);
    return { ...c, ultimaSync: c.ultimaSync + saltos * paso };
  });
}

/** Cabañas que se pueden vender en la página directa para esas fechas, y por qué no las demás. */
export function disponiblesParaVenta(negocio, reservas, cierre, llegada, salida) {
  const cerradas = new Set(cierre && cierre.activo ? cierre.unidades : []);
  const disponibles = [], ocupadas = [], enCierre = [];
  for (const c of negocio.cabanas) {
    if (cerradas.has(c.id)) { enCierre.push(c); continue; }
    if (choquesDeUnidad(reservas, c.id, llegada, salida).length) ocupadas.push(c);
    else disponibles.push(c);
  }
  return { disponibles, ocupadas, enCierre };
}

// ── iCal por cabaña ────────────────────────────────────────────────────────

/**
 * Eventos del .ics de una cabaña, sin datos del huésped: las reservas directas, los bloqueos manuales y las de otro
 * canal que se reubicaron AQUÍ (el canal las tiene en otra cabaña; esta queda ocupada y los demás tienen que saberlo).
 * Nunca la reserva que un canal mandó en el calendario de esta misma cabaña: sería el «eco».
 */
export function eventosParaExportar(reservas, unidadId) {
  return reservas
    .filter((r) => activa(r) && r.unidades.includes(unidadId) && (CANALES_EXPORTABLES.has(r.canal) || unidadDeCanal(r) !== unidadId))
    .sort((a, b) => (a.llegada < b.llegada ? -1 : 1))
    .map((r) => ({
      uid: `${r.id}-${unidadId}@${DOMINIO_UID}`,
      inicio: r.llegada,
      fin: r.salida,
      resumen: r.canal === 'bloqueo' ? 'No disponible' : 'Reservado',
    }));
}

/**
 * Aplica lo importado del iCal de un canal para una cabaña: agrega lo nuevo, actualiza lo que cambió de fechas y
 * quita lo que ya no viene (se canceló en el canal). Ignora los eventos que salieron de aquí (eco).
 */
export function sincronizarCanal(reservas, canalId, unidadId, eventos, ahora, nuevoId) {
  const propias = eventos.filter((e) => e.uid.endsWith('@' + DOMINIO_UID));
  const ajenas = eventos.filter((e) => !e.uid.endsWith('@' + DOMINIO_UID));
  // Las de este canal que vinieron del calendario de esta cabaña (aunque aquí se hayan reubicado en otra).
  const deEsteCalendario = (r) => r.canal === canalId && r.uidExterno && unidadDeCanal(r) === unidadId;
  const existentes = reservas.filter(deEsteCalendario);
  const porUid = new Map(existentes.map((r) => [r.uidExterno, r]));
  const vistos = new Set();
  const nuevas = [], cambiadas = [];
  let lista = reservas.map((r) => {
    if (!deEsteCalendario(r)) return r;
    const e = ajenas.find((x) => x.uid === r.uidExterno);
    if (!e) return r;
    vistos.add(e.uid);
    if (e.inicio !== r.llegada || e.fin !== r.salida) {
      const n = { ...r, llegada: e.inicio, salida: e.fin, estado: 'confirmada' };
      cambiadas.push(n);
      return n;
    }
    return r.estado === 'cancelada' ? { ...r, estado: 'confirmada' } : r;
  });
  for (const e of ajenas) {
    if (vistos.has(e.uid) || porUid.has(e.uid)) continue;
    const r = { id: nuevoId(), canal: canalId, unidades: [unidadId], unidadCanal: unidadId, llegada: e.inicio, salida: e.fin, estado: 'confirmada', huesped: null, uidExterno: e.uid, resumen: e.resumen, creada: ahora };
    nuevas.push(r);
    lista.push(r);
  }
  const quitadas = [];
  lista = lista.map((r) => {
    if (deEsteCalendario(r) && activa(r) && !ajenas.some((e) => e.uid === r.uidExterno)) {
      const q = { ...r, estado: 'cancelada', canceladaEn: ahora, motivo: 'ya no viene en el calendario del canal' };
      quitadas.push(q);
      return q;
    }
    return r;
  });
  return { reservas: lista, nuevas, cambiadas, quitadas, ecos: propias.length };
}

/**
 * Lo que haría aplicar un .ics leído, sin aplicarlo: nuevas, cambiadas y QUITADAS (lo que el canal ya no manda se
 * cancela aquí), y si el archivo parece el calendario que exporta este mismo sistema (todo eco o nuestro PRODID):
 * subir por error el propio en lugar del del canal quitaría todas sus reservas.
 */
export function previsualizarImportacion(reservas, canalId, unidadId, leido) {
  const r = sincronizarCanal(reservas, canalId, unidadId, leido.eventos, 0, () => 'vista-previa');
  const propio = /alphateklab/i.test(leido.prodid || '');
  return { ...r, soloEcos: leido.eventos.length > 0 && r.ecos === leido.eventos.length, propio };
}

export { fechaLarga };

// ── Operaciones sobre el estado del alojamiento ────────────────────────────
// aloj = { reservas, canales, cierres: [{ canalId, unidades, desde }], bitacora }

export const nuevoIdReserva = () => `r_${Math.random().toString(36).slice(2, 10)}`;

function anotarAloj(aloj, t, texto) {
  aloj.bitacora = aloj.bitacora || [];
  aloj.bitacora.unshift({ t, texto });
  if (aloj.bitacora.length > 100) aloj.bitacora.length = 100;
}

/** Cierre preventivo vigente como unión de todos los cierres por canal. */
export function cierreVigente(aloj) {
  const cierres = aloj.cierres || [];
  return { activo: cierres.length > 0, unidades: [...new Set(cierres.flatMap((c) => c.unidades))], cierres };
}

/**
 * Crea una reserva (directa o bloqueo) validando contra lo último guardado.
 * datos = { canal: 'directo'|'bloqueo', unidades, llegada, salida, personas, huesped, sena, nota, ignorarMinimo, respetarCierre }
 */
export function crearReserva(aloj, negocio, datos, ahora, hoy) {
  const errores = validarReserva(negocio, aloj.reservas, datos, { hoy, ignorarMinimo: datos.ignorarMinimo || datos.canal === 'bloqueo' });
  if (datos.respetarCierre) {
    const cerradas = datos.unidades.filter((u) => cierreVigente(aloj).unidades.includes(u));
    if (cerradas.length) errores.push({ codigo: 'cierre', mensaje: `${cerradas.map((u) => cabanaDe(negocio, u).nombre).join(', ')} no se puede reservar en línea en este momento. Escríbenos por WhatsApp.` });
  }
  if (datos.canal === 'directo') {
    if (!datos.huesped || String(datos.huesped.nombre || '').trim().length < 3) errores.push({ campo: 'nombre', mensaje: 'Escribe el nombre de quien reserva.' });
    if (datos.huesped && !datos.huesped.consentimiento) errores.push({ campo: 'consentimiento', mensaje: 'Falta el consentimiento para guardar los datos (Ley 81 de 2019).' });
  }
  if (errores.length) return { ok: false, errores };
  const cot = cotizar(negocio, datos.unidades, datos.llegada, datos.salida);
  const r = {
    id: nuevoIdReserva(), canal: datos.canal, unidades: [...datos.unidades], llegada: datos.llegada, salida: datos.salida,
    estado: 'confirmada', creada: ahora, nota: datos.nota || '',
    huesped: datos.canal === 'directo' ? { nombre: datos.huesped.nombre.trim(), telefono: datos.huesped.telefono || '', correo: datos.huesped.correo || '', personas: datos.personas || null, consentimiento: { fecha: ahora, canal: datos.huesped.canalConsentimiento || 'en la página' } } : null,
    sena: datos.canal === 'directo' ? { estado: datos.sena?.estado || 'por_verificar', metodo: datos.sena?.metodo || 'Yappy', monto: cot.sena } : null,
    total: datos.canal === 'directo' ? cot.total : null,
    origen: datos.origen || 'recepcion',
  };
  aloj.reservas.push(r);
  anotarAloj(aloj, ahora, datos.canal === 'bloqueo'
    ? `Bloqueo manual: ${r.unidades.map((u) => cabanaDe(negocio, u).nombre).join(', ')}, ${rangoTexto(r.llegada, r.salida)}.`
    : `Reserva directa de ${r.huesped.nombre}: ${r.unidades.map((u) => cabanaDe(negocio, u).nombre).join(', ')}, ${rangoTexto(r.llegada, r.salida)}.`);
  return { ok: true, reserva: r, cotizacion: cot };
}

export function cancelarReserva(aloj, reservaId, ahora) {
  const r = aloj.reservas.find((x) => x.id === reservaId);
  if (!r) return { ok: false, errores: [{ mensaje: 'Esa reserva ya no existe.' }] };
  if (!CANALES_EXPORTABLES.has(r.canal)) return { ok: false, errores: [{ mensaje: `Esta reserva viene de ${CANALES_ALOJ[r.canal].largo}: se cancela allá y aquí desaparece en la próxima sincronización.` }] };
  r.estado = 'cancelada';
  r.canceladaEn = ahora;
  anotarAloj(aloj, ahora, `Se canceló ${r.canal === 'bloqueo' ? 'un bloqueo' : `la reserva de ${r.huesped?.nombre || 'un huésped'}`} (${rangoTexto(r.llegada, r.salida)}).`);
  return { ok: true, reserva: r };
}

export function verificarSena(aloj, reservaId, ahora) {
  const r = aloj.reservas.find((x) => x.id === reservaId);
  if (!r || !r.sena) return { ok: false, errores: [{ mensaje: 'Esa reserva no tiene seña.' }] };
  r.sena.estado = 'verificada';
  r.sena.verificadaEn = ahora;
  anotarAloj(aloj, ahora, `Seña verificada: ${r.huesped?.nombre || 'reserva'}.`);
  return { ok: true };
}

export function moverReserva(aloj, negocio, reservaId, deUnidad, aUnidad, ahora) {
  const r = aloj.reservas.find((x) => x.id === reservaId);
  if (!r) return { ok: false, errores: [{ mensaje: 'Esa reserva ya no existe.' }] };
  const libres = proponerReubicacion(negocio, aloj.reservas, r, deUnidad).map((c) => c.id);
  if (!libres.includes(aUnidad)) return { ok: false, errores: [{ mensaje: `${cabanaDe(negocio, aUnidad).nombre} ya no está libre esas noches o es más chica.` }] };
  aloj.reservas = moverUnidad(aloj.reservas, reservaId, deUnidad, aUnidad);
  anotarAloj(aloj, ahora, `Reubicada de ${cabanaDe(negocio, deUnidad).nombre} a ${cabanaDe(negocio, aUnidad).nombre} (${rangoTexto(r.llegada, r.salida)}).`);
  return { ok: true };
}

// ── Simulador de la demo ───────────────────────────────────────────────

/** El canal deja de sincronizar: su última sincronización correcta queda `horas` atrás y ya no avanza. */
export function simularCaida(aloj, canalId, ahora, horas = 9) {
  const c = aloj.canales.find((x) => x.id === canalId);
  if (!c) return { ok: false };
  c.caido = true;
  c.ultimaSync = Math.min(c.ultimaSync, ahora - horas * HORA);
  anotarAloj(aloj, ahora, `${c.nombre} dejó de sincronizar (simulado).`);
  return { ok: true, canal: c };
}

export function restablecerCanal(aloj, canalId, ahora) {
  const c = aloj.canales.find((x) => x.id === canalId);
  if (!c) return { ok: false };
  c.caido = false;
  c.ultimaSync = ahora;
  anotarAloj(aloj, ahora, `${c.nombre} volvió a sincronizar.`);
  return { ok: true, canal: c };
}

/**
 * La reserva directa que un canal caído «vendería otra vez»: la primera futura de una sola cabaña conectada a ese
 * canal; si no hay, la primera futura de cualquier canal en esas cabañas.
 */
export function elegirObjetivoChoque(aloj, canalId, hoy) {
  const canal = aloj.canales.find((c) => c.id === canalId);
  const conectadas = Object.keys(canal?.urls || {});
  const futuras = aloj.reservas
    .filter((r) => activa(r) && r.llegada >= hoy && r.canal !== canalId && r.unidades.some((u) => conectadas.includes(u)))
    .sort((a, b) => (a.llegada < b.llegada ? -1 : a.llegada > b.llegada ? 1 : 0));
  return futuras.find((r) => r.canal === 'directo' && r.unidades.length === 1) || futuras.find((r) => r.canal === 'directo') || futuras[0] || null;
}

/** Entra una reserva por el canal (que no sabía de la otra): se crea encima y queda el choque. */
export function simularReservaOta(aloj, canalId, ahora, hoy) {
  const objetivo = elegirObjetivoChoque(aloj, canalId, hoy);
  if (!objetivo) return { ok: false, errores: [{ mensaje: 'No hay reservas futuras en las cabañas de ese canal para chocar.' }] };
  const canal = aloj.canales.find((c) => c.id === canalId);
  const unidad = objetivo.unidades.find((u) => Object.keys(canal.urls).includes(u));
  const r = {
    id: nuevoIdReserva(), canal: canalId, unidades: [unidad], unidadCanal: unidad, llegada: objetivo.llegada, salida: objetivo.salida, estado: 'confirmada',
    huesped: null, uidExterno: `${Math.random().toString(16).slice(2, 12)}${Math.random().toString(16).slice(2, 12)}@${canalId}.com`,
    resumen: canalId === 'booking' ? 'CLOSED - Not available' : 'Reserved', creada: ahora, simulada: true,
  };
  aloj.reservas.push(r);
  anotarAloj(aloj, ahora, `Entró una reserva por ${canal.nombre} para ${rangoTexto(r.llegada, r.salida)} en una cabaña que ya estaba vendida (simulado).`);
  return { ok: true, reserva: r, objetivo };
}

export function activarCierre(aloj, canalId, ahora) {
  const c = aloj.canales.find((x) => x.id === canalId);
  if (!c) return { ok: false };
  aloj.cierres = (aloj.cierres || []).filter((x) => x.canalId !== canalId);
  aloj.cierres.push({ canalId, unidades: Object.keys(c.urls || {}), desde: ahora });
  anotarAloj(aloj, ahora, `Cierre preventivo por ${c.nombre}: la página directa deja de vender ${Object.keys(c.urls || {}).length} cabañas.`);
  return { ok: true };
}

export function reabrirVenta(aloj, canalId, ahora) {
  aloj.cierres = (aloj.cierres || []).filter((x) => x.canalId !== canalId);
  anotarAloj(aloj, ahora, 'Se reabrió la venta directa.');
  return { ok: true };
}

/** Aplica un .ics importado para un canal y una cabaña, y lo cuenta como sincronización correcta. */
export function aplicarImportacion(aloj, canalId, unidadId, eventos, ahora) {
  const r = sincronizarCanal(aloj.reservas, canalId, unidadId, eventos, ahora, nuevoIdReserva);
  aloj.reservas = r.reservas;
  const c = aloj.canales.find((x) => x.id === canalId);
  if (c) c.ultimaSync = ahora;
  anotarAloj(aloj, ahora, `Importado el calendario de ${c ? c.nombre : canalId}: ${r.nuevas.length} nuevas, ${r.cambiadas.length} cambiadas, ${r.quitadas.length} quitadas${r.ecos ? `, ${r.ecos} propias ignoradas (eco)` : ''}.`);
  return { ok: true, ...r };
}
