# Calendarios de prueba

- `airbnb.ics`: forma del calendario exportado por Airbnb. `DTSTART;VALUE=DATE`, `DTEND;VALUE=DATE`, `UID …@airbnb.com`
  y `SUMMARY:Reserved` vienen del análisis público https://www.duskolicanin.com/blog/how-airbnb-ical-sync-works-teardown-2026;
  la cabecera `PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN` y los bloqueos
  «Airbnb (Not available)» son los que citan los foros de anfitriones de Airbnb. Los UID son inventados.
- `booking.ics`: Booking.com marca TODO (reservas y bloqueos) como `SUMMARY:CLOSED - Not available`
  (https://github.com/Giginoparrucca/doorstep/pull/16). El `PRODID` de Booking no está verificado en una fuente
  primaria; el lector no depende de él.
- `rfc5545.ics`: las demás formas que permite el RFC 5545 (hora con `Z`, hora con `TZID`, líneas plegadas, texto
  escapado, `STATUS:CANCELLED`, `DURATION`, `VALARM` anidada). No imita a ningún canal.
