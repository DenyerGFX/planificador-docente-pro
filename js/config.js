// Configuración pública del frontend. Las claves secretas permanecen en Worker.

export const CONFIG = Object.freeze({
  APP_NAME: "Planificador Pro Docente",
  APP_VERSION: "4.0.0",

  SUPABASE_URL: "https://bgtijxxwzygjjeusiver.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_7RzTcaTXwdAyTilpMBSKXQ_bD7isc-u",

  // Sustituir por la URL desplegada del Worker de Cloudflare.
  WORKER_URL: "https://planificador-pro-docente-worker.planificadordocente.workers.dev",
  AI_MODEL: "deepseek-flash",
  API_TIMEOUT: 300000,

  ADMIN_EMAIL: "denyersequera2511@gmail.com",
  STORAGE_BUCKET_COMPROBANTES: "comprobantes-pago",
  MAX_COMPROBANTE_BYTES: 5 * 1024 * 1024,

  ROUTES: Object.freeze({
    LOGIN: "login.html",
    DASHBOARD: "dashboard.html",
    PROYECTO: "proyecto.html",
    PLANIFICACION: "planificacion-diaria.html",
    HISTORIAL: "planificaciones.html",
    PLANES: "planes.html",
    CUENTA: "cuenta.html",
    ADMIN: "admin.html"
  }),

  THEME: "auto",
  STORAGE_KEYS: Object.freeze({
    AUTH_TOKEN: "auth_token",
    USER_PROFILE: "user_profile",
    THEME_PREF: "theme_pref"
  })
});
