// Teléfono, cédula y correo de Panamá.
// Celular: +507 y 8 dígitos que empiezan por 6 (los fijos tienen 7 y no reciben WhatsApp).
// En wa.me el número va sin «+», sin espacios y sin guion: https://wa.me/50760000123

export function normalizarTelefono(texto) {
  const crudo = String(texto || '').trim();
  if (!crudo) return { ok: false, error: 'Escribe el número de celular.' };
  if (/[^\d\s+()\-.]/.test(crudo)) return { ok: false, error: 'El número solo lleva dígitos (puede llevar +507, espacios o guion).' };
  let d = crudo.replace(/\D/g, '');
  if (d.startsWith('00507')) d = d.slice(5);
  else if (d.startsWith('507') && d.length === 11) d = d.slice(3);
  if (d.length === 7) return { ok: false, error: 'Ese número tiene 7 dígitos, como un fijo. Para WhatsApp hace falta el celular: 8 dígitos que empiezan por 6.' };
  if (d.length !== 8) return { ok: false, error: `El celular en Panamá tiene 8 dígitos; este tiene ${d.length}.` };
  if (d[0] !== '6') return { ok: false, error: 'Los celulares en Panamá empiezan por 6.' };
  return { ok: true, e164: `+507${d}`, mostrar: `+507 ${d.slice(0, 4)}-${d.slice(4)}`, wa: `507${d}` };
}

export function enlaceWhatsApp(e164, texto) {
  const numero = String(e164).replace(/\D/g, '');
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

export function mostrarTelefono(e164) {
  const r = normalizarTelefono(e164);
  return r.ok ? r.mostrar : e164;
}

/**
 * Cédula panameña: provincia (1-13) o letra (E, N, PE), con AV o PI opcional, tomo y asiento.
 * 8-123-4567 · PE-12-345 · E-8-12345 · 4PI-12-345 · 8AV-12-345
 */
export function validarCedula(texto) {
  const c = String(texto || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!c) return { ok: false, error: 'Escribe la cédula.' };
  if (!/^(?:[1-9]|1[0-3]|E|N|PE)(?:AV|PI)?-\d{1,4}-\d{1,6}$/.test(c)) {
    return { ok: false, error: 'La cédula va con guiones, por ejemplo 8-123-4567 o PE-12-345.' };
  }
  return { ok: true, valor: c };
}

export function validarCorreo(texto) {
  const c = String(texto || '').trim();
  if (!c) return { ok: true, valor: '' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) return { ok: false, error: 'Ese correo no parece completo: revisa la @ y el dominio.' };
  return { ok: true, valor: c.toLowerCase() };
}

/** Quita acentos y pasa a minúsculas, para buscar «batista» y encontrar «Batista». */
export function plano(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Busca personas por nombre, teléfono o cédula. */
export function buscarPersonas(personas, consulta) {
  const q = plano(consulta).trim();
  if (!q) return [];
  const digitos = q.replace(/\D/g, '');
  return personas.filter((p) => {
    if (plano(p.nombre).includes(q)) return true;
    if (p.cedula && plano(p.cedula).includes(q)) return true;
    if (digitos.length >= 3 && String(p.telefono || '').replace(/\D/g, '').includes(digitos)) return true;
    return false;
  });
}

export function primerNombre(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0] || '';
}
