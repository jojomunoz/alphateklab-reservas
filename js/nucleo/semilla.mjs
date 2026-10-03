// Datos de ejemplo. Se generan a partir de la hora de la demo para que la agenda se vea viva al abrir: citas pasadas
// (atendidas, alguna que no asistió), las de hoy y las de la semana siguiente (pendientes, confirmadas…).
// Las citas se colocan con el mismo generador de huecos que usa la recepción, así que nunca se pisan, y su
// historial de mensajes sale del mismo planificador de recordatorios.

import { MIN, HORA, DIA, fechaISO, msDeFecha, sumarDias, lunesDe, diaSemana, partes, diferenciaDias } from './tiempo.mjs';
import { feriado } from './feriados.mjs';
import { huecosDelDia, tramosDelDia, siguienteMomentoAbierto } from './agenda.mjs';
import { planificar, VENTANA } from './recordatorios.mjs';
import { textoConsentimiento, NEGOCIO_ALOJAMIENTO } from './negocios.mjs';
import { crearEstadoNegocio, componerEnvio, crearTarea, canalesDe } from './operaciones.mjs';

/** Generador pseudoaleatorio con semilla (mulberry32): los mismos datos cada vez que se restablece el mismo día. */
export function azar(semilla) {
  let a = semilla >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.entero = (min, max) => min + Math.floor(r() * (max - min + 1));
  r.uno = (lista) => lista[Math.floor(r() * lista.length)];
  return r;
}

/**
 * Hora con la que arranca el reloj de la demo: siempre un día de lunes a viernes a las 8:30 (Panamá), hoy si todavía
 * no son las 8:30 y si no el siguiente día hábil. Con la hora real, un sábado por la tarde abría la recepción con el
 * consultorio cerrado y los tres paneles en cero (revisión del 3-oct).
 */
export function horaInicialDemo(real) {
  const habil = (d) => ![0, 6].includes(diaSemana(d)) && !feriado(d);
  const p = partes(real);
  let dia = fechaISO(real);
  if (!habil(dia) || p.hora * 60 + p.minuto >= 8 * 60 + 30) dia = sumarDias(dia, 1);
  while (!habil(dia)) dia = sumarDias(dia, 1);
  return msDeFecha(dia, 8 * 60 + 30);
}

let contador = 0;
const idSemilla = (p) => `${p}_s${(++contador).toString(36)}`;

/** Personas de ejemplo: teléfono +507 6000-0xxx y cédula con tomo 000 (no existe). */
export function personasDeEjemplo(negocio, base, ahora, r) {
  return negocio.nombres.map((nombre, i) => {
    const num = String(base + i).padStart(3, '0');
    const conCorreo = r() < 0.55;
    const usuario = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '.');
    return {
      id: idSemilla('p'),
      nombre,
      cedula: `8-000-${1000 + base + i}`,
      telefono: `+5076000${num.padStart(4, '0')}`,
      correo: conCorreo ? `${usuario}@example.com` : '',
      nacimiento: '',
      notas: '',
      consentimiento: { fecha: ahora - r.entero(20, 400) * DIA, canal: r.uno(['en persona', 'en persona', 'por teléfono', 'por WhatsApp']), texto: textoConsentimiento(negocio), version: 1 },
      revocado: null,
      creado: ahora - r.entero(20, 400) * DIA,
    };
  });
}

/**
 * Estado de ejemplo de un negocio de citas.
 * @param opciones.urlBase  URL de confirmar.html (para el texto de los mensajes ya enviados)
 */
export function semillaCitas(negocio, ahora, { urlBase = 'confirmar.html', sala, baseTelefono = 101 } = {}) {
  const r = azar(0xa1fa + negocio.id.length * 977);
  const st = crearEstadoNegocio(negocio);
  st.pacientes = personasDeEjemplo(negocio, baseTelefono, ahora, r);
  // Tres personas que faltan seguido, para que el panel de riesgo tenga a quién mostrar.
  const faltonas = new Set(st.pacientes.filter((_, i) => i % 9 === 4).map((p) => p.id));

  const hoy = fechaISO(ahora);
  const lunes = lunesDe(hoy);
  let paraSala = null; // la cita de quien estará en la sala de espera
  // solo si el negocio ya está abierto a esa hora (la barbería abre a las 9:00: nadie espera adentro a las 8:30)
  const minAhora = partes(ahora).hora * 60 + partes(ahora).minuto;
  const abiertoAlEmpezar = tramosDelDia(negocio, hoy).some(([a, b]) => minAhora >= a && minAhora < b);
  const desde = sumarDias(lunes, -14), hasta = sumarDias(lunes, 13);
  const n = diferenciaDias(desde, hasta);

  for (let i = 0; i <= n; i++) {
    const fecha = sumarDias(desde, i);
    if (!tramosDelDia(negocio, fecha).length) continue;
    const esActual = fecha >= lunes;
    // Unas cuatro citas por profesional cada día de esta semana y la siguiente (una recepción con trabajo a la vista);
    // menos en las dos anteriores (historial).
    const objetivo = esActual ? 4 : 0.6;
    const usadosHoy = new Set();
    for (const [iProf, prof] of negocio.profesionales.entries()) {
      const porProf = Math.floor(objetivo) + (r() < objetivo % 1 ? 1 : 0);
      for (let k = 0; k < porProf; k++) {
        const servicio = r.uno(negocio.servicios);
        let huecos = huecosDelDia({ negocio, citas: st.citas, fecha, servicioId: servicio.id, profesionalId: prof.id, ahora: 0 });
        // La primera del día de la demo, con el primer profesional, empieza entre 10 y 40 minutos después de abrir la
        // demo: es quien está en la sala de espera (ver más abajo).
        const deSala = fecha === hoy && iProf === 0 && k === 0 && abiertoAlEmpezar;
        if (deSala) huecos = huecos.filter((x) => x.inicio >= ahora + 10 * MIN && x.inicio <= ahora + 40 * MIN);
        if (!huecos.length) continue;
        const h = huecos[r.entero(0, huecos.length - 1)];
        // Nadie tiene dos citas el mismo día (así nunca hay dos citas de la misma persona a la vez).
        const libres = st.pacientes.filter((x) => !usadosHoy.has(x.id));
        if (!libres.length) continue;
        const paciente = r.uno(libres);
        usadosHoy.add(paciente.id);
        const creada = Math.min(h.inicio - r.entero(2, 9) * DIA + 2 * HORA, ahora - HORA);
        if (deSala) paraSala = idSemilla('c');
        st.citas.push({
          id: deSala ? paraSala : idSemilla('c'), pacienteId: paciente.id, servicioId: servicio.id, profesionalId: h.profesionalId, salaId: h.salaId,
          inicio: h.inicio, fin: h.fin, estado: 'pendiente', origen: r() < 0.2 ? 'autoagenda' : 'recepcion',
          regla: { ...st.regla, dias: [...st.regla.dias] }, creada, historial: [{ t: creada, texto: 'Agendada en recepción' }],
          respuesta: null, confirmadaEn: null, enSala: null,
        });
      }
    }
  }

  // Estados y mensajes, según si la cita ya pasó. La tarea de llamar cae con el negocio abierto, como en la recepción.
  const siguienteAbierto = (ms) => siguienteMomentoAbierto(negocio, ms);
  for (const c of st.citas) {
    const pac = st.pacientes.find((p) => p.id === c.pacienteId);
    const plan = planificar({ ...c, estado: 'pendiente' }, c.regla, c.creada, { canales: canalesDe(pac), ventana: VENTANA, siguienteAbierto });
    const mensajes = plan.filter((x) => x.tipo === 'mensaje');
    const llamada = plan.find((x) => x.tipo === 'llamar');
    const pasada = c.fin <= ahora;
    const x = r();
    let destino, respuesta = null;
    if (pasada) {
      const falta = faltonas.has(c.pacienteId) ? x < 0.55 : x < 0.1;
      destino = falta ? 'no_asistio' : x > 0.93 ? 'cancelada' : 'atendida';
      if (destino !== 'no_asistio' && mensajes.length) respuesta = mensajes[0].momento + r.entero(10, 200) * MIN;
    } else if (c.id === paraSala) {
      destino = x < 0.5 ? 'confirmada' : 'pendiente'; // ni cancelada ni movida: es quien llega
    } else {
      const cerca = c.inicio - ahora < 2 * DIA;
      if (x < (cerca ? 0.42 : 0.3)) destino = 'confirmada';
      else if (x < 0.9) destino = 'pendiente';
      else if (x < 0.95) destino = 'cancelada';
      else destino = 'reprogramada';
      if ((destino === 'confirmada' || destino === 'cancelada') && mensajes.length) {
        respuesta = Math.min(mensajes[0].momento + r.entero(10, 200) * MIN, ahora - 5 * MIN);
        if (respuesta < mensajes[0].momento) respuesta = null;
      }
    }
    c.estado = destino;
    if (respuesta) {
      c.respuesta = { t: respuesta, tipo: destino === 'cancelada' ? 'cancelo' : 'confirmo', via: 'enlace' };
      if (destino !== 'cancelada') c.confirmadaEn = respuesta;
      c.historial.push({ t: respuesta, texto: destino === 'cancelada' ? 'Canceló por el enlace' : 'Confirmó por el enlace' });
    } else if (destino === 'confirmada') {
      // Confirmada por teléfono al agendarla: no hace falta recordarle nada.
      c.confirmadaEn = c.creada;
      c.historial.push({ t: c.creada, texto: 'Confirmada al agendar (por teléfono)' });
    } else if (destino === 'atendida') {
      c.confirmadaEn = c.inicio - DIA;
    }
    if (destino === 'reprogramada') c.historial.push({ t: c.creada + HORA, texto: 'Reprogramada en recepción' });
    if (pasada && destino !== 'cancelada') c.historial.push({ t: c.fin, texto: destino === 'atendida' ? 'Atendida' : 'No asistió' });

    // Confirmada por teléfono al agendarla: no se le pidió confirmar; recibe solo el aviso, como cualquier cita que
    // nace confirmada.
    if (destino === 'confirmada' && !respuesta) {
      for (const m of planificar({ ...c, estado: 'confirmada' }, c.regla, c.creada, { canales: canalesDe(pac), ventana: VENTANA })) {
        st.envios.push({
          id: idSemilla('e'), citaId: c.id, pacienteId: c.pacienteId, tipo: 'mensaje', clase: m.motivo, intento: m.intento, de: m.de,
          canal: m.canal, etiqueta: m.etiqueta, atrasado: false, momento: m.momento, creado: c.creada,
          ...(m.momento <= ahora ? { estado: 'enviado', salioEn: m.momento } : { estado: 'programado' }),
        });
      }
      continue;
    }
    const corte = respuesta ?? (destino === 'cancelada' && pasada ? c.inicio - DIA : Infinity);
    let enviados = 0;
    for (const m of mensajes) {
      const e = {
        id: idSemilla('e'), citaId: c.id, pacienteId: c.pacienteId, tipo: 'mensaje', clase: m.motivo, intento: m.intento, de: m.de,
        canal: m.canal, etiqueta: m.etiqueta, atrasado: m.atrasado, momento: m.momento, creado: c.creada, estado: 'programado',
      };
      if (m.momento > corte) {
        const motivo = destino === 'cancelada' ? 'canceló la cita' : respuesta ? 'confirmó' : 'la cita se confirmó en recepción';
        Object.assign(e, { estado: 'cancelado', canceladoEn: corte, motivoCancelacion: motivo });
      }
      else if (m.momento <= ahora) {
        Object.assign(e, { estado: 'enviado', salioEn: m.momento });
        enviados++;
      } else if (!['pendiente', 'reprogramada'].includes(destino)) {
        Object.assign(e, { estado: 'cancelado', canceladoEn: ahora, motivoCancelacion: 'confirmó' });
      }
      st.envios.push(e);
    }
    if (llamada && !respuesta) {
      const e = { id: idSemilla('e'), citaId: c.id, pacienteId: c.pacienteId, tipo: 'llamar', clase: 'llamar', momento: llamada.momento, creado: c.creada, estado: 'programado' };
      if (llamada.momento <= ahora && destino !== 'cancelada') {
        e.estado = 'tarea';
        e.salioEn = llamada.momento;
        const t = crearTarea(st, c, `No respondió a ${enviados} ${enviados === 1 ? 'mensaje' : 'mensajes'}`, llamada.momento);
        if (pasada) t.hecha = { t: c.inicio - HORA, resultado: destino === 'atendida' ? 'confirmo' : 'no_contesto' };
      } else if (!['pendiente', 'reprogramada'].includes(destino)) {
        e.estado = 'cancelado';
        e.canceladoEn = ahora;
        e.motivoCancelacion = 'la cita se confirmó en recepción';
      }
      st.envios.push(e);
    }
    // Quien está ahora mismo en la sala de espera.
    if (destino === 'confirmada' && c.inicio - ahora <= 20 * MIN && c.inicio - ahora >= -10 * MIN) c.enSala = ahora - 6 * MIN;
  }
  // Alguien en la sala de espera al abrir la demo: la primera cita de hoy que empieza en los próximos 40 minutos. Si
  // estaba sin confirmar, confirmó al llegar: sus mensajes pendientes se detienen y su llamada queda hecha.
  const hoyISO = fechaISO(ahora);
  if (!st.citas.some((c) => c.enSala && fechaISO(c.inicio) === hoyISO)) {
    const llega = st.citas
      .filter((c) => fechaISO(c.inicio) === hoyISO && ['confirmada', 'pendiente'].includes(c.estado) && c.inicio >= ahora - 10 * MIN && c.inicio <= ahora + 40 * MIN)
      .sort((a, b) => a.inicio - b.inicio)[0];
    if (llega) {
      const t = ahora - 6 * MIN;
      if (llega.estado === 'pendiente') {
        llega.estado = 'confirmada';
        llega.confirmadaEn = t;
        llega.historial.push({ t, texto: 'Confirmó al llegar, en recepción' });
        for (const e of st.envios) if (e.citaId === llega.id && e.estado === 'programado') Object.assign(e, { estado: 'cancelado', canceladoEn: t, motivoCancelacion: 'la cita se confirmó en recepción' });
        for (const tarea of st.tareas) if (tarea.citaId === llega.id && !tarea.hecha) tarea.hecha = { t, resultado: 'confirmo' };
      }
      llega.enSala = t;
    }
  }
  // Una cita que ya empezó no se confirma por teléfono: sus tareas quedan cerradas (como al adelantar el reloj).
  for (const t of st.tareas) {
    const c = st.citas.find((x) => x.id === t.citaId);
    if (!t.hecha && c && c.inicio <= ahora) t.hecha = { t: c.inicio, resultado: 'vencida' };
  }
  // Textos de lo ya enviado (con enlace), como habrían salido.
  for (const e of st.envios) {
    if (e.estado !== 'enviado') continue;
    const { texto, enlace } = componerEnvio(st, negocio, e, e.momento, { urlBase, sala });
    e.texto = texto;
    e.enlace = enlace;
  }

  // Lista de espera: tres personas sin cita próxima.
  const conCitaFutura = new Set(st.citas.filter((c) => c.inicio > ahora && c.estado !== 'cancelada').map((c) => c.pacienteId));
  const libres = st.pacientes.filter((p) => !conCitaFutura.has(p.id));
  negocio.servicios.slice(0, 3).forEach((s, i) => {
    const p = libres[i];
    if (!p) return;
    st.espera.push({ id: idSemilla('w'), pacienteId: p.id, servicioId: s.id, profesionalId: i === 1 ? negocio.profesionales[0].id : null, nota: i === 0 ? 'Puede cualquier día por la mañana' : '', desde: ahora - r.entero(1, 6) * DIA, estado: 'esperando' });
  });

  st.bitacora = [{ t: ahora, texto: 'Datos de ejemplo cargados. Adelanta el reloj para ver salir los recordatorios.', tipo: 'info' }];
  return st;
}

// ── Alojamiento ───────────────────────────────────────────────────────────

/** Reservas de ejemplo de 4 canales, con un grupo de 3 cabañas en una sola reserva. */
export function semillaAlojamiento(ahora, negocio = NEGOCIO_ALOJAMIENTO) {
  const hoy = fechaISO(ahora);
  const d = (n) => sumarDias(hoy, n);
  let k = 0;
  const id = () => `r_s${(++k).toString(36)}`;
  const uid = (canal) => `${Math.random().toString(16).slice(2, 14)}${Math.random().toString(16).slice(2, 14)}@${canal === 'airbnb' ? 'airbnb.com' : canal === 'booking' ? 'booking.com' : 'expedia.com'}`;
  const directa = (unidades, a, noches, nombre, telefono, personas, sena = 'verificada') => ({
    id: id(), canal: 'directo', unidades, llegada: d(a), salida: d(a + noches), estado: 'confirmada',
    huesped: { nombre, telefono, correo: '', personas }, sena: { estado: sena, metodo: 'Yappy' }, creada: ahora - (5 + Math.abs(a)) * DIA,
  });
  const ota = (canal, unidad, a, noches) => ({
    id: id(), canal, unidades: [unidad], unidadCanal: unidad, llegada: d(a), salida: d(a + noches), estado: 'confirmada', huesped: null,
    uidExterno: uid(canal), resumen: canal === 'booking' ? 'CLOSED - Not available' : canal === 'airbnb' ? 'Reserved' : 'Reservado', creada: ahora - (3 + Math.abs(a) / 2) * DIA,
  });
  const reservas = [
    directa(['corotu'], -2, 3, 'Pareja Valdés (ejemplo)', '+50760000401', 2),
    ota('airbnb', 'corotu', 4, 2),
    ota('booking', 'corotu', 9, 3),
    directa(['nance'], 1, 2, 'Marta Ureña (ejemplo)', '+50760000402', 2, 'por_verificar'),
    ota('booking', 'nance', 6, 2),
    { id: id(), canal: 'bloqueo', unidades: ['nance'], llegada: d(15), salida: d(18), estado: 'confirmada', huesped: null, nota: 'Mantenimiento del techo', creada: ahora - 5 * DIA },
    ota('booking', 'guayacan', 2, 2),
    directa(['guayacan', 'espave', 'cuipo'], 10, 3, 'Grupo Cedeño, cumpleaños (ejemplo)', '+50760000403', 13),
    ota('airbnb', 'guayacan', 16, 4),
    ota('expedia', 'espave', 3, 2),
    directa(['espave'], 18, 2, 'Familia Arosemena (ejemplo)', '+50760000404', 4),
    ota('booking', 'cuipo', -1, 3),
    directa(['cuipo'], 20, 4, 'Familia Him (ejemplo)', '+50760000405', 5),
    ota('expedia', 'caoba', 5, 3),
    directa(['caoba'], 13, 2, 'Rubén y Delia (ejemplo)', '+50760000406', 3),
    ota('airbnb', 'caoba', 20, 3),
  ];
  const canales = [
    { id: 'airbnb', nombre: 'Airbnb', intervaloHoras: 3, ultimaSync: ahora - 75 * MIN, maxHoras: 6, caido: false,
      urls: { corotu: 'https://www.airbnb.com/calendar/ical/00000001.ics?s=ejemplo', nance: 'https://www.airbnb.com/calendar/ical/00000002.ics?s=ejemplo', guayacan: 'https://www.airbnb.com/calendar/ical/00000003.ics?s=ejemplo', caoba: 'https://www.airbnb.com/calendar/ical/00000004.ics?s=ejemplo' } },
    { id: 'booking', nombre: 'Booking.com', intervaloHoras: 2, ultimaSync: ahora - 50 * MIN, maxHoras: 6, caido: false,
      urls: { corotu: 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=ejemplo-1', nance: 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=ejemplo-2', guayacan: 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=ejemplo-3', cuipo: 'https://admin.booking.com/hotel/hoteladmin/ical.html?t=ejemplo-4' } },
    // Para Expedia la investigación no da un intervalo con fuente (trabaja sobre todo con channel managers): la demo
    // simula 2 h y la página lo dice.
    { id: 'expedia', nombre: 'Expedia', intervaloHoras: 2, intervaloConFuente: false, ultimaSync: ahora - 100 * MIN, maxHoras: 6, caido: false,
      urls: { espave: 'https://www.expediapartnercentral.com/ical/ejemplo-1.ics', cuipo: 'https://www.expediapartnercentral.com/ical/ejemplo-2.ics', caoba: 'https://www.expediapartnercentral.com/ical/ejemplo-3.ics' } },
  ];
  return { negocioId: negocio.id, reservas, canales, cierres: [], bitacora: [{ t: ahora, texto: 'Datos de ejemplo cargados.' }] };
}
