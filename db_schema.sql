
-- 1. HABILITAR RLS (Seguridad a nivel de fila)
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

-- 2. POLÍTICAS DE ACCESO (Eliminar antiguas y recrear para asegurar permisos)

-- Lectura: Todos los autenticados pueden ver viajes (necesario para negociación)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.rides;
CREATE POLICY "Enable read access for all users" ON public.rides
FOR SELECT
USING (auth.role() = 'authenticated');

-- Inserción: Solo el pasajero puede crear su viaje
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.rides;
CREATE POLICY "Enable insert for authenticated users only" ON public.rides
FOR INSERT
WITH CHECK (auth.uid() = passenger_id);

-- Actualización: CRÍTICO - Conductores deben poder actualizar (aceptar, llegar, finalizar)
DROP POLICY IF EXISTS "Enable update for all users" ON public.rides;
CREATE POLICY "Enable update for all users" ON public.rides
FOR UPDATE
USING (auth.role() = 'authenticated');

-- 3. CORRECCIÓN REALTIME (Bloque seguro para evitar error 42710)
DO $$
BEGIN
    -- Solo agregar si no está ya en la publicación
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'rides'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
END $$;
