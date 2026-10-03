// La barra de la demo (de alphateklab, no del cliente), el selector de plantilla y de tema, y el encabezado con la
// marca del negocio de ejemplo.

import { esc, confirmar, icono } from './ui.mjs';
import { preferencia, restablecer, hayAlmacenamiento, cargar } from './almacen.mjs';
import { NEGOCIOS_CITAS, NEGOCIO_ALOJAMIENTO, PLANTILLAS, negocioCitas as buscarNegocio } from '../nucleo/negocios.mjs';
import { fechaCorta, horaTexto } from '../nucleo/tiempo.mjs';

const VISTAS = [
  ['index.html', 'Inicio'],
  ['citas.html', 'Recepción'],
  ['bandeja.html', 'Bandeja'],
  ['reservar.html', 'Pedir cita'],
  ['alojamiento.html', 'Alojamiento'],
  ['alojamiento-reservar.html', 'Reservar cabaña'],
];

/** Plantilla de citas elegida (consultorio, barbería, taller). */
export function plantillaCitas() {
  const p = preferencia('plantilla');
  return buscarNegocio(p) ? p : 'consultorio';
}

export function negocioCitas() {
  return NEGOCIOS_CITAS[plantillaCitas()];
}

function aplicarTema(valor) {
  const html = document.documentElement;
  if (valor === 'claro' || valor === 'oscuro') html.dataset.tema = valor;
  else delete html.dataset.tema;
}

/**
 * Pinta la barra de la demo en #barra-demo.
 * @param tipo 'citas' | 'alojamiento' | 'paciente' | 'inicio'
 * @param alCambiarPlantilla se llama al elegir otra plantilla de citas sin cambiar de página
 */
export function iniciarBarra({ pagina, tipo, alCambiarPlantilla }) {
  const html = document.documentElement;
  const fija = html.hasAttribute('data-marca-fija');
  const actual = fija ? html.dataset.marca : plantillaCitas();
  if (!fija) html.dataset.marca = actual;
  aplicarTema(preferencia('tema'));

  const opciones = (grupo) => PLANTILLAS.filter((p) => p.tipo === grupo)
    .map((p) => `<option value="${p.id}"${p.id === actual ? ' selected' : ''}>${esc(p.etiqueta)}</option>`).join('');
  const tema = preferencia('tema') || 'auto';
  const cont = document.getElementById('barra-demo');
  cont.innerHTML = `
    <div class="barra-demo__dentro">
      <p class="barra-demo__titulo"><a class="barra-demo__logo" href="../alphateklab/"><img src="assets/marca/logo-oscuro.svg" alt="alphateklab" width="98" height="22"></a><strong>Reservas</strong><span>· demo con negocios de ejemplo</span></p>
      <button type="button" class="boton barra-demo__menu" aria-expanded="false" aria-controls="barra-demo-mas">Opciones de la demo</button>
      <div class="barra-demo__mas" id="barra-demo-mas">
        <label>Plantilla
          <select id="sel-plantilla">
            <optgroup label="Citas">${opciones('citas')}</optgroup>
            <optgroup label="Alojamiento">${opciones('alojamiento')}</optgroup>
          </select>
        </label>
        <label>Tema
          <select id="sel-tema">
            <option value="auto"${tema === 'auto' ? ' selected' : ''}>Según el sistema</option>
            <option value="claro"${tema === 'claro' ? ' selected' : ''}>Claro</option>
            <option value="oscuro"${tema === 'oscuro' ? ' selected' : ''}>Oscuro</option>
          </select>
        </label>
        <nav aria-label="Vistas de la demo">
          ${VISTAS.map(([href, txt]) => `<a href="${href}"${href === pagina ? ' aria-current="page"' : ''}>${txt}</a>`).join('')}
        </nav>
        <button type="button" class="boton" id="btn-restablecer">Restablecer datos de ejemplo</button>
      </div>
    </div>
    ${hayAlmacenamiento() ? '' : '<p class="aviso-almacen">Este navegador no deja guardar datos de la página: la demo funciona, pero lo que hagas se borra al recargar.</p>'}`;

  const menu = cont.querySelector('.barra-demo__menu');
  const mas = cont.querySelector('#barra-demo-mas');
  menu.addEventListener('click', () => {
    const abierto = mas.classList.toggle('abierto');
    menu.setAttribute('aria-expanded', String(abierto));
  });

  cont.querySelector('#sel-tema').addEventListener('change', (ev) => {
    preferencia('tema', ev.target.value);
    aplicarTema(ev.target.value);
  });

  cont.querySelector('#sel-plantilla').addEventListener('change', (ev) => {
    const id = ev.target.value;
    const p = PLANTILLAS.find((x) => x.id === id);
    if (p.tipo === 'citas') preferencia('plantilla', id);
    if (p.tipo === 'alojamiento' && tipo !== 'alojamiento') { location.href = 'alojamiento.html'; return; }
    if (p.tipo === 'citas' && tipo === 'alojamiento') { location.href = 'citas.html'; return; }
    if (p.tipo === 'citas') {
      html.dataset.marca = id;
      alCambiarPlantilla ? alCambiarPlantilla(id) : location.reload();
    }
  });

  cont.querySelector('#btn-restablecer').addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Restablecer datos de ejemplo',
      texto: 'Se borra lo que hiciste en esta demo (citas, pacientes, mensajes, reservas) y vuelven los datos de ejemplo. El reloj de la demo vuelve a la hora de hoy.',
      si: 'Restablecer datos de ejemplo',
      no: 'Volver sin cambiar nada',
      peligro: true,
    });
    if (!ok) return;
    restablecer();
    location.reload();
  });
}

/** Encabezado con la marca del negocio de ejemplo. `extra` es HTML a la derecha (reloj, pestañas). */
export function pintarMarca(contenedor, negocio, { enlace = null, extra = '' } = {}) {
  const logo = `<span class="marca__nombre">${esc(negocio.nombre)}</span><span class="marca__rotulo">${esc(negocio.rotulo)} · ${esc(negocio.ciudad || negocio.lugar)}</span>`;
  contenedor.innerHTML = `<div class="marca__dentro">${enlace ? `<a class="marca__logo" href="${enlace}">${logo}</a>` : `<div class="marca__logo">${logo}</div>`}${extra}</div>`;
}

/** Chip con la hora de la demo y enlace a la bandeja, para las vistas de recepción. */
export function relojChip(ahora, { enlace = true } = {}) {
  const texto = `${fechaCorta(ahora)}, ${horaTexto(ahora)}`;
  return enlace
    ? `<a class="reloj-chip" href="bandeja.html" title="Adelantar el reloj en la bandeja">${icono('reloj')}<span><span class="reloj-chip__etiqueta">Reloj de la demo</span> <time>${esc(texto)}</time></span></a>`
    : `<p class="reloj-chip">${icono('reloj')}<span><span class="reloj-chip__etiqueta">Reloj de la demo</span> <time>${esc(texto)}</time></span></p>`;
}

export { NEGOCIO_ALOJAMIENTO, cargar };
