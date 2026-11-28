import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://ppdyxsfpvbuyeytxclnr.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwZHl4c2ZwdmJ1eWV5dHhjbG5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NzQ0MDIsImV4cCI6MjA4MTM1MDQwMn0.ktAgiGtEPunWTAQiIeKK9tif6Tb6g_8n0aMxaFf92WA';

const envUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

const supabaseUrl = envUrl && envUrl.length > 0 ? envUrl : DEFAULT_SUPABASE_URL;
const supabaseAnonKey = envAnonKey && envAnonKey.length > 0 ? envAnonKey : DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
