# alphateklab Reservas

Un motor de citas y reservas con dos plantillas, para negocios de Panamá:

- **Citas** (consultorio, barbería, taller o cualquier negocio con cita): agenda por profesional y por sala, registro
  de pacientes con consentimiento de la Ley 81 de 2019, recordatorio 2 días o 1 día antes que insiste hasta tener
  respuesta, confirmación con un toque desde el teléfono, lista de espera y panel de riesgo.
- **Alojamiento** (cabañas, hoteles pequeños): calendario por cabaña y canal (página propia, Airbnb, Booking,
  Expedia), reservas de grupo, iCal de entrada y salida sin eco, vigilante de sincronización con cierre preventivo,
  choques con propuesta de reubicación y reserva directa con ITBMS y seña.

Esto es una **demo** en GitHub Pages con negocios de ejemplo (Dermatología Ríos, Barbería Calle Cuarta, Taller La
Rotonda y Cabañas Quebrada Honda). Ninguno existe; ningún nombre, teléfono ni cédula es real.

Demo publicada: https://jojomunoz.github.io/alphateklab-reservas/

## Las vistas

| Archivo | Para quién | Qué hace |
|---|---|---|
| `index.html` | Dueño que evalúa | Qué resuelve cada plantilla, cómo funciona el recordatorio, qué es simulado y el camino a producción. |
| `citas.html` | Recepción | Agenda día y semana por profesional o por sala, huecos libres, agendar y reprogramar con horas válidas, ficha del paciente, «hoy en recepción» (sin confirmar, por llamar, en sala), lista de espera y riesgo. |
| `bandeja.html` | Recepción | La cola de mensajes y el reloj de la demo (+1 h, +6 h, +1 día, hasta el próximo envío), lo enviado con «Abrir en WhatsApp» y «Ver como paciente», lo que se detuvo y por qué, y las plantillas de mensaje. |
| `confirmar.html#…` | Paciente | Confirmar, cambiar (3 horarios libres o «llámenme») o avisar que no irá. Descarga el `.ics`. También sirve para aceptar un espacio de la lista de espera. |
| `reservar.html` | Paciente | Autoagenda: servicio → profesional → día → hora → datos y consentimiento. |
| `alojamiento.html` | Dueño o recepción | Calendario de cabañas por canal, reservas, choques, `#canales` (importar y exportar iCal, vigilante) y el simulador de la doble reserva. |
| `alojamiento-reservar.html` | Huésped | Fechas y personas → cabañas libres (respeta el cierre preventivo) → total con ITBMS → datos → seña por Yappy simulada. |

## Cómo se usa la demo

1. Abre `citas.html`. La agenda arranca con unas 40 citas de ejemplo en la semana actual y la siguiente.
2. «Agendar cita»: busca o registra un paciente, elige servicio y hora libre, y marca el recordatorio. Abajo ves
   cuándo saldrían los mensajes antes de guardar.
3. Ve a `bandeja.html` y adelanta el reloj. Cada mensaje enviado tiene «Ver como paciente»: ábrelo y confirma. La
   agenda lo marca y el reintento pendiente desaparece.
4. Si no respondes, el reloj sigue: reintentos hasta el máximo y, al final, «Llamar al paciente» en recepción.
5. Para probar con tu teléfono: en la bandeja, «Más» en un mensaje muestra un QR del enlace. Desde la dirección
   publicada, la respuesta llega a la pantalla de recepción por el relevo de pruebas (ntfy.sh).
6. En `alojamiento.html`: «Simular que Booking deja de sincronizar» → alerta roja → «Cierre preventivo» → abre
   `alojamiento-reservar.html` y verás que esas cabañas ya no se ofrecen → «Simular una reserva que entra por
   Booking mientras tanto» → aparece el choque con su propuesta de reubicación.
7. «Restablecer datos de ejemplo», en la barra de arriba, vuelve todo al principio. El selector de plantilla cambia
   el negocio (consultorio, barbería, taller, cabañas) sin cambiar la estructura: así se ve la marca blanca.

## Qué es simulado

- **El reloj.** Se adelanta con botones; no corre solo.
- **El envío.** No sale ningún mensaje automático. «Abrir en WhatsApp» abre `https://wa.me/<número>?text=<mensaje>`
  y lo mandas a mano desde el WhatsApp del negocio. Nada de librerías no oficiales: violan los términos de WhatsApp
  y el número puede quedar bloqueado.
- **Entre dispositivos.** Las respuestas viajan por `https://ntfy.sh` (servidor público de pruebas) en el tema
  `atk-reservas-<sala>`. Solo viajan identificadores y la respuesta; la solicitud de cita desde otro teléfono
  (`reservar.html#s=<sala>`) lleva lo que la persona escribe. Por eso el aviso: no escribas datos reales.
- **Los datos de la cita en el enlace** van en el fragmento `#` (base64url de un JSON corto): el navegador no lo
  manda a ningún servidor. En producción el enlace lleva un identificador aleatorio de un solo uso.
- **Los canales del alojamiento.** No hay conexión con Airbnb, Booking ni Expedia. Los calendarios se importan
  subiendo el `.ics` o pegando su contenido: sus feeds no permiten que otra página los lea (CORS), y la demo lo dice
  cuando intentas leer una URL.
- **La seña por Yappy.** QR y directorio de ejemplo; la seña queda «por verificar» y se marca a mano.
- **Los datos.** Viven en `localStorage` del navegador (con versión de esquema). Si el navegador no deja guardar,
  la demo funciona en memoria y lo avisa.

## Camino a producción

GitHub Pages es solo para la demo (su política no permite alojar un SaaS comercial). Para un cliente real:

1. **Servidor con la cola de envíos.** PocketBase en un VPS propio (o Supabase con un cron; su plan gratis se pausa
   tras 7 días sin actividad). Colecciones: pacientes, citas, recordatorios, consentimientos, canales. Una tarea
   cada 5 a 15 minutos manda lo que venció; el planificador de `js/nucleo/recordatorios.mjs` se usa tal cual.
2. **WhatsApp Business API** (Cloud API de Meta) con una plantilla de utilidad aprobada y botones «Confirmo / No
   podré ir»; un webhook recibe la respuesta y actualiza la cita. Meta cobra por mensaje entregado desde el
   1-jul-2025; Panamá entra en «Rest of Latin America», unos **US$0.011 a 0.013 por plantilla de utilidad** según
   tablas de terceros (la oficial: https://developers.facebook.com/docs/whatsapp/pricing). Una plantilla de
   utilidad solo es gratis dentro de las 24 h desde el último mensaje del cliente, y un recordatorio de 1 o 2 días
   antes casi siempre cae fuera. Un blog dice que desde el 1-oct-2026 también se cobran dentro de la ventana; la
   página de cambios de Meta no lo anuncia: verificarlo antes de fijar precios. El costo de los mensajes se cobra
   aparte de la suscripción (el panel de riesgo ya lo separa).
3. **Correo** de respaldo, casi gratis. **SMS** solo como último intento: US$0.10 a 0.18 por segmento a Panamá
   (Twilio), y un acento baja el segmento de 160 a 70 caracteres.
4. **iCal desde el servidor** cada 15 a 30 minutos, con el vigilante encendido. El iCal no es tiempo real (Airbnb
   relee cada ~3 h, Booking cada ~2 h); para eliminar la doble reserva hace falta un channel manager por API
   (Beds24, Smoobu, Lodgify…). Booking solo permite iCal con 20 tipos de habitación o menos y sin channel manager.
5. **Seña:** enlace de pago de Tilopay con Yappy (2 %, mínimo US$0.30) sin servidor propio, o el botón de pago de
   Yappy, que pide servidor para generar la orden y validar el aviso del banco.
6. **Datos personales:** Ley 81 de 2019 y Decreto Ejecutivo 285 de 2021 (ANTAI). Los datos de salud son sensibles:
   consentimiento expreso, trazable (fecha, canal, texto) y revocable; derechos ARCO en 10 días hábiles. Si el
   servidor está fuera de Panamá, el texto de consentimiento debe mencionar la transferencia. Que lo revise un
   abogado antes de un cliente real.

## Decisiones técnicas

- **Calendario propio, no EventCalendar.** La agenda y el «tape chart» están hechos a mano (CSS grid + posiciones
  por minuto o por noche). EventCalendar de vkurko (MIT, ~35 KB) trae vistas por recurso, pero aquí hacía falta
  pintar huecos libres como botones, estados con forma + texto + color, la media celda de llegada y salida del
  alojamiento y el cierre preventivo: con la librería había que pelear con su DOM. Sin dependencias, cero KB extra.
- **Lector de iCal propio**, probado contra ejemplos con la forma documentada de Airbnb y Booking
  (`pruebas/fixtures/`, con sus fuentes en `pruebas/fixtures/LEEME.md`) y contra las formas del RFC 5545 (Z, TZID,
  plegado, escapado, CANCELLED, DURATION).
- **Hora de Panamá propia** (`js/nucleo/tiempo.mjs`, UTC-5 fijo): las pruebas pasan igual con `TZ=Asia/Tokyo`.
- **Feriados 2026** calculados por regla (fijos + Carnaval y Viernes Santo según la Pascua + traslado de domingo a
  lunes) y comprobados contra la lista oficial publicada (La Estrella y La Prensa).
- **ITBMS de hospedaje: 10 %** (DGI, https://dgi.mef.gob.pa/itbms/Generalidades).
- **Única librería externa:** `qrcode-generator@1.4.4` desde jsDelivr, cargada solo al mostrar un QR.

## Pruebas

```sh
node --test pruebas/                       # lógica pura (en Node 22 entra por pruebas/index.js)
node herramientas/contraste.mjs            # contraste de los tokens de las 4 marcas, claro y oscuro
python3 -m http.server 4710 -d ~/alphateklab/repos &   # servir como en GitHub Pages
node herramientas/recorrido.mjs            # recorrido principal con Playwright (29 comprobaciones, incluye el relevo ntfy)
node herramientas/recorrido-extra.mjs      # autoagenda, cambiar, lista de espera, reprogramar, plantillas, grupo, huésped
node herramientas/capturas.mjs --completa  # 7 vistas × 390/1280 × claro/oscuro, con desborde y consola
node herramientas/mutaciones.mjs           # rompe el código a propósito y comprueba que las pruebas fallan
```

## Estructura

```
index.html  citas.html  bandeja.html  confirmar.html  reservar.html  alojamiento.html  alojamiento-reservar.html
css/        base (tokens y componentes), recepcion, paciente, alojamiento, inicio
fuentes/    Hanken Grotesk y Bitter 700 (latin + latin-ext, autoalojadas)
js/nucleo/  lógica pura: tiempo, feriados, agenda, recordatorios, operaciones, enlace, ical, alojamiento, riesgo…
js/app/     interfaz: almacén, relevo ntfy, barra de la demo y una por vista
pruebas/    node --test y calendarios de ejemplo
herramientas/  capturas, contraste, recorrido y mutaciones
```
