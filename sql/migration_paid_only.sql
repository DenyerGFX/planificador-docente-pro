-- Planificador Pro Docente V4.0: acceso exclusivamente pagado.
-- Ejecutar una vez en Supabase SQL Editor DESPUÉS de schema.sql y migration_v4.sql.

-- El plan gratuito deja de mostrarse y las membresías gratuitas existentes
-- pierden acceso inmediatamente, sin borrar usuarios ni documentos.
UPDATE public.planes
SET activo = FALSE
WHERE id = 'free';

UPDATE public.planes
SET precio_usd = 5.00,
    duracion_dias = 30,
    descripcion = 'Plan mensual para docentes activos'
WHERE id = 'pro';

UPDATE public.suscripciones
SET estado = 'cancelada', updated_at = NOW()
WHERE plan_id = 'free' AND estado IN ('activa', 'trial', 'pendiente');

-- Las cuentas nuevas se crean sin membresía. Podrán iniciar sesión, pagar y
-- consultar su cuenta, pero no generar hasta que el administrador apruebe.
DROP TRIGGER IF EXISTS on_auth_user_created_suscripcion ON auth.users;
DROP FUNCTION IF EXISTS public.crear_suscripcion_inicial();

CREATE OR REPLACE FUNCTION public.tiene_suscripcion_pago_activa(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.suscripciones s
    JOIN public.planes p ON p.id = s.plan_id
    WHERE s.user_id = p_user_id
      AND s.estado = 'activa'
      AND p.activo = TRUE
      AND p.precio_usd > 0
      AND (s.fecha_vencimiento IS NULL OR s.fecha_vencimiento > NOW())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tiene_suscripcion_pago_activa(UUID) TO authenticated;

-- Los documentos existentes siguen siendo visibles, pero insertar una nueva
-- generación exige una membresía pagada activa también en la base de datos.
DROP POLICY IF EXISTS "Usuarios ven sus propias planificaciones" ON public.planificaciones;
DROP POLICY IF EXISTS "Usuarios leen sus propias planificaciones" ON public.planificaciones;
DROP POLICY IF EXISTS "Usuarios crean planificaciones con plan activo" ON public.planificaciones;
DROP POLICY IF EXISTS "Usuarios actualizan sus propias planificaciones" ON public.planificaciones;
DROP POLICY IF EXISTS "Usuarios eliminan sus propias planificaciones" ON public.planificaciones;

CREATE POLICY "Usuarios leen sus propias planificaciones" ON public.planificaciones
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuarios crean planificaciones con plan activo" ON public.planificaciones
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.tiene_suscripcion_pago_activa(auth.uid())
  );

CREATE POLICY "Usuarios actualizan sus propias planificaciones" ON public.planificaciones
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios eliminan sus propias planificaciones" ON public.planificaciones
  FOR DELETE USING (auth.uid() = user_id);

-- La aprobación nunca puede activar el plan gratuito ni un plan cuyo precio
-- no coincida con el pago registrado.
CREATE OR REPLACE FUNCTION public.aprobar_pago_manual(p_pago_id UUID, p_plan_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago public.pagos%ROWTYPE;
  v_duracion INT;
  v_precio NUMERIC(10,2);
BEGIN
  IF LOWER(auth.jwt()->>'email') <> 'denyersequera2511@gmail.com' THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  SELECT * INTO v_pago
  FROM public.pagos
  WHERE id = p_pago_id
  FOR UPDATE;

  IF NOT FOUND OR v_pago.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Pago inexistente o ya procesado';
  END IF;

  SELECT duracion_dias, precio_usd INTO v_duracion, v_precio
  FROM public.planes
  WHERE id = p_plan_id AND activo = TRUE AND precio_usd > 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan pagado no válido';
  END IF;

  IF v_pago.monto_usd <> v_precio THEN
    RAISE EXCEPTION 'El monto registrado no corresponde al plan seleccionado';
  END IF;

  UPDATE public.pagos
  SET estado = 'aprobado', aprobado_por = auth.uid(), aprobado_at = NOW()
  WHERE id = p_pago_id;

  UPDATE public.suscripciones
  SET estado = 'cancelada', updated_at = NOW()
  WHERE user_id = v_pago.user_id AND estado IN ('activa', 'trial');

  INSERT INTO public.suscripciones (
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
