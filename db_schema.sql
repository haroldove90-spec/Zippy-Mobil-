
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

-- 3. COLUMNAS EXTENDIDAS PARA CICLO COMPLETO DE VIAJE (Idempotente)
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pin_code TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_category TEXT DEFAULT 'ECONOMICO',
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_fare NUMERIC DEFAULT 35,
  ADD COLUMN IF NOT EXISTS distance_fare NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS time_fare NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rating_tags TEXT[],
  ADD COLUMN IF NOT EXISTS driver_rating_for_passenger NUMERIC,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by_driver BOOLEAN DEFAULT FALSE;

-- 4. COLUMNAS EXTENDIDAS EN PROFILES Y DRIVER_APPLICATIONS
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS car_color TEXT,
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS debt_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trusted_contacts JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.driver_applications
  ADD COLUMN IF NOT EXISTS circulation_card_url TEXT,
  ADD COLUMN IF NOT EXISTS insurance_policy_url TEXT,
  ADD COLUMN IF NOT EXISTS background_check_url TEXT,
  ADD COLUMN IF NOT EXISTS license_expiry DATE,
  ADD COLUMN IF NOT EXISTS insurance_expiry DATE;

-- 5. TABLAS OPERATIVAS DE ADMINISTRACIÓN (Tarifas, Geocercas, Soporte)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius_km NUMERIC NOT NULL DEFAULT 3,
  surcharge_percent NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_name TEXT,
  ride_id UUID,
  category TEXT NOT NULL DEFAULT 'soporte',
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  refund_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read settings" ON public.app_settings;
CREATE POLICY "Allow read settings" ON public.app_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow write settings" ON public.app_settings;
CREATE POLICY "Allow write settings" ON public.app_settings FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow read geofences" ON public.geofences;
CREATE POLICY "Allow read geofences" ON public.geofences FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow write geofences" ON public.geofences;
CREATE POLICY "Allow write geofences" ON public.geofences FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow read tickets" ON public.support_tickets;
CREATE POLICY "Allow read tickets" ON public.support_tickets FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow write tickets" ON public.support_tickets;
CREATE POLICY "Allow write tickets" ON public.support_tickets FOR ALL USING (true);

-- 6. CORRECCIÓN REALTIME (Bloque seguro para evitar error 42710)
DO $$
BEGIN
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

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    END IF;
END $$;
