// Generación de Proyectos de Aprendizaje según el formato CDCE Portuguesa.

import { supabase } from "./supabase-client.js";
import { callAI } from "./api.js";
import { showToast } from "./toast.js";
import { obtenerPerfil, obtenerUsuarioActual } from "./auth.js";
import { puedoGenerarPA, puedeDescargarPDF } from "./membresias.js";
import {
  obtenerAreasDisponibles,
  obtenerContenidosPorGrado,
  serializarContenidosOficiales
} from "../data/guias.js";
import { CONFIG } from "./config.js";

const SECCIONES_PA = [
  "encabezado",
  "peic",
  "proyecto",
  "diagnostico",
  "propositos",
  "areas",
  "evaluacion"
];

function textoSeguro(valor, respaldo = "No indicado") {
  return String(valor ?? "").trim() || respaldo;
}

function limpiarRespuestaHTML(respuesta) {
  return String(respuesta ?? "")
    .replace(/^\s*```(?:html)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export function sanitizarHTMLGenerado(html) {
  const documento = new DOMParser().parseFromString(html, "text/html");
  documento.querySelectorAll("script, style, iframe, object, embed, form, link, meta").forEach(nodo => nodo.remove());
  documento.querySelectorAll("*").forEach(nodo => {
    [...nodo.attributes].forEach(atributo => {
      const nombre = atributo.name.toLowerCase();
      const valor = atributo.value.trim().toLowerCase();
      if (nombre.startsWith("on") || valor.startsWith("javascript:")) {
        nodo.removeAttribute(atributo.name);
      }
    });
  });
  return documento.body.innerHTML.trim();
}

function construirPrompt(datos, perfil) {
  const contenidos = serializarContenidosOficiales(datos.areas, datos.grado);
  const total = Number(datos.matricula_v) + Number(datos.matricula_h);

  return `
Eres un especialista en currículo venezolano con 20 años de experiencia en el sistema educativo del Estado Portuguesa.

Genera un PROYECTO DE APRENDIZAJE (P.A.) siguiendo EXACTAMENTE el formato oficial del CDCE Portuguesa 2025-2026.

DATOS DEL DOCENTE:
- Nombre: ${textoSeguro(perfil?.nombre_completo, "Docente")}
- Cédula: ${textoSeguro(perfil?.cedula)}
- Escuela: ${textoSeguro(perfil?.escuela)}
- Grado y sección: ${datos.grado}° grado, sección ${textoSeguro(datos.seccion)}
- Lapso: ${datos.lapso}
- Duración: ${datos.duracion}
- Lapso de ejecución: inicio ${textoSeguro(datos.fecha_inicio)} y culminación ${textoSeguro(datos.fecha_fin)}
- Matrícula inicial: V:${datos.matricula_v} H:${datos.matricula_h} T:${total}
- Áreas: ${datos.areas.join(", ")}
- Tema central: ${datos.tema}

CONTENIDOS OFICIALES DEL MPPE PARA ESTE GRADO Y ÁREAS:
${contenidos}

ESTRUCTURA OBLIGATORIA Y ORDEN INALTERABLE:
1. <section id="encabezado"> con:
   - REPÚBLICA BOLIVARIANA DE VENEZUELA
   - MINISTERIO DEL PODER POPULAR PARA LA EDUCACIÓN
   - Nombre de la escuela y ubicación en el estado Portuguesa
   - SUBSISTEMA DE EDUCACIÓN BÁSICA: NIVEL DE EDUCACIÓN PRIMARIA
   - Docente, grado y sección, matrícula inicial, lapso de ejecución y año escolar 2025-2026.
2. <section id="peic"> con NOMBRE DEL PEIC y OBJETIVO DEL PEIC, dejando líneas visibles para completar.
3. <section id="proyecto"> con el título PROYECTO DE APRENDIZAJE (PA), un título creativo, INTENCIONALIDAD PEDAGÓGICA DEL PROYECTO y PROPÓSITOS DEL P.A. identificados A, B, C, D y E.
4. <section id="diagnostico"> con DIAGNÓSTICO contextualizado y, dentro de la misma sección, el subtítulo FINALIDAD.
5. <section id="propositos"> con PROPÓSITO GENERAL y PROPÓSITOS ESPECÍFICOS A, B, C, D y E.
6. <section id="areas"> con:
   - ÁREA DE FORMACIÓN, TEMA INDISPENSABLE e INTENCIONALIDAD PEDAGÓGICA.
   - Una tabla con estas columnas exactas y en este orden:
     AREA DE FORMACIÓN | COMPONENTE | CONTENIDOS | APRENDIZAJE ESPERADO | ESTRATEGIAS DIDÁCTICAS | ACTIVIDADES DE APRENDIZAJE | TÉCNICAS | RECURSOS | LAPSO DE EJECUCIÓN | OBSERVACIÓN.
   - Incluye filas completas para cada área seleccionada y usa exclusivamente los contenidos y aprendizajes oficiales suministrados.
7. <section id="evaluacion"> con el título PLAN DE EVALUACIÓN y una tabla con estas columnas exactas:
   Área de formación | Potencialidades | Indicadores | Técnicas | Instrumento | Observación.

INSTRUCCIONES:
- Responde SOLO con el fragmento HTML de las siete secciones, sin markdown, sin cercas de código y sin etiquetas html, head, body, script o style.
- Usa h1, h2, h3, p, table, thead, tbody, tr, th, td, ul, li y strong.
- No cambies el orden, los id ni los nombres de las secciones.
- Escribe contenido pedagógico específico, coherente y aplicable, con terminología venezolana.
- Redacta con extensión moderada: completo, concreto, útil y sin repeticiones innecesarias.
- Prioriza actividades aplicables y descripciones claras; no alargues párrafos para alcanzar una cantidad de palabras.
- Completa todas las celdas; no uses textos como "etc.", "por definir" o marcadores genéricos.
- No inventes contenidos oficiales fuera de los suministrados.
`.trim();
}

export function validarProyectoHTML(html, areasRequeridas = []) {
  const documento = new DOMParser().parseFromString(html, "text/html");
  const faltantes = SECCIONES_PA.filter(id => !documento.querySelector(`section#${id}`));
  const tablaAreas = documento.querySelector("section#areas table");
  const tablaEvaluacion = documento.querySelector("section#evaluacion table");

  const cabecerasAreas = [
    "area de formacion",
    "componente",
    "contenidos",
    "aprendizaje esperado",
    "estrategias didacticas",
    "actividades de aprendizaje",
    "tecnicas",
    "recursos",
    "lapso de ejecucion",
    "observacion"
  ];
  const cabecerasEvaluacion = [
    "area de formacion",
    "potencialidades",
    "indicadores",
    "tecnicas",
    "instrumento",
    "observacion"
  ];

  const normalizar = texto => texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const leerCabeceras = tabla => [...(tabla?.querySelectorAll("th") ?? [])]
    .map(celda => normalizar(celda.textContent));
  const incluyeCabeceras = (actuales, requeridas) =>
    requeridas.every((cabecera, indice) => actuales[indice]?.includes(cabecera));

  if (!tablaAreas || !tablaEvaluacion) faltantes.push("tablas obligatorias");
  if (!incluyeCabeceras(leerCabeceras(tablaAreas), cabecerasAreas)) {
    faltantes.push("columnas de áreas de formación");
  }
  if (!incluyeCabeceras(leerCabeceras(tablaEvaluacion), cabecerasEvaluacion)) {
    faltantes.push("columnas del plan de evaluación");
  }

  const areasSinFila = tabla => areasRequeridas.filter(area =>
    !normalizar(tabla?.textContent || "").includes(normalizar(area))
  );
  if (areasSinFila(tablaAreas).length) {
    faltantes.push("filas de todas las áreas de formación");
  }
  if (areasSinFila(tablaEvaluacion).length) {
    faltantes.push("filas de todas las áreas en el plan de evaluación");
  }

  return { valido: faltantes.length === 0, faltantes: [...new Set(faltantes)] };
}

async function solicitarProyecto(prompt, correccion = "") {
  const respuesta = await callAI({
    model: CONFIG.AI_MODEL,
    messages: [{
      role: "user",
      content: correccion ? `${prompt}\n\nCORRECCIÓN OBLIGATORIA:\n${correccion}` : prompt
    }],
    temperature: 0.65,
    max_tokens: 8000
  });

  const mensaje = respuesta?.choices?.[0]?.message;
  const contenido = typeof mensaje?.content === "string"
    ? mensaje.content
    : respuesta?.output_text || respuesta?.choices?.[0]?.text || "";

  if (!String(contenido).trim()) {
    const motivo = respuesta?.choices?.[0]?.finish_reason || "desconocido";
    throw new Error(`DeepSeek no devolvió contenido final (motivo: ${motivo}).`);
  }

  return limpiarRespuestaHTML(contenido);
}

function obtenerSeccionesParaReparar(html, validacion) {
  const documento = new DOMParser().parseFromString(html, "text/html");
  const ids = new Set(
    SECCIONES_PA.filter(id => !documento.querySelector(`section#${id}`))
  );
  const errores = new Set(validacion.faltantes);

  if (errores.has("columnas de áreas de formación") ||
      errores.has("filas de todas las áreas de formación") ||
      (errores.has("tablas obligatorias") && !documento.querySelector("section#areas table"))) {
    ids.add("areas");
  }
  if (errores.has("columnas del plan de evaluación") ||
      errores.has("filas de todas las áreas en el plan de evaluación") ||
      (errores.has("tablas obligatorias") && !documento.querySelector("section#evaluacion table"))) {
    ids.add("evaluacion");
  }

  return SECCIONES_PA.filter(id => ids.has(id));
}

function fusionarSeccionProyecto(htmlBase, htmlReparacion, id) {
  const base = new DOMParser().parseFromString(htmlBase, "text/html");
  const reparacion = new DOMParser().parseFromString(htmlReparacion, "text/html");
  let seccionNueva = reparacion.querySelector(`section#${id}`);

  // Si DeepSeek respetó que fuera una sola sección, pero alteró únicamente el id,
  // lo corregimos de forma segura antes de fusionarla.
  const candidatas = reparacion.querySelectorAll("section");
  if (!seccionNueva && candidatas.length === 1) {
    seccionNueva = candidatas[0];
    seccionNueva.id = id;
  }
  if (!seccionNueva) return htmlBase;

  return SECCIONES_PA.map(sectionId => {
    if (sectionId === id) return seccionNueva.outerHTML;
    return base.querySelector(`section#${sectionId}`)?.outerHTML || "";
  }).filter(Boolean).join("\n");
}

async function repararProyectoPorSecciones(html, prompt, validacion) {
  let resultado = html;
  const ids = obtenerSeccionesParaReparar(html, validacion);

  for (const id of ids) {
    const fragmento = await solicitarProyecto(
      prompt,
      `Esta es una reparación parcial. Devuelve ÚNICAMENTE <section id="${id}"> completa y bien cerrada. ` +
      `No repitas ninguna otra sección. Conserva exactamente el id "${id}" y cumple todas las columnas, ` +
      `datos e instrucciones indicadas para esta sección. Redacta de forma concreta y sin repeticiones.`
    );
    resultado = fusionarSeccionProyecto(resultado, fragmento, id);
  }

  return resultado;
}

function escaparHTML(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizarTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function obtenerAreasAusentes(tabla, areas) {
  const textoTabla = normalizarTexto(tabla?.textContent);
  return areas.filter(area => !textoTabla.includes(normalizarTexto(area)));
}

function crearFilaAreaFormacion(area, datos, contenidosPorArea) {
  const areaSegura = escaparHTML(area);
  const primerComponente = Object.entries(contenidosPorArea?.[area] ?? {})[0];
  const tieneGuia = Boolean(primerComponente);
  const componente = tieneGuia ? primerComponente[0] : "Articulación complementaria";
  const detalle = tieneGuia ? primerComponente[1] : {};
  const contenidos = tieneGuia
    ? (detalle.contenidos ?? []).slice(0, 3).join("; ")
    : `Actividad integradora vinculada con «${datos.tema}». No se suministró una guía oficial para esta área.`;
  const aprendizajes = tieneGuia
    ? (detalle.aprendizajes ?? []).slice(0, 3).join("; ")
    : "Participa responsablemente en actividades complementarias relacionadas con el proyecto, sin atribuir contenidos oficiales no suministrados.";

  return `<tr>
    <td>${areaSegura}</td>
    <td>${escaparHTML(componente)}</td>
    <td>${escaparHTML(contenidos)}</td>
    <td>${escaparHTML(aprendizajes)}</td>
    <td>Conversación guiada, demostración, trabajo cooperativo y aplicación práctica.</td>
    <td>Explorar saberes previos, desarrollar una actividad vinculada con «${escaparHTML(datos.tema)}» y socializar los resultados.</td>
    <td>Observación sistemática y análisis de producciones.</td>
    <td>Cuaderno, material reutilizable, recursos del entorno y material preparado por el docente.</td>
    <td>${escaparHTML(datos.fecha_inicio)} al ${escaparHTML(datos.fecha_fin)}</td>
    <td>Realizar seguimiento y adecuar la actividad al ritmo del grupo.</td>
  </tr>`;
}

function crearFilaEvaluacion(area, tema) {
  const areaSegura = escaparHTML(area);
  const temaSeguro = escaparHTML(tema);
  return `<tr>
    <td>${areaSegura}</td>
    <td>Integra saberes, habilidades y actitudes del área ${areaSegura} en situaciones vinculadas con «${temaSeguro}».</td>
    <td>Participa activamente; explica sus procedimientos; aplica los aprendizajes y presenta evidencias pertinentes.</td>
    <td>Observación sistemática y análisis de producciones.</td>
    <td>Escala de estimación, registro descriptivo y portafolio de evidencias.</td>
    <td>Seguimiento continuo durante el desarrollo de las actividades.</td>
  </tr>`;
}

function completarFilasFaltantes(html, datos) {
  const documento = new DOMParser().parseFromString(html, "text/html");
  const tablaAreas = documento.querySelector("section#areas table");
  const tablaEvaluacion = documento.querySelector("section#evaluacion table");
  const contenidosPorArea = obtenerContenidosPorGrado(datos.areas, datos.grado);

  if (tablaAreas) {
    let cuerpo = tablaAreas.querySelector("tbody");
    if (!cuerpo) {
      cuerpo = documento.createElement("tbody");
      tablaAreas.appendChild(cuerpo);
    }
    obtenerAreasAusentes(tablaAreas, datos.areas).forEach(area => {
      cuerpo.insertAdjacentHTML(
        "beforeend",
        crearFilaAreaFormacion(area, datos, contenidosPorArea)
      );
    });
  }

  if (tablaEvaluacion) {
    let cuerpo = tablaEvaluacion.querySelector("tbody");
    if (!cuerpo) {
      cuerpo = documento.createElement("tbody");
      tablaEvaluacion.appendChild(cuerpo);
    }
    obtenerAreasAusentes(tablaEvaluacion, datos.areas).forEach(area => {
      cuerpo.insertAdjacentHTML("beforeend", crearFilaEvaluacion(area, datos.tema));
    });
  }

  return documento.body.innerHTML.trim();
}

function crearEvaluacionDeRespaldo(datos) {
  const filas = datos.areas.map(area => crearFilaEvaluacion(area, datos.tema)).join("\n");

  return `<section id="evaluacion">
    <h2>PLAN DE EVALUACIÓN</h2>
    <table>
      <thead><tr>
        <th>Área de formación</th><th>Potencialidades</th><th>Indicadores</th>
        <th>Técnicas</th><th>Instrumento</th><th>Observación</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>
  </section>`;
}

async function guardarProyecto(datos, html, usuario) {
  const total = Number(datos.matricula_v) + Number(datos.matricula_h);
  const { data, error } = await supabase
    .from("planificaciones")
    .insert({
      user_id: usuario.id,
      tipo: "proyecto_pa",
      titulo: datos.tema,
      grado: datos.grado,
      area: datos.areas.join(", "),
      lapso: datos.lapso,
      duracion: datos.duracion,
      tema: datos.tema,
      contenido_html: html,
      contenido_texto: new DOMParser().parseFromString(html, "text/html").body.textContent,
      metadata: {
        seccion: datos.seccion,
        fecha_inicio: datos.fecha_inicio,
        fecha_fin: datos.fecha_fin,
        matricula: {
          v: Number(datos.matricula_v),
          h: Number(datos.matricula_h),
          t: total
        },
        areas: datos.areas,
        generated_at: new Date().toISOString()
      }
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function generarProyectoPA(eventoOFormulario) {
  const formulario = eventoOFormulario?.target instanceof HTMLFormElement
    ? eventoOFormulario.target
    : eventoOFormulario;
  eventoOFormulario?.preventDefault?.();

  try {
    if (!(formulario instanceof HTMLFormElement)) {
      throw new Error("Formulario de proyecto no disponible");
    }

    const fd = new FormData(formulario);
    const datos = {
      grado: fd.get("grado"),
      seccion: fd.get("seccion"),
      lapso: fd.get("lapso"),
      duracion: fd.get("duracion"),
      fecha_inicio: fd.get("fecha_inicio"),
      fecha_fin: fd.get("fecha_fin"),
      tema: fd.get("tema")?.trim(),
      matricula_v: Number(fd.get("matricula_v")),
      matricula_h: Number(fd.get("matricula_h")),
      areas: fd.getAll("areas")
    };

    if (!datos.grado || !datos.lapso || !datos.duracion || !datos.tema || !datos.areas.length) {
      showToast("Completa los campos obligatorios del proyecto.", "warning");
      return null;
    }
    if (!(await puedoGenerarPA())) return null;

    const [usuario, perfil] = await Promise.all([
      obtenerUsuarioActual(),
      obtenerPerfil()
    ]);
    if (!usuario) {
      window.location.href = CONFIG.ROUTES.LOGIN;
      return null;
    }

    showToast("Generando el Proyecto de Aprendizaje…", "info");
    const prompt = construirPrompt(datos, perfil);
    let html = await solicitarProyecto(prompt);
    html = completarFilasFaltantes(html, datos);
    let validacion = validarProyectoHTML(html, datos.areas);

    // Las respuestas largas pueden terminar justo antes de la última sección.
    // Reparamos solamente los fragmentos faltantes para no volver a consumir
    // los 8.000 tokens repitiendo todo el P.A.
    for (let intento = 0; intento < 2 && !validacion.valido; intento += 1) {
      const secciones = obtenerSeccionesParaReparar(html, validacion);
      if (!secciones.length) break;
      showToast(
        `Completando ${secciones.map(id => id.replaceAll("_", " ")).join(", ")}...`,
        "warning"
      );
      html = await repararProyectoPorSecciones(html, prompt, validacion);
      html = completarFilasFaltantes(html, datos);
      validacion = validarProyectoHTML(html, datos.areas);
    }

    // Último respaldo: si todo el proyecto está completo y solo falla la tabla
    // final de evaluación, la construimos con las áreas seleccionadas.
    if (!validacion.valido) {
      const erroresEvaluacion = new Set([
        "evaluacion",
        "tablas obligatorias",
        "columnas del plan de evaluación",
        "filas de todas las áreas en el plan de evaluación"
      ]);
      if (validacion.faltantes.every(error => erroresEvaluacion.has(error))) {
        html = fusionarSeccionProyecto(html, crearEvaluacionDeRespaldo(datos), "evaluacion");
        html = completarFilasFaltantes(html, datos);
        validacion = validarProyectoHTML(html, datos.areas);
      }
    }

    if (!validacion.valido) {
      console.error("Secciones faltantes en P.A.:", validacion.faltantes);
      showToast("La IA no devolvió el formato oficial completo. Intenta nuevamente.", "error");
      return null;
    }

    const htmlSeguro = sanitizarHTMLGenerado(html);
    const registro = await guardarProyecto(datos, htmlSeguro, usuario);
    showToast("Proyecto generado y guardado correctamente.", "success");
    return { html: htmlSeguro, registro };
  } catch (error) {
    console.error("Error al generar el P.A.:", error);
    if (!error.userNotified) {
      showToast("No pudimos generar el proyecto. Revisa la conexión e intenta de nuevo.", "error");
    }
    return null;
  }
}

export function actualizarAreasSelect(contenedor) {
  contenedor.innerHTML = "";
  obtenerAreasDisponibles().forEach(area => {
    const etiqueta = document.createElement("label");
    etiqueta.className = "check-option";
    const entrada = document.createElement("input");
    entrada.type = "checkbox";
    entrada.name = "areas";
    entrada.value = area;
    etiqueta.append(entrada, document.createTextNode(area));
    contenedor.appendChild(etiqueta);
  });
}

export async function copiarContenido(elemento) {
  try {
    await navigator.clipboard.writeText(elemento.innerText);
    showToast("Contenido copiado al portapapeles.", "success");
  } catch (error) {
    console.error("Error al copiar:", error);
    showToast("No pudimos copiar el contenido.", "error");
  }
}

export function descargarWord(elemento, titulo = "proyecto-de-aprendizaje") {
  try {
    const documento = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;line-height:1.45}table{border-collapse:collapse;width:100%}th,td{border:1px solid #555;padding:6px;vertical-align:top}h1,h2,h3{text-align:center}</style></head><body>${elemento.innerHTML}</body></html>`;
    const blob = new Blob(["\ufeff", documento], { type: "application/msword" });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = `${titulo.replace(/[^a-z0-9áéíóúñ-]+/gi, "-").toLowerCase()}.doc`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
    showToast("Documento Word descargado.", "success");
  } catch (error) {
    console.error("Error al descargar Word:", error);
    showToast("No pudimos descargar el documento Word.", "error");
  }
}

export async function imprimirComoPDF() {
  if (!(await puedeDescargarPDF())) return;
  window.print();
}

export function agregarBotonPlanDiaria(id, _titulo, contenedor) {
  const enlace = document.createElement("a");
  enlace.className = "btn btn-daily-plan";
  enlace.href = `planificacion-diaria.html?pa=${encodeURIComponent(id)}`;
  enlace.textContent = "📅 Generar Planificación Diaria";
  contenedor.appendChild(enlace);
}

export const PROYECTO_API = {
  generarProyectoPA,
  actualizarAreasSelect,
  agregarBotonPlanDiaria,
  copiarContenido,
  descargarWord,
  imprimirComoPDF,
  validarProyectoHTML
};
