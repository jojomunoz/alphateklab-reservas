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
 * Ordenadas de menor a mayor capacidad (la más justa primero). Vacía = «sin cabaña libre: contactar al huésped».
 */
export function proponerReubicacion(negocio, reservas, reserva, unidadId) {
  const origen = cabanaDe(negocio, unidadId);
  return negocio.cabanas
    .filter((c) => c.id !== unidadId && !reserva.unidades.includes(c.id) && c.capacidad >= origen.capacidad)
    .filter((c) => choquesDeUnidad(reservas, c.id, reserva.llegada, reserva.salida, reserva.id).length === 0)
    .sort((a, b) => a.capacidad - b.capacidad || a.nombre.localeCompare(b.nombre, 'es'));
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

/** Estado de cada canal: horas sin sincronizar y si pasó del máximo permitido. */
export function vigilar(canales, ahora) {
  return canales.map((c) => {
    const max = c.maxHoras || MAX_HORAS_POR_DEFECTO;
    const horas = (ahora - c.ultimaSync) / HORA;
    return { canalId: c.id, nombre: c.nombre, horas, max, vencido: horas > max, unidades: Object.keys(c.urls || {}) };
  });
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

/** Eventos del .ics de una cabaña: SOLO reservas directas y bloqueos manuales, sin datos del huésped. */
export function eventosParaExportar(reservas, unidadId) {
  return reservas
    .filter((r) => activa(r) && CANALES_EXPORTABLES.has(r.canal) && r.unidades.includes(unidadId))
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
  const existentes = reservas.filter((r) => r.canal === canalId && r.unidades.includes(unidadId) && r.uidExterno);
  const porUid = new Map(existentes.map((r) => [r.uidExterno, r]));
  const vistos = new Set();
  const nuevas = [], cambiadas = [];
  let lista = reservas.map((r) => {
    if (r.canal !== canalId || !r.unidades.includes(unidadId) || !r.uidExterno) return r;
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
    const r = { id: nuevoId(), canal: canalId, unidades: [unidadId], llegada: e.inicio, salida: e.fin, estado: 'confirmada', huesped: null, uidExterno: e.uid, resumen: e.resumen, creada: ahora };
    nuevas.push(r);
    lista.push(r);
  }
  const quitadas = [];
  lista = lista.map((r) => {
    if (r.canal === canalId && r.unidades.includes(unidadId) && r.uidExterno && activa(r) && !ajenas.some((e) => e.uid === r.uidExterno)) {
      const q = { ...r, estado: 'cancelada', canceladaEn: ahora, motivo: 'ya no viene en el calendario del canal' };
      quitadas.push(q);
      return q;
    }
    return r;
  });
  return { reservas: lista, nuevas, cambiadas, quitadas, ecos: propias.length };
}

export { fechaLarga };
