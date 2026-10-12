// Generación de la Unidad Diaria de Clase vinculada a un P.A.

import { supabase } from "./supabase-client.js";
import { callAI } from "./api.js";
import { showToast } from "./toast.js";
import { obtenerPerfil, obtenerUsuarioActual } from "./auth.js";
import { puedoGenerarClase } from "./membresias.js";
import {
  obtenerComponentes,
  obtenerDetalleComponente
} from "../data/guias.js";
import { CONFIG } from "./config.js";

const SECCIONES_DIARIAS = [
  "encabezado",
  "actividades_rutina",
  "exploracion",
  "desarrollo",
  "reflexion",
  "evaluacion",
  "nota",
  "especialistas",
  "firmas"
];

function limpiarRespuestaHTML(respuesta) {
  return String(respuesta ?? "")
    .replace(/^\s*```(?:html)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function sanitizarHTML(html) {
  const documento = new DOMParser().parseFromString(html, "text/html");
  documento.querySelectorAll("script, style, iframe, object, embed, form, link, meta").forEach(nodo => nodo.remove());
  documento.querySelectorAll("*").forEach(nodo => {
    [...nodo.attributes].forEach(atributo => {
      if (atributo.name.toLowerCase().startsWith("on") ||
          atributo.value.trim().toLowerCase().startsWith("javascript:")) {
        nodo.removeAttribute(atributo.name);
      }
    });
  });
  return documento.body.innerHTML.trim();
}

function construirPrompt(datos, perfil, detalleComponente) {
  const totalGeneral = Number(datos.matricula_v) + Number(datos.matricula_h);
  const totalAsistente = Number(datos.asistencia_v) + Number(datos.asistencia_h);
  const potencialidades = (detalleComponente.aprendizajes ?? []).join("; ");

  return `
Eres un docente venezolano de educación primaria con 20 años de experiencia.

Genera una UNIDAD DIARIA DE CLASE siguiendo EXACTAMENTE el formato oficial del MPPE y CDCE Portuguesa.

CONTEXTO:
- Docente: ${perfil?.nombre_completo || "Docente"}
- Escuela: ${perfil?.escuela || "No indicada"}
- Grado: ${datos.grado}° grado
- Sección: ${datos.seccion || "Única"}
- P.A. de origen: ${datos.pa_titulo}
- Área de Formación: ${datos.area}
- Componente: ${datos.componente}
- Contenido a desarrollar: ${datos.contenido}
- Potencialidades: ${potencialidades || "Construidas a partir del contenido seleccionado"}
- Día: ${datos.dia}
- Fecha: ${datos.fecha}
- Matrícula General: V:${datos.matricula_v} H:${datos.matricula_h} T:${totalGeneral}
- Matrícula Asistente del Día: V:${datos.asistencia_v} H:${datos.asistencia_h} T:${totalAsistente}

CONTENIDOS OFICIALES DEL MPPE PARA ESTE GRADO, ÁREA Y COMPONENTE:
${JSON.stringify(detalleComponente, null, 2)}

ESTRUCTURA OBLIGATORIA Y ORDEN INALTERABLE:
1. <section id="encabezado">: membrete oficial, título UNIDAD DIARIA DE CLASE, P.A., docente, grado, sección, matrículas, día, fecha, área, componente, contenido y potencialidades.
2. <section id="actividades_rutina"> con ACTIVIDADES DE RUTINA concretas y breves.
3. <section id="exploracion"> con EXPLORACIÓN / INICIO, conocimientos previos, motivación y tiempo.
4. <section id="desarrollo"> con DESARROLLO, actividades de enseñanza, actividades de aprendizaje, recursos y tiempos.
5. <section id="reflexion"> con REFLEXIÓN / CIERRE, metacognición, conclusiones y asignación.
6. <section id="evaluacion"> con EVALUACIÓN: potencialidades, indicadores, técnica, instrumento, tipo, forma y observaciones.
7. <section id="nota"> con NOTA sobre el Programa de Alimentación Escolar PAE.
8. <section id="especialistas"> con espacio para ESPECIALISTAS y observaciones.
9. <section id="firmas"> con espacios para firmas del docente, coordinación o dirección.

INSTRUCCIONES:
- Responde SOLO con el fragmento HTML de las nueve secciones, sin markdown, sin cercas de código y sin etiquetas html, head, body, script o style.
- Usa h1, h2, h3, p, table, thead, tbody, tr, th, td, ul, li y strong.
- No cambies el orden, los id ni los nombres de las secciones.
- Sé específico y práctico; indica tiempos concretos en inicio, desarrollo y cierre.
- Usa terminología pedagógica venezolana y actividades adecuadas al grado.
- Usa exclusivamente el contenido y los aprendizajes oficiales suministrados.
`.trim();
}

export function validarPlanificacionHTML(html) {
  const documento = new DOMParser().parseFromString(html, "text/html");
  const faltantes = SECCIONES_DIARIAS.filter(id => !documento.querySelector(`section#${id}`));
  return { valido: faltantes.length === 0, faltantes };
}

async function solicitarPlanificacion(prompt, correccion = "") {
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

function fusionarSeccionPlanificacion(htmlBase, htmlReparacion, id) {
  const base = new DOMParser().parseFromString(htmlBase, "text/html");
  const reparacion = new DOMParser().parseFromString(htmlReparacion, "text/html");
  let seccionNueva = reparacion.querySelector(`section#${id}`);
  const candidatas = reparacion.querySelectorAll("section");

  if (!seccionNueva && candidatas.length === 1) {
    seccionNueva = candidatas[0];
    seccionNueva.id = id;
  }
  if (!seccionNueva) return htmlBase;

  return SECCIONES_DIARIAS.map(sectionId => {
    if (sectionId === id) return seccionNueva.outerHTML;
    return base.querySelector(`section#${sectionId}`)?.outerHTML || "";
  }).filter(Boolean).join("\n");
}

async function repararPlanificacionPorSecciones(html, prompt, ids) {
  let resultado = html;

  for (const id of ids) {
    const fragmento = await solicitarPlanificacion(
      prompt,
      `Esta es una reparación parcial. Devuelve ÚNICAMENTE <section id="${id}"> completa y bien cerrada. ` +
      `No repitas ninguna otra sección y conserva exactamente el id "${id}".`
    );
    resultado = fusionarSeccionPlanificacion(resultado, fragmento, id);
  }

  return resultado;
}

async function guardarPlanificacion(datos, html, usuario, potencialidades) {
  const { data, error } = await supabase
    .from("planificaciones")
    .insert({
      user_id: usuario.id,
      tipo: "clase",
      titulo: `${datos.pa_titulo} - ${datos.dia} ${datos.fecha}`,
      grado: datos.grado,
      area: datos.area,
      lapso: "",
      duracion: "1 jornada",
      tema: datos.contenido,
      contenido_html: html,
      contenido_texto: new DOMParser().parseFromString(html, "text/html").body.textContent,
      pa_origen_id: datos.pa_id,
      dia_semana: datos.dia,
      fecha_clase: datos.fecha,
      componente: datos.componente,
      metadata: {
        seccion: datos.seccion,
        matricula_general: {
          v: Number(datos.matricula_v),
          h: Number(datos.matricula_h),
          t: Number(datos.matricula_v) + Number(datos.matricula_h)
        },
        matricula_asistente: {
          v: Number(datos.asistencia_v),
          h: Number(datos.asistencia_h),
          t: Number(datos.asistencia_v) + Number(datos.asistencia_h)
        },
        potencialidades,
        generated_at: new Date().toISOString()
      }
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function generarPlanificacionDiaria(datos) {
  try {
    const requeridos = [
      "pa_id", "pa_titulo", "grado", "area", "componente",
      "contenido", "dia", "fecha"
    ];
    if (requeridos.some(campo => !datos[campo])) {
      showToast("Completa los campos obligatorios de la planificación.", "warning");
      return null;
    }
    if (!(await puedoGenerarClase())) return null;

    const [usuario, perfil] = await Promise.all([
      obtenerUsuarioActual(),
      obtenerPerfil()
    ]);
    if (!usuario) {
      window.location.href = CONFIG.ROUTES.LOGIN;
      return null;
    }

    const detalle = obtenerDetalleComponente(datos.area, datos.grado, datos.componente);
    if (!(detalle.contenidos ?? []).includes(datos.contenido)) {
      showToast("El contenido seleccionado no pertenece al componente indicado.", "error");
      return null;
    }

    showToast("Generando la Unidad Diaria de Clase…", "info");
    const prompt = construirPrompt(datos, perfil, detalle);
    let html = await solicitarPlanificacion(prompt);
    let validacion = validarPlanificacionHTML(html);

    for (let intento = 0; intento < 2 && !validacion.valido; intento += 1) {
      showToast(
        `Completando ${validacion.faltantes.map(id => id.replaceAll("_", " ")).join(", ")}...`,
        "warning"
      );
      html = await repararPlanificacionPorSecciones(html, prompt, validacion.faltantes);
      validacion = validarPlanificacionHTML(html);
    }

    if (!validacion.valido) {
      console.error("Secciones faltantes en planificación:", validacion.faltantes);
      showToast("La IA no devolvió el formato diario completo. Intenta nuevamente.", "error");
      return null;
    }

    const htmlSeguro = sanitizarHTML(html);
    const registro = await guardarPlanificacion(
      datos,
      htmlSeguro,
      usuario,
      detalle.aprendizajes ?? []
    );
    showToast("Planificación diaria generada y guardada.", "success");
    return { html: htmlSeguro, registro };
  } catch (error) {
    console.error("Error al generar la planificación diaria:", error);
    if (!error.userNotified) {
      showToast("No pudimos generar la planificación. Intenta nuevamente.", "error");
    }
    return null;
  }
}

export function cargarComponentes(select, area, grado) {
  const componentes = obtenerComponentes(area, grado);
  select.innerHTML = '<option value="">Seleccione componente</option>';
  componentes.forEach(componente => {
    const opcion = document.createElement("option");
    opcion.value = componente;
    opcion.textContent = componente;
    select.appendChild(opcion);
  });
  select.disabled = componentes.length === 0;
  return componentes;
}

export function cargarContenidos(select, area, grado, componente) {
  const detalle = obtenerDetalleComponente(area, grado, componente);
  select.innerHTML = '<option value="">Seleccione contenido</option>';
  (detalle.contenidos ?? []).forEach(contenido => {
    const opcion = document.createElement("option");
    opcion.value = contenido;
    opcion.textContent = contenido;
    select.appendChild(opcion);
  });
  select.disabled = !(detalle.contenidos ?? []).length;
  return detalle;
}

export const PLANIFICACION_API = {
  generarPlanificacionDiaria,
  cargarComponentes,
  cargarContenidos,
  validarPlanificacionHTML
};
