// Consolida las cuatro guías oficiales MPPE suministradas para 1.º a 6.º.

import { GUIA_CIENCIAS } from "./guias_ciencias.js";
import { GUIA_MATEMATICA } from "./guias_matematica.js";
import { GUIA_IDENTIDAD } from "./guias_identidad.js";
import { GUIA_LENGUAJE } from "./guias_lenguaje.js";

export const GUIAS_POR_AREA = Object.freeze({
  "Prácticas del Lenguaje": GUIA_LENGUAJE,
  Lenguaje: GUIA_LENGUAJE,
  Matemática: GUIA_MATEMATICA,
  Matemáticas: GUIA_MATEMATICA,
  "Ciencias Naturales": GUIA_CIENCIAS,
  Identidad: GUIA_IDENTIDAD
});

const AREAS_DISPONIBLES = Object.freeze([
  "Prácticas del Lenguaje",
  "Matemática",
  "Ciencias Naturales",
  "Identidad",
  "Cultura",
  "Educación Física"
]);

export function obtenerAreasDisponibles() {
  return [...AREAS_DISPONIBLES];
}

export function obtenerGuia(area) {
  return GUIAS_POR_AREA[area] ?? null;
}

/**
 * Devuelve los componentes oficiales por área para un grado.
 * Las áreas sin guía suministrada se representan con un objeto vacío.
 */
export function obtenerContenidosPorGrado(areas, grado) {
  const seleccionadas = Array.isArray(areas) ? areas : [areas];
  const gradoNormalizado = String(grado).replace(/\D/g, "");

  return seleccionadas.reduce((resultado, area) => {
    const guia = obtenerGuia(area);
    resultado[area] = guia?.grados?.[gradoNormalizado] ?? {};
    return resultado;
  }, {});
}

export function obtenerComponentes(area, grado) {
  const contenidos = obtenerContenidosPorGrado([area], grado);
  return Object.keys(contenidos[area] ?? {});
}

export function obtenerDetalleComponente(area, grado, componente) {
  const contenidos = obtenerContenidosPorGrado([area], grado);
  return contenidos[area]?.[componente] ?? { contenidos: [], aprendizajes: [] };
}

export function serializarContenidosOficiales(areas, grado) {
  const contenidos = obtenerContenidosPorGrado(areas, grado);
  return Object.entries(contenidos)
    .map(([area, componentes]) => {
      if (!Object.keys(componentes).length) {
        return [
          `ÁREA: ${area}`,
          "No se suministró una guía oficial para esta área. No atribuyas contenidos al MPPE ni inventes contenidos oficiales."
        ].join("\n");
      }

      const detalle = Object.entries(componentes).map(([componente, datos]) => [
        `COMPONENTE: ${componente}`,
        "CONTENIDOS:",
        ...(datos.contenidos ?? []).map(item => `- ${item}`),
        "APRENDIZAJES ESPERADOS:",
        ...(datos.aprendizajes ?? []).map(item => `- ${item}`)
      ].join("\n")).join("\n\n");

      return `ÁREA: ${area}\n${detalle}`;
    })
    .join("\n\n");
}
