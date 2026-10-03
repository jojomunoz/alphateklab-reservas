// Mensajes que viajan entre dispositivos (por ntfy) o entre pestañas, y cómo se aplican al estado.
// Lo que llega de fuera no es de fiar: se valida la forma antes de tocar nada, y todo es idempotente por id.
//
// Ida y vuelta: el teléfono publica su respuesta (o su solicitud) y la pantalla de recepción, al aplicarla, publica
// un «acuse» con el resultado real (confirmada, el horario ya no estaba libre, la solicitud no se pudo agendar…).
// El teléfono no da nada por hecho hasta que le llega ese acuse: valida contra su propia copia de la demo, que puede
// tener otro reloj y otras citas.

import { negocioCitas } from './negocios.mjs';
import { responder, aceptarOferta, solicitarCita, pacienteDe } from './operaciones.mjs';

const ID = /^[a-z0-9_]{3,40}$/i;
const TIPOS_RESPUESTA = new Set(['confirmo', 'cancelo', 'cambio', 'llamenme']);

export function mensajeRespuesta({ id, pl, citaId, respuesta, hueco = null }) {
  return { v: 1, tipo: 'respuesta', id, pl, citaId, respuesta, ...(hueco ? { hueco } : {}) };
}

export function mensajeOferta({ id, pl, ofertaId, esperaId, acepta }) {
  return { v: 1, tipo: 'oferta', id, pl, ofertaId, esperaId, acepta: !!acepta };
}

export function mensajeSolicitud({ id, pl, cita, paciente }) {
  return { v: 1, tipo: 'solicitud', id, pl, cita, paciente };
}

/** Respuesta de la recepción a un mensaje del teléfono: `de` es el id del mensaje original. */
export function mensajeAcuse({ de, pl, resultado, inicio = null, estado = null, motivo = null }) {
  return {
    v: 1, tipo: 'acuse', id: `k_${de}`.slice(0, 40), de, pl, resultado,
    ...(Number.isInteger(inicio) ? { inicio } : {}), ...(estado ? { estado } : {}), ...(motivo ? { motivo: String(motivo).slice(0, 200) } : {}),
  };
}

/** ¿Es el acuse de mi mensaje `id`, con forma válida? */
export function esAcuseDe(m, id) {
  return !!m && m.v === 1 && m.tipo === 'acuse' && m.de === id && typeof m.resultado === 'string' && /^[a-z_]{2,30}$/.test(m.resultado) &&
    (m.inicio === undefined || Number.isInteger(m.inicio)) && (m.motivo === undefined || typeof m.motivo === 'string');
}

/**
 * Aplica un mensaje al estado completo de la demo. Devuelve { ok, resultado, aviso } con un texto para recepción.
 */
export function aplicarMensaje(estado, m) {
  const negocio = m ? negocioCitas(m.pl) : null;
  if (!m || m.v !== 1 || !ID.test(m.id || '') || !negocio) return { ok: false, resultado: 'forma' };
  const st = estado.negocios[m.pl];
  const ahora = estado.reloj.ahora;
  const alguien = `Un ${negocio.vocab.persona}`;

  if (m.tipo === 'respuesta') {
    if (!ID.test(m.citaId || '') || !TIPOS_RESPUESTA.has(m.respuesta)) return { ok: false, resultado: 'forma' };
    const hueco = Number.isInteger(m.hueco) ? m.hueco * 60000 : null;
    const r = responder(st, negocio, { id: m.id, citaId: m.citaId, tipo: m.respuesta, hueco, via: 'relevo' }, ahora);
    const p = r.cita ? pacienteDe(st, r.cita.pacienteId) : null;
    const quien = p ? p.nombre : alguien;
    const avisos = {
      confirmada: `${quien} confirmó su cita desde otro dispositivo.`,
      cancelada: `${quien} avisó desde otro dispositivo que no podrá ir.`,
      reprogramada: `${quien} cambió su cita desde otro dispositivo.`,
      llamar: `${quien} pidió que lo llamen.`,
      hueco_ocupado: `${quien} eligió un horario que ya no estaba libre: queda para llamar.`,
      hueco_pasado: `${quien} eligió un horario que ya había pasado: queda para llamar.`,
    };
    return { ...r, aviso: avisos[r.resultado] || null };
  }

  if (m.tipo === 'oferta') {
    if (!ID.test(m.ofertaId || '') || !ID.test(m.esperaId || '')) return { ok: false, resultado: 'forma' };
    if (!m.acepta) return { ok: true, resultado: 'rechazada', aviso: null };
    const r = aceptarOferta(st, negocio, { id: m.id, ofertaId: m.ofertaId, esperaId: m.esperaId }, ahora);
    return { ...r, aviso: r.ok && r.resultado === 'tomada' ? 'Alguien de la lista de espera tomó el espacio liberado.' : null };
  }

  if (m.tipo === 'solicitud') {
    const c = m.cita || {}, p = m.paciente || {};
    if (!Number.isInteger(c.inicio) || typeof c.servicioId !== 'string' || typeof p.nombre !== 'string') return { ok: false, resultado: 'forma' };
    if (st.procesados.includes(m.id)) return { ok: true, resultado: 'repetida' };
    st.procesados.push(m.id);
    const r = solicitarCita(st, negocio, {
      persona: { nombre: p.nombre, cedula: p.cedula, telefono: p.telefono, correo: p.correo, consentimiento: p.consentimiento === true },
      servicioId: c.servicioId, profesionalId: c.profesionalId || null, inicio: c.inicio * 60000,
    }, ahora);
    if (!r.ok) {
      const codigos = r.errores.map((e) => e.codigo || '');
      const razon = codigos.includes('pasado') ? 'para un horario que ya pasó'
        : codigos.some((x) => x.startsWith('solape')) ? 'para un horario que ya no está libre' : 'que no se pudo agendar';
      st.bitacora.unshift({ t: ahora, texto: `Llegó una solicitud de cita desde otro teléfono ${razon}: no se guardó nada.`, tipo: 'respuesta' });
      return { ok: true, resultado: 'rechazada', motivo: r.errores.map((e) => e.mensaje).join(' '), aviso: `Llegó una solicitud desde otro teléfono ${razon}.` };
    }
    return { ok: true, resultado: 'creada', cita: r.cita, aviso: `${r.paciente.nombre} pidió una cita desde la página.` };
  }
  return { ok: false, resultado: 'forma' };
}

/** El acuse que la recepción le devuelve al teléfono, o null si no hay nada que contestar (repetido o mal formado). */
export function acuseDe(m, r) {
  if (!m || !r || ['repetida', 'forma'].includes(r.resultado)) return null;
  const inicio = r.cita ? Math.round(r.cita.inicio / 60000) : null;
  if (m.tipo === 'respuesta') return mensajeAcuse({ de: m.id, pl: m.pl, resultado: r.resultado, inicio, estado: r.cita?.estado });
  if (m.tipo === 'oferta') {
    if (!m.acepta) return null;
    const resultado = r.ok || r.resultado === 'ya_es_tuya' ? 'tuya' : r.resultado === 'tomada' ? 'tomada' : 'vencida';
    return mensajeAcuse({ de: m.id, pl: m.pl, resultado, inicio });
  }
  if (m.tipo === 'solicitud') return mensajeAcuse({ de: m.id, pl: m.pl, resultado: r.resultado, inicio, estado: r.cita?.estado, motivo: r.motivo });
  return null;
}
