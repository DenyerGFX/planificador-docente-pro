// js/auth.js
// Autenticación, perfil y protección de rutas con Supabase.

import { supabase, auth } from "./supabase-client.js";
import { showToast } from "./toast.js";
import { initTheme } from "./theme.js";

const LOGIN_URL = "login.html";
const DASHBOARD_URL = "dashboard.html";

function esCorreoSinConfirmar(error) {
  return error?.message?.toLowerCase().includes("email not confirmed");
}

/**
 * Inicia sesión con correo y contraseña.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object|null>}
 */
export async function signIn(email, password) {
  try {
    const { data, error } = await auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (error) {
      console.error("Error al iniciar sesión:", error);
      const mensaje = esCorreoSinConfirmar(error)
        ? "Confirma tu correo electrónico antes de iniciar sesión."
        : "Correo o contraseña incorrectos. Verifica los datos e intenta de nuevo.";
      showToast(mensaje, "error");
      return null;
    }

    initTheme();
    showToast("¡Bienvenido! 🎉", "success");
    window.location.href = DASHBOARD_URL;
    return data.user;
  } catch (error) {
    console.error("Error inesperado al iniciar sesión:", error);
    showToast("No pudimos iniciar sesión. Intenta nuevamente.", "error");
    return null;
  }
}

/**
 * Registra a un docente, completa su perfil e inicia su sesión.
 * Si Supabase exige confirmar el correo, informa al usuario y no intenta
 * navegar a una ruta protegida sin una sesión válida.
 *
 * @param {object} datos
 * @returns {Promise<object|null>}
 */
export async function registerTeacher({
  email,
  password,
  nombre_completo,
  cedula,
  escuela,
  grado_imparte
}) {
  try {
    const correo = email.trim().toLowerCase();
    const { data: registro, error: errorRegistro } = await auth.signUp({
      email: correo,
      password,
      options: {
        data: { nombre_completo, cedula, escuela, grado_imparte }
      }
    });

    if (errorRegistro) {
      console.error("Error al registrar:", errorRegistro);
      showToast(
        "No se pudo crear la cuenta. Revisa los datos o intenta con otro correo.",
        "error"
      );
      return null;
    }

    if (!registro.user) {
      showToast("No se pudo completar el registro. Intenta nuevamente.", "error");
      return null;
    }

    let usuario = registro.user;
    let sesion = registro.session;

    // Cuando la confirmación de correo está desactivada, signUp ya entrega
    // una sesión. Si no la entrega, intentamos el auto-login solicitado.
    if (!sesion) {
      const { data: acceso, error: errorAcceso } = await auth.signInWithPassword({
        email: correo,
        password
      });

      if (errorAcceso) {
        console.error("La cuenta se creó, pero falló el auto-login:", errorAcceso);
        if (esCorreoSinConfirmar(errorAcceso)) {
          showToast(
            "Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.",
            "success"
          );
        } else {
          showToast(
            "Cuenta creada, pero no pudimos iniciar la sesión automáticamente.",
            "warning"
          );
        }
        return usuario;
      }

      usuario = acceso.user;
      sesion = acceso.session;
    }

    // El trigger crea el perfil base; aquí se guardan también los campos
    // adicionales del formulario actual.
    const { error: errorPerfil } = await supabase
      .from("profiles")
      .update({ escuela, grado_imparte, updated_at: new Date().toISOString() })
      .eq("id", usuario.id);

    if (errorPerfil) {
      console.error("Error al completar el perfil:", errorPerfil);
      showToast(
        "La cuenta fue creada, pero algunos datos del perfil no pudieron guardarse.",
        "warning"
      );
    }

    initTheme();
    showToast("¡Cuenta creada! Bienvenido/a. 🎉", "success");
    window.location.href = DASHBOARD_URL;
    return usuario;
  } catch (error) {
    console.error("Error inesperado al registrar:", error);
    showToast("No pudimos completar el registro. Intenta nuevamente.", "error");
    return null;
  }
}

/**
 * Devuelve el usuario autenticado o null si no existe una sesión válida.
 * @returns {Promise<object|null>}
 */
export async function obtenerUsuarioActual() {
  try {
    const { data: datosSesion, error: errorSesion } = await auth.getSession();
    if (errorSesion) {
      console.error("Error al leer la sesión local:", errorSesion);
      return null;
    }
    if (!datosSesion.session) return null;

    const { data, error } = await auth.getUser();

    if (error) {
      // No tener una sesión es un estado normal al proteger una página.
      const mensaje = error.message?.toLowerCase() || "";
      const sesionInvalida = mensaje.includes("auth session missing") ||
        mensaje.includes("valid bearer token") ||
        mensaje.includes("jwt");
      if (sesionInvalida) {
        await auth.signOut({ scope: "local" });
      } else {
        console.error("Error al obtener el usuario actual:", error);
        showToast("No pudimos verificar tu sesión.", "error");
      }
      return null;
    }

    return data.user ?? null;
  } catch (error) {
    console.error("Error inesperado al verificar la sesión:", error);
    showToast("No pudimos verificar tu sesión.", "error");
    return null;
  }
}

/**
 * Obtiene el perfil del docente autenticado.
 * @returns {Promise<object|null>}
 */
export async function obtenerPerfil() {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", usuario.id)
      .single();

    if (error) {
      console.error("Error al obtener el perfil:", error);
      showToast("No pudimos cargar los datos de tu perfil.", "error");
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error inesperado al cargar el perfil:", error);
    showToast("No pudimos cargar los datos de tu perfil.", "error");
    return null;
  }
}

/**
 * Actualiza los datos editables del perfil del docente autenticado.
 * @param {object} cambios
 * @returns {Promise<object|null>}
 */
export async function actualizarPerfil(cambios = {}) {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      showToast("Debes iniciar sesión para actualizar tu perfil.", "warning");
      return null;
    }

    const camposPermitidos = [
      "nombre_completo",
      "cedula",
      "escuela",
      "grado_imparte",
      "municipio",
      "estado"
    ];
    const datosActualizados = Object.fromEntries(
      Object.entries(cambios).filter(([campo]) => camposPermitidos.includes(campo))
    );

    if (Object.keys(datosActualizados).length === 0) {
      showToast("No hay datos válidos para actualizar.", "warning");
      return null;
    }

    datosActualizados.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("profiles")
      .update(datosActualizados)
      .eq("id", usuario.id)
      .select()
      .single();

    if (error) {
      console.error("Error al actualizar el perfil:", error);
      showToast("No pudimos actualizar tu perfil. Intenta nuevamente.", "error");
      return null;
    }

    showToast("Perfil actualizado correctamente.", "success");
    return data;
  } catch (error) {
    console.error("Error inesperado al actualizar el perfil:", error);
    showToast("No pudimos actualizar tu perfil. Intenta nuevamente.", "error");
    return null;
  }
}

/**
 * Protege una página y ejecuta el callback únicamente con sesión válida.
 * @param {(usuario: object) => (void|Promise<void>)} [callback]
 * @returns {Promise<object|null>}
 */
export async function protegerRuta(callback) {
  try {
    const usuario = await obtenerUsuarioActual();

    if (!usuario) {
      window.location.href = LOGIN_URL;
      return null;
    }

    if (typeof callback === "function") {
      await callback(usuario);
    }

    return usuario;
  } catch (error) {
    console.error("Error al proteger la ruta:", error);
    showToast("Ocurrió un problema al cargar esta página.", "error");
    return null;
  }
}

/**
 * Cierra la sesión y regresa al formulario de acceso.
 * @returns {Promise<boolean>}
 */
export async function signOut() {
  try {
    const { error } = await auth.signOut();

    if (error) {
      console.error("Error al cerrar sesión:", error);
      showToast("No pudimos cerrar la sesión correctamente.", "error");
      window.location.href = LOGIN_URL;
      return false;
    }

    showToast("Sesión cerrada.", "info");
    window.location.href = LOGIN_URL;
    return true;
  } catch (error) {
    console.error("Error inesperado al cerrar sesión:", error);
    showToast("No pudimos cerrar la sesión. Intenta nuevamente.", "error");
    window.location.href = LOGIN_URL;
    return false;
  }
}

export const iniciarSesion = signIn;
export const cerrarSesion = signOut;
