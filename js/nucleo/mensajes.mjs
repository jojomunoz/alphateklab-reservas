// Plantillas de mensaje y costo de los envíos.
// Los mensajes no llevan datos clínicos: la vista previa de WhatsApp se ve con el teléfono bloqueado. Por eso no
// existe una variable {servicio}.

export const VARIABLES = ['nombre', 'fecha', 'hora', 'profesional', 'negocio', 'enlace'];

export const PLANTILLAS_POR_DEFECTO = Object.freeze({
  recordatorio: 'Hola, {nombre}. Te recordamos tu cita en {negocio} el {fecha} a las {hora} con {profesional}. Confirma, cámbiala o avísanos si no podrás ir: {enlace}',
  reintento: 'Hola, {nombre}. Seguimos sin saber si vendrás a tu cita del {fecha} a las {hora} en {negocio}. Respóndenos con un toque: {enlace}',
  // Para la cita que ya está confirmada (la persona la pidió y se confirmó sola, la tomó de la lista de espera o la cambió).
  aviso: 'Hola, {nombre}. Te esperamos en {negocio} el {fecha} a las {hora} con {profesional}. Si necesitas cambiarla o no podrás ir, avísanos aquí: {enlace}',
  oferta: 'Hola, {nombre}. Se liberó un espacio en {negocio} el {fecha} a las {hora} con {profesional}. Si lo quieres, tómalo aquí; es del primero que lo acepte: {enlace}',
});

/** Variables usadas en una plantilla. */
export function variablesDe(texto) {
  return [...String(texto).matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]);
}

/** Errores de una plantilla: variables que no existen y el enlace, que no puede faltar. */
export function revisarPlantilla(texto, tipo = 'recordatorio') {
  const errores = [];
  const t = String(texto || '').trim();
  if (!t) return ['El mensaje está vacío.'];
  const desconocidas = [...new Set(variablesDe(t).filter((v) => !VARIABLES.includes(v)))];
  if (desconocidas.length) {
    errores.push(`No existe ${desconocidas.map((v) => `{${v}}`).join(', ')}. Usa ${VARIABLES.map((v) => `{${v}}`).join(', ')}.`);
  }
  if (!variablesDe(t).includes('enlace')) {
    errores.push(tipo === 'oferta'
      ? 'Falta {enlace}: sin él no hay cómo aceptar el espacio.'
      : tipo === 'aviso' ? 'Falta {enlace}: sin él no hay cómo avisar un cambio con un toque.'
        : 'Falta {enlace}: sin él no hay cómo confirmar con un toque.');
  }
  if (t.length > 700) errores.push(`El mensaje tiene ${t.length} caracteres; déjalo en 700 o menos.`);
  return errores;
}

export function rellenar(texto, valores) {
  return String(texto).replace(/\{([^{}\s]+)\}/g, (todo, v) => (v in valores ? String(valores[v]) : todo));
}

// ── SMS: segmentos ─────────────────────────────────────────────────────────
// GSM 03.38: si todos los caracteres están en el alfabeto básico, un SMS lleva 160 (153 por parte si se divide).
// Si hay uno fuera (á, í, ó, ú, comillas tipográficas…), el mensaje va en UCS-2: 70 (67 por parte).
const GSM_BASICO = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€\f';

export function segmentosSMS(texto) {
  const chars = [...String(texto)];
  const esGsm = chars.every((c) => GSM_BASICO.includes(c) || GSM_EXT.includes(c));
  if (esGsm) {
    const largo = chars.reduce((s, c) => s + (GSM_EXT.includes(c) ? 2 : 1), 0);
    return { codificacion: 'GSM-7', largo, segmentos: largo <= 160 ? 1 : Math.ceil(largo / 153) };
  }
  const largo = chars.length;
  return { codificacion: 'UCS-2', largo, segmentos: largo <= 70 ? 1 : Math.ceil(largo / 67) };
}

// ── Costo ─────────────────────────────────────────────────────────────────
// Rangos de la investigación del 3-oct-2026 (tablas de terceros; la oficial de Meta está en su CSV):
//   WhatsApp, plantilla de utilidad, mercado «Rest of Latin America» (Panamá): US$0.011–0.013 por mensaje entregado.
//   SMS a Panamá por Twilio: US$0.10–0.18 por segmento.
//   Correo: prácticamente 0.
export const TARIFAS = Object.freeze({
  whatsapp: { min: 0.011, max: 0.013, unidad: 'mensaje' },
  sms: { min: 0.10, max: 0.18, unidad: 'segmento' },
  correo: { min: 0, max: 0, unidad: 'mensaje' },
});

/**
 * Costo estimado de los mensajes enviados en un mes. Solo cuentan los que salieron (no los cancelados).
 * @param envios lista de la bandeja (con texto y canal)
 * @param mes 'AAAA-MM'
 * @param mesDe función ms → 'AAAA-MM' (hora de Panamá)
 */
export function costoDelMes(envios, mes, mesDe) {
  const por = { whatsapp: { mensajes: 0, unidades: 0 }, sms: { mensajes: 0, unidades: 0 }, correo: { mensajes: 0, unidades: 0 } };
  for (const e of envios) {
    if (e.tipo !== 'mensaje' || e.estado !== 'enviado' || mesDe(e.salioEn ?? e.momento) !== mes) continue;
    const fila = por[e.canal];
    if (!fila) continue;
    fila.mensajes++;
    fila.unidades += e.canal === 'sms' ? segmentosSMS(e.texto || '').segmentos : 1;
  }
  let min = 0, max = 0;
  for (const [canal, fila] of Object.entries(por)) {
    fila.min = fila.unidades * TARIFAS[canal].min;
    fila.max = fila.unidades * TARIFAS[canal].max;
    min += fila.min; max += fila.max;
  }
  return { por, min, max };
}

// En Panamá se escribe como en Estados Unidos: punto decimal y coma de miles (B/.1,234.50).

/** «US$0.42» */
export function dolares(n, decimales = 2) {
  return 'US$' + n.toFixed(decimales);
}

/** «B/.1,234.50» desde centavos. */
export function balboas(centavos) {
  const negativo = centavos < 0;
  const v = Math.abs(Math.round(centavos));
  const entero = Math.floor(v / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = String(v % 100).padStart(2, '0');
  return `${negativo ? '−' : ''}B/.${entero}.${dec}`;
}
