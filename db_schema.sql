
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
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'PASSENGER',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS service_type TEXT,
  ADD COLUMN IF NOT EXISTS taxi_number TEXT,
  ADD COLUMN IF NOT EXISTS car_model TEXT,
  ADD COLUMN IF NOT EXISTS car_plate TEXT,
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

-- Función auxiliar segura para verificar rol ADMIN autenticado
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'ADMIN'
      AND COALESCE(is_suspended, FALSE) = FALSE
  );
$$;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read settings" ON public.app_settings;
CREATE POLICY "Allow read settings" ON public.app_settings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow write settings" ON public.app_settings;
CREATE POLICY "Allow write settings" ON public.app_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Allow read geofences" ON public.geofences;
CREATE POLICY "Allow read geofences" ON public.geofences
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow write geofences" ON public.geofences;
CREATE POLICY "Allow write geofences" ON public.geofences
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Allow read tickets" ON public.support_tickets;
CREATE POLICY "Allow read tickets" ON public.support_tickets
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "Allow create tickets" ON public.support_tickets;
CREATE POLICY "Allow create tickets" ON public.support_tickets
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND (user_id IS NULL OR auth.uid() = user_id));
DROP POLICY IF EXISTS "Allow write tickets" ON public.support_tickets;
CREATE POLICY "Allow write tickets" ON public.support_tickets
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Allow delete tickets" ON public.support_tickets;
CREATE POLICY "Allow delete tickets" ON public.support_tickets
  FOR DELETE USING (public.is_admin());

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

-- 7. CREDENCIALES DE ADMINISTRADOR (Hash bcrypt seguro, sin contraseñas en texto plano)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabla privada de administradores (bloqueada para lectura/escritura directa desde clientes)
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL DEFAULT 'Administrador',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ADMIN',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;

-- Registro idempotente del administrador: admin_1
INSERT INTO public.admin_users (username, email, full_name, password_hash, role, is_active)
VALUES (
  'admin_1',
  'admin_1@zippy.admin',
  'Administrador Principal',
  '$2a$10$TwxqGWNNyUcQAhTrE9US8O8JH.BsRYqBG8.hx7K8uv04.3Dy6ob5q',
  'ADMIN',
  TRUE
)
ON CONFLICT (username) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    role = 'ADMIN',
    is_active = TRUE,
    updated_at = NOW();

-- Función RPC segura para validar acceso de administrador en servidor
CREATE OR REPLACE FUNCTION public.verify_admin_login(p_username TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  full_name TEXT,
  role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT au.id, au.username, au.full_name, au.role
  FROM public.admin_users au
  WHERE (LOWER(au.username) = LOWER(TRIM(p_username)) OR LOWER(au.email) = LOWER(TRIM(p_username)))
    AND au.is_active = TRUE
    AND crypt(p_password, au.password_hash) = au.password_hash
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_admin_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_admin_login(TEXT, TEXT) TO anon, authenticated;

-- Sincronizar admin_1 en Supabase Auth (auth.users + auth.identities + public.profiles)
-- Esto permite iniciar sesión con JWT real de Supabase y cumplir todas las políticas RLS.
DO $$
DECLARE
  v_admin_id UUID;
  v_admin_email CONSTANT TEXT := 'admin_1@zippy.admin';
  v_password_hash CONSTANT TEXT := '$2a$10$TwxqGWNNyUcQAhTrE9US8O8JH.BsRYqBG8.hx7K8uv04.3Dy6ob5q';
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = v_admin_email LIMIT 1;

  IF v_admin_id IS NULL THEN
    v_admin_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      v_admin_email,
      v_password_hash,
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Administrador Principal","username":"admin_1","role":"ADMIN"}'::jsonb,
      NOW(),
      NOW(),
      '',
      '',
      '',
      ''
    );

    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      v_admin_id,
      v_admin_id::text,
      jsonb_build_object(
        'sub', v_admin_id::text,
        'email', v_admin_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      NOW(),
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE auth.users
    SET encrypted_password = v_password_hash,
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"username":"admin_1","role":"ADMIN"}'::jsonb,
        updated_at = NOW()
    WHERE id = v_admin_id;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (v_admin_id, v_admin_email, 'Administrador Principal', 'ADMIN')
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      role = 'ADMIN',
      full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);
END $$;

-- 8. CREDENCIALES OPERATIVAS (Pasajero, Conductor y Proveedor con hash bcrypt único)
DO $$
DECLARE
  v_user_id UUID;
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT *
    FROM (
      VALUES
        (
          'pasejero_1',
          'pasejero_1@zippy.app',
          'Pasajero 1',
          'PASSENGER',
          '$2a$10$bwNmbTUxue8JDhp.SVE0c.5iYC9gIF45/8UMnHSx0JcDRYbU5HoQi',
          'unverified',
          NULL::TEXT,
          NULL::TEXT,
          NULL::TEXT,
          NULL::TEXT,
          NULL::TEXT
        ),
        (
          'conductor_1',
          'conductor_1@zippy.app',
          'Conductor 1',
          'DRIVER',
          '$2a$10$hXxpOf2aFHeM.L.dziUKvOBss1f7U4rpvo2wC/5KAFyYePxv4xpoy',
          'verified',
          NULL::TEXT,
          'Z-101',
          'Nissan Versa',
          'ZPY-101',
          'Blanco'
        ),
        (
          'proveedor_1',
          'proveedor_1@zippy.app',
          'Proveedor 1',
          'PROVIDER',
          '$2a$10$TPW9cdobkZVWtYdfrhwPq.pHWfZAay.fyb7jydNeVgs4mJ9uVPbLa',
          'verified',
          'GRUA',
          NULL::TEXT,
          NULL::TEXT,
          NULL::TEXT,
          NULL::TEXT
        )
    ) AS t(
      username,
      email,
      full_name,
      role,
      password_hash,
      verification_status,
      service_type,
      taxi_number,
      car_model,
      car_plate,
      car_color
    )
  LOOP
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_rec.email LIMIT 1;

    IF v_user_id IS NULL THEN
      v_user_id := gen_random_uuid();

      INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
      )
      VALUES (
        '00000000-0000-0000-0000-000000000000',
        v_user_id,
        'authenticated',
        'authenticated',
        v_rec.email,
        v_rec.password_hash,
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'full_name', v_rec.full_name,
          'username', v_rec.username,
          'role', v_rec.role
        ),
        NOW(),
        NOW(),
        '',
        '',
        '',
        ''
      );

      INSERT INTO auth.identities (
        id,
        user_id,
        provider_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        jsonb_build_object(
          'sub', v_user_id::text,
          'email', v_rec.email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING;
    ELSE
      UPDATE auth.users
      SET encrypted_password = v_rec.password_hash,
          email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
          raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
            'full_name', v_rec.full_name,
            'username', v_rec.username,
            'role', v_rec.role
          ),
          updated_at = NOW()
      WHERE id = v_user_id;
    END IF;

    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      role,
      status,
      verification_status,
      service_type,
      taxi_number,
      car_model,
      car_plate,
      car_color,
      is_suspended
    )
    VALUES (
      v_user_id,
      v_rec.email,
      v_rec.full_name,
      v_rec.role,
      'offline',
      v_rec.verification_status,
      v_rec.service_type,
      v_rec.taxi_number,
      v_rec.car_model,
      v_rec.car_plate,
      v_rec.car_color,
      FALSE
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role = EXCLUDED.role,
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        verification_status = EXCLUDED.verification_status,
        service_type = COALESCE(public.profiles.service_type, EXCLUDED.service_type),
        taxi_number = COALESCE(public.profiles.taxi_number, EXCLUDED.taxi_number),
        car_model = COALESCE(public.profiles.car_model, EXCLUDED.car_model),
        car_plate = COALESCE(public.profiles.car_plate, EXCLUDED.car_plate),
        car_color = COALESCE(public.profiles.car_color, EXCLUDED.car_color),
        is_suspended = FALSE;
  END LOOP;
END $$;


