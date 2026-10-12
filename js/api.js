// Cliente del proxy de Cloudflare Worker. La clave de DeepSeek nunca llega al navegador.

import { CONFIG } from "./config.js";
import { showToast } from "./toast.js";
import { getSession } from "./supabase-client.js";

export async function callAI(payload) {
  if (!CONFIG.WORKER_URL || CONFIG.WORKER_URL === "YOUR_WORKER_URL") {
    showToast("Configura la URL del Worker de Cloudflare antes de generar.", "error");
    throw new Error("WORKER_URL no configurada");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

  try {
    const session = await getSession();
    if (!session?.access_token) {
      showToast("Debes iniciar sesión para usar la generación con IA.", "warning");
      throw new Error("Sesión requerida");
    }

    const response = await fetch(CONFIG.WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const texto = await response.text();
    let data;
    try {
      data = texto ? JSON.parse(texto) : {};
    } catch {
      data = { error: texto || "Respuesta no válida del servidor" };
    }

    if (!response.ok) {
      console.error("Error del Worker:", data);
      const mensaje = data.error?.message || data.error || "El servicio de IA no pudo completar la solicitud.";
      showToast(mensaje, "error");
      const errorWorker = new Error(typeof mensaje === "string" ? mensaje : "Error del Worker");
      errorWorker.userNotified = true;
      throw errorWorker;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      showToast("DeepSeek tardó más de cinco minutos. Intenta nuevamente con menos áreas.", "error");
      error.userNotified = true;
    } else if (error instanceof TypeError) {
      showToast("El navegador no pudo conectarse al Worker. Verifica CORS y que el Worker esté desplegado.", "error");
      error.userNotified = true;
    } else if (error.message !== "WORKER_URL no configurada") {
      console.error("Error de conexión con el Worker:", error);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// Alias temporal para no romper integraciones antiguas que todavía importen este nombre.
export const callGroq = callAI;
