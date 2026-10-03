// Mensajes que viajan entre dispositivos (por ntfy) o entre pestañas, y cómo se aplican al estado.
// Lo que llega de fuera no es de fiar: se valida la forma antes de tocar nada, y todo es idempotente por id.

import { NEGOCIOS_CITAS } from './negocios.mjs';
import { responder, aceptarOferta, registrarPaciente, crearCita, pacienteDe } from './operaciones.mjs';
import { validarCedula, normalizarTelefono } from './contacto.mjs';

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

/**
 * Aplica un mensaje al estado completo de la demo. Devuelve { ok, resultado, aviso } con un texto para recepción.
 */
export function aplicarMensaje(estado, m) {
  if (!m || m.v !== 1 || !ID.test(m.id || '') || !NEGOCIOS_CITAS[m.pl]) return { ok: false, resultado: 'forma' };
  const negocio = NEGOCIOS_CITAS[m.pl];
  const st = estado.negocios[m.pl];
  const ahora = estado.reloj.ahora;

  if (m.tipo === 'respuesta') {
    if (!ID.test(m.citaId || '') || !TIPOS_RESPUESTA.has(m.respuesta)) return { ok: false, resultado: 'forma' };
    const hueco = Number.isInteger(m.hueco) ? m.hueco * 60000 : null;
    const r = responder(st, negocio, { id: m.id, citaId: m.citaId, tipo: m.respuesta, hueco, via: 'relevo' }, ahora);
    const p = r.cita ? pacienteDe(st, r.cita.pacienteId) : null;
    const quien = p ? p.nombre : 'Un paciente';
    const avisos = {
      confirmada: `${quien} confirmó su cita desde otro dispositivo.`,
      cancelada: `${quien} avisó desde otro dispositivo que no podrá ir.`,
      reprogramada: `${quien} cambió su cita desde otro dispositivo.`,
      llamar: `${quien} pidió que lo llamen.`,
      hueco_ocupado: `${quien} eligió un horario que ya no estaba libre: queda para llamar.`,
    };
    return { ...r, aviso: avisos[r.resultado] || null };
  }

  if (m.tipo === 'oferta') {
    if (!ID.test(m.ofertaId || '') || !ID.test(m.esperaId || '')) return { ok: false, resultado: 'forma' };
    if (!m.acepta) return { ok: true, resultado: 'rechazada', aviso: null };
    const r = aceptarOferta(st, negocio, { id: m.id, ofertaId: m.ofertaId, esperaId: m.esperaId }, ahora);
    return { ...r, aviso: r.resultado === 'tomada' ? 'Alguien de la lista de espera tomó el espacio liberado.' : null };
  }

  if (m.tipo === 'solicitud') {
    const c = m.cita || {}, p = m.paciente || {};
    if (!Number.isInteger(c.inicio) || typeof c.servicioId !== 'string' || typeof p.nombre !== 'string') return { ok: false, resultado: 'forma' };
    if (st.procesados.includes(m.id)) return { ok: true, resultado: 'repetida' };
    st.procesados.push(m.id);
    const ced = validarCedula(p.cedula), tel = normalizarTelefono(p.telefono);
    let paciente = ced.ok && tel.ok ? st.pacientes.find((x) => x.cedula === ced.valor && x.telefono === tel.e164) : null;
    if (!paciente) {
      const rp = registrarPaciente(st, negocio, { ...p, consentimiento: p.consentimiento === true, canalConsentimiento: 'en la página de citas' }, ahora);
      if (!rp.ok) return { ok: false, resultado: 'datos', errores: rp.errores };
      paciente = rp.paciente;
    }
    const estadoInicial = st.ajustes.autoConfirmar ? 'confirmada' : 'pendiente';
    const r = crearCita(st, negocio, {
      pacienteId: paciente.id, servicioId: c.servicioId, profesionalId: c.profesionalId || null, salaId: null,
      inicio: c.inicio * 60000, estado: estadoInicial,
    }, ahora, { origen: 'autoagenda' });
    return { ...r, resultado: r.ok ? 'creada' : 'choque', aviso: r.ok ? `${paciente.nombre} pidió una cita desde la página.` : `Llegó una solicitud de ${paciente.nombre} para un horario que ya no está libre.` };
  }
  return { ok: false, resultado: 'forma' };
}
