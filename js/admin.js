import { supabase } from "./supabase-client.js";
import { protegerRuta } from "./auth.js";
import { crearUrlTemporalComprobante, listarPlanes } from "./membresias.js";
import { showToast } from "./toast.js";
import { initTheme } from "./theme.js";
import { CONFIG } from "./config.js";

const cuerpo = document.getElementById("pagos-pendientes");
let planes = [];

function planSolicitado(pago) {
  const coincidencia = pago.notas?.match(/Plan solicitado:\s*([\w-]+)/i);
  return coincidencia?.[1] || (Number(pago.monto_usd) >= 50 ? "institucional" : "pro");
}

function agregarCelda(fila, contenido) {
  const celda = document.createElement("td");
  if (contenido instanceof Node) celda.appendChild(contenido);
  else celda.textContent = contenido;
  fila.appendChild(celda);
}

async function abrirComprobante(ruta) {
  const url = await crearUrlTemporalComprobante(ruta);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

async function aprobarPago(id, planId) {
  try {
    const { error } = await supabase.rpc("aprobar_pago_manual", {
      p_pago_id: id,
      p_plan_id: planId
    });
    if (error) throw error;
    showToast("Pago aprobado y membresía activada.", "success");
    await cargarPagos();
  } catch (error) {
    console.error("Error al aprobar el pago:", error);
    showToast("No pudimos aprobar el pago. Verifica la migración SQL.", "error");
  }
}

async function rechazarPago(id) {
  try {
    const { error } = await supabase
      .from("pagos")
      .update({ estado: "rechazado", aprobado_at: new Date().toISOString() })
      .eq("id", id)
      .eq("estado", "pendiente");
    if (error) throw error;
    showToast("Pago rechazado.", "info");
    await cargarPagos();
  } catch (error) {
    console.error("Error al rechazar el pago:", error);
    showToast("No pudimos rechazar el pago.", "error");
  }
}

async function cargarPagos() {
  try {
    const { data: pagos, error } = await supabase
      .from("pagos")
      .select("*")
      .eq("estado", "pendiente")
      .order("created_at", { ascending: true });
    if (error) throw error;

    const ids = [...new Set((pagos ?? []).map(pago => pago.user_id))];
    let perfiles = [];
    if (ids.length) {
      const respuesta = await supabase
        .from("profiles")
        .select("id,nombre_completo,cedula")
        .in("id", ids);
      if (respuesta.error) throw respuesta.error;
      perfiles = respuesta.data ?? [];
    }
    const perfilesPorId = new Map(perfiles.map(perfil => [perfil.id, perfil]));

    cuerpo.innerHTML = "";
    if (!pagos?.length) {
      cuerpo.innerHTML = '<tr><td colspan="8">No hay pagos pendientes.</td></tr>';
      return;
    }

    pagos.forEach(pago => {
      const fila = document.createElement("tr");
      const perfil = perfilesPorId.get(pago.user_id);
      const planId = planSolicitado(pago);
      agregarCelda(fila, perfil ? `${perfil.nombre_completo} · ${perfil.cedula || "sin cédula"}` : pago.user_id);
      agregarCelda(fila, new Date(pago.created_at).toLocaleString("es-VE"));

      const selector = document.createElement("select");
      planes.filter(plan => plan.id !== "free").forEach(plan => {
        const opcion = document.createElement("option");
        opcion.value = plan.id;
        opcion.textContent = plan.nombre;
        opcion.selected = plan.id === planId;
        selector.appendChild(opcion);
      });
      agregarCelda(fila, selector);
      agregarCelda(fila, pago.metodo);
      agregarCelda(fila, pago.referencia || "—");
      agregarCelda(fila, `$${Number(pago.monto_usd).toFixed(2)}`);

      const ver = document.createElement("button");
      ver.className = "btn btn-secondary";
      ver.type = "button";
      ver.textContent = "Ver";
      ver.addEventListener("click", () => abrirComprobante(pago.comprobante_url));
      agregarCelda(fila, ver);

      const acciones = document.createElement("div");
      acciones.className = "action-row";
      const aprobar = document.createElement("button");
      aprobar.className = "btn btn-success";
      aprobar.type = "button";
      aprobar.textContent = "Aprobar";
      aprobar.addEventListener("click", () => aprobarPago(pago.id, selector.value));
      const rechazar = document.createElement("button");
      rechazar.className = "btn btn-danger";
      rechazar.type = "button";
      rechazar.textContent = "Rechazar";
      rechazar.addEventListener("click", () => rechazarPago(pago.id));
      acciones.append(aprobar, rechazar);
      agregarCelda(fila, acciones);
      cuerpo.appendChild(fila);
    });
  } catch (error) {
    console.error("Error al cargar pagos pendientes:", error);
    cuerpo.innerHTML = '<tr><td colspan="8">No se pudieron cargar los pagos.</td></tr>';
    showToast("No pudimos cargar los pagos pendientes.", "error");
  }
}

initTheme();
protegerRuta(async usuario => {
  if (usuario.email?.toLowerCase() !== CONFIG.ADMIN_EMAIL.toLowerCase()) {
    showToast("No tienes permisos para acceder a esta página.", "error");
    window.location.href = CONFIG.ROUTES.DASHBOARD;
    return;
  }
  planes = await listarPlanes();
  await cargarPagos();
});
