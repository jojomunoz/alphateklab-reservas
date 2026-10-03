# alphateklab Reservas

Demo estática en GitHub Pages (https://jojomunoz.github.io/alphateklab-reservas/): un motor de citas y reservas con dos
plantillas (citas y alojamiento). HTML + CSS + módulos ES, sin build. Reglas comunes: `~/alphateklab/BRIEF.md`;
especificación: `~/alphateklab/ESPEC-reservas.md`; guía de diseño: `~/Documents/NovahWEB/conocimiento/GUIA-DISENO-SIN-SLOP.md`.

- Lógica pura en `js/nucleo/` (sin DOM), pruebas en `pruebas/` con `node --test pruebas/` (en Node 22 entra por
  `pruebas/index.js`). Interfaz en `js/app/`. Herramientas de QA en `herramientas/` (capturas, contraste, recorrido,
  mutaciones, relevo simulado). Servir con `python3 -m http.server 4730 -d ~/alphateklab/repos` y abrir
  `/alphateklab-reservas/` (las herramientas leen el puerto de `PUERTO`, 4730 por defecto).
- Toda fecha pasa por `js/nucleo/tiempo.mjs` (Panamá, UTC-5 fijo). Nunca `new Date().getHours()`.
- `horaTexto()` termina en «m.» («9:30 a. m.»): ese punto cierra la frase. Nunca escribir `${horaTexto(x)}.` (una prueba
  busca «m..» en la bitácora, las tareas y los mensajes). Para listas de recepción, `diaRelativo()` («hoy», «mañana»,
  «ayer» o la fecha), nunca un «mañana» calculado a mano.
- El teléfono del paciente no da nada por hecho si la agenda está en otro dispositivo: espera el acuse de la
  recepción (`acuseDe` y `esAcuseDe` en `js/nucleo/mensajes-relevo.mjs`). Con la agenda en el mismo navegador no se
  publica nada en ntfy.
- La página pública (autoagenda) nunca dice de quién es una cédula ni si está registrada; valida todo antes de
  escribir (si la hora no sirve, no queda nadie registrado ni una línea en la bitácora).
- Datos de ejemplo: nombres comunes combinados, teléfonos `+507 6000-0xxx`, cédulas con tomo `000`, correos en
  `example.com`. Nada de los chats ni de Konsenda.

## Dirección visual (decidida el 3-oct-2026)

- **El mundo:** la libreta de citas de la recepción y la planilla de ocupación de un hotel («tape chart»).
  Interfaces de trabajo densas y calmadas: filetes en vez de cajas, la tarjeta solo donde agrupa acciones.
- **Marca blanca:** una estructura y cuatro marcas de ejemplo que solo cambian tokens (logo de texto, primario,
  fuente de títulos): consultorio `#0f5560` + Hanken Grotesk; barbería `#7d2a3a` + Bitter; taller `#2c4a7a` +
  Hanken 800; cabañas `#38572f` + Bitter 700. Fondos y grises por marca en `css/base.css`, cada token con versión
  clara (`-c`) y oscura (`-o`). Contraste medido con `node herramientas/contraste.mjs` (todos ≥ 4,5:1).
- **Estados de cita:** forma + texto + color. Pendiente ámbar `#9a5b05` (círculo vacío), confirmada `#1d7a4a`
  (círculo con visto), cancelada gris `#5c6b70` tachada, no asistió `#b42318` (triángulo), atendida gris tinta
  (cuadro con visto), reprogramada ámbar (flecha).
- **Canales del alojamiento:** color + patrón + etiqueta (directo liso, Airbnb rayado, Booking punteado, Expedia
  líneas, bloqueo cuadriculado). La etiqueta va sobre fondo liso para que el texto no pierda contraste.
- **La apuesta:** la bandeja con el reloj de la demo. El riel de 72 h con la ventana de envío (8:00-20:00), las
  marcas de cada mensaje (en cola, enviado, detenido, llamar) y la aguja que viaja al adelantar el reloj.
- **Radios:** 0 en paneles, 4 px en controles, 2 px en insignias. Sombras solo en diálogos y avisos.
- **Movimiento:** solo responder (120 ms) y estado (220 ms); la aguja del riel viaja 340 ms. Hover solo con puntero
  fino. «Reducir movimiento» deja fundidos cortos y quita el viaje de la aguja.
- **Barra de la demo** (de alphateklab, no del cliente): marca de la casa del 3-oct-2026. Fondo grafito `#202729`,
  logo `assets/marca/logo-oscuro.svg` (copia del sitio de la agencia; enlaza a `../alphateklab/`), la vista actual
  y el foco en ámbar `#F2B544`. El favicon es la «a» de alphateklab con su módulo ámbar. Los negocios de ejemplo
  conservan su propia marca (Hanken/Bitter y sus primarios): Manrope e Inter son solo de la agencia.
- **Textos:** tuteo, español de Panamá, montos `B/.1,234.50` y `US$0.012`, horas `9:30 a. m.`. Nada de cifras sin
  fuente: el 30 % de la CSS (TVN) y Robotham 2016 van con enlace; el «hasta 80 %» de los vendedores no se cita.
