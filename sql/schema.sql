-- Tabla de perfiles de docentes
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_completo TEXT NOT NULL,
  cedula TEXT UNIQUE,
  escuela TEXT,
  grado_imparte TEXT,
  municipio TEXT,
  estado TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de planificaciones
CREATE TABLE planificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('clase', 'proyecto_pa')),
  titulo TEXT NOT NULL,
  grado TEXT NOT NULL,
  area TEXT NOT NULL,
  lapso TEXT,
  duracion TEXT,
  tema TEXT,
  contenido_html TEXT NOT NULL,
  contenido_texto TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  es_favorito BOOLEAN DEFAULT FALSE,
  compartido_publicamente BOOLEAN DEFAULT FALSE,
  slug_publico TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Column extensions for daily planning
ALTER TABLE planificaciones
  ADD COLUMN pa_origen_id UUID REFERENCES planificaciones(id),
  ADD COLUMN dia_semana TEXT,
  ADD COLUMN fecha_clase DATE,
  ADD COLUMN componente TEXT;

-- Índices para búsqueda rápida
CREATE INDEX idx_planificaciones_user_id ON planificaciones(user_id);
CREATE INDEX idx_planificaciones_tipo ON planificaciones(tipo);
CREATE INDEX idx_planificaciones_created_at ON planificaciones(created_at DESC);
CREATE INDEX idx_planificaciones_grado ON planificaciones(grado);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE planificaciones ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Usuarios ven su propio perfil" ON profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "Usuarios ven sus propias planificaciones" ON planificaciones
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Planificaciones públicas son visibles" ON planificaciones
  FOR SELECT USING (compartido_publicamente = TRUE);

-- Trigger para crear perfil al registrar usuario
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nombre_completo, cedula, escuela, grado_imparte)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre_completo', 'Docente'),
    NEW.raw_user_meta_data->>'cedula',
    NEW.raw_user_meta_data->>'escuela',
    NEW.raw_user_meta_data->>'grado_imparte'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---- Membresías y pagos ----

-- Planes de membresía disponibles
CREATE TABLE planes (
  id TEXT PRIMARY KEY,                -- 'free', 'pro', 'institucional'
  nombre TEXT NOT NULL,
  precio_usd NUMERIC(10,2) DEFAULT 0,
  duracion_dias INT,                  -- NULL = permanente
  limite_pa_mes INT,                  -- cuántos P.A. puede generar al mes
  limite_clases_mes INT,
  permite_pdf BOOLEAN DEFAULT FALSE,
  permite_compartir BOOLEAN DEFAULT FALSE,
  permite_api BOOLEAN DEFAULT FALSE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Suscripciones de los usuarios
CREATE TABLE suscripciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES planes(id),
  estado TEXT NOT NULL CHECK (estado IN ('activa','trial','vencida','cancelada','pendiente')),
  fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
  fecha_vencimiento TIMESTAMPTZ,
  metodo_pago TEXT,                   -- 'manual', 'stripe', 'transferencia', etc.
  referencia_pago TEXT,
  monto_pagado_usd NUMERIC(10,2),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Historial de pagos
CREATE TABLE pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suscripcion_id UUID REFERENCES suscripciones(id),
  monto_usd NUMERIC(10,2) NOT NULL,
  metodo TEXT NOT NULL,
  referencia TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','aprobado','rechazado','reembolsado')),
  comprobante_url TEXT,               -- URL en Supabase Storage
  aprobado_por UUID REFERENCES auth.users(id),
  aprobado_at TIMESTAMPTZ,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Uso mensual (para limitar según plan)
CREATE TABLE uso_mensual (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mes TEXT NOT NULL,                  -- formato 'YYYY-MM'
  pa_generados INT DEFAULT 0,
  clases_generadas INT DEFAULT 0,
  pdf_descargados INT DEFAULT 0,
  UNIQUE(user_id, mes)
);

-- Índices adicionales
CREATE INDEX idx_suscripciones_user ON suscripciones(user_id);
CREATE INDEX idx_suscripciones_estado ON suscripciones(estado);
CREATE INDEX idx_pagos_user ON pagos(user_id);
CREATE INDEX idx_pagos_estado ON pagos(estado);
CREATE INDEX idx_uso_mensual_user_mes ON uso_mensual(user_id, mes);

-- Row Level Security para nuevas tablas
ALTER TABLE planes ENABLE ROW LEVEL SECURITY;
ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE uso_mensual ENABLE ROW LEVEL SECURITY;

-- Políticas
CREATE POLICY "Planes visibles para todos" ON planes
  FOR SELECT USING (activo = TRUE);

CREATE POLICY "Usuarios ven sus suscripciones" ON suscripciones
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuarios ven sus pagos" ON pagos
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuarios registran sus pagos" ON pagos
  FOR INSERT WITH CHECK (auth.uid() = user_id AND estado = 'pendiente');

CREATE POLICY "Usuarios ven su uso" ON uso_mensual
  FOR ALL USING (auth.uid() = user_id);

-- Insertar planes por defecto
INSERT INTO planes (id, nombre, precio_usd, duracion_dias, limite_pa_mes, limite_clases_mes, permite_pdf, permite_compartir, permite_api, descripcion) VALUES
  ('free', 'Gratuito', 0, NULL, 5, 20, FALSE, FALSE, FALSE, 'Plan básico para conocer la plataforma'),
  ('pro', 'Docente Pro', 5.00, 30, 100, 500, TRUE, TRUE, FALSE, 'Plan mensual para docentes activos'),
  ('institucional', 'Institucional', 50.00, 365, 9999, 9999, TRUE, TRUE, TRUE, 'Plan anual para escuelas completas');

-- Funciones auxiliares
CREATE OR REPLACE FUNCTION public.tiene_suscripcion_activa(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_activa BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM suscripciones
    WHERE user_id = p_user_id
      AND estado IN ('activa','trial')
      AND (fecha_vencimiento IS NULL OR fecha_vencimiento > NOW())
  ) INTO v_activa;
  RETURN COALESCE(v_activa, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.obtener_plan_actual(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_plan TEXT;
BEGIN
  SELECT plan_id INTO v_plan
  FROM suscripciones
  WHERE user_id = p_user_id
    AND estado IN ('activa','trial')
    AND (fecha_vencimiento IS NULL OR fecha_vencimiento > NOW())
  ORDER BY fecha_inicio DESC
  LIMIT 1;
  RETURN COALESCE(v_plan, 'free');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: crear suscripción 'free' cuando se registra un usuario
CREATE OR REPLACE FUNCTION public.crear_suscripcion_inicial()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.suscripciones (user_id, plan_id, estado)
  VALUES (NEW.id, 'free', 'activa');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_suscripcion
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.crear_suscripcion_inicial();

-- Trigger: incrementar uso cuando se guarda una planificación
CREATE OR REPLACE FUNCTION public.incrementar_uso()
RETURNS TRIGGER AS $$
DECLARE
  v_mes TEXT := TO_CHAR(NOW(), 'YYYY-MM');
BEGIN
  INSERT INTO public.uso_mensual (user_id, mes, pa_generados, clases_generadas)
  VALUES (NEW.user_id, v_mes,
    CASE WHEN NEW.tipo = 'proyecto_pa' THEN 1 ELSE 0 END,
    CASE WHEN NEW.tipo = 'clase' THEN 1 ELSE 0 END)
  ON CONFLICT (user_id, mes) DO UPDATE SET
    pa_generados = uso_mensual.pa_generados +
      CASE WHEN NEW.tipo = 'proyecto_pa' THEN 1 ELSE 0 END,
    clases_generadas = uso_mensual.clases_generadas +
      CASE WHEN NEW.tipo = 'clase' THEN 1 ELSE 0 END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_planificacion_created
  AFTER INSERT ON planificaciones
  FOR EACH ROW EXECUTE FUNCTION public.incrementar_uso();

-- Acceso administrativo limitado al correo configurado
CREATE POLICY "Admin ve perfiles" ON profiles
  FOR SELECT USING (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com');

CREATE POLICY "Admin gestiona pagos" ON pagos
  FOR ALL USING (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com')
  WITH CHECK (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com');

CREATE POLICY "Admin gestiona suscripciones" ON suscripciones
  FOR ALL USING (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com')
  WITH CHECK (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com');

-- Almacenamiento privado de comprobantes
INSERT INTO storage.buckets (id, name, public)
VALUES ('comprobantes-pago', 'comprobantes-pago', FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Usuarios suben sus comprobantes" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comprobantes-pago'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "Usuarios ven sus comprobantes" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'comprobantes-pago'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com'
    )
  );

CREATE POLICY "Usuarios eliminan comprobantes fallidos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'comprobantes-pago'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- Aprobación atómica de un pago y activación de la membresía
CREATE OR REPLACE FUNCTION public.aprobar_pago_manual(p_pago_id UUID, p_plan_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago pagos%ROWTYPE;
  v_duracion INT;
BEGIN
  IF LOWER(auth.jwt()->>'email') <> 'denyersequera2511@gmail.com' THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  SELECT * INTO v_pago FROM pagos WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND OR v_pago.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Pago inexistente o ya procesado';
  END IF;

  SELECT duracion_dias INTO v_duracion FROM planes WHERE id = p_plan_id AND activo = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan no válido';
  END IF;

  UPDATE pagos
  SET estado = 'aprobado', aprobado_por = auth.uid(), aprobado_at = NOW()
  WHERE id = p_pago_id;

  UPDATE suscripciones
  SET estado = 'cancelada', updated_at = NOW()
  WHERE user_id = v_pago.user_id AND estado IN ('activa', 'trial');

  INSERT INTO suscripciones (
    user_id, plan_id, estado, fecha_inicio, fecha_vencimiento,
    metodo_pago, referencia_pago, monto_pagado_usd
  ) VALUES (
    v_pago.user_id, p_plan_id, 'activa', NOW(),
    CASE WHEN v_duracion IS NULL THEN NULL ELSE NOW() + make_interval(days => v_duracion) END,
    v_pago.metodo, v_pago.referencia, v_pago.monto_usd
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aprobar_pago_manual(UUID, TEXT) TO authenticated;
