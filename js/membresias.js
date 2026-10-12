// Membresías, límites mensuales y comprobantes de pago.

import { supabase } from "./supabase-client.js";
import { obtenerUsuarioActual } from "./auth.js";
import { showToast } from "./toast.js";
import { CONFIG } from "./config.js";

function mesActual() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "America/Caracas"
  }).format(new Date()).slice(0, 7);
}

const PLAN_SIN_ACCESO = Object.freeze({
  id: "sin_plan",
  nombre: "Sin plan activo",
  precio_usd: 0,
  limite_pa_mes: 0,
  limite_clases_mes: 0,
  permite_pdf: false,
  permite_compartir: false,
  permite_api: false
});

export async function obtenerSuscripcionActual() {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return null;

    const ahora = new Date().toISOString();
    const { data, error } = await supabase
      .from("suscripciones")
      .select("*, plan:planes(*)")
      .eq("user_id", usuario.id)
      .eq("estado", "activa")
      .or(`fecha_vencimiento.is.null,fecha_vencimiento.gt.${ahora}`)
      .order("fecha_inicio", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data?.plan) return data;

    return {
      user_id: usuario.id,
      plan_id: null,
      estado: "pendiente",
      fecha_inicio: null,
      fecha_vencimiento: null,
      plan: PLAN_SIN_ACCESO
    };
  } catch (error) {
    console.error("Error al obtener la suscripción:", error);
    showToast("No pudimos consultar tu plan actual.", "error");
    return null;
  }
}

export async function obtenerUsoMensual() {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return null;

    const mes = mesActual();
    const { data, error } = await supabase
      .from("uso_mensual")
      .select("*")
      .eq("user_id", usuario.id)
      .eq("mes", mes)
      .maybeSingle();

    if (error) throw error;
    return data ?? {
      user_id: usuario.id,
      mes,
      pa_generados: 0,
      clases_generadas: 0,
      pdf_descargados: 0
    };
  } catch (error) {
    console.error("Error al obtener el uso mensual:", error);
    showToast("No pudimos consultar tu uso mensual.", "error");
    return null;
  }
}

export async function obtenerResumenMembresia() {
  const [suscripcion, uso] = await Promise.all([
    obtenerSuscripcionActual(),
    obtenerUsoMensual()
  ]);

  if (!suscripcion || !uso) return null;
  return { suscripcion, plan: suscripcion.plan, uso };
}

async function puedeGenerar(tipo) {
  const resumen = await obtenerResumenMembresia();
  if (!resumen) return false;

  if (!resumen.suscripcion.plan_id || resumen.suscripcion.estado !== "activa") {
    showToast("Necesitas un plan activo para generar contenido.", "warning");
    window.setTimeout(() => {
      window.location.href = CONFIG.ROUTES.PLANES;
    }, 900);
    return false;
  }

  const esPA = tipo === "proyecto_pa";
  const usados = esPA ? resumen.uso.pa_generados : resumen.uso.clases_generadas;
  const limite = esPA
    ? resumen.plan.limite_pa_mes
    : resumen.plan.limite_clases_mes;

  if (limite === null || limite === undefined || usados < limite) return true;

  showToast("Alcanzaste el límite mensual de tu plan.", "warning");
  window.setTimeout(() => {
    window.location.href = CONFIG.ROUTES.PLANES;
  }, 900);
  return false;
}

export function puedoGenerarPA() {
  return puedeGenerar("proyecto_pa");
}

export function puedoGenerarClase() {
  return puedeGenerar("clase");
}

export async function puedeDescargarPDF() {
  const suscripcion = await obtenerSuscripcionActual();
  if (!suscripcion) return false;
  if (suscripcion.plan?.permite_pdf) return true;

  showToast("La descarga en PDF está disponible en los planes Pro.", "warning");
  return false;
}

export async function listarPlanes() {
  try {
    const { data, error } = await supabase
      .from("planes")
      .select("*")
      .eq("activo", true)
      .order("precio_usd", { ascending: true });
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error("Error al listar planes:", error);
    showToast("No pudimos cargar los planes disponibles.", "error");
    return [];
  }
}

export async function listarPagosUsuario() {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return [];

    const { data, error } = await supabase
      .from("pagos")
      .select("*")
      .eq("user_id", usuario.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error("Error al listar pagos:", error);
    showToast("No pudimos cargar tu historial de pagos.", "error");
    return [];
  }
}

export async function subirComprobante({
  archivo,
  planId,
  metodo,
  referencia
}) {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      showToast("Debes iniciar sesión para registrar un pago.", "warning");
      return null;
    }

    if (!archivo || !planId || !metodo || !referencia?.trim()) {
      showToast("Completa los datos del pago y adjunta el comprobante.", "warning");
      return null;
    }

    const tiposPermitidos = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!tiposPermitidos.includes(archivo.type)) {
      showToast("El comprobante debe ser JPG, PNG, WEBP o PDF.", "warning");
      return null;
    }
    if (archivo.size > CONFIG.MAX_COMPROBANTE_BYTES) {
      showToast("El comprobante no puede superar 5 MB.", "warning");
      return null;
    }

    const { data: plan, error: errorPlan } = await supabase
      .from("planes")
      .select("id, nombre, precio_usd")
      .eq("id", planId)
      .eq("activo", true)
      .single();
    if (errorPlan) throw errorPlan;

    const extension = archivo.name.split(".").pop()?.toLowerCase() || "bin";
    const ruta = `${usuario.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error: errorSubida } = await supabase.storage
      .from(CONFIG.STORAGE_BUCKET_COMPROBANTES)
      .upload(ruta, archivo, { cacheControl: "3600", upsert: false });
    if (errorSubida) throw errorSubida;

    const { data, error: errorPago } = await supabase
      .from("pagos")
      .insert({
        user_id: usuario.id,
        monto_usd: plan.precio_usd,
        metodo,
        referencia: referencia.trim(),
        estado: "pendiente",
        comprobante_url: ruta,
        notas: `Plan solicitado: ${plan.id}`
      })
      .select()
      .single();

    if (errorPago) {
      await supabase.storage
        .from(CONFIG.STORAGE_BUCKET_COMPROBANTES)
        .remove([ruta]);
      throw errorPago;
    }

    showToast("Comprobante enviado. Lo revisaremos manualmente.", "success");
    return data;
  } catch (error) {
    console.error("Error al subir el comprobante:", error);
    showToast("No pudimos registrar el comprobante. Intenta nuevamente.", "error");
    return null;
  }
}

export async function crearUrlTemporalComprobante(ruta) {
  try {
    const { data, error } = await supabase.storage
      .from(CONFIG.STORAGE_BUCKET_COMPROBANTES)
      .createSignedUrl(ruta, 300);
    if (error) throw error;
    return data.signedUrl;
  } catch (error) {
    console.error("Error al abrir el comprobante:", error);
    showToast("No pudimos abrir el comprobante.", "error");
    return null;
  }
}
