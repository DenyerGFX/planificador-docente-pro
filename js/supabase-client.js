// Cliente único de Supabase para toda la aplicación.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm";
import { CONFIG } from "./config.js";

export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

export const auth = supabase.auth;
export const db = supabase.from.bind(supabase);
export const storage = supabase.storage;

export async function getSession() {
  try {
    const { data, error } = await auth.getSession();
    if (error) throw error;
    return data.session ?? null;
  } catch (error) {
    console.error("No se pudo obtener la sesión:", error);
    return null;
  }
}

window.supabaseClient = supabase;
