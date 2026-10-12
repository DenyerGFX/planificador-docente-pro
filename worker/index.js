// Cloudflare Worker: proxy seguro a la API oficial de DeepSeek.
// Recibe POST del frontend, verifica sesión de Supabase + suscripción pagada,
// y reenvía la petición sin exponer la clave de DeepSeek en el navegador.

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return jsonError('Solo se permite POST', 405, corsHeaders);
    }

    try {
      // 1. Verificar token de Supabase
      const authorization = request.headers.get('authorization') || '';
      if (!authorization.startsWith('Bearer ')) {
        return jsonError('Debes iniciar sesión.', 401, corsHeaders);
      }

      const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: authorization
        }
      });

      if (!userResponse.ok) {
        return jsonError('La sesión no es válida o venció.', 401, corsHeaders);
      }

      const user = await userResponse.json();

      // 2. Verificar obligatoriamente la suscripción pagada activa
      const accessResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/rpc/tiene_suscripcion_pago_activa`,
        {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_ANON_KEY,
            Authorization: authorization,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ p_user_id: user.id })
        }
      );

      const hasAccess = accessResponse.ok ? await accessResponse.json() : false;
      if (!hasAccess) {
        return jsonError('Necesitas un plan pagado activo.', 403, corsHeaders);
      }

      // 3. Parsear el body
      const body = await request.json();

      if (!Array.isArray(body.messages) || body.messages.length === 0 ||
          body.messages.some(message => !message?.role || typeof message?.content !== 'string')) {
        return jsonError('Payload inválido: falta messages[]', 400, corsHeaders);
      }

      // 4. Forzar un modelo válido y desactivar el modo de razonamiento.
      // DeepSeek activa "thinking" por defecto. En respuestas extensas puede
      // consumir todo max_tokens razonando y dejar message.content vacío.
      const allowedModels = new Set(['deepseek-flash', 'deepseek-v4-pro']);
      const requestedMaxTokens = Number(body.max_tokens);
      const maxTokens = Number.isFinite(requestedMaxTokens)
        ? Math.min(Math.max(Math.trunc(requestedMaxTokens), 1), 8000)
        : 4096;
      const payload = {
        model: allowedModels.has(body.model) ? body.model : 'deepseek-flash',
        messages: [
          {
            role: 'system',
            content: 'Genera únicamente el fragmento HTML final solicitado. No expliques, no uses Markdown y no omitas secciones ni tablas obligatorias.'
          },
          ...body.messages
        ],
        thinking: { type: 'disabled' },
        stream: false,
        temperature: body.temperature ?? 0.7,
        max_tokens: maxTokens
      };

      // 5. Llamar directamente a la API oficial de DeepSeek
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      // 6. Validar que DeepSeek realmente devolvió contenido final.
      const responseBody = await response.text();

      if (!response.ok) {
        return new Response(responseBody, {
          status: response.status,
          headers: {
            ...corsHeaders,
            'Content-Type': response.headers.get('content-type') || 'application/json'
          }
        });
      }

      let deepseekData;
      try {
        deepseekData = JSON.parse(responseBody);
      } catch {
        console.error('DeepSeek devolvió JSON inválido.', { status: response.status });
        return jsonError('DeepSeek devolvió una respuesta no válida. Intenta nuevamente.', 502, corsHeaders);
      }

      const choice = deepseekData?.choices?.[0];
      const content = choice?.message?.content;
      const contentLength = typeof content === 'string' ? content.trim().length : 0;
      const reasoningLength = typeof choice?.message?.reasoning_content === 'string'
        ? choice.message.reasoning_content.length
        : 0;

      console.log('Respuesta DeepSeek', {
        model: deepseekData?.model || payload.model,
        finishReason: choice?.finish_reason || 'desconocido',
        contentLength,
        reasoningLength
      });

      if (!contentLength) {
        return jsonError(
          choice?.finish_reason === 'length'
            ? 'DeepSeek agotó el límite antes de redactar el proyecto. Intenta con menos áreas.'
            : 'DeepSeek devolvió una respuesta vacía. Intenta nuevamente.',
          502,
          corsHeaders
        );
      }

      return new Response(JSON.stringify(deepseekData), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });

    } catch (err) {
      console.error('Worker error:', err);
      return jsonError(
        'Error interno del servidor. Por favor, inténtelo de nuevo.',
        500,
        corsHeaders
      );
    }
  }
};

function jsonError(message, status, corsHeaders) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configuredOrigins = [...new Set([
    'https://planificadorprodocente.site',
    'https://www.planificadorprodocente.site',
    ...String(env.ALLOWED_ORIGIN || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  ])];
  const localDevelopment = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const allowedOrigin = configuredOrigins.includes(origin) || localDevelopment
    ? origin
    : configuredOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
