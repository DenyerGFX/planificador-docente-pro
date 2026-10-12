import { CONFIG } from "./config.js";
import { showToast } from "./toast.js";

const THEME_KEY = CONFIG.STORAGE_KEYS.THEME_PREF;

function aplicarTema(modo) {
  document.documentElement.dataset.theme = modo;
  document.documentElement.style.colorScheme = modo;
}

export function initTheme() {
  try {
    const guardado = localStorage.getItem(THEME_KEY);
    const sistemaOscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
    aplicarTema(guardado || (sistemaOscuro ? "dark" : "light"));
  } catch (error) {
    console.error("Error al cargar el tema:", error);
    aplicarTema("light");
  }
}

export function toggleTheme() {
  try {
    const actual = document.documentElement.dataset.theme || "light";
    const siguiente = actual === "dark" ? "light" : "dark";
    aplicarTema(siguiente);
    localStorage.setItem(THEME_KEY, siguiente);
  } catch (error) {
    console.error("Error al cambiar el tema:", error);
    showToast("No pudimos cambiar el tema.", "error");
  }
}
