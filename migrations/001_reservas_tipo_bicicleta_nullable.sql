-- 001_reservas_tipo_bicicleta_nullable.sql
-- Rueda Libre: la reserva de un recorrido guiado sin bicicleta temporalmente
-- deja reservas.tipo_bicicleta en NULL (el servicio ya trata ese campo como
-- opcional: lee 'solo_recorrido' en la agregación de métricas y usa LEFT JOINs).
-- Si se desea mantener el NOT NULL, descomentar la siguiente línea:
-- ALTER TABLE public.reservas ALTER COLUMN tipo_bicicleta SET NOT NULL;

ALTER TABLE public.reservas ALTER COLUMN tipo_bicicleta DROP NOT NULL;
