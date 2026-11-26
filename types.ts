
export enum RideStatus {
  IDLE = 'IDLE',
  REQUESTING = 'REQUESTING',
  NEGOTIATING = 'NEGOTIATING',
  ACCEPTED = 'ACCEPTED',
  ARRIVED = 'ARRIVED',
  PASSENGER_READY = 'PASSENGER_READY',
  IN_PROGRESS = 'IN_PROGRESS',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  COMPLETED = 'COMPLETED',
  RATING = 'RATING',
  SCHEDULED = 'SCHEDULED',
  CANCELLED = 'CANCELLED',
  ARCHIVED = 'ARCHIVED'
}

export enum UserRole {
  PASSENGER = 'PASSENGER',
  DRIVER = 'DRIVER',
  ADMIN = 'ADMIN',
  PROVIDER = 'PROVIDER'
}

export type ProviderCategory = 'GRUA' | 'AMBULANCIA' | 'SEGURO' | 'MECANICO' | 'LLANTERA';

export type VehicleCategory = 'ECONOMICO' | 'CONFORT' | 'XL';

export type PaymentMethodType = 'cash' | 'card' | 'wallet';

export interface TariffConfig {
  baseFare: number;
  costPerKm: number;
  costPerMin: number;
  minFare: number;
  commissionRate: number; // percentage e.g. 15
  surgeMultiplier: number; // e.g. 1.0
  categoryMultipliers: Record<VehicleCategory, number>;
}

export interface GeofenceZone {
  id: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  surcharge_percent: number;
  active: boolean;
  created_at?: string;
}

export interface TrustedContact {
  id: string;
  name: string;
  phone: string;
  relation?: string;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  user_name?: string;
  ride_id?: string;
  category: 'disputa' | 'objeto_perdido' | 'reembolso' | 'soporte';
  subject: string;
  description: string;
  status: 'open' | 'in_review' | 'resolved' | 'refunded';
  refund_amount?: number;
  created_at?: string;
}

export interface Ride {
  id: string;
  passenger_id: string;
  driver_id?: string;
  pickup_label: string;
  destination_label: string;
  price: number;
  status: RideStatus;
  created_at?: string;
  scheduled_for?: string;
  // Security & Lifecycle Fields
  pin_code?: string;
  vehicle_category?: VehicleCategory;
  distance_km?: number;
  estimated_minutes?: number;
  base_fare?: number;
  distance_fare?: number;
  time_fare?: number;
  arrived_at?: string;
  started_at?: string;
  completed_at?: string;
  // SOS Fields
  sos_active?: boolean;
  sos_triggered_by?: string;
  sos_at?: string;
  sos_lat?: number;
  sos_lng?: number;
  // Payment Logic
  is_paid?: boolean;
  payment_confirmed_by_driver?: boolean;
  tip_amount?: number;
  payment_method?: PaymentMethodType;
  total_paid?: number;
  // For history detail & ratings
  driver_name?: string;
  driver_avatar_url?: string;
  rating_given?: number;
  rating_tags?: string[];
  driver_rating_for_passenger?: number;
  // GPS fields (optional for display)
  driver_lat?: number;
  driver_lng?: number;
  // Coordinates
  pickup_lat?: number;
  pickup_lng?: number;
  dest_lat?: number;
  dest_lng?: number;
}

export interface RideRequest {
  pickup: string;
  destination: string;
  price: number;
  distance: number;
  vehicleType: 'basic' | 'comfort';
  vehicleCategory?: VehicleCategory;
  paymentMethod: PaymentMethodType;
  scheduledTime?: string;
  pin?: string;
}

export interface DriverTarifa {
  id: string;
  ride_id?: string;
  driver_id?: string;
  name: string;
  rating: number;
  carModel: string;
  carPlate: string;
  carColor?: string;
  taxiNumber: string;
  price: number;
  eta: number;
  avatarUrl: string;
  distance: number;
  tripsCompleted: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

export interface DriverDocuments {
  license?: string;
  insurance?: string;
  id_card?: string;
  vehicle_registration?: string;
  background_check?: string;
  license_expiry?: string;
  insurance_expiry?: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url?: string;
  rating: number;
  role: string;
  status?: string;
  car_model?: string;
  car_plate?: string;
  car_color?: string;
  taxi_number?: string;
  verification_status?: 'verified' | 'pending' | 'rejected' | 'unverified' | 'suspended';
  is_suspended?: boolean;
  debt_amount?: number;
  wallet_balance?: number;
  documents?: DriverDocuments;
  trusted_contacts?: TrustedContact[];
  lat?: number;
  lng?: number;
  is_online?: boolean;
  // Payment fields
  card_name?: string;
  card_last4?: string;
  card_expiry?: string;
  card_brand?: string;
  // Saved Addresses
  saved_home?: string;
  saved_work?: string;
  created_at?: string;
}

export interface MapEntity {
  id: string;
  type: 'driver' | 'passenger' | 'provider';
  lat: number;
  lng: number;
  label: string;
  status?: string;
}

export interface DriverApplication {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  email: string;
  car_model: string;
  car_plate: string;
  car_year: string;
  car_color: string;
  selfie_url?: string;
  license_photo_url?: string;
  ine_front_url?: string;
  car_photo_front_url?: string;
  car_photo_back_url?: string;
  circulation_card_url?: string;
  insurance_policy_url?: string;
  background_check_url?: string;
  license_expiry?: string;
  insurance_expiry?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}
