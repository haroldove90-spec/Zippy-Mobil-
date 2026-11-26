import { supabase } from './supabase';
import {
  GeofenceZone,
  Ride,
  RideStatus,
  SupportTicket,
  TariffConfig,
  TrustedContact,
  VehicleCategory,
} from '../types';

export const DEFAULT_TARIFF_CONFIG: TariffConfig = {
  baseFare: 35,
  costPerKm: 12,
  costPerMin: 2,
  minFare: 45,
  commissionRate: 15,
  surgeMultiplier: 1.0,
  categoryMultipliers: {
    ECONOMICO: 1.0,
    CONFORT: 1.25,
    XL: 1.5,
  },
};

export const ACTIVE_RIDE_STATUSES: RideStatus[] = [
  RideStatus.REQUESTING,
  RideStatus.NEGOTIATING,
  RideStatus.ACCEPTED,
  RideStatus.ARRIVED,
  RideStatus.PASSENGER_READY,
  RideStatus.IN_PROGRESS,
  RideStatus.PAYMENT_PENDING,
  RideStatus.RATING,
];

export const FINISHED_RIDE_STATUSES: RideStatus[] = [
  RideStatus.COMPLETED,
  RideStatus.ARCHIVED,
];

export const PASSENGER_RATING_TAGS: string[] = [
  'Amable',
  'Auto limpio',
  'Buena ruta',
  'Conducción segura',
  'Puntual',
];

export const DRIVER_RATING_TAGS: string[] = [
  'Puntual',
  'Respetuoso',
  'Buena comunicación',
  'Excelente trato',
];

const SETTINGS_STORAGE_KEY = 'zippy_tariff_config';
const GEOFENCES_STORAGE_KEY = 'zippy_geofences';
const TICKETS_STORAGE_KEY = 'zippy_support_tickets';
const RIDE_META_STORAGE_KEY = 'zippy_ride_meta';

interface RideLocalMeta {
  pin_code?: string;
  vehicle_category?: VehicleCategory;
  distance_km?: number;
  estimated_minutes?: number;
  base_fare?: number;
  distance_fare?: number;
  time_fare?: number;
  arrived_at?: string;
  rating_tags?: string[];
  driver_rating_for_passenger?: number;
  payment_confirmed_by_driver?: boolean;
}

export const generateSecurityPin = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export const calculateHaversineKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export interface FareQuote {
  distanceKm: number;
  estimatedMinutes: number;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  totalFare: number;
  geofenceSurcharge: number;
}

export const calculateFareQuote = (
  distanceKm: number,
  config: TariffConfig,
  category: VehicleCategory,
  geofenceSurchargePercent: number = 0
): FareQuote => {
  const safeDist = Math.max(Number(distanceKm.toFixed(2)), 0.5);
  const estimatedMinutes = Math.max(Math.round((safeDist / 26) * 60), 3);
  const multiplier =
    (config.categoryMultipliers[category] || 1) * (config.surgeMultiplier || 1);

  const baseFare = Math.round(config.baseFare * multiplier);
  const distanceFare = Math.round(safeDist * config.costPerKm * multiplier);
  const timeFare = Math.round(estimatedMinutes * config.costPerMin * multiplier);
  const subtotal = Math.max(baseFare + distanceFare + timeFare, config.minFare);
  const geofenceSurcharge = Math.round((subtotal * geofenceSurchargePercent) / 100);
  const totalFare = Math.round(subtotal + geofenceSurcharge);

  return {
    distanceKm: safeDist,
    estimatedMinutes,
    baseFare,
    distanceFare,
    timeFare,
    totalFare,
    geofenceSurcharge,
  };
};

// Local metadata fallback store for environments where extended SQL columns haven't been migrated yet
const getRideMetaMap = (): Record<string, RideLocalMeta> => {
  try {
    return JSON.parse(localStorage.getItem(RIDE_META_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
};

export const saveRideLocalMeta = (rideId: string, meta: Partial<RideLocalMeta>): void => {
  try {
    const map = getRideMetaMap();
    map[rideId] = { ...(map[rideId] || {}), ...meta };
    localStorage.setItem(RIDE_META_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
};

export const enrichRideWithLocalMeta = (ride: Ride): Ride => {
  const meta = getRideMetaMap()[ride.id];
  if (!meta) return ride;
  return {
    ...ride,
    pin_code: ride.pin_code || meta.pin_code,
    vehicle_category: ride.vehicle_category || meta.vehicle_category,
    distance_km: ride.distance_km ?? meta.distance_km,
    estimated_minutes: ride.estimated_minutes ?? meta.estimated_minutes,
    base_fare: ride.base_fare ?? meta.base_fare,
    distance_fare: ride.distance_fare ?? meta.distance_fare,
    time_fare: ride.time_fare ?? meta.time_fare,
    arrived_at: ride.arrived_at || meta.arrived_at,
    rating_tags: ride.rating_tags || meta.rating_tags,
    driver_rating_for_passenger:
      ride.driver_rating_for_passenger ?? meta.driver_rating_for_passenger,
    payment_confirmed_by_driver:
      ride.payment_confirmed_by_driver ?? meta.payment_confirmed_by_driver,
  };
};

const isMissingColumnError = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    msg.includes('column') ||
    msg.includes('schema cache')
  );
};

export const insertRideResilient = async (
  corePayload: Record<string, unknown>,
  extendedPayload: Record<string, unknown>
): Promise<{ data: Ride | null; error: { message: string } | null }> => {
  const fullPayload = { ...corePayload, ...extendedPayload };
  const firstAttempt = await supabase.from('rides').insert(fullPayload).select().single();

  if (!firstAttempt.error && firstAttempt.data) {
    saveRideLocalMeta(firstAttempt.data.id, extendedPayload as RideLocalMeta);
    return { data: enrichRideWithLocalMeta(firstAttempt.data as Ride), error: null };
  }

  if (isMissingColumnError(firstAttempt.error)) {
    const fallback = await supabase.from('rides').insert(corePayload).select().single();
    if (!fallback.error && fallback.data) {
      saveRideLocalMeta(fallback.data.id, extendedPayload as RideLocalMeta);
      return { data: enrichRideWithLocalMeta(fallback.data as Ride), error: null };
    }
    return { data: null, error: fallback.error };
  }

  return { data: null, error: firstAttempt.error };
};

export const updateRideResilient = async (
  rideId: string,
  corePayload: Record<string, unknown>,
  extendedPayload: Record<string, unknown> = {}
): Promise<{ error: { message: string } | null }> => {
  if (Object.keys(extendedPayload).length > 0) {
    saveRideLocalMeta(rideId, extendedPayload as RideLocalMeta);
  }

  const fullPayload = { ...corePayload, ...extendedPayload };
  const firstAttempt = await supabase.from('rides').update(fullPayload).eq('id', rideId);

  if (!firstAttempt.error) {
    return { error: null };
  }

  if (isMissingColumnError(firstAttempt.error)) {
    if (Object.keys(corePayload).length === 0) {
      return { error: null };
    }
    const fallback = await supabase.from('rides').update(corePayload).eq('id', rideId);
    return { error: fallback.error };
  }

  return { error: firstAttempt.error };
};

export const updateProfileResilient = async (
  userId: string,
  corePayload: Record<string, unknown>,
  extendedPayload: Record<string, unknown> = {}
): Promise<{ error: { message: string } | null }> => {
  const fullPayload = { ...corePayload, ...extendedPayload };
  const firstAttempt = await supabase.from('profiles').update(fullPayload).eq('id', userId);

  if (!firstAttempt.error) {
    return { error: null };
  }

  if (isMissingColumnError(firstAttempt.error)) {
    if (Object.keys(corePayload).length === 0) {
      return { error: null };
    }
    const fallback = await supabase.from('profiles').update(corePayload).eq('id', userId);
    return { error: fallback.error };
  }

  return { error: firstAttempt.error };
};

// --- TARIFF CONFIG (Supabase app_settings + localStorage fallback) ---
export const fetchTariffConfig = async (): Promise<TariffConfig> => {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'tariff_config')
      .maybeSingle();

    if (!error && data?.value) {
      const merged: TariffConfig = {
        ...DEFAULT_TARIFF_CONFIG,
        ...(data.value as Partial<TariffConfig>),
        categoryMultipliers: {
          ...DEFAULT_TARIFF_CONFIG.categoryMultipliers,
          ...((data.value as Partial<TariffConfig>).categoryMultipliers || {}),
        },
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
      return merged;
    }
  } catch {
    // fallback below
  }

  try {
    const local = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (local) {
      return { ...DEFAULT_TARIFF_CONFIG, ...JSON.parse(local) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_TARIFF_CONFIG;
};

export const saveTariffConfig = async (config: TariffConfig): Promise<void> => {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(config));
  try {
    await supabase
      .from('app_settings')
      .upsert({ key: 'tariff_config', value: config, updated_at: new Date().toISOString() });
  } catch {
    // localStorage already updated
  }
};

// --- GEOFENCES ---
export const fetchGeofences = async (): Promise<GeofenceZone[]> => {
  try {
    const { data, error } = await supabase
      .from('geofences')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) {
      localStorage.setItem(GEOFENCES_STORAGE_KEY, JSON.stringify(data));
      return data as GeofenceZone[];
    }
  } catch {
    // fallback
  }

  try {
    const local = localStorage.getItem(GEOFENCES_STORAGE_KEY);
    if (local) return JSON.parse(local) as GeofenceZone[];
  } catch {
    // ignore
  }
  return [];
};

export const saveGeofence = async (
  zone: Omit<GeofenceZone, 'id' | 'created_at'>
): Promise<GeofenceZone> => {
  const localItem: GeofenceZone = {
    ...zone,
    id: `geo-${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase.from('geofences').insert(zone).select().single();
    if (!error && data) {
      return data as GeofenceZone;
    }
  } catch {
    // fallback to localStorage
  }

  const existing = await fetchGeofences();
  const next = [localItem, ...existing];
  localStorage.setItem(GEOFENCES_STORAGE_KEY, JSON.stringify(next));
  return localItem;
};

export const deleteGeofence = async (id: string): Promise<void> => {
  try {
    await supabase.from('geofences').delete().eq('id', id);
  } catch {
    // fallback
  }
  try {
    const existing: GeofenceZone[] = JSON.parse(
      localStorage.getItem(GEOFENCES_STORAGE_KEY) || '[]'
    );
    localStorage.setItem(
      GEOFENCES_STORAGE_KEY,
      JSON.stringify(existing.filter((z) => z.id !== id))
    );
  } catch {
    // ignore
  }
};

export const findMatchingGeofenceSurcharge = (
  lat: number,
  lng: number,
  zones: GeofenceZone[]
): number => {
  let maxSurcharge = 0;
  for (const zone of zones) {
    if (!zone.active) continue;
    const dist = calculateHaversineKm(lat, lng, zone.center_lat, zone.center_lng);
    if (dist <= zone.radius_km && zone.surcharge_percent > maxSurcharge) {
      maxSurcharge = zone.surcharge_percent;
    }
  }
  return maxSurcharge;
};

// --- SUPPORT TICKETS (Disputas, Objetos Perdidos, Reembolsos) ---
export const fetchSupportTickets = async (userId?: string): Promise<SupportTicket[]> => {
  try {
    let query = supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false });
    if (userId) {
      query = query.eq('user_id', userId);
    }
    const { data, error } = await query;
    if (!error && data) {
      return data as SupportTicket[];
    }
  } catch {
    // fallback
  }

  try {
    const local: SupportTicket[] = JSON.parse(
      localStorage.getItem(TICKETS_STORAGE_KEY) || '[]'
    );
    return userId ? local.filter((t) => t.user_id === userId) : local;
  } catch {
    return [];
  }
};

export const createSupportTicket = async (
  ticket: Omit<SupportTicket, 'id' | 'created_at' | 'status'>
): Promise<SupportTicket> => {
  const newTicket: SupportTicket = {
    ...ticket,
    id: `tkt-${Date.now()}`,
    status: 'open',
    created_at: new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({ ...ticket, status: 'open' })
      .select()
      .single();
    if (!error && data) return data as SupportTicket;
  } catch {
    // fallback
  }

  try {
    const existing: SupportTicket[] = JSON.parse(
      localStorage.getItem(TICKETS_STORAGE_KEY) || '[]'
    );
    localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify([newTicket, ...existing]));
  } catch {
    // ignore
  }
  return newTicket;
};

export const updateSupportTicketStatus = async (
  id: string,
  status: SupportTicket['status'],
  refundAmount?: number
): Promise<void> => {
  try {
    await supabase
      .from('support_tickets')
      .update({ status, ...(refundAmount !== undefined ? { refund_amount: refundAmount } : {}) })
      .eq('id', id);
  } catch {
    // fallback
  }

  try {
    const existing: SupportTicket[] = JSON.parse(
      localStorage.getItem(TICKETS_STORAGE_KEY) || '[]'
    );
    const updated = existing.map((t) =>
      t.id === id ? { ...t, status, ...(refundAmount !== undefined ? { refund_amount: refundAmount } : {}) } : t
    );
    localStorage.setItem(TICKETS_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
};

// --- TRUSTED CONTACTS ---
export const getLocalTrustedContacts = (userId: string): TrustedContact[] => {
  try {
    return JSON.parse(localStorage.getItem(`zippy_trusted_contacts_${userId}`) || '[]');
  } catch {
    return [];
  }
};

export const saveTrustedContacts = async (
  userId: string,
  contacts: TrustedContact[]
): Promise<void> => {
  localStorage.setItem(`zippy_trusted_contacts_${userId}`, JSON.stringify(contacts));
  await updateProfileResilient(userId, {}, { trusted_contacts: contacts });
};

// --- WALLET BALANCE (Local + DB sync) ---
export const getLocalWalletBalance = (userId: string, dbBalance?: number): number => {
  if (typeof dbBalance === 'number' && !Number.isNaN(dbBalance)) return dbBalance;
  try {
    const val = localStorage.getItem(`zippy_wallet_${userId}`);
    return val ? Number(val) : 0;
  } catch {
    return 0;
  }
};

export const saveWalletBalance = async (userId: string, balance: number): Promise<void> => {
  localStorage.setItem(`zippy_wallet_${userId}`, String(balance));
  await updateProfileResilient(userId, {}, { wallet_balance: balance });
};
