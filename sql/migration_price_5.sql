-- Actualiza el plan mensual Docente Pro a US$5.
UPDATE public.planes
SET precio_usd = 5.00,
    nombre = 'Docente Pro',
    descripcion = 'Plan mensual para docentes activos',
    activo = TRUE
WHERE id = 'pro';
