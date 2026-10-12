// js/historial.js
// Functions to load and display a teacher's saved planifications and P.A. projects.
// Uses Supabase client from supabase-client.js and toast utility.

import { supabase } from "./supabase-client.js";
import { showToast } from "./toast.js";

/**
 * Fetches the logged‑in user's planifications (both clases and proyectos).
 * Returns an array of records sorted by most recent.
 */
export async function fetchHistorial() {
  try {
    const { data, error } = await supabase
      .from('planificaciones')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching historial:', error);
      showToast('No se pudo cargar el historial.', 'error');
      return [];
    }
    return data;
  } catch (e) {
    console.error('fetchHistorial exception:', e);
    showToast('Error inesperado al cargar el historial.', 'error');
    return [];
  }
}

/**
 * Renders a list of planifications into a container element.
 * @param {HTMLElement} container - The element where items will be appended.
 * @param {Array} items - Array of planification objects.
 */
export function renderHistorial(container, items) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<p class="text-center text-muted">No hay planificaciones guardadas.</p>';
    return;
  }
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'historial-card glass'; // assumes glassmorphism class
    card.innerHTML = `
      <h3 class="h5">${item.titulo}</h3>
      <p class="mb-1"><strong>Tipo:</strong> ${item.tipo === 'proyecto_pa' ? 'Proyecto de Aprendizaje' : 'Clase'}</p>
      <p class="mb-1"><strong>Grado:</strong> ${item.grado}</p>
      <p class="mb-1"><strong>Área:</strong> ${item.area}</p>
      <small class="text-muted">Creado: ${new Date(item.created_at).toLocaleString()}</small>
      <div class="mt-2">
        <button class="btn btn-sm btn-primary" data-id="${item.id}" onclick="verDetalle(this)">Ver</button>
        ${item.compartido_publicamente ? `<button class="btn btn-sm btn-outline-success" data-id="${item.id}" onclick="copiarEnlace(this)">Enlace Público</button>` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

/**
 * Show detailed view of a planification (HTML content) in a modal.
 * This function is intended to be called from the generated button's onclick.
 */
export async function verDetalle(btn) {
  const id = btn.getAttribute('data-id');
  try {
    const { data, error } = await supabase
      .from('planificaciones')
      .select('contenido_html, titulo')
      .eq('id', id)
      .single();
    if (error) throw error;
    // Simple modal implementation – you can replace with a library later.
    const modal = document.createElement('div');
    modal.className = 'modal glass';
    modal.innerHTML = `
      <div class="modal-content p-4">
        <h2 class="h4 mb-3">${data.titulo}</h2>
        <div class="modal-body">${data.contenido_html}</div>
        <button class="btn btn-sm btn-secondary mt-3" onclick="this.parentElement.parentElement.remove()">Cerrar</button>
      </div>
    `;
    document.body.appendChild(modal);
  } catch (e) {
    console.error('verDetalle error:', e);
    showToast('No se pudo cargar el detalle.', 'error');
  }
}

/**
 * Copy public link of a planification to clipboard.
 */
export async function copiarEnlace(btn) {
  const id = btn.getAttribute('data-id');
  const publicUrl = new URL(`planificaciones.html?public=${id}`, window.location.href).href;
  try {
    await navigator.clipboard.writeText(publicUrl);
    showToast('Enlace copiado al portapapeles.', 'success');
  } catch (e) {
    console.error('copiarEnlace error:', e);
    showToast('No se pudo copiar el enlace.', 'error');
  }
}
