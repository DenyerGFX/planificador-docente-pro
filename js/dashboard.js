import { protegerRuta, obtenerPerfil, cerrarSesion } from "./auth.js";
import { obtenerResumenMembresia } from "./membresias.js";
import { initTheme, toggleTheme } from "./theme.js";
import { CONFIG } from "./config.js";
import { showToast } from "./toast.js";

function porcentaje(usados, limite) {
  if (!limite) return 0;
  return Math.min(100, Math.round((usados / limite) * 100));
}

function mostrarResumen(resumen) {
  const { plan, suscripcion, uso } = resumen;
  const limitePA = plan.limite_pa_mes ?? "∞";
  const limiteClases = plan.limite_clases_mes ?? "∞";

  document.getElementById("plan-nombre").textContent = plan.nombre;
  document.getElementById("plan-estado").textContent =
    suscripcion.fecha_vencimiento
      ? `Estado: ${suscripcion.estado} · vence ${new Date(suscripcion.fecha_vencimiento).toLocaleDateString("es-VE")}`
      : `Estado: ${suscripcion.estado} · sin vencimiento`;
  document.getElementById("uso-pa").textContent = `${uso.pa_generados} de ${limitePA}`;
  document.getElementById("uso-clases").textContent = `${uso.clases_generadas} de ${limiteClases}`;
  document.getElementById("barra-pa").style.width = `${porcentaje(uso.pa_generados, plan.limite_pa_mes)}%`;
  document.getElementById("barra-clases").style.width = `${porcentaje(uso.clases_generadas, plan.limite_clases_mes)}%`;
}

initTheme();

protegerRuta(async usuario => {
  try {
    const [perfil, resumen] = await Promise.all([
      obtenerPerfil(),
      obtenerResumenMembresia()
    ]);
    const nombre = perfil?.nombre_completo || usuario.user_metadata?.nombre_completo || "Docente";
    const primerNombre = nombre.split(/\s+/)[0];
    document.getElementById("nombre-docente").textContent = nombre;
    document.getElementById("saludo").textContent = `¡Hola, ${primerNombre}!`;
    if (resumen) mostrarResumen(resumen);

    if (usuario.email?.toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase()) {
      document.getElementById("admin-link").classList.remove("is-hidden");
    }
  } catch (error) {
    console.error("Error al cargar el dashboard:", error);
    showToast("No pudimos cargar todo el resumen del panel.", "error");
  }
});

document.getElementById("logout-button").addEventListener("click", cerrarSesion);
document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(error => {
    console.error("No se pudo registrar el Service Worker:", error);
  });
}
