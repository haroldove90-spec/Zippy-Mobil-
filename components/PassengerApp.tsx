import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Menu, Navigation, MessageSquare, ShieldCheck, MapPin, Loader2, Calendar, Clock, Lock,
  Eye, EyeOff, Star, BellRing, X, ChevronRight, Check, History, CreditCard, User,
  ArrowLeft, Save, Plus, Wallet, TrendingUp, Truck, Wrench, Siren, Disc, Briefcase,
  HeartPulse, LogOut, DollarSign, Share2, Phone, Award, CheckCircle2, Camera, ThumbsUp, CheckCircle, Car,
  Gift, ChevronDown, ChevronUp, XCircle, Trash2, Home, Building2, AlertCircle, RefreshCw, Receipt, Bell, RotateCcw, Banknote,
  LifeBuoy, FileText, Zap, Coins, KeyRound, Tag, Users, Edit3
} from 'lucide-react';
import {
  RideStatus,
  DriverTarifa,
  Ride,
  MapEntity,
  VehicleCategory,
  PaymentMethodType,
  TariffConfig,
  GeofenceZone,
  TrustedContact,
  SupportTicket,
} from '../types';
import MapVisual from './MapVisual';
import Drawer from './Drawer';
import AssistantModal from './AssistantModal';
import EmergencyDirectory from './EmergencyDirectory';
import OffersList from './OffersList';
import DriverRegistration from './DriverRegistration';
import ChatModal from './ChatModal';
import NotificationToast, { NotificationType } from './NotificationToast';
import ApplicationStatus from './ApplicationStatus';
import { supabase } from '../services/supabase';
import { getSmartPriceAdvice } from '../services/geminiService';
import {
  ACTIVE_RIDE_STATUSES,
  DEFAULT_TARIFF_CONFIG,
  PASSENGER_RATING_TAGS,
  calculateFareQuote,
  calculateHaversineKm,
  createSupportTicket,
  enrichRideWithLocalMeta,
  fetchGeofences,
  fetchSupportTickets,
  fetchTariffConfig,
  findMatchingGeofenceSurcharge,
  generateSecurityPin,
  getLocalTrustedContacts,
  getLocalWalletBalance,
  insertRideResilient,
  saveTrustedContacts,
  saveWalletBalance,
  updateProfileResilient,
  updateRideResilient,
  FareQuote,
} from '../services/rideService';
import { appAlert, appConfirm } from '../services/uiDialogs';

declare var google: any;

interface PassengerAppProps {
  onBack: () => void;
  onOpenProvider?: () => void;
}

const SOUNDS = {
  driverFound: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  driverArrived: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
  message: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',
  sos: 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3',
  cashRegister: 'https://assets.mixkit.co/active_storage/sfx/2004/2004-preview.mp3',
  cancel: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
};

const VEHICLE_CATEGORIES: { id: VehicleCategory; label: string; desc: string; seats: string }[] = [
  { id: 'ECONOMICO', label: 'Económico', desc: 'Tarifa justa', seats: '4' },
  { id: 'CONFORT', label: 'Confort', desc: 'Autos recientes', seats: '4' },
  { id: 'XL', label: 'Zippy XL', desc: 'Más espacio', seats: '6' },
];

const speak = (text: string): void => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
};

const PassengerApp: React.FC<PassengerAppProps> = ({ onBack, onOpenProvider }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'home' | 'profile' | 'history' | 'payment' | 'services'>('home');
  const [status, setStatus] = useState<RideStatus>(RideStatus.IDLE);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [driverRegOpen, setDriverRegOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [showArrivalOverlay, setShowArrivalOverlay] = useState(false);

  const [sosActive, setSosActive] = useState(false);

  // SEPARATED STEP 6 (COBRO) & STEP 7 (CALIFICACIÓN + PROPINA)
  const [showReceiptModal, setShowReceiptModal] = useState(false); // Paso 6: Cobro
  const [showRatingModal, setShowRatingModal] = useState(false);   // Paso 7: Evaluación y Propina
  const [finalFare, setFinalFare] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('cash');
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory>('ECONOMICO');
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [rating, setRating] = useState<number>(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const [toast, setToast] = useState<{ msg: string; type: NotificationType; visible: boolean }>({
    msg: '',
    type: 'info',
    visible: false,
  });

  const [driverApplicationStatus, setDriverApplicationStatus] = useState<string | null>(null);
  const [driverStatusViewOpen, setDriverStatusViewOpen] = useState(false);

  const [availableTarifas, setAvailableTarifas] = useState<DriverTarifa[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<(DriverTarifa & { phone?: string }) | null>(null);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [viewingDriver, setViewingDriver] = useState<DriverTarifa | null>(null);
  const [nearbyDrivers, setNearbyDrivers] = useState<MapEntity[]>([]);

  // COORDENADAS & GPS REAL
  const [passengerLocation, setPassengerLocation] = useState<[number, number] | undefined>(undefined);
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(0);
  const [driverLocation, setDriverLocation] = useState<[number, number] | undefined>(undefined);

  const [destinationCoords, setDestinationCoords] = useState<[number, number] | undefined>(undefined);
  const [routeStart, setRouteStart] = useState<[number, number] | undefined>(undefined);
  const [routeEnd, setRouteEnd] = useState<[number, number] | undefined>(undefined);

  // Dynamic Tariffs & Geofences
  const [tariffConfig, setTariffConfig] = useState<TariffConfig>(DEFAULT_TARIFF_CONFIG);
  const [geofences, setGeofences] = useState<GeofenceZone[]>([]);
  const [fareQuote, setFareQuote] = useState<FareQuote | null>(null);

  // History, Scheduled & Receipts
  const [history, setHistory] = useState<Ride[]>([]);
  const [scheduledRides, setScheduledRides] = useState<Ride[]>([]);
  const [historyTab, setHistoryTab] = useState<'past' | 'scheduled'>('past');
  const [selectedReceiptRide, setSelectedReceiptRide] = useState<Ride | null>(null);

  // Wallet, Coupons, Support & Trusted Contacts
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [couponCode, setCouponCode] = useState('');
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [trustedContacts, setTrustedContacts] = useState<TrustedContact[]>([]);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');

  const [userProfile, setUserProfile] = useState({
    id: '',
    name: '',
    email: '',
    phone: '',
    avatar_url: '',
    card_name: '',
    card_last4: '',
    card_expiry: '',
    card_brand: '',
    saved_home: '',
    saved_work: '',
    is_suspended: false,
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Places Autocomplete Refs
  const pickupInputRef = useRef<HTMLInputElement>(null);
  const destInputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [calculatedPrice, setCalculatedPrice] = useState<number>(0);
  const [smartAdvice, setSmartAdvice] = useState<{ advice: string; prob: number } | null>(null);

  const activeRideRef = useRef<Ride | null>(null);
  useEffect(() => {
    activeRideRef.current = activeRide;
  }, [activeRide]);

  const playSound = (soundUrl: string, loop = false) => {
    const audio = new Audio(soundUrl);
    audio.loop = loop;
    audio.play().catch((e) => console.warn('Audio play failed (interaction needed):', e));
    return audio;
  };

  const showToast = useCallback((msg: string, type: NotificationType) => {
    setToast({ msg, type, visible: true });
  }, []);

  // --- COMPLETE MEMORY CLEANUP ---
  const resetRideState = useCallback(() => {
    setActiveRide(null);
    setStatus(RideStatus.IDLE);
    setAvailableTarifas([]);
    setSelectedDriver(null);
    setDriverLocation(undefined);
    setRouteStart(undefined);
    setRouteEnd(undefined);
    setDestination('');
    setDestinationCoords(undefined);
    setFareQuote(null);
    setShowArrivalOverlay(false);
    setShowReceiptModal(false);
    setShowRatingModal(false);
    setTipAmount(0);
    setRating(0);
    setSelectedTags([]);
    setSosActive(false);
    setSmartAdvice(null);
  }, []);

  // --- AUTO-COMPLETE ADDRESS & REVERSE GEOCODE ---
  const reverseGeocode = useCallback((lat: number, lng: number) => {
    if (typeof google === 'undefined') return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results: any, geocodeStatus: any) => {
      if (geocodeStatus === 'OK' && results?.[0]) {
        const address = results[0].formatted_address;
        const simpleAddress = address.split(',').slice(0, 2).join(',');
        setPickup(simpleAddress);
      }
    });
  }, []);

  const geocodeAddress = useCallback((address: string, isPickup: boolean) => {
    if (!address.trim() || typeof google === 'undefined') return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address }, (results: any, geocodeStatus: any) => {
      if (geocodeStatus === 'OK' && results?.[0]?.geometry?.location) {
        const lat = results[0].geometry.location.lat();
        const lng = results[0].geometry.location.lng();
        if (isPickup) {
          setPassengerLocation([lat, lng]);
        } else {
          setDestinationCoords([lat, lng]);
        }
      }
    });
  }, []);

  // Attach Google Places Autocomplete when in IDLE home view
  useEffect(() => {
    if (!isAuthenticated || view !== 'home' || status !== RideStatus.IDLE) return;
    if (typeof google === 'undefined' || !google.maps?.places) return;

    let pickupAuto: any = null;
    let destAuto: any = null;

    if (pickupInputRef.current) {
      pickupAuto = new google.maps.places.Autocomplete(pickupInputRef.current, {
        fields: ['formatted_address', 'geometry', 'name'],
      });
      pickupAuto.addListener('place_changed', () => {
        const place = pickupAuto.getPlace();
        if (place?.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          setPassengerLocation([lat, lng]);
          setPickup(place.name || place.formatted_address || pickupInputRef.current?.value || '');
        }
      });
    }

    if (destInputRef.current) {
      destAuto = new google.maps.places.Autocomplete(destInputRef.current, {
        fields: ['formatted_address', 'geometry', 'name'],
      });
      destAuto.addListener('place_changed', () => {
        const place = destAuto.getPlace();
        if (place?.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          setDestinationCoords([lat, lng]);
          setDestination(place.name || place.formatted_address || destInputRef.current?.value || '');
        }
      });
    }

    return () => {
      if (pickupAuto && google.maps?.event) google.maps.event.clearInstanceListeners(pickupAuto);
      if (destAuto && google.maps?.event) google.maps.event.clearInstanceListeners(destAuto);
    };
  }, [isAuthenticated, view, status]);

  // --- LOAD TARIFFS & GEOFENCES ---
  useEffect(() => {
    fetchTariffConfig().then(setTariffConfig);
    fetchGeofences().then(setGeofences);
  }, []);

  // --- 1. ACTIVACIÓN DE GPS REAL ---
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      showToast('Tu dispositivo no soporta GPS.', 'error');
      return;
    }

    const geoOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    };

    const handleSuccess = (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = position.coords;
      setPassengerLocation((prev) => {
        if (!prev) {
          reverseGeocode(latitude, longitude);
          return [latitude, longitude];
        }
        const dist = Math.abs(prev[0] - latitude) + Math.abs(prev[1] - longitude);
        return dist > 0.0002 ? [latitude, longitude] : prev;
      });
      setGpsAccuracy(accuracy);
    };

    const handleError = (error: GeolocationPositionError) => {
      if (error.code === 1) showToast('Permiso de ubicación denegado.', 'error');
      if (error.code === 3) showToast('Buscando señal GPS...', 'warning');
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, geoOptions);
    const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, geoOptions);

    return () => navigator.geolocation.clearWatch(watchId);
  }, [reverseGeocode, showToast]);

  // --- NEARBY ONLINE DRIVERS IN IDLE ---
  useEffect(() => {
    if (!isAuthenticated || status !== RideStatus.IDLE) {
      setNearbyDrivers([]);
      return;
    }

    const fetchOnlineDrivers = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, lat, lng, car_model, status')
        .eq('role', 'DRIVER')
        .eq('status', 'online')
        .not('lat', 'is', null);

      if (data) {
        setNearbyDrivers(
          data
            .filter((d: any) => d.lat && d.lng)
            .map((d: any) => ({
              id: d.id,
              type: 'driver' as const,
              lat: d.lat,
              lng: d.lng,
              label: `${d.full_name || 'Zippy'} (${d.car_model || 'Disponible'})`,
              status: 'online',
            }))
        );
      }
    };

    fetchOnlineDrivers();
    const interval = setInterval(fetchOnlineDrivers, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, status]);

  // --- FETCH HISTORY & SCHEDULED ---
  const loadPassengerHistory = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('rides')
      .select('*')
      .eq('passenger_id', uid)
      .in('status', ['COMPLETED', 'ARCHIVED', 'CANCELLED'])
      .order('created_at', { ascending: false });
    if (data) setHistory((data as Ride[]).map(enrichRideWithLocalMeta));

    const { data: sched } = await supabase
      .from('rides')
      .select('*')
      .eq('passenger_id', uid)
      .eq('status', 'SCHEDULED')
      .order('scheduled_for', { ascending: true });
    if (sched) setScheduledRides((sched as Ride[]).map(enrichRideWithLocalMeta));
  }, []);

  useEffect(() => {
    if ((view === 'history' || view === 'payment') && userProfile.id) {
      loadPassengerHistory(userProfile.id);
    }
    if (view === 'services' && userProfile.id) {
      fetchSupportTickets(userProfile.id).then(setSupportTickets);
    }
  }, [view, userProfile.id, loadPassengerHistory]);

  // --- REAL QUOTE CALCULATION (Distance, ETA, Tariff, Category, Geofence) ---
  useEffect(() => {
    if (status === RideStatus.IDLE && passengerLocation && destinationCoords) {
      const dist = calculateHaversineKm(
        passengerLocation[0],
        passengerLocation[1],
        destinationCoords[0],
        destinationCoords[1]
      );
      const surcharge = findMatchingGeofenceSurcharge(
        passengerLocation[0],
        passengerLocation[1],
        geofences
      );
      const quote = calculateFareQuote(dist, tariffConfig, vehicleCategory, surcharge);
      setFareQuote(quote);
      setCalculatedPrice(quote.totalFare);
    }
  }, [passengerLocation, destinationCoords, status, tariffConfig, vehicleCategory, geofences]);

  // Trigger AI Smart Price Advice gently when destination + price change
  useEffect(() => {
    if (status !== RideStatus.IDLE || !destination.trim() || calculatedPrice <= 0) return;
    const timer = setTimeout(async () => {
      try {
        const res = await getSmartPriceAdvice(pickup || 'Mi ubicación', destination, calculatedPrice);
        if (res?.advice) setSmartAdvice({ advice: res.advice, prob: res.successProbability });
      } catch {
        // non-blocking
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [calculatedPrice, destination, pickup, status]);

  const fetchDriverProfile = useCallback(async (driverId: string, price: number, rideId: string) => {
    const { data: driverData } = await supabase.from('profiles').select('*').eq('id', driverId).single();
    const drvInfo: DriverTarifa & { phone?: string } = {
      id: 'assigned-' + driverId,
      ride_id: rideId,
      driver_id: driverId,
      name: driverData?.full_name || 'Conductor Zippy',
      rating: driverData?.rating || 5.0,
      carModel: driverData?.car_model || 'Vehículo',
      carPlate: driverData?.car_plate || '---',
      carColor: driverData?.car_color || 'Blanco',
      taxiNumber: driverData?.taxi_number || '---',
      price,
      eta: 5,
      avatarUrl:
        driverData?.avatar_url ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(driverData?.full_name || 'Zippy')}&background=003A70&color=fff`,
      distance: 0,
      tripsCompleted: driverData?.trips_completed || 0,
      phone: driverData?.phone,
    };
    setSelectedDriver(drvInfo);
  }, []);

  // --- CRITICAL RULE #2: ALWAYS CHECK ACTIVE RIDE FOR UID ON PAGE LOAD OR LOGIN ---
  const restoreActiveRideForUser = useCallback(
    async (userId: string) => {
      const { data: activeRides } = await supabase
        .from('rides')
        .select('*')
        .eq('passenger_id', userId)
        .in('status', [...ACTIVE_RIDE_STATUSES, RideStatus.COMPLETED])
        .order('created_at', { ascending: false })
        .limit(1);

      const latest = activeRides?.[0] ? enrichRideWithLocalMeta(activeRides[0] as Ride) : null;
      if (!latest) {
        setActiveRide(null);
        setStatus(RideStatus.IDLE);
        return;
      }

      // If truly finished (COMPLETED and paid, or ARCHIVED/CANCELLED) -> clean home screen
      if (
        latest.status === RideStatus.ARCHIVED ||
        latest.status === RideStatus.CANCELLED ||
        (latest.status === RideStatus.COMPLETED && latest.is_paid)
      ) {
        setActiveRide(null);
        setStatus(RideStatus.IDLE);
        return;
      }

      // Restore active ride state cleanly!
      setActiveRide(latest);
      setStatus(latest.status as RideStatus);
      if (latest.payment_method) setPaymentMethod(latest.payment_method);
      if (latest.vehicle_category) setVehicleCategory(latest.vehicle_category);
      setPickup(latest.pickup_label || '');
      setDestination(latest.destination_label || '');
      setCalculatedPrice(latest.price);
      setFinalFare(latest.price);
      if (latest.dest_lat && latest.dest_lng) {
        setDestinationCoords([latest.dest_lat, latest.dest_lng]);
      }
      if (latest.driver_lat && latest.driver_lng) {
        setDriverLocation([latest.driver_lat, latest.driver_lng]);
      }
      if (latest.status === RideStatus.ARRIVED) {
        setShowArrivalOverlay(true);
      }
      if (latest.status === RideStatus.PAYMENT_PENDING || (latest.status === RideStatus.COMPLETED && !latest.is_paid)) {
        setShowReceiptModal(true);
        setShowRatingModal(false);
      }
      if (latest.status === RideStatus.RATING) {
        setShowReceiptModal(false);
        setShowRatingModal(true);
      }
      if (
        latest.driver_id &&
        [
          RideStatus.ACCEPTED,
          RideStatus.ARRIVED,
          RideStatus.PASSENGER_READY,
          RideStatus.IN_PROGRESS,
          RideStatus.PAYMENT_PENDING,
          RideStatus.RATING,
          RideStatus.COMPLETED,
        ].includes(latest.status)
      ) {
        fetchDriverProfile(latest.driver_id, latest.price, latest.id);
      }
    },
    [fetchDriverProfile]
  );

  const hydrateUserProfile = useCallback(
    async (userId: string) => {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (!profile || (profile.role && profile.role !== 'PASSENGER')) return;

      if (profile.is_suspended) {
        showToast('Tu cuenta se encuentra suspendida. Contacta a soporte.', 'error');
      }

      setUserProfile({
        id: userId,
        name: profile.full_name || 'Usuario Zippy',
        email: profile.email || '',
        phone: profile.phone || '',
        avatar_url: profile.avatar_url || '',
        card_name: profile.card_name || '',
        card_last4: profile.card_last4 || '',
        card_expiry: profile.card_expiry || '',
        card_brand: profile.card_brand || '',
        saved_home: profile.saved_home || '',
        saved_work: profile.saved_work || '',
        is_suspended: Boolean(profile.is_suspended),
      });
      setDriverApplicationStatus(profile.verification_status || 'unverified');
      setWalletBalance(getLocalWalletBalance(userId, profile.wallet_balance));
      setTrustedContacts(
        Array.isArray(profile.trusted_contacts)
          ? (profile.trusted_contacts as TrustedContact[])
          : getLocalTrustedContacts(userId)
      );
      setIsAuthenticated(true);
      await restoreActiveRideForUser(userId);
    },
    [restoreActiveRideForUser, showToast]
  );

  // --- SESSION RECOVERY ON MOUNT ---
  useEffect(() => {
    const checkSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.id) {
          await hydrateUserProfile(session.user.id);
        }
      } catch (error) {
        console.error('Error restoring session:', error);
      }
    };
    checkSession();
  }, [hydrateUserProfile]);

  // --- CENTRALIZED REALTIME UPDATE HANDLER ---
  const handleRideUpdate = useCallback(
    (rawRide: any) => {
      if (!rawRide) return;
      const updatedRide = enrichRideWithLocalMeta(rawRide as Ride);
      const newStatus = updatedRide.status;
      const prevRide = activeRideRef.current;

      if (updatedRide.driver_lat && updatedRide.driver_lng) {
        if (updatedRide.driver_lat !== 0 && updatedRide.driver_lng !== 0) {
          setDriverLocation([updatedRide.driver_lat, updatedRide.driver_lng]);
        }
      }

      if (prevRide?.status !== newStatus || prevRide?.is_paid !== updatedRide.is_paid) {
        setActiveRide(updatedRide);

        if (newStatus === RideStatus.ACCEPTED) {
          setAvailableTarifas([]);
          if (updatedRide.driver_id) {
            fetchDriverProfile(updatedRide.driver_id, updatedRide.price, updatedRide.id);
          }
          setStatus(RideStatus.ACCEPTED);
          playSound(SOUNDS.driverFound);
          speak('Conductor asignado. Tu Zippy va en camino.');
          showToast('¡Conductor asignado! Tu Zippy va en camino.', 'success');
        } else if (newStatus === RideStatus.ARRIVED) {
          setStatus(RideStatus.ARRIVED);
          if (prevRide?.status !== RideStatus.ARRIVED && prevRide?.status !== RideStatus.PASSENGER_READY) {
            setShowArrivalOverlay(true);
            playSound(SOUNDS.driverArrived);
            speak('Tu conductor ha llegado por ti.');
          }
        } else if (newStatus === RideStatus.PASSENGER_READY) {
          setStatus(RideStatus.PASSENGER_READY);
          setShowArrivalOverlay(false);
        } else if (newStatus === RideStatus.IN_PROGRESS) {
          setStatus(RideStatus.IN_PROGRESS);
          setShowArrivalOverlay(false);
          if (prevRide?.status !== RideStatus.IN_PROGRESS) {
            speak('Iniciando viaje a tu destino.');
            showToast('¡Viaje en curso!', 'info');
          }
        } else if (newStatus === RideStatus.PAYMENT_PENDING) {
          // STEP 6: PAYMENT ONLY
          setStatus(RideStatus.PAYMENT_PENDING);
          setFinalFare(updatedRide.price);
          if (updatedRide.is_paid) {
            // Driver confirmed cash payment -> advance to Step 7 Rating & Tip!
            setShowReceiptModal(false);
            setShowRatingModal(true);
            playSound(SOUNDS.cashRegister);
            speak('Pago confirmado. Ahora puedes calificar tu viaje.');
          } else {
            setShowReceiptModal(true);
            setShowRatingModal(false);
            playSound(SOUNDS.cashRegister);
            speak('Hemos llegado a tu destino. Por favor confirma tu pago.');
          }
        } else if (newStatus === RideStatus.RATING) {
          // STEP 7: RATING & TIP ONLY
          setStatus(RideStatus.RATING);
          setShowReceiptModal(false);
          setShowRatingModal(true);
        } else if (newStatus === RideStatus.COMPLETED) {
          if (!updatedRide.is_paid) {
            setStatus(RideStatus.PAYMENT_PENDING);
            setFinalFare(updatedRide.price);
            setShowReceiptModal(true);
            playSound(SOUNDS.cashRegister);
            speak('Hemos llegado a tu destino. Por favor realiza el pago.');
          } else if (prevRide?.status === RideStatus.RATING) {
            resetRideState();
            showToast('¡Viaje completado! Gracias por viajar con Zippy.', 'success');
          } else {
            // Paid directly (e.g. driver confirmed cash), open Step 7 rating modal before clearing
            setStatus(RideStatus.RATING);
            setShowReceiptModal(false);
            setShowRatingModal(true);
          }
        } else if (newStatus === RideStatus.ARCHIVED) {
          resetRideState();
          showToast('Viaje completado.', 'success');
        } else if (newStatus === RideStatus.CANCELLED) {
          playSound(SOUNDS.cancel);
          speak('El viaje ha sido cancelado.');
          resetRideState();
          showToast('El viaje fue cancelado.', 'error');
        }
      } else {
        setActiveRide(updatedRide);
      }
    },
    [fetchDriverProfile, resetRideState, showToast]
  );

  // --- REALTIME SUBSCRIPTION + BACKUP POLLING ---
  useEffect(() => {
    if (!activeRide?.id) return;
    const activeRideId = activeRide.id;

    const statusChannel = supabase
      .channel(`ride-tracking-${activeRideId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${activeRideId}`,
        },
        (payload) => {
          handleRideUpdate(payload.new);
        }
      )
      .subscribe();

    const pollingInterval = setInterval(async () => {
      const { data } = await supabase.from('rides').select('*').eq('id', activeRideId).single();
      if (data) handleRideUpdate(data);
    }, 4000);

    const offersChannel = supabase
      .channel(`ride-offers-${activeRideId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_offers',
          filter: `ride_id=eq.${activeRideId}`,
        },
        (payload) => {
          const newOffer = payload.new as any;
          playSound(SOUNDS.driverFound);
          speak(`Nueva oferta de ${newOffer.offered_price} pesos.`);
          const mappedTarifa: DriverTarifa = {
            id: newOffer.id,
            ride_id: newOffer.ride_id,
            driver_id: newOffer.driver_id,
            name: newOffer.driver_name,
            rating: newOffer.driver_rating,
            carModel: newOffer.car_model,
            carPlate: newOffer.car_plate,
            taxiNumber: newOffer.taxi_number,
            price: newOffer.offered_price,
            eta: newOffer.eta,
            avatarUrl: newOffer.avatar_url,
            distance: newOffer.distance,
            tripsCompleted: newOffer.trips_completed,
          };
          setAvailableTarifas((prev) => {
            if (prev.some((t) => t.id === mappedTarifa.id)) return prev;
            return [mappedTarifa, ...prev];
          });
          showToast(`Nueva oferta de ${mappedTarifa.name}: $${mappedTarifa.price}`, 'success');
        }
      )
      .subscribe();

    const msgChannel = supabase
      .channel(`passenger_messages:${userProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `ride_id=eq.${activeRideId}`,
        },
        (payload) => {
          const msg = payload.new as any;
          if (msg.sender_id !== userProfile.id) {
            playSound(SOUNDS.message);
            speak('Tienes un nuevo mensaje del conductor.');
            showToast('Nuevo mensaje del conductor', 'message');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(statusChannel);
      supabase.removeChannel(offersChannel);
      supabase.removeChannel(msgChannel);
      clearInterval(pollingInterval);
    };
  }, [activeRide?.id, userProfile.id, handleRideUpdate, showToast]);

  // --- MAP ROUTE LOGIC ---
  useEffect(() => {
    if ((status === RideStatus.IDLE || status === RideStatus.REQUESTING) && passengerLocation && destinationCoords) {
      setRouteStart(passengerLocation);
      setRouteEnd(destinationCoords);
      return;
    }
    if (
      (status === RideStatus.ACCEPTED || status === RideStatus.ARRIVED || status === RideStatus.PASSENGER_READY) &&
      driverLocation &&
      passengerLocation
    ) {
      setRouteStart(driverLocation);
      setRouteEnd(passengerLocation);
      return;
    }
    if (status === RideStatus.IN_PROGRESS && driverLocation && destinationCoords) {
      setRouteStart(driverLocation);
      setRouteEnd(destinationCoords);
      return;
    }
    if (status === RideStatus.IDLE && !destinationCoords) {
      setRouteStart(undefined);
      setRouteEnd(undefined);
    }
  }, [status, driverLocation, passengerLocation, destinationCoords]);

  // Dynamic ETA calculation
  const getLiveDriverEta = (): number => {
    if (!driverLocation) return selectedDriver?.eta || 4;
    const target = status === RideStatus.IN_PROGRESS ? destinationCoords : passengerLocation;
    if (!target) return selectedDriver?.eta || 4;
    const km = calculateHaversineKm(driverLocation[0], driverLocation[1], target[0], target[1]);
    return Math.max(Math.round((km / 26) * 60), 1);
  };

  // --- ACTIONS ---
  const handlePickupPinDragEnd = useCallback(
    (coords: [number, number]) => {
      setPassengerLocation(coords);
      reverseGeocode(coords[0], coords[1]);
      showToast('Punto de recogida ajustado en el mapa', 'info');
    },
    [reverseGeocode, showToast]
  );

  const handlePassengerReady = async () => {
    if (!activeRide) return;
    setLoading(true);
    try {
      await updateRideResilient(activeRide.id, { status: RideStatus.PASSENGER_READY });
      setStatus(RideStatus.PASSENGER_READY);
      setShowArrivalOverlay(false);
      showToast('Has notificado al conductor que vas saliendo.', 'success');
    } catch (err: any) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestRide = async () => {
    if (userProfile.is_suspended) {
      showToast('Tu cuenta está suspendida. No puedes solicitar viajes.', 'error');
      return;
    }
    if (!destination.trim()) {
      showToast('Por favor indica un destino.', 'warning');
      return;
    }
    if (!passengerLocation) {
      showToast('Esperando señal GPS... Revisa tu ubicación.', 'warning');
      return;
    }

    // Resolve destination coordinates if user typed without picking autocomplete suggestion
    const resolvedDestCoords: [number, number] = destinationCoords || [
      passengerLocation[0] + 0.018,
      passengerLocation[1] + 0.014,
    ];

    const dist = calculateHaversineKm(
      passengerLocation[0],
      passengerLocation[1],
      resolvedDestCoords[0],
      resolvedDestCoords[1]
    );
    const surcharge = findMatchingGeofenceSurcharge(passengerLocation[0], passengerLocation[1], geofences);
    const quote = fareQuote || calculateFareQuote(dist, tariffConfig, vehicleCategory, surcharge);
    const realPrice = calculatedPrice > 0 ? calculatedPrice : quote.totalFare;

    if (paymentMethod === 'wallet' && walletBalance < realPrice) {
      showToast('Saldo insuficiente en Billetera. Recarga o cambia método de pago.', 'error');
      return;
    }

    const pinCode = generateSecurityPin();
    setLoading(true);
    try {
      const corePayload = {
        passenger_id: userProfile.id,
        pickup_label: pickup || 'Mi Ubicación',
        destination_label: destination,
        price: realPrice,
        status: RideStatus.REQUESTING,
        pickup_lat: passengerLocation[0],
        pickup_lng: passengerLocation[1],
        dest_lat: resolvedDestCoords[0],
        dest_lng: resolvedDestCoords[1],
        payment_method: paymentMethod === 'wallet' ? 'card' : paymentMethod,
      };

      const extendedPayload = {
        pin_code: pinCode,
        vehicle_category: vehicleCategory,
        distance_km: quote.distanceKm,
        estimated_minutes: quote.estimatedMinutes,
        base_fare: quote.baseFare,
        distance_fare: quote.distanceFare,
        time_fare: quote.timeFare,
        payment_method: paymentMethod,
      };

      const { data, error } = await insertRideResilient(corePayload, extendedPayload);
      if (error || !data) throw new Error(error?.message || 'Error al crear viaje');

      setActiveRide(data);
      setStatus(RideStatus.REQUESTING);
      setAvailableTarifas([]);
      setCalculatedPrice(realPrice);
      setDestinationCoords(resolvedDestCoords);
      showToast(`Buscando Zippy (${vehicleCategory}) • PIN: ${pinCode}`, 'info');
    } catch (err: any) {
      console.error(err);
      showToast('Error al solicitar: ' + (err.message || 'Verifica tu conexión'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptTarifa = async (tarifa: DriverTarifa) => {
    let driverPhone = '';
    if (tarifa.driver_id) {
      const { data } = await supabase.from('profiles').select('phone, car_color').eq('id', tarifa.driver_id).single();
      if (data) {
        driverPhone = data.phone || '';
        tarifa.carColor = data.car_color || tarifa.carColor;
      }
    }
    setSelectedDriver({ ...tarifa, phone: driverPhone });
    setLoading(true);
    try {
      if (activeRide?.id) {
        await updateRideResilient(activeRide.id, {
          status: RideStatus.ACCEPTED,
          driver_id: tarifa.driver_id,
          price: tarifa.price,
        });
      }
      setStatus(RideStatus.ACCEPTED);
      showToast('Has aceptado al conductor.', 'success');
    } catch (err: any) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- STEP 6: CONFIRM PAYMENT ONLY (SEPARATE FROM RATING & TIP) ---
  const handleConfirmPayment = async () => {
    if (!activeRide) return;
    const basePrice = activeRide.price || finalFare;

    if (paymentMethod === 'wallet') {
      if (walletBalance < basePrice) {
        showToast('Saldo insuficiente en Billetera Zippy.', 'error');
        return;
      }
      const nextBalance = Number((walletBalance - basePrice).toFixed(2));
      setWalletBalance(nextBalance);
      await saveWalletBalance(userProfile.id, nextBalance);
    }

    setLoading(true);
    try {
      const { error } = await updateRideResilient(
        activeRide.id,
        {
          is_paid: true,
          total_paid: basePrice,
          status: RideStatus.RATING,
        },
        {
          payment_method: paymentMethod,
        }
      );

      if (error) throw new Error(error.message);

      playSound(SOUNDS.cashRegister);
      speak('Pago confirmado. Ahora puedes calificar al conductor y dejar propina si deseas.');
      showToast(`Pago de $${basePrice} confirmado`, 'success');

      setActiveRide((prev) => (prev ? { ...prev, is_paid: true, status: RideStatus.RATING, total_paid: basePrice } : null));
      setStatus(RideStatus.RATING);
      setShowReceiptModal(false);
      setShowRatingModal(true);
    } catch (err: any) {
      showToast('Error al confirmar pago: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- STEP 7: SUBMIT RATING, TAGS & OPTIONAL TIP, THEN CLEAN UP ---
  const handleSubmitRatingAndTip = async (skipTipAndRating = false) => {
    if (!activeRide) return;
    setLoading(true);
    try {
      const basePrice = activeRide.price || finalFare;
      const appliedTip = skipTipAndRating ? 0 : Math.max(0, tipAmount);
      const total = basePrice + appliedTip;
      const finalRating = skipTipAndRating ? 5 : rating || 5;

      if (!skipTipAndRating && appliedTip > 0 && paymentMethod === 'wallet' && walletBalance >= appliedTip) {
        const nextBal = Number((walletBalance - appliedTip).toFixed(2));
        setWalletBalance(nextBal);
        await saveWalletBalance(userProfile.id, nextBal);
      }

      const { error } = await updateRideResilient(
        activeRide.id,
        {
          is_paid: true,
          tip_amount: appliedTip,
          total_paid: total,
          rating_given: finalRating,
          status: RideStatus.COMPLETED,
        },
        {
          rating_tags: skipTipAndRating ? [] : selectedTags,
          completed_at: new Date().toISOString(),
        }
      );

      if (error) throw new Error(error.message);

      if (appliedTip > 0) {
        playSound(SOUNDS.cashRegister);
      }
      speak('Gracias por viajar con Zippy.');
      showToast(
        appliedTip > 0
          ? `¡Gracias! Propina de $${appliedTip} enviada. Viaje cerrado.`
          : '¡Gracias por tu calificación! Viaje completado.',
        'success'
      );

      resetRideState();
    } catch (err: any) {
      showToast('Error al finalizar evaluación: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEarlyPayment = () => {
    setFinalFare(activeRide?.price || 0);
    setShowReceiptModal(true);
  };

  const handleTriggerSOS = async () => {
    if (!activeRide || !passengerLocation) return;
    if (!(await appConfirm('¿ESTÁS EN PELIGRO? Se enviará alerta SOS con tu ubicación en vivo.', 'Alerta SOS'))) return;
    try {
      await updateRideResilient(activeRide.id, {
        sos_active: true,
        sos_triggered_by: userProfile.id,
        sos_at: new Date().toISOString(),
        sos_lat: passengerLocation[0],
        sos_lng: passengerLocation[1],
      });
      setSosActive(true);
      setEmergencyOpen(true);
      showToast('ALERTA SOS ENVIADA A SEGURIDAD', 'error');
      playSound(SOUNDS.sos);
    } catch (e: any) {
      console.error(e);
    }
  };

  const resolveLoginEmail = (identifier: string): string => {
    const trimmed = identifier.trim().toLowerCase();
    if (trimmed === 'pasajero_1' || trimmed === 'pasajero_1@zippy.app') {
      return 'pasejero_1@zippy.app';
    }
    return trimmed.includes('@') ? trimmed : `${trimmed}@zippy.app`;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (authMode === 'login') {
        const loginEmail = resolveLoginEmail(email);
        const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
        if (error) throw error;
        if (data.user) {
          const { data: roleCheck } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', data.user.id)
            .single();
          if (roleCheck?.role && roleCheck.role !== 'PASSENGER') {
            await supabase.auth.signOut();
            throw new Error('Esta cuenta no corresponde al perfil de Pasajero.');
          }
          await hydrateUserProfile(data.user.id);
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: fullName, role: 'PASSENGER' } },
        });
        if (error) throw error;
        showToast('Registro exitoso. Inicia sesión.', 'success');
        setAuthMode('login');
      }
    } catch (err: any) {
      showToast(err.message || 'Error de autenticación', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCard = async (cardData: any) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          card_last4: cardData.number.slice(-4),
          card_brand: cardData.brand,
          card_name: cardData.name,
          card_expiry: cardData.expiry,
        })
        .eq('id', userProfile.id);
      if (error) throw error;
      setUserProfile((prev) => ({
        ...prev,
        card_last4: cardData.number.slice(-4),
        card_brand: cardData.brand,
        card_name: cardData.name,
        card_expiry: cardData.expiry,
      }));
      setAddCardOpen(false);
      showToast('Tarjeta guardada correctamente', 'success');
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleRide = async (datetime: string) => {
    if (!passengerLocation) return showToast('Esperando ubicación...', 'warning');
    if (!destination.trim()) return showToast('Indica un destino antes de programar.', 'warning');
    setLoading(true);
    try {
      const dest = destinationCoords || [passengerLocation[0] + 0.015, passengerLocation[1] + 0.015];
      const { error } = await insertRideResilient(
        {
          passenger_id: userProfile.id,
          pickup_label: pickup || 'Mi Ubicación',
          destination_label: destination,
          pickup_lat: passengerLocation[0],
          pickup_lng: passengerLocation[1],
          dest_lat: dest[0],
          dest_lng: dest[1],
          price: calculatedPrice || 50,
          status: RideStatus.SCHEDULED,
          scheduled_for: datetime,
        },
        {
          vehicle_category: vehicleCategory,
          payment_method: paymentMethod,
          pin_code: generateSecurityPin(),
        }
      );
      if (error) throw new Error(error.message);
      setScheduleModalOpen(false);
      showToast(`Viaje programado para ${new Date(datetime).toLocaleString()}`, 'success');
      loadPassengerHistory(userProfile.id);
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelScheduledRide = async (rideId: string) => {
    await updateRideResilient(rideId, { status: RideStatus.CANCELLED });
    setScheduledRides((prev) => prev.filter((r) => r.id !== rideId));
    showToast('Reserva cancelada', 'info');
  };

  const handleRefreshConnection = async () => {
    setLoading(true);
    try {
      if (activeRide) {
        const { data: ride } = await supabase.from('rides').select('*').eq('id', activeRide.id).single();
        if (ride) handleRideUpdate(ride);
        const { data: offers } = await supabase.from('ride_offers').select('*').eq('ride_id', activeRide.id);
        if (offers) {
          const newOffers: DriverTarifa[] = offers.map((o: any) => ({
            id: o.id,
            ride_id: o.ride_id,
            driver_id: o.driver_id,
            name: o.driver_name,
            rating: o.driver_rating,
            carModel: o.car_model,
            carPlate: o.car_plate,
            taxiNumber: o.taxi_number,
            price: o.offered_price,
            eta: o.eta,
            avatarUrl: o.avatar_url,
            distance: o.distance,
            tripsCompleted: o.trips_completed,
          }));
          setAvailableTarifas(newOffers);
        }
      }
      showToast('Sincronizado', 'success');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSearch = async () => {
    if (!activeRide) return;
    if (!(await appConfirm('¿Cancelar búsqueda?', 'Cancelar solicitud'))) return;
    setLoading(true);
    try {
      await updateRideResilient(activeRide.id, { status: RideStatus.CANCELLED });
      resetRideState();
      showToast('Búsqueda cancelada', 'info');
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelRide = async () => {
    if (!activeRide) return;
    if (!(await appConfirm('¿Seguro que deseas cancelar el viaje?', 'Cancelar viaje'))) return;
    try {
      await updateRideResilient(activeRide.id, { status: RideStatus.CANCELLED });
      resetRideState();
      showToast('Viaje cancelado', 'info');
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const handleCallDriver = () =>
    selectedDriver?.phone
      ? (window.location.href = `tel:${selectedDriver.phone}`)
      : showToast('Número no disponible', 'error');

  // --- SHARE LIVE TRIP LINK ---
  const handleShareTrip = async () => {
    if (!activeRide) return;
    const coords = driverLocation || passengerLocation;
    const mapUrl = coords ? `https://maps.google.com/?q=${coords[0]},${coords[1]}` : window.location.href;
    const text = `🚖 Viajo en Zippy Taxi hacia ${activeRide.destination_label}.\nConductor: ${selectedDriver?.name || 'Asignado'} (${selectedDriver?.carModel || ''} • Placas ${selectedDriver?.carPlate || '---'}).\nUbicación en vivo: ${mapUrl}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mi viaje en vivo - Zippy Taxi', text, url: mapUrl });
        showToast('Ubicación del viaje compartida', 'success');
      } else {
        await navigator.clipboard.writeText(text);
        showToast('Enlace de viaje copiado al portapapeles', 'success');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Enlace de viaje copiado al portapapeles', 'success');
      } catch {
        showToast('No se pudo compartir automáticamente.', 'warning');
      }
    }
  };

  // --- PROFILE EDITING & TRUSTED CONTACTS ---
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('La imagen debe pesar menos de 5MB', 'error');
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setIsEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    if (!userProfile.id) return;
    setLoading(true);
    try {
      let avatarUrl = userProfile.avatar_url;
      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop();
        const path = `avatars/passenger_${userProfile.id}_${Date.now()}.${ext}`;
        const { data, error: uploadErr } = await supabase.storage
          .from('zippy-media')
          .upload(path, avatarFile, { cacheControl: '3600', upsert: true });
        if (!uploadErr && data) {
          const { data: pub } = supabase.storage.from('zippy-media').getPublicUrl(data.path);
          avatarUrl = pub.publicUrl;
        }
      }

      const { error } = await updateProfileResilient(userProfile.id, {
        full_name: userProfile.name,
        phone: userProfile.phone,
        saved_home: userProfile.saved_home,
        saved_work: userProfile.saved_work,
        avatar_url: avatarUrl,
      });

      if (error) throw new Error(error.message);
      setUserProfile((prev) => ({ ...prev, avatar_url: avatarUrl }));
      setAvatarFile(null);
      setIsEditingProfile(false);
      showToast('Perfil y direcciones guardadas', 'success');
    } catch (e: any) {
      showToast('Error al guardar perfil: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTrustedContact = async () => {
    if (!newContactName.trim() || !newContactPhone.trim()) {
      showToast('Ingresa nombre y teléfono del contacto', 'warning');
      return;
    }
    const next: TrustedContact[] = [
      ...trustedContacts,
      { id: `tc-${Date.now()}`, name: newContactName.trim(), phone: newContactPhone.trim() },
    ];
    setTrustedContacts(next);
    setNewContactName('');
    setNewContactPhone('');
    await saveTrustedContacts(userProfile.id, next);
    showToast('Contacto de confianza guardado', 'success');
  };

  const handleRemoveTrustedContact = async (id: string) => {
    const next = trustedContacts.filter((c) => c.id !== id);
    setTrustedContacts(next);
    await saveTrustedContacts(userProfile.id, next);
    showToast('Contacto eliminado', 'info');
  };

  // --- WALLET COUPON & TOP-UP ---
  const handleRedeemCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    const coupons: Record<string, number> = { ZIPPY20: 20, BIENVENIDO: 50, ZIPPY100: 100 };
    if (!coupons[code]) {
      showToast('Cupón no válido. Prueba ZIPPY20 o BIENVENIDO.', 'error');
      return;
    }
    const usedKey = `zippy_used_coupon_${userProfile.id}_${code}`;
    if (localStorage.getItem(usedKey)) {
      showToast('Ya utilizaste este cupón anteriormente.', 'warning');
      return;
    }
    const bonus = coupons[code];
    const nextBal = walletBalance + bonus;
    localStorage.setItem(usedKey, 'true');
    setWalletBalance(nextBal);
    setCouponCode('');
    await saveWalletBalance(userProfile.id, nextBal);
    showToast(`¡Cupón aplicado! +$${bonus} MXN en tu billetera`, 'success');
  };

  const handleTopUpWallet = async (amount: number) => {
    const nextBal = walletBalance + amount;
    setWalletBalance(nextBal);
    setTopUpModalOpen(false);
    await saveWalletBalance(userProfile.id, nextBal);
    showToast(`Recarga de $${amount} MXN acreditada`, 'success');
  };

  // --- STEP 6 MODAL: PAYMENT ONLY (SEPARATED FROM RATING/TIP) ---
  const renderReceiptModal = () => {
    const basePrice = activeRide?.price || finalFare;
    const isEarlyPayment =
      status === RideStatus.IN_PROGRESS || status === RideStatus.ARRIVED || status === RideStatus.ACCEPTED;

    return (
      <div className="fixed inset-0 z-[120] bg-zippy-dark/95 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
        <div className="bg-white w-full max-w-sm rounded-[40px] shadow-2xl overflow-hidden relative animate-scale-up flex flex-col max-h-[90vh]">
          <div className="bg-zippy-main p-6 text-center relative overflow-hidden flex-shrink-0">
            <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-white/10 rotate-12"></div>
            {isEarlyPayment && (
              <button
                onClick={() => setShowReceiptModal(false)}
                className="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/40 text-zippy-dark"
              >
                <X size={20} />
              </button>
            )}
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg">
              <Receipt size={32} className="text-zippy-dark" />
            </div>
            <h2 className="text-xl font-black text-zippy-dark uppercase tracking-tight">
              {isEarlyPayment ? 'Pago Anticipado' : 'Paso 1: Confirmar Cobro'}
            </h2>
            <p className="text-zippy-dark/70 font-bold text-xs uppercase tracking-widest mt-1">
              Total del Viaje
            </p>
          </div>

          <div className="p-6 overflow-y-auto space-y-5">
            <div className="text-center">
              <span className="text-5xl font-black text-zippy-dark tracking-tighter block">${basePrice}</span>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                Método:{' '}
                {paymentMethod === 'cash'
                  ? 'Efectivo'
                  : paymentMethod === 'wallet'
                  ? 'Billetera Zippy'
                  : 'Tarjeta Digital'}
              </span>
            </div>

            {/* Desglose de tarifa */}
            <div className="bg-gray-50 rounded-2xl p-4 space-y-2 border border-gray-100 text-xs">
              <div className="flex justify-between font-bold text-gray-500">
                <span>Tarifa base</span>
                <span>${activeRide?.base_fare ?? tariffConfig.baseFare}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-500">
                <span>Distancia ({activeRide?.distance_km ?? fareQuote?.distanceKm ?? '—'} km)</span>
                <span>${activeRide?.distance_fare ?? Math.max(0, basePrice - tariffConfig.baseFare)}</span>
              </div>
              {activeRide?.time_fare ? (
                <div className="flex justify-between font-bold text-gray-500">
                  <span>Tiempo ({activeRide?.estimated_minutes ?? '—'} min)</span>
                  <span>${activeRide.time_fare}</span>
                </div>
              ) : null}
              <div className="h-px bg-gray-200 my-1"></div>
              <div className="flex justify-between font-black text-zippy-dark text-sm">
                <span>Total a liquidar</span>
                <span>${basePrice} MXN</span>
              </div>
            </div>

            {paymentMethod === 'cash' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-3 text-center">
                <p className="text-[11px] font-bold text-yellow-800">
                  Entrega ${basePrice} MXN al conductor y confirma abajo para pasar a tu evaluación.
                </p>
              </div>
            )}

            <button
              onClick={handleConfirmPayment}
              disabled={loading}
              className="w-full bg-zippy-dark text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-transform uppercase text-sm tracking-widest flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : 'CONFIRMAR PAGO'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // --- STEP 7 MODAL: INDEPENDENT RATING, QUICK TAGS & TIP ---
  const renderRatingModal = () => {
    const toggleTag = (tag: string) => {
      setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
    };

    return (
      <div className="fixed inset-0 z-[125] bg-zippy-dark/95 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
        <div className="bg-white w-full max-w-sm rounded-[40px] shadow-2xl overflow-hidden relative animate-scale-up flex flex-col max-h-[90vh]">
          <div className="bg-green-600 p-6 text-center relative flex-shrink-0">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg">
              <Award size={32} className="text-green-600" />
            </div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">¡Pago Confirmado!</h2>
            <p className="text-white/80 font-bold text-xs uppercase tracking-widest mt-1">
              Califica a {selectedDriver?.name || 'tu conductor'}
            </p>
          </div>

          <div className="p-6 overflow-y-auto space-y-5">
            {/* Estrellas */}
            <div className="flex flex-col items-center gap-2">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                Tu calificación
              </p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRating(r)}
                    className="transform hover:scale-125 transition-transform active:scale-95"
                  >
                    <Star
                      size={34}
                      className={r <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Etiquetas rápidas */}
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 text-center">
                ¿Qué destacarías del servicio?
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {PASSENGER_RATING_TAGS.map((tag) => {
                  const active = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                        active
                          ? 'bg-zippy-dark text-white border-zippy-dark'
                          : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-zippy-main'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="w-full h-px bg-gray-100"></div>

            {/* Propina opcional */}
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 text-center">
                ¿Deseas agregar propina al conductor?
              </p>
              <div className="flex justify-center gap-3 mb-3">
                {[10, 20, 50].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setTipAmount(amount === tipAmount ? 0 : amount)}
                    className={`w-14 h-14 rounded-full border-2 flex items-center justify-center font-black text-sm transition-all ${
                      tipAmount === amount
                        ? 'bg-zippy-main text-zippy-dark border-zippy-dark scale-110'
                        : 'bg-gray-50 border-gray-100 text-gray-400 hover:border-zippy-main'
                    }`}
                  >
                    ${amount}
                  </button>
                ))}
              </div>
              <div className="bg-gray-50 p-3 rounded-xl flex items-center gap-2 border border-gray-100">
                <Coins size={16} className="text-gray-400" />
                <input
                  type="number"
                  min={0}
                  placeholder="Otro monto de propina (opcional)"
                  value={tipAmount > 0 && ![10, 20, 50].includes(tipAmount) ? tipAmount : ''}
                  onChange={(e) => setTipAmount(Math.max(0, Number(e.target.value)))}
                  className="bg-transparent w-full font-bold text-zippy-dark outline-none text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => handleSubmitRatingAndTip(false)}
                disabled={loading}
                className="w-full bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl active:scale-95 transition-transform uppercase text-xs tracking-widest flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Loader2 className="animate-spin" />
                ) : tipAmount > 0 ? (
                  `ENVIAR CALIFICACIÓN Y $${tipAmount} PROPINA`
                ) : (
                  'ENVIAR CALIFICACIÓN'
                )}
              </button>
              <button
                onClick={() => handleSubmitRatingAndTip(true)}
                disabled={loading}
                className="w-full py-3 rounded-2xl text-gray-400 font-black text-[10px] uppercase tracking-widest hover:text-zippy-dark"
              >
                Omitir y Volver al Inicio
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- WALLET VIEW ---
  const renderPayment = () => (
    <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24">
      <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10">
        <button
          onClick={() => setView('home')}
          className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-2">Billetera</h2>
        <p className="text-center text-white/60 text-xs font-bold uppercase tracking-widest">
          Métodos de Pago, Saldo y Cupones
        </p>
      </div>

      <div className="p-6 space-y-6">
        <div className="bg-white p-6 rounded-[32px] shadow-lg border border-gray-100 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-zippy-main/20 rounded-full blur-2xl"></div>
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Tu Saldo Zippy</p>
          <h3 className="text-4xl font-black text-zippy-dark tracking-tighter">
            ${walletBalance.toFixed(2)} <span className="text-sm text-gray-400 font-bold">MXN</span>
          </h3>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setTopUpModalOpen(true)}
              className="flex-1 py-3 bg-zippy-dark text-white rounded-xl font-bold text-xs shadow-md active:scale-95 transition-transform"
            >
              Recargar Saldo
            </button>
            <button
              onClick={() => {
                setPaymentMethod('wallet');
                setView('home');
                showToast('Billetera seleccionada como método de pago', 'info');
              }}
              className="flex-1 py-3 bg-zippy-main text-zippy-dark rounded-xl font-black text-xs active:scale-95 transition-transform"
            >
              Usar en Viaje
            </button>
          </div>
        </div>

        {/* Cupones */}
        <div className="bg-white p-5 rounded-[28px] shadow-sm border border-gray-100">
          <h4 className="font-black text-zippy-dark text-xs uppercase tracking-widest mb-3 flex items-center gap-2">
            <Tag size={14} className="text-zippy-main" /> Cupones Promocionales
          </h4>
          <div className="flex gap-2">
            <input
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="Ej: ZIPPY20 o BIENVENIDO"
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs font-bold uppercase outline-none focus:border-zippy-main"
            />
            <button
              onClick={handleRedeemCoupon}
              className="px-5 py-3 bg-zippy-dark text-white rounded-xl font-black text-xs uppercase active:scale-95"
            >
              Aplicar
            </button>
          </div>
        </div>

        {/* Tarjetas */}
        <div>
          <div className="flex justify-between items-center mb-3 px-2">
            <h4 className="font-black text-zippy-dark text-sm uppercase tracking-wide">Mis Tarjetas</h4>
            <button
              onClick={() => setAddCardOpen(true)}
              className="p-2 bg-white rounded-full shadow-sm text-blue-600"
            >
              <Plus size={16} />
            </button>
          </div>
          {userProfile.card_last4 ? (
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-5 rounded-2xl shadow-xl text-white relative overflow-hidden">
              <div className="absolute right-4 top-4 opacity-50">
                <CreditCard size={32} />
              </div>
              <p className="font-mono text-xs opacity-70 mb-8">{userProfile.card_brand || 'Tarjeta'}</p>
              <p className="font-mono text-xl tracking-widest mb-4">•••• •••• •••• {userProfile.card_last4}</p>
              <div className="flex justify-between items-end">
                <p className="text-xs font-bold uppercase opacity-70">{userProfile.card_name}</p>
                <p className="text-xs font-bold opacity-70">{userProfile.card_expiry}</p>
              </div>
            </div>
          ) : (
            <div
              onClick={() => setAddCardOpen(true)}
              className="border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center text-gray-400 cursor-pointer hover:border-zippy-main hover:bg-zippy-main/5 transition-all"
            >
              <CreditCard size={24} className="mx-auto mb-2 opacity-50" />
              <p className="text-xs font-bold uppercase">Agregar Tarjeta</p>
            </div>
          )}
        </div>

        {/* Movimientos */}
        <div>
          <h4 className="font-black text-zippy-dark text-sm uppercase tracking-wide mb-3 px-2">
            Movimientos Recientes
          </h4>
          <div className="bg-white rounded-[24px] p-2 shadow-sm border border-gray-100">
            {history.slice(0, 5).map((ride) => (
              <div
                key={ride.id}
                onClick={() => setSelectedReceiptRide(ride)}
                className="flex justify-between items-center p-4 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-100 rounded-full text-gray-500">
                    <Car size={16} />
                  </div>
                  <div>
                    <p className="font-bold text-zippy-dark text-xs">
                      Viaje a {ride.destination_label.split(',')[0]}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold">
                      {new Date(ride.created_at || '').toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <span className="font-black text-zippy-dark text-sm">
                  -${ride.total_paid || ride.price}
                </span>
              </div>
            ))}
            {history.length === 0 && (
              <p className="text-center py-6 text-xs text-gray-400 font-bold">Sin movimientos</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // --- HISTORY & SCHEDULED VIEW ---
  const renderHistory = () => (
    <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24">
      <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10">
        <button
          onClick={() => setView('home')}
          className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-2">Mis Viajes</h2>
        <div className="flex bg-white/10 p-1 rounded-xl mt-3 max-w-xs mx-auto">
          <button
            onClick={() => setHistoryTab('past')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${
              historyTab === 'past' ? 'bg-zippy-main text-zippy-dark' : 'text-white/70'
            }`}
          >
            Historial ({history.length})
          </button>
          <button
            onClick={() => setHistoryTab('scheduled')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${
              historyTab === 'scheduled' ? 'bg-zippy-main text-zippy-dark' : 'text-white/70'
            }`}
          >
            Programados ({scheduledRides.length})
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {historyTab === 'scheduled' ? (
          scheduledRides.length > 0 ? (
            scheduledRides.map((ride) => (
              <div key={ride.id} className="bg-white p-5 rounded-[24px] shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-3">
                  <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-[10px] font-black uppercase flex items-center gap-1">
                    <Calendar size={12} />{' '}
                    {ride.scheduled_for ? new Date(ride.scheduled_for).toLocaleString() : 'Programado'}
                  </span>
                  <span className="font-black text-zippy-dark">${ride.price}</span>
                </div>
                <p className="text-xs font-bold text-gray-500 truncate mb-1">Origen: {ride.pickup_label}</p>
                <p className="text-xs font-black text-zippy-dark truncate mb-4">
                  Destino: {ride.destination_label}
                </p>
                <button
                  onClick={() => handleCancelScheduledRide(ride.id)}
                  className="w-full py-2.5 bg-red-50 text-red-600 rounded-xl font-black text-[10px] uppercase"
                >
                  Cancelar Reserva
                </button>
              </div>
            ))
          ) : (
            <div className="text-center py-20 opacity-50">
              <Calendar size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="font-bold text-gray-400 text-sm">No tienes viajes programados.</p>
            </div>
          )
        ) : history.length > 0 ? (
          history.map((ride) => (
            <div
              key={ride.id}
              onClick={() => setSelectedReceiptRide(ride)}
              className="bg-white p-5 rounded-[24px] shadow-sm border border-gray-100 cursor-pointer hover:border-zippy-main transition-colors"
            >
              <div className="flex justify-between items-center mb-4">
                <img
                  src="https://daloocomercializadora.com.mx/zippyicono.png"
                  alt="Zippy Taxi"
                  className="h-6 object-contain opacity-70"
                />
                <div className="text-right">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">
                    {new Date(ride.created_at || '').toLocaleDateString()}
                  </span>
                  <span className="text-[10px] font-bold text-gray-300 uppercase block">
                    {new Date(ride.created_at || '').toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
              <div className="space-y-3 mb-4 relative pl-3">
                <div className="absolute top-2 bottom-2 left-[5px] w-0.5 bg-gray-100"></div>
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-3 h-3 bg-green-500 rounded-full border-2 border-white shadow-sm mt-0.5"></div>
                  <p className="text-xs font-bold text-gray-500 truncate w-full">{ride.pickup_label}</p>
                </div>
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm mt-0.5"></div>
                  <p className="text-xs font-black text-zippy-dark truncate w-full">
                    {ride.destination_label}
                  </p>
                </div>
              </div>
              <div className="w-full h-px bg-gray-50 mb-3"></div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-lg ${
                      ride.payment_method === 'card'
                        ? 'bg-blue-50 text-blue-600'
                        : ride.payment_method === 'wallet'
                        ? 'bg-purple-50 text-purple-600'
                        : 'bg-green-50 text-green-600'
                    }`}
                  >
                    {ride.payment_method === 'card' ? (
                      <CreditCard size={14} />
                    ) : ride.payment_method === 'wallet' ? (
                      <Wallet size={14} />
                    ) : (
                      <Banknote size={14} />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-gray-400 uppercase">Total Pagado</span>
                    <span className="text-lg font-black text-zippy-dark">
                      ${ride.total_paid || ride.price}
                    </span>
                    {(ride.tip_amount || 0) > 0 && (
                      <span className="text-[10px] text-green-600 font-bold">
                        +${ride.tip_amount} propina
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {ride.rating_given && (
                    <div className="flex items-center gap-1 bg-yellow-50 px-2 py-1 rounded-lg">
                      <Star size={12} className="fill-yellow-500 text-yellow-500" />
                      <span className="text-xs font-black text-yellow-600">{ride.rating_given}</span>
                    </div>
                  )}
                  <span className="text-[10px] font-black text-zippy-dark bg-gray-100 px-2.5 py-1.5 rounded-lg">
                    Recibo
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-20 opacity-50">
            <History size={48} className="mx-auto mb-4 text-gray-300" />
            <p className="font-bold text-gray-400 text-sm">Aún no tienes viajes registrados.</p>
          </div>
        )}
      </div>
    </div>
  );

  // --- EDITABLE PROFILE + TRUSTED CONTACTS ---
  const renderProfile = () => (
    <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24">
      <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative">
        <button
          onClick={() => setView('home')}
          className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"
        >
          <ArrowLeft size={20} />
        </button>
        <button
          onClick={() => (isEditingProfile ? handleSaveProfile() : setIsEditingProfile(true))}
          className="absolute top-4 right-4 px-3 py-2 bg-zippy-main text-zippy-dark rounded-xl font-black text-[10px] uppercase flex items-center gap-1"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : isEditingProfile ? (
            <>
              <Save size={14} /> Guardar
            </>
          ) : (
            <>
              <Edit3 size={14} /> Editar
            </>
          )}
        </button>

        <div className="flex flex-col items-center">
          <div className="relative">
            <img
              src={
                avatarPreview ||
                userProfile.avatar_url ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(userProfile.name)}&background=000000&color=F5B901`
              }
              className="w-28 h-28 rounded-full border-4 border-zippy-main shadow-2xl overflow-hidden mb-4 object-cover"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-4 right-0 p-2 bg-zippy-main text-zippy-dark rounded-full shadow-lg"
              title="Cambiar foto"
            >
              <Camera size={16} />
            </button>
          </div>
          {isEditingProfile ? (
            <input
              value={userProfile.name}
              onChange={(e) => setUserProfile({ ...userProfile, name: e.target.value })}
              className="text-center text-xl font-black uppercase bg-white/10 rounded-xl px-4 py-1 text-white outline-none mb-1"
            />
          ) : (
            <h2 className="text-2xl font-black uppercase tracking-tight">{userProfile.name}</h2>
          )}
          <p className="text-xs text-white/70 font-bold">{userProfile.email}</p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-black text-zippy-dark uppercase tracking-widest border-b border-gray-100 pb-2">
            Mis Datos y Direcciones
          </h3>
          <div className="flex items-center gap-3">
            <Phone size={16} className="text-gray-400" />
            <input
              placeholder="Teléfono"
              value={userProfile.phone}
              readOnly={!isEditingProfile}
              onChange={(e) => setUserProfile({ ...userProfile, phone: e.target.value })}
              className={`flex-1 font-bold text-zippy-dark outline-none rounded-lg px-2 py-1 ${
                isEditingProfile ? 'bg-gray-50 border border-zippy-main' : 'bg-transparent'
              }`}
            />
          </div>
          <div className="flex items-center gap-3">
            <Home size={16} className="text-gray-400" />
            <input
              placeholder="Dirección de Casa"
              value={userProfile.saved_home}
              readOnly={!isEditingProfile}
              onChange={(e) => setUserProfile({ ...userProfile, saved_home: e.target.value })}
              className={`flex-1 font-bold text-zippy-dark outline-none rounded-lg px-2 py-1 ${
                isEditingProfile ? 'bg-gray-50 border border-zippy-main' : 'bg-transparent'
              }`}
            />
          </div>
          <div className="flex items-center gap-3">
            <Building2 size={16} className="text-gray-400" />
            <input
              placeholder="Dirección de Trabajo"
              value={userProfile.saved_work}
              readOnly={!isEditingProfile}
              onChange={(e) => setUserProfile({ ...userProfile, saved_work: e.target.value })}
              className={`flex-1 font-bold text-zippy-dark outline-none rounded-lg px-2 py-1 ${
                isEditingProfile ? 'bg-gray-50 border border-zippy-main' : 'bg-transparent'
              }`}
            />
          </div>
        </div>

        {/* Contactos de Confianza */}
        <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-black text-zippy-dark uppercase tracking-widest border-b border-gray-100 pb-2 flex items-center gap-2">
            <Users size={16} className="text-zippy-main" /> Contactos de Confianza
          </h3>
          {trustedContacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-2xl">
              <div>
                <p className="font-bold text-zippy-dark text-sm">{c.name}</p>
                <p className="text-xs text-gray-400 font-mono">{c.phone}</p>
              </div>
              <button
                onClick={() => handleRemoveTrustedContact(c.id)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-xl"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="grid grid-cols-1 gap-2 pt-2">
            <input
              placeholder="Nombre del contacto"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-xs outline-none focus:border-zippy-main"
            />
            <div className="flex gap-2">
              <input
                type="tel"
                placeholder="Teléfono / WhatsApp"
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                className="flex-1 p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-xs outline-none focus:border-zippy-main"
              />
              <button
                onClick={handleAddTrustedContact}
                className="px-4 py-3 bg-zippy-dark text-white rounded-xl font-black text-xs uppercase"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={onBack}
          className="w-full py-4 rounded-2xl bg-red-50 text-red-600 font-black text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 mt-4 hover:bg-red-100 transition-colors"
        >
          <LogOut size={18} /> Cerrar Sesión
        </button>
      </div>
    </div>
  );

  // --- SERVICES & SUPPORT VIEW ---
  const renderServices = () => (
    <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24">
      <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10">
        <button
          onClick={() => setView('home')}
          className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-2">Servicios</h2>
        <p className="text-center text-white/60 text-xs font-bold uppercase tracking-widest">
          Asistencia, Soporte y Ayuda
        </p>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setAssistantOpen(true)}
            className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col items-center gap-3 hover:scale-105 transition-transform"
          >
            <div className="p-4 bg-zippy-main/20 rounded-full text-zippy-dark">
              <MessageSquare size={32} />
            </div>
            <span className="font-black text-zippy-dark text-xs uppercase">Asistente IA</span>
          </button>
          <button
            onClick={() => setEmergencyOpen(true)}
            className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col items-center gap-3 hover:scale-105 transition-transform"
          >
            <div className="p-4 bg-red-100 rounded-full text-red-600">
              <Siren size={32} />
            </div>
            <span className="font-black text-zippy-dark text-xs uppercase">Emergencias</span>
          </button>
          <button
            onClick={() => {
              setView('history');
              showToast('Toca cualquier viaje para ver tu recibo detallado', 'info');
            }}
            className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col items-center gap-3 hover:scale-105 transition-transform"
          >
            <div className="p-4 bg-blue-50 rounded-full text-blue-600">
              <FileText size={32} />
            </div>
            <span className="font-black text-zippy-dark text-xs uppercase">Recibos</span>
          </button>
          <button
            onClick={() => setSupportModalOpen(true)}
            className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col items-center gap-3 hover:scale-105 transition-transform"
          >
            <div className="p-4 bg-[#005EDD]/10 rounded-full text-[#005EDD]">
              <LifeBuoy size={32} />
            </div>
            <span className="font-black text-zippy-dark text-xs uppercase">Soporte / Objetos</span>
          </button>
        </div>

        <div className="bg-black text-white p-5 rounded-[28px] shadow-lg border border-[#F5B901]/30 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-black text-[#F5B901] text-xs uppercase tracking-widest">
                Auxilio Vial en Tiempo Real
              </h4>
              <p className="text-[11px] text-white/70 font-medium mt-0.5">
                Envía una solicitud directa a Proveedores (Grúa / Mecánico) conectados
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              const locLabel = pickup || (passengerLocation ? `${passengerLocation[0].toFixed(4)}, ${passengerLocation[1].toFixed(4)}` : 'Ubicación actual');
              const { error } = await supabase.from('provider_requests').insert({
                customer_name: userProfile.name || 'Pasajero Zippy Taxi',
                description: 'Solicitud de auxilio vial / grúa desde la app de pasajero',
                location_label: locLabel,
                price: 350,
                status: 'pending',
              });
              if (error) {
                showToast('No se pudo enviar auxilio vial: ' + error.message, 'error');
              } else {
                showToast('Solicitud de auxilio vial enviada a proveedores cercanos.', 'success');
              }
            }}
            className="w-full py-3.5 rounded-2xl bg-[#F5B901] hover:bg-[#005EDD] hover:text-white text-black font-black text-xs uppercase tracking-wider transition-colors"
          >
            Solicitar Grúa / Mecánico Ahora
          </button>
        </div>

        {supportTickets.length > 0 && (
          <div className="bg-white p-5 rounded-[28px] shadow-sm border border-gray-100 space-y-3">
            <h4 className="font-black text-zippy-dark text-xs uppercase tracking-widest">
              Mis Reportes de Soporte
            </h4>
            {supportTickets.map((t) => (
              <div key={t.id} className="p-3 bg-gray-50 rounded-2xl flex justify-between items-center">
                <div>
                  <p className="font-bold text-zippy-dark text-xs">{t.subject}</p>
                  <p className="text-[10px] text-gray-400 uppercase">{t.category}</p>
                </div>
                <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-zippy-main/30 text-zippy-dark">
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative w-full h-screen h-[100dvh] bg-gray-100 overflow-hidden flex flex-col font-sans">
      <NotificationToast
        message={toast.msg}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast({ ...toast, visible: false })}
      />

      <MapVisual
        status={status === RideStatus.RATING || status === RideStatus.PAYMENT_PENDING ? RideStatus.COMPLETED : status}
        entities={nearbyDrivers}
        userLocation={passengerLocation}
        driverLocation={driverLocation}
        routeStart={routeStart}
        routeEnd={routeEnd}
        gpsAccuracy={gpsAccuracy}
        draggablePickup={status === RideStatus.IDLE}
        onPickupPinDragEnd={handlePickupPinDragEnd}
      />

      {showReceiptModal && renderReceiptModal()}
      {showRatingModal && renderRatingModal()}

      {showArrivalOverlay && !showReceiptModal && !showRatingModal && (
        <div className="fixed inset-0 z-[100] bg-green-600/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-bounce-in text-center">
          <div className="w-40 h-40 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl animate-ping-slow">
            <Bell size={64} className="text-green-600 animate-swing" />
          </div>
          <h1 className="text-5xl font-black text-white uppercase tracking-tighter mb-4 leading-none">
            ¡Tu Zippy
            <br />
            ha llegado!
          </h1>
          {activeRide?.pin_code && (
            <div className="bg-white/20 px-6 py-3 rounded-2xl mb-4 border border-white/30">
              <span className="text-[10px] font-black text-white/80 uppercase tracking-widest block">
                PIN de Seguridad
              </span>
              <span className="text-3xl font-black text-white tracking-[0.3em]">{activeRide.pin_code}</span>
            </div>
          )}
          <p className="text-white/90 font-bold text-lg uppercase tracking-widest max-w-xs leading-relaxed">
            Sal al punto de encuentro. El conductor te está esperando.
          </p>
          <button
            onClick={handlePassengerReady}
            disabled={loading}
            className="mt-10 px-10 py-5 bg-white text-green-700 font-black rounded-3xl shadow-xl active:scale-95 transition-transform text-lg uppercase tracking-wide flex items-center gap-3"
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <>
                <ThumbsUp size={24} /> Voy Saliendo
              </>
            )}
          </button>
        </div>
      )}

      {view === 'history' && renderHistory()}
      {view === 'payment' && renderPayment()}
      {view === 'profile' && renderProfile()}
      {view === 'services' && renderServices()}

      {view === 'home' && !showReceiptModal && !showRatingModal && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 pointer-events-none flex flex-col transition-transform duration-300 ease-in-out ${
            isMinimized ? 'translate-y-[82%]' : 'translate-y-0'
          }`}
        >
          <div className="pointer-events-auto flex justify-end px-4 pb-2">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="bg-white text-zippy-dark p-2 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 active:scale-90 transition-transform"
            >
              {isMinimized ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
            </button>
          </div>

          {status === RideStatus.IDLE && (
            <div className="pointer-events-auto bg-white rounded-t-[40px] p-6 shadow-2xl border-t border-gray-100 animate-slide-up pb-8 max-h-[75vh] overflow-y-auto">
              <div className="text-center mb-4">
                <img src="https://daloocomercializadora.com.mx/zippylogo.png" alt="Zippy Taxi" className="h-8 mx-auto mb-1 object-contain" />
                <h2 className="text-xl font-black text-zippy-dark tracking-tight">
                  ¿A dónde <span className="text-zippy-main">vamos?</span>
                </h2>
              </div>

              <div className="space-y-3 mb-4">
                <div className="bg-gray-50 p-3.5 rounded-2xl flex items-center gap-3 border border-gray-100">
                  <MapPin size={18} className="text-green-500 flex-shrink-0" />
                  <input
                    ref={pickupInputRef}
                    type="text"
                    value={pickup}
                    onChange={(e) => setPickup(e.target.value)}
                    onBlur={() => geocodeAddress(pickup, true)}
                    placeholder="¿Dónde te recogemos? (o mueve el pin)"
                    className="bg-transparent w-full font-bold outline-none text-zippy-dark text-sm"
                  />
                </div>
                <div className="bg-gray-50 p-3.5 rounded-2xl flex items-center gap-3 border border-gray-100 focus-within:border-zippy-main relative">
                  <Navigation size={18} className="text-red-500 flex-shrink-0" />
                  <input
                    ref={destInputRef}
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    onBlur={() => geocodeAddress(destination, false)}
                    placeholder="¿A dónde vas?"
                    className="bg-transparent w-full font-bold outline-none text-zippy-dark text-sm"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      title="Casa"
                      onClick={() => {
                        if (userProfile.saved_home) {
                          setDestination(userProfile.saved_home);
                          geocodeAddress(userProfile.saved_home, false);
                        } else {
                          showToast('Guarda tu dirección de Casa en Perfil', 'info');
                        }
                      }}
                      className="p-2 bg-gray-200 rounded-full hover:bg-zippy-main/50"
                    >
                      <Home size={14} />
                    </button>
                    <button
                      type="button"
                      title="Trabajo"
                      onClick={() => {
                        if (userProfile.saved_work) {
                          setDestination(userProfile.saved_work);
                          geocodeAddress(userProfile.saved_work, false);
                        } else {
                          showToast('Guarda tu dirección de Trabajo en Perfil', 'info');
                        }
                      }}
                      className="p-2 bg-gray-200 rounded-full hover:bg-zippy-main/50"
                    >
                      <Building2 size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Categoría de vehículo */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                {VEHICLE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setVehicleCategory(cat.id)}
                    className={`p-2.5 rounded-2xl border-2 text-left transition-all ${
                      vehicleCategory === cat.id
                        ? 'bg-zippy-main/15 border-zippy-dark shadow-sm'
                        : 'bg-gray-50 border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Car size={16} className="text-zippy-dark" />
                      <span className="text-[9px] font-black text-gray-400">{cat.seats}p</span>
                    </div>
                    <p className="font-black text-zippy-dark text-xs mt-1">{cat.label}</p>
                    <p className="text-[9px] font-bold text-gray-400">{cat.desc}</p>
                  </button>
                ))}
              </div>

              {/* Tarifa + Distancia + ETA */}
              <div className="flex items-center justify-between mb-4 bg-gray-50 p-3.5 rounded-2xl">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-zippy-dark">$</span>
                  <input
                    type="number"
                    value={calculatedPrice}
                    onChange={(e) => setCalculatedPrice(Number(e.target.value))}
                    className="bg-transparent text-2xl font-black text-zippy-dark outline-none w-20"
                  />
                </div>
                <div className="text-right">
                  {fareQuote ? (
                    <span className="text-[10px] font-black text-zippy-dark block">
                      {fareQuote.distanceKm} km • ~{fareQuote.estimatedMinutes} min
                    </span>
                  ) : (
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">
                      TU TARIFA
                    </span>
                  )}
                  {smartAdvice && (
                    <span className="text-[9px] font-bold text-zippy-dark/70 block max-w-[170px] truncate">
                      {smartAdvice.advice}
                    </span>
                  )}
                </div>
              </div>

              {/* Payment Selection: Efectivo / Tarjeta / Billetera */}
              <div className="grid grid-cols-3 bg-gray-50 p-1 rounded-xl mb-4 border border-gray-100 gap-1">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`py-2.5 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all ${
                    paymentMethod === 'cash'
                      ? 'bg-white text-zippy-dark shadow-sm border border-gray-100'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <Banknote size={14} /> Efectivo
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`py-2.5 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all ${
                    paymentMethod === 'card'
                      ? 'bg-white text-zippy-dark shadow-sm border border-gray-100'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <CreditCard size={14} /> Tarjeta
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('wallet')}
                  className={`py-2.5 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-1.5 transition-all ${
                    paymentMethod === 'wallet'
                      ? 'bg-white text-zippy-dark shadow-sm border border-gray-100'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <Wallet size={14} /> ${walletBalance.toFixed(0)}
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleRequestRide}
                  disabled={loading}
                  className="flex-1 bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-transform uppercase text-sm tracking-widest"
                >
                  {loading ? <Loader2 className="animate-spin" /> : 'PEDIR AHORA'}
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(true)}
                  className="p-4 bg-gray-100 text-gray-500 rounded-2xl active:scale-90 transition-transform"
                  title="Programar viaje"
                >
                  <Calendar size={20} />
                </button>
              </div>
            </div>
          )}

          {status === RideStatus.REQUESTING && (
            <div className="pointer-events-auto bg-white rounded-t-[40px] p-6 shadow-2xl flex-1 flex flex-col overflow-hidden animate-slide-up h-[55vh]">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-black text-zippy-dark uppercase tracking-tight">
                    Conductores Cerca
                  </h3>
                  {activeRide?.pin_code && (
                    <span className="text-[10px] font-black text-zippy-dark/60 uppercase">
                      PIN de abordaje: {activeRide.pin_code}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleRefreshConnection}
                  disabled={loading}
                  className="text-zippy-dark/50 hover:text-zippy-dark transition-colors p-2 rounded-full active:scale-90"
                  title="Refrescar Conexión"
                >
                  <RotateCcw size={20} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {availableTarifas.length > 0 ? (
                  <OffersList
                    tarifas={availableTarifas}
                    onAccept={handleAcceptTarifa}
                    onDecline={(id) => setAvailableTarifas((prev) => prev.filter((o) => o.id !== id))}
                    onViewProfile={setViewingDriver}
                  />
                ) : (
                  <div className="space-y-3 pb-10 p-1 flex flex-col items-center justify-center h-full">
                    <div className="text-center mb-4">
                      <Loader2 className="w-12 h-12 text-zippy-dark animate-spin mx-auto mb-4" />
                      <p className="text-sm font-bold text-gray-500 animate-pulse">
                        Buscando conductores cercanos...
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="pt-4 border-t border-gray-100">
                <button
                  onClick={handleCancelSearch}
                  disabled={loading}
                  className="w-full bg-red-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-red-600/30 hover:bg-red-700 transition-all uppercase text-xs tracking-widest flex items-center justify-center gap-3 active:scale-95"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <>
                      <XCircle size={18} /> CANCELAR BÚSQUEDA
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {(status === RideStatus.ACCEPTED ||
            status === RideStatus.ARRIVED ||
            status === RideStatus.PASSENGER_READY ||
            status === RideStatus.IN_PROGRESS) &&
            selectedDriver && (
              <div
                className={`pointer-events-auto bg-white rounded-t-[40px] shadow-[0_-10px_40px_rgba(0,0,0,0.15)] animate-slide-up relative overflow-hidden transition-all duration-500 ${
                  status === RideStatus.ARRIVED
                    ? 'border-t-8 border-green-500 shadow-[0_0_50px_rgba(34,197,94,0.4)]'
                    : ''
                }`}
              >
                <div className="px-6 py-2 flex items-center justify-between bg-green-600">
                  <div className="flex items-center gap-2 text-white">
                    <ShieldCheck size={16} />
                    <span className="text-[10px] font-black uppercase tracking-widest">
                      Conductor 100% Verificado
                    </span>
                  </div>
                  {status !== RideStatus.IN_PROGRESS && (
                    <button
                      onClick={handleCancelRide}
                      className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2 py-1 rounded-lg transition-colors"
                    >
                      <XCircle size={12} className="text-white" />
                      <span className="text-[9px] font-black text-white uppercase">Cancelar</span>
                    </button>
                  )}
                </div>

                <div className="p-6 pb-8">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-16 h-16 rounded-full p-1 bg-gradient-to-tr from-zippy-main to-zippy-dark transition-all ${
                          status === RideStatus.ARRIVED ? 'scale-110 ring-4 ring-green-400 ring-offset-2' : ''
                        }`}
                      >
                        <img
                          src={selectedDriver.avatarUrl}
                          alt="Driver"
                          className="w-full h-full rounded-full object-cover border-2 border-white"
                        />
                      </div>
                      <div>
                        <h2 className="text-2xl font-black text-zippy-dark leading-none mb-1">
                          {selectedDriver.name}
                        </h2>
                        <div className="flex items-center gap-2 text-gray-500 text-[10px] font-bold uppercase">
                          <span>★ {selectedDriver.rating}</span>
                          <span>•</span>
                          <span>{selectedDriver.tripsCompleted} Viajes</span>
                        </div>
                      </div>
                    </div>

                    {activeRide?.is_paid ? (
                      <div className="px-4 py-2 rounded-xl bg-green-100 text-green-700 font-black text-[10px] uppercase tracking-widest flex items-center gap-2 shadow-sm border border-green-200">
                        <CheckCircle2 size={14} /> PAGO LISTO
                      </div>
                    ) : status === RideStatus.IN_PROGRESS ? (
                      <button
                        onClick={handleOpenEarlyPayment}
                        className="px-4 py-2 rounded-xl bg-zippy-dark text-white font-black text-[10px] uppercase tracking-widest shadow-lg hover:scale-105 transition-transform"
                      >
                        PAGAR AHORA
                      </button>
                    ) : (
                      <div
                        className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md ${
                          status === RideStatus.ARRIVED
                            ? 'bg-green-500 text-white animate-pulse scale-105'
                            : 'bg-zippy-dark text-white'
                        }`}
                      >
                        {status === RideStatus.ARRIVED ? '¡Llegó por ti!' : `${getLiveDriverEta()} min`}
                      </div>
                    )}
                  </div>

                  {/* PIN DE SEGURIDAD 4 DÍGITOS (ANTES DE INICIAR VIAJE) */}
                  {activeRide?.pin_code && status !== RideStatus.IN_PROGRESS && (
                    <div className="mb-4 bg-zippy-main/20 border-2 border-zippy-main rounded-2xl p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <KeyRound size={18} className="text-zippy-dark" />
                        <div>
                          <span className="text-[9px] font-black text-zippy-dark/70 uppercase tracking-widest block">
                            PIN de Seguridad
                          </span>
                          <span className="text-[10px] font-bold text-zippy-dark">
                            Compártelo al abordar
                          </span>
                        </div>
                      </div>
                      <span className="text-2xl font-black text-zippy-dark tracking-[0.25em] bg-white px-4 py-1 rounded-xl shadow-sm">
                        {activeRide.pin_code}
                      </span>
                    </div>
                  )}

                  {/* Ficha del vehículo (incluyendo Color) */}
                  <div
                    className={`flex gap-4 mb-5 p-4 rounded-3xl border transition-colors ${
                      status === RideStatus.ARRIVED
                        ? 'bg-green-50 border-green-200'
                        : 'bg-gray-50 border-gray-100'
                    }`}
                  >
                    <div className="flex-1 flex flex-col justify-center">
                      <h3 className="font-bold text-zippy-dark text-sm">
                        {selectedDriver.carModel}
                        {selectedDriver.carColor ? ` • ${selectedDriver.carColor}` : ''}
                      </h3>
                      <div className="flex items-center gap-3 mt-1">
                        <div className="bg-white border border-gray-200 px-2 py-1 rounded text-xs font-mono font-bold text-gray-600">
                          {selectedDriver.carPlate}
                        </div>
                        <span className="text-[10px] font-black text-gray-400 uppercase">
                          Econ. {selectedDriver.taxiNumber}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={handleCallDriver}
                      className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"
                    >
                      <Phone size={20} className="text-zippy-dark mb-1" />
                      <span className="text-[8px] font-black uppercase text-gray-500">Llamar</span>
                    </button>
                    <button
                      onClick={() => setChatOpen(true)}
                      className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20 disabled:opacity-50"
                    >
                      <MessageSquare size={20} className="text-zippy-dark mb-1" />
                      <span className="text-[8px] font-black uppercase text-gray-500">Chat</span>
                    </button>
                    <button
                      onClick={handleShareTrip}
                      className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"
                    >
                      <Share2 size={20} className="text-zippy-dark mb-1" />
                      <span className="text-[8px] font-black uppercase text-gray-500">Compartir</span>
                    </button>
                    <button
                      onClick={handleTriggerSOS}
                      className="flex flex-col items-center justify-center p-3 bg-red-600 text-white rounded-2xl shadow-lg shadow-red-600/30 active:scale-90 transition-transform"
                    >
                      <Siren size={20} className="mb-1 animate-pulse" />
                      <span className="text-[8px] font-black uppercase">SOS</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
        </div>
      )}

      {view === 'home' && !showReceiptModal && !showRatingModal && (
        <div className="absolute top-0 left-0 right-0 p-4 z-30 flex justify-between items-center">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-4 bg-white shadow-xl rounded-2xl text-zippy-dark active:scale-90 transition-transform"
          >
            <Menu size={24} />
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onBack}
              title="Cerrar Sesión"
              className="p-4 bg-white shadow-xl rounded-2xl text-red-500 active:scale-90 transition-transform"
            >
              <LogOut size={24} />
            </button>
            <button
              onClick={() => setAssistantOpen(true)}
              className="p-4 bg-zippy-dark text-zippy-accent shadow-xl rounded-2xl animate-pulse"
            >
              <MessageSquare size={24} />
            </button>
          </div>
        </div>
      )}

      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onLogout={onBack}
        currentView={view}
        onChangeView={setView}
        onOpenEmergency={() => setEmergencyOpen(true)}
        onOpenDriverReg={() => setDriverRegOpen(true)}
        userName={userProfile.name}
        driverApplicationStatus={driverApplicationStatus}
        onOpenDriverStatus={() => setDriverStatusViewOpen(true)}
        onOpenProvider={onOpenProvider}
      />
      <AssistantModal isOpen={assistantOpen} onClose={() => setAssistantOpen(false)} />
      <EmergencyDirectory isOpen={emergencyOpen} onClose={() => setEmergencyOpen(false)} />
      <DriverRegistration
        isOpen={driverRegOpen}
        onClose={() => setDriverRegOpen(false)}
        userId={userProfile.id}
        onRegistrationComplete={() => {
          setDriverRegOpen(false);
          const refetchProfile = async () => {
            const { data: profile } = await supabase
              .from('profiles')
              .select('verification_status')
              .eq('id', userProfile.id)
              .single();
            if (profile) setDriverApplicationStatus(profile.verification_status || 'pending');
          };
          refetchProfile();
        }}
      />

      {addCardOpen && (
        <AddCardModal onClose={() => setAddCardOpen(false)} onSave={handleSaveCard} loading={loading} />
      )}
      {scheduleModalOpen && (
        <ScheduleRideModal
          onClose={() => setScheduleModalOpen(false)}
          onSchedule={handleScheduleRide}
          loading={loading}
        />
      )}
      {driverStatusViewOpen && (
        <ApplicationStatus
          isOpen={driverStatusViewOpen}
          onClose={() => setDriverStatusViewOpen(false)}
          status={driverApplicationStatus}
        />
      )}
      {selectedReceiptRide && (
        <TripReceiptDetailModal
          ride={selectedReceiptRide}
          tariffConfig={tariffConfig}
          onClose={() => setSelectedReceiptRide(null)}
        />
      )}
      {topUpModalOpen && (
        <TopUpWalletModal onClose={() => setTopUpModalOpen(false)} onTopUp={handleTopUpWallet} />
      )}
      {supportModalOpen && (
        <SupportTicketModal
          userId={userProfile.id}
          userName={userProfile.name}
          onClose={() => setSupportModalOpen(false)}
          onCreated={(ticket) => {
            setSupportTickets((prev) => [ticket, ...prev]);
            setSupportModalOpen(false);
            showToast('Reporte enviado al equipo de soporte Zippy', 'success');
          }}
        />
      )}
      {viewingDriver && (
        <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-xs rounded-[32px] p-6 text-center relative shadow-2xl">
            <button
              onClick={() => setViewingDriver(null)}
              className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500"
            >
              <X size={18} />
            </button>
            <img
              src={viewingDriver.avatarUrl}
              className="w-20 h-20 rounded-full mx-auto mb-3 object-cover border-4 border-zippy-main"
            />
            <h3 className="font-black text-zippy-dark text-lg">{viewingDriver.name}</h3>
            <p className="text-xs font-bold text-gray-500 mb-2">
              ★ {viewingDriver.rating} • {viewingDriver.tripsCompleted} viajes
            </p>
            <p className="text-xs font-bold text-zippy-dark bg-gray-50 p-3 rounded-2xl">
              {viewingDriver.carModel} • {viewingDriver.carPlate}
            </p>
          </div>
        </div>
      )}

      <ChatModal
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onEndChat={() => {
          setChatOpen(false);
          showToast('Chat finalizado', 'info');
        }}
        rideId={activeRide?.id || ''}
        currentUserRole="PASSENGER"
        currentUserId={userProfile.id}
        counterpartName={selectedDriver?.name || 'Conductor'}
        counterpartPhone={selectedDriver?.phone}
      />

      {!isAuthenticated && (
        <div className="fixed inset-0 z-[100] bg-zippy-dark/95 backdrop-blur-xl flex items-center justify-center p-6 animate-fade-in">
          <div className="bg-white p-8 rounded-[40px] w-full max-w-sm shadow-2xl overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-2 bg-zippy-main"></div>
            <div className="text-center mb-8">
              <img src="https://daloocomercializadora.com.mx/zippylogo.png" alt="Zippy Taxi" className="h-12 mx-auto mb-4 object-contain" />
              <h2 className="text-2xl font-black text-zippy-dark uppercase tracking-tight">
                {authMode === 'login' ? 'Bienvenido' : 'Crear Cuenta'}
              </h2>
              <p className="text-gray-400 text-xs font-bold mt-1">Ingresa tus datos para continuar</p>
            </div>
            <form onSubmit={handleAuth} className="space-y-4">
              {authMode === 'register' && (
                <input
                  required
                  placeholder="Nombre Completo"
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold text-sm outline-none focus:border-zippy-main transition-colors"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              )}
              <input
                required
                type={authMode === 'login' ? 'text' : 'email'}
                placeholder={authMode === 'login' ? 'Usuario o Correo Electrónico' : 'Correo Electrónico'}
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold text-sm outline-none focus:border-zippy-main transition-colors"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="relative">
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Contraseña"
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold text-sm outline-none focus:border-zippy-main transition-colors"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-zippy-dark"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <button className="w-full bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl hover:bg-zippy-light transition-all flex items-center justify-center gap-2 mt-4 active:scale-95">
                {loading ? (
                  <Loader2 className="animate-spin" />
                ) : authMode === 'login' ? (
                  'INICIAR SESIÓN'
                ) : (
                  'REGISTRARME'
                )}
              </button>
              <div className="text-center mt-6">
                <button
                  type="button"
                  onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                  className="text-zippy-main font-black text-xs uppercase tracking-widest hover:underline decoration-2 underline-offset-4"
                >
                  {authMode === 'login'
                    ? '¿No tienes cuenta? Regístrate'
                    : '¿Ya tienes cuenta? Inicia Sesión'}
                </button>
              </div>
            </form>
            <button onClick={onBack} className="absolute top-4 right-4 p-2 text-gray-300 hover:text-gray-500">
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const AddCardModal = ({
  onClose,
  onSave,
  loading,
}: {
  onClose: () => void;
  onSave: (data: any) => void;
  loading: boolean;
}) => {
  const [cardData, setCardData] = useState({ number: '', name: '', expiry: '', cvv: '' });
  const [cardBrand, setCardBrand] = useState('');
  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    if (parts.length) return parts.join(' ');
    return value;
  };
  const formatExpiry = (value: string) => {
    const v = value.replace(/[^0-9]/gi, '');
    if (v.length >= 3) return `${v.slice(0, 2)}/${v.slice(2, 4)}`;
    return v;
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let { name, value } = e.target;
    if (name === 'number') {
      value = formatCardNumber(value);
      if (value.startsWith('4')) setCardBrand('Visa');
      else if (value.startsWith('5')) setCardBrand('Mastercard');
      else setCardBrand('');
    }
    if (name === 'expiry') value = formatExpiry(value);
    if (name === 'cvv') value = value.replace(/[^0-9]/gi, '').slice(0, 4);
    setCardData((prev) => ({ ...prev, [name]: value }));
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...cardData, brand: cardBrand, number: cardData.number.replace(/\s/g, '') });
  };
  return (
    <div className="fixed inset-0 z-[100] bg-zippy-dark/90 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-sm rounded-[32px] shadow-2xl overflow-hidden relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400 hover:text-zippy-dark z-20"
        >
          <X size={20} />
        </button>
        <div className="p-6">
          <h2 className="text-xl font-black text-zippy-dark uppercase mb-6">Agregar Tarjeta</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              name="number"
              value={cardData.number}
              onChange={handleInputChange}
              maxLength={19}
              placeholder="Número de Tarjeta"
              className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm"
            />
            <input
              name="name"
              value={cardData.name}
              onChange={handleInputChange}
              placeholder="Nombre en la Tarjeta"
              className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                name="expiry"
                value={cardData.expiry}
                onChange={handleInputChange}
                maxLength={5}
                placeholder="MM/AA"
                className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm"
              />
              <input
                name="cvv"
                value={cardData.cvv}
                onChange={handleInputChange}
                maxLength={4}
                placeholder="CVV"
                className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm"
              />
            </div>
            <button
              disabled={loading}
              className="w-full bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : 'Guardar Tarjeta'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

const ScheduleRideModal = ({
  onClose,
  onSchedule,
  loading,
}: {
  onClose: () => void;
  onSchedule: (datetime: string) => void;
  loading: boolean;
}) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(new Date(Date.now() + 3600000).toTimeString().substring(0, 5));

  const handleSubmit = () => {
    const scheduledDateTime = new Date(`${date}T${time}`);
    if (scheduledDateTime < new Date()) {
      void appAlert('Selecciona una hora futura.', 'Fecha inválida');
      return;
    }
    onSchedule(scheduledDateTime.toISOString());
  };

  return (
    <div className="fixed inset-0 z-[100] bg-zippy-dark/90 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-sm rounded-[32px] shadow-2xl p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400"
        >
          <X size={20} />
        </button>
        <div className="text-center mb-6">
          <Calendar size={32} className="mx-auto text-zippy-main mb-2" />
          <h2 className="text-xl font-black text-zippy-dark uppercase">Programar Viaje</h2>
        </div>
        <div className="space-y-4">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl mt-6"
        >
          {loading ? <Loader2 className="animate-spin mx-auto" /> : 'Confirmar Horario'}
        </button>
      </div>
    </div>
  );
};

const TripReceiptDetailModal = ({
  ride,
  tariffConfig,
  onClose,
}: {
  ride: Ride;
  tariffConfig: TariffConfig;
  onClose: () => void;
}) => {
  const baseFare = ride.base_fare ?? tariffConfig.baseFare;
  const tip = ride.tip_amount || 0;
  const distFare = ride.distance_fare ?? Math.max(0, ride.price - baseFare);
  const total = ride.total_paid || ride.price + tip;

  return (
    <div className="fixed inset-0 z-[130] bg-zippy-dark/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl relative">
        <div className="bg-zippy-dark text-white p-6 text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white"
          >
            <X size={18} />
          </button>
          <Receipt size={28} className="mx-auto text-zippy-main mb-2" />
          <h3 className="font-black uppercase text-lg">Recibo Desglosado</h3>
          <p className="text-[10px] text-white/60 font-bold">
            {new Date(ride.created_at || '').toLocaleString()}
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-1 text-xs">
            <p className="font-bold text-gray-500">Origen: {ride.pickup_label}</p>
            <p className="font-black text-zippy-dark">Destino: {ride.destination_label}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded-2xl space-y-2 text-xs">
            <div className="flex justify-between font-bold text-gray-500">
              <span>Tarifa base</span>
              <span>${baseFare}.00</span>
            </div>
            <div className="flex justify-between font-bold text-gray-500">
              <span>Distancia ({ride.distance_km || '—'} km)</span>
              <span>${distFare}.00</span>
            </div>
            {ride.time_fare ? (
              <div className="flex justify-between font-bold text-gray-500">
                <span>Tiempo ({ride.estimated_minutes || '—'} min)</span>
                <span>${ride.time_fare}.00</span>
              </div>
            ) : null}
            <div className="flex justify-between font-bold text-green-600">
              <span>Propina</span>
              <span>${tip}.00</span>
            </div>
            <div className="h-px bg-gray-200 my-1"></div>
            <div className="flex justify-between font-black text-zippy-dark text-base">
              <span>Total Pagado</span>
              <span>${total}.00 MXN</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-full py-3.5 bg-zippy-dark text-white rounded-2xl font-black text-xs uppercase"
          >
            Cerrar Recibo
          </button>
        </div>
      </div>
    </div>
  );
};

const TopUpWalletModal = ({
  onClose,
  onTopUp,
}: {
  onClose: () => void;
  onTopUp: (amount: number) => void;
}) => (
  <div className="fixed inset-0 z-[130] bg-zippy-dark/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
    <div className="bg-white w-full max-w-sm rounded-[32px] p-6 relative shadow-2xl">
      <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400">
        <X size={18} />
      </button>
      <h3 className="text-xl font-black text-zippy-dark uppercase mb-2 text-center">Recargar Saldo</h3>
      <p className="text-xs text-gray-400 font-bold text-center mb-6">Selecciona un monto en MXN</p>
      <div className="grid grid-cols-2 gap-3">
        {[100, 200, 500, 1000].map((amt) => (
          <button
            key={amt}
            onClick={() => onTopUp(amt)}
            className="py-4 bg-gray-50 border-2 border-gray-100 hover:border-zippy-main rounded-2xl font-black text-xl text-zippy-dark active:scale-95 transition-all"
          >
            +${amt}
          </button>
        ))}
      </div>
    </div>
  </div>
);

const SupportTicketModal = ({
  userId,
  userName,
  onClose,
  onCreated,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
  onCreated: (t: SupportTicket) => void;
}) => {
  const [category, setCategory] = useState<SupportTicket['category']>('objeto_perdido');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;
    setSaving(true);
    const created = await createSupportTicket({
      user_id: userId,
      user_name: userName,
      category,
      subject: subject.trim(),
      description: description.trim(),
    });
    setSaving(false);
    onCreated(created);
  };

  return (
    <div className="fixed inset-0 z-[130] bg-zippy-dark/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-sm rounded-[32px] p-6 relative shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400">
          <X size={18} />
        </button>
        <h3 className="text-lg font-black text-zippy-dark uppercase mb-4">Centro de Soporte</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as SupportTicket['category'])}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs text-zippy-dark"
          >
            <option value="objeto_perdido">Objeto Perdido</option>
            <option value="disputa">Disputa de Tarifa</option>
            <option value="reembolso">Solicitud de Reembolso</option>
            <option value="soporte">Soporte General</option>
          </select>
          <input
            required
            placeholder="Asunto breve"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs"
          />
          <textarea
            required
            rows={4}
            placeholder="Describe lo sucedido..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs resize-none"
          />
          <button
            disabled={saving}
            className="w-full py-4 bg-zippy-dark text-white rounded-2xl font-black text-xs uppercase shadow-lg"
          >
            {saving ? <Loader2 className="animate-spin mx-auto" /> : 'Enviar Reporte'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PassengerApp;
