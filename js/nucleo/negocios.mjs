// Los negocios de ejemplo. Todos son ficticios y lo dicen en su rótulo. Ningún nombre, teléfono ni cédula es real:
// los teléfonos usan el prefijo de ejemplo +507 6000-0xxx y las cédulas el tomo 000, que no existe.
//
// Una plantilla de citas = vocabulario + horario + profesionales + salas + servicios + marca (tokens).
// La estructura de las pantallas es la misma para todas: eso es lo que se revende.

const LV = [[480, 720], [780, 1020]]; // 8:00-12:00 y 13:00-17:00

export const NEGOCIOS_CITAS = {
  consultorio: {
    id: 'consultorio',
    plantilla: 'Consultorio médico',
    nombre: 'Dermatología Ríos',
    rotulo: 'consultorio de ejemplo',
    ciudad: 'Ciudad de Panamá',
    direccion: 'Vía de ejemplo 123, piso 4, Ciudad de Panamá (dirección de ejemplo)',
    telefono: '+50760000100',
    tema: 'consultorio',
    vocab: {
      persona: 'paciente', personas: 'pacientes', Persona: 'Paciente', Personas: 'Pacientes',
      sala: 'consultorio', salas: 'consultorios', Sala: 'Consultorio', Salas: 'Consultorios',
      profesional: 'profesional', profesionales: 'profesionales', Profesional: 'Profesional', Profesionales: 'Profesionales',
      profesionalArt: 'el profesional', salaArt: 'el consultorio', alNegocio: 'al consultorio',
      llamar: 'Llamar al paciente',
    },
    horario: { 0: [], 1: LV, 2: LV, 3: LV, 4: LV, 5: LV, 6: [[480, 720]] },
    cerrarFeriados: true,
    profesionales: [
      { id: 'rios', nombre: 'Dra. Ana Ríos', corto: 'Dra. Ríos', sala: 'c1' },
      { id: 'herrera', nombre: 'Dr. Luis Herrera', corto: 'Dr. Herrera', sala: 'c2' },
    ],
    salas: [
      { id: 'c1', nombre: 'Consultorio 1', corto: 'C1' },
      { id: 'c2', nombre: 'Consultorio 2', corto: 'C2' },
    ],
    servicios: [
      { id: 'primera', nombre: 'Consulta de primera vez', min: 30, precio: 60 },
      { id: 'control', nombre: 'Control', min: 20, precio: 40 },
      { id: 'crio', nombre: 'Crioterapia', min: 30, precio: 75 },
      { id: 'biopsia', nombre: 'Biopsia de piel', min: 45, precio: 120 },
      { id: 'limpieza', nombre: 'Limpieza facial', min: 60, precio: 55, salas: ['c2'] },
    ],
    ajustes: { paso: 15, buffer: 0, antelacionMin: 0, autoConfirmar: false },
    // Nombres panameños comunes, combinados al azar. No son personas reales.
    nombres: [
      'Carmen Batista', 'José Rodríguez', 'María González', 'Luis Castillo', 'Itzel Morales',
      'Carlos Pérez', 'Yariela Vásquez', 'Edgar Jiménez', 'Rosa Camarena', 'Jorge Quintero',
      'Milagros Ortega', 'Roberto Gutiérrez', 'Luz Cedeño', 'Alexis Barría', 'Yaritza Moreno',
      'Omar Pinzón', 'Elvia Saavedra', 'Kathia Villarreal', 'Abdiel Domínguez', 'Gisela Aguilar',
      'Francisco Arosemena', 'Nelly Samaniego', 'Iván De León', 'Marisol Tejada', 'Rubén Espinosa',
    ],
  },
  barberia: {
    id: 'barberia',
    plantilla: 'Barbería',
    nombre: 'Barbería Calle Cuarta',
    rotulo: 'barbería de ejemplo',
    ciudad: 'Ciudad de Panamá',
    direccion: 'Calle de ejemplo 4, local 2, Ciudad de Panamá (dirección de ejemplo)',
    telefono: '+50760000200',
    tema: 'barberia',
    vocab: {
      persona: 'cliente', personas: 'clientes', Persona: 'Cliente', Personas: 'Clientes',
      sala: 'silla', salas: 'sillas', Sala: 'Silla', Salas: 'Sillas',
      profesional: 'barbero', profesionales: 'barberos', Profesional: 'Barbero', Profesionales: 'Barberos',
      profesionalArt: 'el barbero', salaArt: 'la silla', alNegocio: 'a la barbería',
      llamar: 'Llamar al cliente',
    },
    horario: { 0: [], 1: [[540, 1140]], 2: [[540, 1140]], 3: [[540, 1140]], 4: [[540, 1140]], 5: [[540, 1140]], 6: [[540, 1080]] },
    cerrarFeriados: true,
    profesionales: [
      { id: 'tito', nombre: 'Tito Arauz', corto: 'Tito', sala: 's1' },
      { id: 'manuel', nombre: 'Manuel Ledezma', corto: 'Manuel', sala: 's2' },
      { id: 'jean', nombre: 'Jean Carlos Mela', corto: 'Jean Carlos', sala: 's3' },
    ],
    salas: [
      { id: 's1', nombre: 'Silla 1', corto: 'S1' },
      { id: 's2', nombre: 'Silla 2', corto: 'S2' },
      { id: 's3', nombre: 'Silla 3', corto: 'S3' },
    ],
    servicios: [
      { id: 'corte', nombre: 'Corte', min: 30, precio: 10 },
      { id: 'barba', nombre: 'Arreglo de barba', min: 15, precio: 6 },
      { id: 'corte_barba', nombre: 'Corte y barba', min: 45, precio: 15 },
      { id: 'nino', nombre: 'Corte de niño', min: 30, precio: 8 },
    ],
    ajustes: { paso: 15, buffer: 0, antelacionMin: 0, autoConfirmar: true },
    nombres: [
      'Héctor Bósquez', 'Ariel Montenegro', 'Kevin Rodríguez', 'Eduardo Sanjur', 'Joel Castillo',
      'Anel Pittí', 'Erick Navarro', 'Luis Carlos Him', 'Fernando Batista', 'Gabriel Ureña',
      'Andrés Caballero', 'Ricardo Mendieta',
    ],
  },
  taller: {
    id: 'taller',
    plantilla: 'Taller mecánico',
    nombre: 'Taller La Rotonda',
    rotulo: 'taller de ejemplo',
    ciudad: 'La Chorrera',
    direccion: 'Carretera de ejemplo, km 3, La Chorrera (dirección de ejemplo)',
    telefono: '+50760000300',
    tema: 'taller',
    vocab: {
      persona: 'cliente', personas: 'clientes', Persona: 'Cliente', Personas: 'Clientes',
      sala: 'bahía', salas: 'bahías', Sala: 'Bahía', Salas: 'Bahías',
      profesional: 'técnico', profesionales: 'técnicos', Profesional: 'Técnico', Profesionales: 'Técnicos',
      profesionalArt: 'el técnico', salaArt: 'la bahía', alNegocio: 'al taller',
      llamar: 'Llamar al cliente',
    },
    horario: { 0: [], 1: [[450, 720], [780, 990]], 2: [[450, 720], [780, 990]], 3: [[450, 720], [780, 990]], 4: [[450, 720], [780, 990]], 5: [[450, 720], [780, 990]], 6: [[480, 720]] },
    cerrarFeriados: true,
    profesionales: [
      { id: 'beto', nombre: 'Alberto Him', corto: 'Alberto', sala: 'b1' },
      { id: 'yoel', nombre: 'Yoel Camaño', corto: 'Yoel', sala: 'b2' },
    ],
    salas: [
      { id: 'b1', nombre: 'Bahía 1 (elevador)', corto: 'B1' },
      { id: 'b2', nombre: 'Bahía 2', corto: 'B2' },
    ],
    servicios: [
      { id: 'aceite', nombre: 'Cambio de aceite y filtro', min: 45, precio: 45 },
      { id: 'escaner', nombre: 'Diagnóstico con escáner', min: 30, precio: 35 },
      { id: 'frenos', nombre: 'Revisión de frenos', min: 60, precio: 30, salas: ['b1'] },
      { id: 'alineacion', nombre: 'Alineación y balanceo', min: 60, precio: 40, salas: ['b2'] },
    ],
    ajustes: { paso: 15, buffer: 15, antelacionMin: 0, autoConfirmar: false },
    nombres: [
      'Daniel Ábrego', 'Yessica Polanco', 'Raúl Sáez', 'Melissa Guerra', 'Rodrigo Tuñón',
      'Arelys Ríos', 'Juan Pablo Achurra', 'Dalys Franco', 'César Nieto', 'Ana Lucía Bernal',
    ],
  },
};

export const NEGOCIO_ALOJAMIENTO = {
  id: 'cabanas',
  plantilla: 'Alojamiento',
  nombre: 'Cabañas Quebrada Honda',
  rotulo: 'alojamiento de ejemplo',
  lugar: 'Tierras altas de Chiriquí',
  direccion: 'Camino de ejemplo, tierras altas de Chiriquí (dirección de ejemplo)',
  telefono: '+50760000400',
  tema: 'cabanas',
  cabanas: [
    { id: 'corotu', nombre: 'Corotú', capacidad: 2, tarifa: { baja: 85, alta: 105 } },
    { id: 'nance', nombre: 'Nance', capacidad: 2, tarifa: { baja: 80, alta: 100 } },
    { id: 'guayacan', nombre: 'Guayacán', capacidad: 4, tarifa: { baja: 120, alta: 150 } },
    { id: 'espave', nombre: 'Espavé', capacidad: 4, tarifa: { baja: 115, alta: 145 } },
    { id: 'cuipo', nombre: 'Cuipo', capacidad: 6, tarifa: { baja: 165, alta: 205 } },
    { id: 'caoba', nombre: 'Caoba', capacidad: 6, tarifa: { baja: 170, alta: 210 } },
  ],
  // Temporada alta de diciembre a abril (la seca). Mínimo de noches según la temporada de la noche de llegada.
  temporadas: { alta: { meses: [12, 1, 2, 3, 4], minNoches: 3 }, baja: { minNoches: 2 } },
  itbms: 0.10, // hospedaje: 10 % (DGI)
  sena: 0.30, // seña para apartar, decisión del alojamiento de ejemplo
  yappy: '@alojamiento-de-ejemplo',
};

export const PLANTILLAS = [
  { id: 'consultorio', tipo: 'citas', etiqueta: 'Consultorio médico', pagina: 'citas.html' },
  { id: 'barberia', tipo: 'citas', etiqueta: 'Barbería', pagina: 'citas.html' },
  { id: 'taller', tipo: 'citas', etiqueta: 'Taller mecánico', pagina: 'citas.html' },
  { id: 'cabanas', tipo: 'alojamiento', etiqueta: 'Cabañas', pagina: 'alojamiento.html' },
];

export function textoConsentimiento(negocio) {
  const datosSalud = negocio.id === 'consultorio'
    ? ' Esto incluye datos de salud (qué servicio recibo en cada cita), que se tratan como datos sensibles.'
    : '';
  return `Autorizo a ${negocio.nombre} a guardar mis datos de contacto y los de mis citas, y a escribirme por WhatsApp, SMS o correo sobre ellas, según la Ley 81 de 2019 de protección de datos personales.${datosSalud} Puedo retirar este permiso cuando quiera.`;
}

/** El negocio de citas con ese id, o null. Con Object.hasOwn: «__proto__» o «constructor» no son negocios. */
export function negocioCitas(id) {
  return typeof id === 'string' && Object.hasOwn(NEGOCIOS_CITAS, id) ? NEGOCIOS_CITAS[id] : null;
}
