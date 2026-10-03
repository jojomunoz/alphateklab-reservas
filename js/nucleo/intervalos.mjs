// Intervalos semiabiertos [inicio, fin): el fin no cuenta. Una cita de 9:00 a 9:30 y otra de 9:30 a 10:00 no se
// pisan; una estancia que sale el día 8 y otra que llega el día 8 tampoco.

/** ¿Se pisan [a.inicio, a.fin) y [b.inicio, b.fin)? */
export function solapan(a, b) {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** ¿Se pisan si a cada lado se exige un margen de `margen` unidades? */
export function solapanConMargen(a, b, margen = 0) {
  return a.inicio < b.fin + margen && b.inicio < a.fin + margen;
}

/** ¿b cabe entero dentro de a? */
export function contiene(a, b) {
  return a.inicio <= b.inicio && b.fin <= a.fin;
}

/** Une intervalos que se tocan o se pisan. Devuelve una lista ordenada. */
export function unir(lista) {
  const orden = [...lista].filter((x) => x.fin > x.inicio).sort((x, y) => x.inicio - y.inicio);
  const salida = [];
  for (const x of orden) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && x.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, x.fin);
    else salida.push({ inicio: x.inicio, fin: x.fin });
  }
  return salida;
}

/** Lo que queda de `base` tras quitarle los intervalos `ocupados`. */
export function restar(base, ocupados) {
  let libres = [{ inicio: base.inicio, fin: base.fin }];
  for (const o of unir(ocupados)) {
    const siguiente = [];
    for (const l of libres) {
      if (!solapan(l, o)) { siguiente.push(l); continue; }
      if (o.inicio > l.inicio) siguiente.push({ inicio: l.inicio, fin: o.inicio });
      if (o.fin < l.fin) siguiente.push({ inicio: o.fin, fin: l.fin });
    }
    libres = siguiente;
  }
  return libres;
}
