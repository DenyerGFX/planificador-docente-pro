-- Ejecutar una vez en Supabase SQL Editor sobre una instalación existente.

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.incrementar_uso()
RETURNS TRIGGER AS $$
DECLARE
  v_mes TEXT := TO_CHAR(NOW(), 'YYYY-MM');
BEGIN
  INSERT INTO public.uso_mensual (user_id, mes, pa_generados, clases_generadas)
  VALUES (
    NEW.user_id,
    v_mes,
    CASE WHEN NEW.tipo = 'proyecto_pa' THEN 1 ELSE 0 END,
    CASE WHEN NEW.tipo = 'clase' THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, mes) DO UPDATE SET
    pa_generados = uso_mensual.pa_generados +
      CASE WHEN NEW.tipo = 'proyecto_pa' THEN 1 ELSE 0 END,
    clases_generadas = uso_mensual.clases_generadas +
      CASE WHEN NEW.tipo = 'clase' THEN 1 ELSE 0 END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS "Usuarios registran sus pagos" ON pagos;
CREATE POLICY "Usuarios registran sus pagos" ON pagos
  FOR INSERT WITH CHECK (auth.uid() = user_id AND estado = 'pendiente');

DROP POLICY IF EXISTS "Admin ve perfiles" ON profiles;
CREATE POLICY "Admin ve perfiles" ON profiles
  FOR SELECT USING (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com');

DROP POLICY IF EXISTS "Admin gestiona pagos" ON pagos;
CREATE POLICY "Admin gestiona pagos" ON pagos
  FOR ALL USING (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com')
  WITH CHECK (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com');

DROP POLICY IF EXISTS "Admin gestiona suscripciones" ON suscripciones;
CREATE POLICY "Admin gestiona suscripciones" ON suscripciones
  FOR ALL USING (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com')
  WITH CHECK (LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com');

INSERT INTO storage.buckets (id, name, public)
VALUES ('comprobantes-pago', 'comprobantes-pago', FALSE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Usuarios suben sus comprobantes" ON storage.objects;
CREATE POLICY "Usuarios suben sus comprobantes" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comprobantes-pago'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "Usuarios ven sus comprobantes" ON storage.objects;
CREATE POLICY "Usuarios ven sus comprobantes" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'comprobantes-pago'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR LOWER(auth.jwt()->>'email') = 'denyersequera2511@gmail.com'
    )
  );

DROP POLICY IF EXISTS "Usuarios eliminan comprobantes fallidos" ON storage.objects;
CREATE POLICY "Usuarios eliminan comprobantes fallidos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'comprobantes-pago'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

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
