import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Power, Map, Loader2, Star, BellRing, X, Navigation, CheckCircle, TrendingUp,
  DollarSign, LogOut, Phone, MessageCircle, Navigation2, Minus, Plus,
  User, History, Wallet, ChevronRight, Camera, Save, MapPin, Calendar, Clock,
  ArrowLeft, Mail, ShieldCheck, CreditCard, Filter, Eye, EyeOff, Smartphone, Shield, Wind, VolumeX, AlertOctagon,
  Gift, Trash2, Share2, Siren, MessageSquare, Car, ChevronDown, ChevronUp,
  XCircle, CheckSquare, Zap, Check, CheckCircle2, RotateCcw, RefreshCw, KeyRound, Edit3, Banknote, ExternalLink
} from 'lucide-react';
import MapVisual from './MapVisual';
import { RideStatus, Ride } from '../types';
import { supabase } from '../services/supabase';
import DriverRegistration from './DriverRegistration';
import ChatModal from './ChatModal';
import EmergencyDirectory from './EmergencyDirectory';
import NotificationToast, { NotificationType } from './NotificationToast';
import {
  DRIVER_RATING_TAGS,
  calculateHaversineKm,
  enrichRideWithLocalMeta,
  updateProfileResilient,
  updateRideResilient,
} from '../services/rideService';

interface DriverAppProps {
  onBack: () => void;
}

const SOUNDS = {
  newRequest: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
  assigned: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  cancel: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  message: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',
  sos: 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3',
  cash: 'https://assets.mixkit.co/active_storage/sfx/2004/2004-preview.mp3',
};

const REQUEST_TIMEOUT_SECONDS = 20;

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

const DriverApp: React.FC<DriverAppProps> = ({ onBack }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [isApplying, setIsApplying] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [view, setView] = useState<'home' | 'history' | 'profile' | 'wallet'>('home');
  const [rideStatus, setRideStatus] = useState<RideStatus>(RideStatus.IDLE);
  const [loading, setLoading] = useState(false);
  const [availableRides, setAvailableRides] = useState<Ride[]>([]);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const [isRequestsMinimized, setIsRequestsMinimized] = useState(false);

  const [newRequestAlert, setNewRequestAlert] = useState<Ride | null>(null);
  const [requestCountdown, setRequestCountdown] = useState<number>(REQUEST_TIMEOUT_SECONDS);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const soundLoopRef = useRef<number | null>(null);

  const [toast, setToast] = useState<{ msg: string; type: NotificationType; visible: boolean }>({
    msg: '',
    type: 'info',
    visible: false,
  });
  const [tipNotification, setTipNotification] = useState<{ message: string; amount: number } | null>(null);

  const [showPassengerModal, setShowPassengerModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<Ride | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [sosActive, setSosActive] = useState(false);

  // PIN Validation, Swipe-to-Start & Waiting Timer
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [slideProgress, setSlideProgress] = useState(0);
  const [waitSeconds, setWaitSeconds] = useState(0);

  // Step 7: Rate Passenger Modal & Wallet Withdrawal
  const [showRatePassengerModal, setShowRatePassengerModal] = useState(false);
  const [passengerRating, setPassengerRating] = useState(5);
  const [passengerRatingTags, setPassengerRatingTags] = useState<string[]>([]);
  const [walletPeriod, setWalletPeriod] = useState<'today' | 'week' | 'all'>('today');
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [bankClabe, setBankClabe] = useState('');

  const [pendingOffer, setPendingOffer] = useState<{ rideId: string; offerId: string } | null>(null);
  const [requestPassenger, setRequestPassenger] = useState<{
    name: string;
    rating: number;
    trips: number;
    photo: string;
    phone?: string;
  } | null>(null);

  const [currentLocation, setCurrentLocation] = useState<[number, number] | undefined>(undefined);
  const [gpsError, setGpsError] = useState(false);
  const [negotiationPrices, setNegotiationPrices] = useState<{ [key: string]: number }>({});

  const [driverProfile, setDriverProfile] = useState({
    id: '',
    name: '',
    email: '',
    phone: '',
    rating: 4.9,
    carModel: '',
    carPlate: '',
    carColor: '',
    taxiNumber: '',
    avatarUrl: '',
    tripsToday: 0,
    earningsToday: 0,
    licenseStatus: '',
    verificationStatus: 'verified' as string,
    isSuspended: false,
  });

  const [history, setHistory] = useState<Ride[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);

  const [isEditing, setIsEditing] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const locationRef = useRef<[number, number] | undefined>(undefined);

  const playSound = (soundUrl: string, loop = false) => {
    const audio = new Audio(soundUrl);
    audio.loop = loop;
    audio.play().catch((e) => console.warn('Audio play failed:', e));
    return audio;
  };

  const showToast = useCallback((msg: string, type: NotificationType) => {
    setToast({ msg, type, visible: true });
  }, []);

  const unlockAudio = () => {
    const audio = new Audio(SOUNDS.newRequest);
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
      })
      .catch(() => {});
  };

  // --- PERSIST ONLINE/OFFLINE STATUS IN SUPABASE ---
  const toggleOnline = async () => {
    if (
      driverProfile.isSuspended ||
      driverProfile.verificationStatus === 'suspended' ||
      driverProfile.verificationStatus === 'rejected'
    ) {
      showToast('Tu cuenta está suspendida o rechazada. Contacta a administración.', 'error');
      return;
    }
    if (driverProfile.verificationStatus === 'pending') {
      showToast('Tu documentación aún está en revisión por administración.', 'warning');
      return;
    }

    const nextOnline = !isOnline;
    if (nextOnline) {
      unlockAudio();
      showToast('En turno. Esperando solicitudes cercanas...', 'info');
    } else {
      showToast('Te has desconectado.', 'info');
    }

    setIsOnline(nextOnline);
    if (driverProfile.id) {
      await updateProfileResilient(
        driverProfile.id,
        { status: nextOnline ? 'online' : 'offline' },
        { is_online: nextOnline }
      );
    }
  };

  // --- 20-SECOND REQUEST COUNTDOWN TIMER ---
  useEffect(() => {
    if (!newRequestAlert && !showPassengerModal) {
      setRequestCountdown(REQUEST_TIMEOUT_SECONDS);
      return;
    }
    setRequestCountdown(REQUEST_TIMEOUT_SECONDS);
    const timer = window.setInterval(() => {
      setRequestCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setNewRequestAlert(null);
          setShowPassengerModal(false);
          setSelectedRequest(null);
          showToast('Solicitud expirada por tiempo.', 'info');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [newRequestAlert?.id, showPassengerModal, showToast]);

  // --- WAITING TIMER IN ARRIVED / PASSENGER_READY ---
  useEffect(() => {
    if (rideStatus !== RideStatus.ARRIVED && rideStatus !== RideStatus.PASSENGER_READY) {
      setWaitSeconds(0);
      return;
    }
    const startTs = activeRide?.arrived_at ? new Date(activeRide.arrived_at).getTime() : Date.now();
    const tick = () => {
      setWaitSeconds(Math.max(0, Math.floor((Date.now() - startTs) / 1000)));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [rideStatus, activeRide?.arrived_at]);

  // --- ALERT SOUND LOOP ---
  useEffect(() => {
    if (newRequestAlert && !showPassengerModal) {
      playSound(SOUNDS.newRequest);
      speak('Nueva solicitud de viaje cercana.');
      soundLoopRef.current = window.setInterval(() => {
        playSound(SOUNDS.newRequest);
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      }, 3000);
    } else if (soundLoopRef.current) {
      clearInterval(soundLoopRef.current);
      soundLoopRef.current = null;
    }
    return () => {
      if (soundLoopRef.current) clearInterval(soundLoopRef.current);
    };
  }, [newRequestAlert, showPassengerModal]);

  const hydrateDriverProfile = useCallback(async (userId: string) => {
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (!profile || (profile.role && profile.role !== 'DRIVER')) return;
    setDriverProfile((prev) => ({
      ...prev,
      id: userId,
      name: profile.full_name || 'Conductor Zippy',
      email: profile.email || '',
      taxiNumber: profile.taxi_number || 'S/N',
      carModel: profile.car_model || 'Vehículo',
      carPlate: profile.car_plate || '---',
      carColor: profile.car_color || 'Blanco',
      phone: profile.phone || '',
      avatarUrl: profile.avatar_url || '',
      rating: profile.rating || 4.9,
      tripsToday: profile.trips_completed || 0,
      verificationStatus: profile.verification_status || 'verified',
      isSuspended: Boolean(profile.is_suspended),
    }));
    setIsAuthenticated(true);
    if (
      profile.status === 'online' &&
      !profile.is_suspended &&
      profile.verification_status !== 'pending' &&
      profile.verification_status !== 'rejected' &&
      profile.verification_status !== 'suspended'
    ) {
      setIsOnline(true);
    }
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await hydrateDriverProfile(session.user.id);
      }
    };
    checkSession();
  }, [hydrateDriverProfile]);

  const handleDriverLogout = useCallback(async (): Promise<void> => {
    try {
      if (driverProfile.id && isOnline) {
        await supabase.from('profiles').update({ status: 'offline' }).eq('id', driverProfile.id);
      }
    } catch (err: unknown) {
      console.error('Error al desconectar conductor:', err);
    }
    setIsOnline(false);
    setIsAuthenticated(false);
    onBack();
  }, [driverProfile.id, isOnline, onBack]);

  // --- CLEAN MEMORY RESET ---
  const handleResetToIdle = useCallback(() => {
    setActiveRide(null);
    setRideStatus(RideStatus.IDLE);
    setNewRequestAlert(null);
    setSelectedRequest(null);
    setPendingOffer(null);
    setRequestPassenger(null);
    setEnteredPin('');
    setPinError('');
    setSlideProgress(0);
    setWaitSeconds(0);
    setShowRatePassengerModal(false);
    setPassengerRating(5);
    setPassengerRatingTags([]);
    setView('home');
    setNegotiationPrices({});

    const fetchRequesting = async () => {
      const { data } = await supabase.from('rides').select('*').eq('status', RideStatus.REQUESTING);
      if (data) {
        const ignored: string[] = JSON.parse(localStorage.getItem('zippy_ignored_rides') || '[]');
        const valid = (data as Ride[])
          .map(enrichRideWithLocalMeta)
          .filter((r) => !ignored.includes(r.id));
        setAvailableRides(valid);
      } else {
        setAvailableRides([]);
      }
    };
    fetchRequesting();
  }, []);

  // --- MANUAL DATA REFRESH (FIXED: includes COMPLETED and ARCHIVED!) ---
  const refreshDriverData = useCallback(async () => {
    if (!driverProfile.id) return;
    setLoading(true);
    try {
      const { data: rides } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', driverProfile.id)
        .in('status', ['COMPLETED', 'ARCHIVED'])
        .order('created_at', { ascending: false });

      if (rides) {
        const enriched = (rides as Ride[]).map(enrichRideWithLocalMeta);
        setHistory(enriched);
        const total = enriched.reduce((acc, r) => acc + (r.price || 0) + (r.tip_amount || 0), 0);
        setTotalEarnings(total);
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', driverProfile.id)
        .single();
      if (profile) {
        setDriverProfile((prev) => ({
          ...prev,
          rating: profile.rating || prev.rating,
          tripsToday: profile.trips_completed || prev.tripsToday,
          verificationStatus: profile.verification_status || prev.verificationStatus,
          isSuspended: Boolean(profile.is_suspended),
        }));
      }

      if (activeRide) {
        const { data: ride } = await supabase.from('rides').select('*').eq('id', activeRide.id).single();
        if (ride) {
          const enrichedRide = enrichRideWithLocalMeta(ride as Ride);
          if (
            enrichedRide.status === RideStatus.ARCHIVED ||
            (enrichedRide.status === RideStatus.COMPLETED && enrichedRide.is_paid)
          ) {
            setShowRatePassengerModal(true);
          } else if (enrichedRide.status !== rideStatus) {
            setRideStatus(enrichedRide.status);
            setActiveRide(enrichedRide);
          }
        } else {
          handleResetToIdle();
        }
      }

      showToast('Datos y ganancias actualizados', 'success');
    } catch (error) {
      console.error(error);
      showToast('Error al sincronizar datos', 'error');
    } finally {
      setLoading(false);
    }
  }, [driverProfile.id, activeRide, rideStatus, handleResetToIdle, showToast]);

  useEffect(() => {
    if (isAuthenticated && driverProfile.id && (view === 'history' || view === 'wallet')) {
      refreshDriverData();
    }
  }, [view, isAuthenticated, driverProfile.id, refreshDriverData]);

  // --- GPS WATCH + HEARTBEAT ---
  useEffect(() => {
    if (!isAuthenticated || !driverProfile.id) return;

    if (!isOnline) {
      setGpsError(false);
      return;
    }

    if (!('geolocation' in navigator)) {
      showToast('GPS no soportado. No podrás recibir viajes.', 'error');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCurrentLocation([latitude, longitude]);
        locationRef.current = [latitude, longitude];
        setGpsError(false);
      },
      (error) => {
        console.error('GPS Error:', error);
        if (error.code === 1) showToast('GPS Bloqueado. Habilita permisos.', 'error');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );

    const heartbeat = setInterval(async () => {
      if (!locationRef.current) return;
      const [lat, lng] = locationRef.current;

      await supabase.from('profiles').update({ lat, lng }).eq('id', driverProfile.id);

      if (activeRide?.id) {
        await supabase.from('rides').update({ driver_lat: lat, driver_lng: lng }).eq('id', activeRide.id);
      }
    }, 3000);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat);
    };
  }, [isAuthenticated, isOnline, activeRide?.id, driverProfile.id, showToast]);

  const retryGps = () => {
    setGpsError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCurrentLocation([pos.coords.latitude, pos.coords.longitude]);
        locationRef.current = [pos.coords.latitude, pos.coords.longitude];
      },
      () => setGpsError(true),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  const fetchPassengerDetails = useCallback(async (passengerId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, rating, avatar_url, phone')
      .eq('id', passengerId)
      .single();
    if (data) {
      setRequestPassenger({
        name: data.full_name || 'Pasajero Zippy',
        rating: data.rating || 5.0,
        trips: 1,
        photo:
          data.avatar_url ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(data.full_name || 'Pasajero')}&background=random`,
        phone: data.phone,
      });
    }
  }, []);

  // --- REALTIME SUBSCRIPTION FOR RIDES & STATUS ---
  useEffect(() => {
    if (!isAuthenticated || !driverProfile.id) return;

    const fetchRequesting = async () => {
      const { data } = await supabase.from('rides').select('*').eq('status', RideStatus.REQUESTING);
      if (data) {
        const ignored: string[] = JSON.parse(localStorage.getItem('zippy_ignored_rides') || '[]');
        const valid = (data as Ride[])
          .map(enrichRideWithLocalMeta)
          .filter((r) => !ignored.includes(r.id));
        setAvailableRides(valid);
        valid.forEach((r) => setNegotiationPrices((prev) => ({ ...prev, [r.id]: r.price })));
      }

      const { data: activeList } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', driverProfile.id)
        .in('status', [
          RideStatus.ACCEPTED,
          RideStatus.ARRIVED,
          RideStatus.PASSENGER_READY,
          RideStatus.IN_PROGRESS,
          RideStatus.PAYMENT_PENDING,
          RideStatus.RATING,
        ])
        .order('created_at', { ascending: false })
        .limit(1);

      const active = activeList?.[0] ? enrichRideWithLocalMeta(activeList[0] as Ride) : null;
      if (active) {
        setActiveRide(active);
        setRideStatus(active.status);
        if (active.passenger_id) fetchPassengerDetails(active.passenger_id);
        if (active.status === RideStatus.RATING && active.is_paid) {
          setShowRatePassengerModal(true);
        }
      } else if (activeRide && !showRatePassengerModal) {
        handleResetToIdle();
      }
    };

    if (isOnline) fetchRequesting();

    const backupInterval = setInterval(async () => {
      if (!isOnline || !driverProfile.id || !activeRide) return;
      const { data } = await supabase.from('rides').select('*').eq('id', activeRide.id).single();
      if (!data) return;
      const updated = enrichRideWithLocalMeta(data as Ride);

      if (updated.tip_amount && updated.tip_amount > (activeRide.tip_amount || 0)) {
        playSound(SOUNDS.cash);
        speak(`¡Recibiste una propina de ${updated.tip_amount} pesos!`);
        setTipNotification({
          message: '¡El pasajero te envió una propina!',
          amount: updated.tip_amount,
        });
        setTimeout(() => setTipNotification(null), 5000);
      }

      if (
        updated.status === RideStatus.RATING ||
        updated.status === RideStatus.ARCHIVED ||
        (updated.status === RideStatus.COMPLETED && updated.is_paid)
      ) {
        if (!showRatePassengerModal) {
          setActiveRide(updated);
          setRideStatus(updated.status);
          setShowRatePassengerModal(true);
        }
      } else if (updated.status === RideStatus.CANCELLED) {
        handleResetToIdle();
      } else if (updated.status !== activeRide.status || updated.is_paid !== activeRide.is_paid) {
        setActiveRide(updated);
        setRideStatus(updated.status);
      }
    }, 5000);

    const channel = supabase
      .channel('driver_main_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, (payload) => {
        const newRide = enrichRideWithLocalMeta(payload.new as Ride);
        const currentIgnored: string[] = JSON.parse(localStorage.getItem('zippy_ignored_rides') || '[]');
        if (newRide.status === RideStatus.REQUESTING && !currentIgnored.includes(newRide.id) && isOnline && !activeRide) {
          setAvailableRides((prev) => {
            if (prev.find((r) => r.id === newRide.id)) return prev;
            return [newRide, ...prev];
          });
          setNegotiationPrices((prev) => ({ ...prev, [newRide.id]: newRide.price }));
          if (newRide.passenger_id) fetchPassengerDetails(newRide.passenger_id);
          setNewRequestAlert(newRide);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, (payload) => {
        const updated = enrichRideWithLocalMeta(payload.new as Ride);

        if (updated.driver_id === driverProfile.id && updated.status === RideStatus.ACCEPTED && !activeRide) {
          setPendingOffer(null);
          setActiveRide(updated);
          setRideStatus(RideStatus.ACCEPTED);
          setAvailableRides((prev) => prev.filter((r) => r.id !== updated.id));
          if (updated.passenger_id) fetchPassengerDetails(updated.passenger_id);
          playSound(SOUNDS.assigned);
          speak('Navegando al punto de recogida.');
          setNewRequestAlert(null);
          setShowPassengerModal(false);
        }

        if (activeRide && updated.id === activeRide.id) {
          if (updated.is_paid && !activeRide.is_paid) {
            playSound(SOUNDS.cash);
            speak('Pago confirmado por el pasajero.');
            showToast('¡Pago recibido! Califica al pasajero.', 'success');
            setDriverProfile((prev) => ({
              ...prev,
              tripsToday: prev.tripsToday + 1,
              earningsToday: prev.earningsToday + updated.price,
            }));
            setActiveRide(updated);
            setRideStatus(updated.status);
            setShowRatePassengerModal(true);
          }

          if (updated.tip_amount && updated.tip_amount > (activeRide.tip_amount || 0)) {
            playSound(SOUNDS.cash);
            speak(`¡Recibiste una propina de ${updated.tip_amount} pesos!`);
            setTipNotification({
              message: '¡El pasajero ha enviado una propina!',
              amount: updated.tip_amount,
            });
            setTimeout(() => setTipNotification(null), 5000);
            setActiveRide((prev) => (prev ? { ...prev, tip_amount: updated.tip_amount } : null));
          }

          if (updated.status === RideStatus.CANCELLED) {
            playSound(SOUNDS.cancel);
            speak('El pasajero ha cancelado el viaje.');
            showToast('Viaje cancelado por el pasajero.', 'error');
            handleResetToIdle();
            return;
          }

          if (
            updated.status === RideStatus.RATING ||
            updated.status === RideStatus.COMPLETED ||
            updated.status === RideStatus.ARCHIVED
          ) {
            setActiveRide(updated);
            setRideStatus(updated.status);
            if (updated.is_paid) {
              setShowRatePassengerModal(true);
            }
            return;
          }

          setRideStatus(updated.status);
          setActiveRide((prev) => (prev ? { ...prev, ...updated } : updated));
        }

        if (updated.status !== RideStatus.REQUESTING && updated.driver_id !== driverProfile.id) {
          setAvailableRides((prev) => prev.filter((r) => r.id !== updated.id));
          if (newRequestAlert?.id === updated.id) {
            setNewRequestAlert(null);
            setShowPassengerModal(false);
          }
        }
      })
      .subscribe();

    const msgChannel = activeRide?.id
      ? supabase
          .channel(`driver_messages:${driverProfile.id}:${activeRide.id}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages', filter: `ride_id=eq.${activeRide.id}` },
            (payload) => {
              const msg = payload.new as any;
              if (msg.sender_id !== driverProfile.id) {
                setChatOpen(true);
                playSound(SOUNDS.message);
                speak('Nuevo mensaje del pasajero.');
                showToast('Nuevo mensaje del pasajero', 'message');
              }
            }
          )
          .subscribe()
      : null;

    return () => {
      supabase.removeChannel(channel);
      if (msgChannel) supabase.removeChannel(msgChannel);
      clearInterval(backupInterval);
    };
  }, [
    isAuthenticated,
    isOnline,
    driverProfile.id,
    activeRide,
    rideStatus,
    newRequestAlert?.id,
    showRatePassengerModal,
    fetchPassengerDetails,
    handleResetToIdle,
    showToast,
  ]);

  const resolveLoginEmail = (identifier: string): string => {
    const trimmed = identifier.trim().toLowerCase();
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
          if (roleCheck?.role && roleCheck.role !== 'DRIVER') {
            await supabase.auth.signOut();
            throw new Error('Esta cuenta no corresponde al perfil de Conductor.');
          }
          await hydrateDriverProfile(data.user.id);
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: fullName, role: 'DRIVER' } },
        });
        if (error) throw error;
        showToast('¡Registro exitoso! Ahora inicia sesión.', 'success');
        setAuthMode('login');
      }
    } catch (err: any) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- CONCURRENCY-SAFE ACCEPT ---
  const handleAcceptRequest = async (overrideRequest?: Ride) => {
    const target = overrideRequest || selectedRequest || newRequestAlert;
    if (!target) return;
    if (!currentLocation) {
      showToast('Esperando ubicación GPS...', 'warning');
      return;
    }
    setLoading(true);
    const agreedPrice = negotiationPrices[target.id] || target.price;
    try {
      const { data: claimed, error } = await supabase
        .from('rides')
        .update({
          status: RideStatus.ACCEPTED,
          driver_id: driverProfile.id,
          price: agreedPrice,
          driver_lat: currentLocation[0],
          driver_lng: currentLocation[1],
        })
        .eq('id', target.id)
        .eq('status', RideStatus.REQUESTING)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!claimed) {
        setAvailableRides((prev) => prev.filter((r) => r.id !== target.id));
        setNewRequestAlert(null);
        setShowPassengerModal(false);
        showToast('Este viaje ya fue tomado por otro conductor.', 'warning');
        return;
      }

      await supabase.from('messages').insert({
        ride_id: target.id,
        sender_id: driverProfile.id,
        role: 'DRIVER',
        text: '¡Hola! He aceptado tu viaje. Voy en camino.',
      });

      playSound(SOUNDS.assigned);
      setNewRequestAlert(null);
      setShowPassengerModal(false);
      setShowSuccessOverlay(true);

      const claimedRide = enrichRideWithLocalMeta(claimed as Ride);

      setTimeout(() => {
        setShowSuccessOverlay(false);
        setActiveRide({ ...target, ...claimedRide, status: RideStatus.ACCEPTED, driver_id: driverProfile.id, price: agreedPrice });
        setRideStatus(RideStatus.ACCEPTED);
        setAvailableRides((prev) => prev.filter((r) => r.id !== target.id));
        if (target.passenger_id) fetchPassengerDetails(target.passenger_id);
      }, 1200);
    } catch (err: any) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- REJECT REQUEST ---
  const handleRejectRequest = (rideId: string) => {
    const ignored: string[] = JSON.parse(localStorage.getItem('zippy_ignored_rides') || '[]');
    if (!ignored.includes(rideId)) {
      localStorage.setItem('zippy_ignored_rides', JSON.stringify([...ignored, rideId]));
    }
    setAvailableRides((prev) => prev.filter((r) => r.id !== rideId));
    setNewRequestAlert(null);
    setShowPassengerModal(false);
    setSelectedRequest(null);
    showToast('Solicitud rechazada', 'info');
  };

  // --- UPDATE RIDE STATUS (ARRIVED, IN_PROGRESS, PAYMENT_PENDING) ---
  const handleUpdateRideStatus = async (newStatus: RideStatus) => {
    if (!activeRide) return;
    if (!currentLocation) {
      showToast('GPS requerido para continuar', 'warning');
      return;
    }

    try {
      const nowIso = new Date().toISOString();
      const extended: Record<string, unknown> = {};
      if (newStatus === RideStatus.ARRIVED) extended.arrived_at = nowIso;
      if (newStatus === RideStatus.IN_PROGRESS) extended.started_at = nowIso;

      const { error } = await updateRideResilient(
        activeRide.id,
        {
          status: newStatus,
          driver_lat: currentLocation[0],
          driver_lng: currentLocation[1],
        },
        extended
      );
      if (error) throw new Error(error.message);

      setRideStatus(newStatus);
      setActiveRide((prev) => (prev ? { ...prev, status: newStatus, ...(extended as Partial<Ride>) } : null));

      if (newStatus === RideStatus.ARRIVED) {
        playSound(SOUNDS.newRequest);
        speak('Has llegado al punto de recogida. Iniciando tiempo de espera.');
        showToast('Llegada notificada. Cronómetro de cortesía iniciado.', 'info');
        await supabase.from('messages').insert({
          ride_id: activeRide.id,
          sender_id: driverProfile.id,
          text: '¡Hola! Ya llegué al punto de recogida.',
          role: 'DRIVER',
        });
      }

      if (newStatus === RideStatus.IN_PROGRESS) {
        speak('PIN verificado. Iniciando viaje al destino.');
        showToast('¡Viaje iniciado hacia el destino!', 'success');
      }

      if (newStatus === RideStatus.PAYMENT_PENDING) {
        playSound(SOUNDS.cash);
        speak('Viaje finalizado. Procede al cobro con el pasajero.');
        showToast('Viaje finalizado. Confirma la recepción del pago.', 'info');
      }
    } catch (err: any) {
      showToast('Error: ' + err.message, 'error');
    }
  };

  // --- VALIDATE PIN + SLIDE TO START ---
  const handleSlideToStart = (value: number) => {
    setSlideProgress(value);
    if (value >= 92 && activeRide) {
      const expectedPin = activeRide.pin_code;
      if (expectedPin && enteredPin.trim() !== expectedPin) {
        setPinError(`PIN incorrecto. Solicita el código de 4 dígitos al pasajero.`);
        setSlideProgress(0);
        return;
      }
      setPinError('');
      handleUpdateRideStatus(RideStatus.IN_PROGRESS);
    }
  };

  // --- STEP 6: DRIVER CONFIRMS CASH RECEIVED ---
  const handleConfirmCashReceived = async () => {
    if (!activeRide) return;
    setLoading(true);
    try {
      const { error } = await updateRideResilient(
        activeRide.id,
        {
          is_paid: true,
          total_paid: activeRide.price,
          status: RideStatus.RATING,
        },
        {
          payment_confirmed_by_driver: true,
        }
      );
      if (error) throw new Error(error.message);

      playSound(SOUNDS.cash);
      speak('Pago en efectivo confirmado. Califica al pasajero.');
      showToast('Efectivo confirmado. Ahora califica al pasajero.', 'success');
      setDriverProfile((prev) => ({
        ...prev,
        tripsToday: prev.tripsToday + 1,
        earningsToday: prev.earningsToday + activeRide.price,
      }));
      setActiveRide((prev) => (prev ? { ...prev, is_paid: true, status: RideStatus.RATING } : null));
      setRideStatus(RideStatus.RATING);
      setShowRatePassengerModal(true);
    } catch (err: any) {
      showToast('Error al confirmar cobro: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- STEP 7: DRIVER RATES PASSENGER & RESETS CLEAN ---
  const handleSubmitPassengerRating = async () => {
    if (!activeRide) {
      handleResetToIdle();
      return;
    }
    setLoading(true);
    try {
      await updateRideResilient(
        activeRide.id,
        {},
        { driver_rating_for_passenger: passengerRating }
      );
      showToast('Evaluación enviada. Volviendo a buscar pasajeros...', 'success');
      handleResetToIdle();
    } catch {
      handleResetToIdle();
    } finally {
      setLoading(false);
    }
  };

  // --- EXTERNAL TURN-BY-TURN NAVIGATION (GOOGLE MAPS / WAZE) ---
  const openExternalNav = (provider: 'google' | 'waze') => {
    if (!activeRide) return;
    const isHeadingToDest = rideStatus === RideStatus.IN_PROGRESS;
    const targetLat = isHeadingToDest ? activeRide.dest_lat : activeRide.pickup_lat;
    const targetLng = isHeadingToDest ? activeRide.dest_lng : activeRide.pickup_lng;
    const fallbackLabel = isHeadingToDest ? activeRide.destination_label : activeRide.pickup_label;

    const url =
      provider === 'google'
        ? targetLat && targetLng
          ? `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=driving`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackLabel)}`
        : targetLat && targetLng
        ? `https://waze.com/ul?ll=${targetLat},${targetLng}&navigate=yes`
        : `https://waze.com/ul?q=${encodeURIComponent(fallbackLabel)}`;

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  const handleTriggerSOS = async () => {
    if (!activeRide || !currentLocation) return;
    if (!confirm('¿CONFIRMAS QUE ESTÁS EN PELIGRO?')) return;
    try {
      await updateRideResilient(activeRide.id, {
        sos_active: true,
        sos_triggered_by: driverProfile.id,
        sos_at: new Date().toISOString(),
        sos_lat: currentLocation[0],
        sos_lng: currentLocation[1],
      });
      setSosActive(true);
      showToast('ALERTA SOS ENVIADA.', 'error');
      setEmergencyOpen(true);
    } catch (err: any) {
      showToast('Error: ' + err.message, 'error');
    }
  };

  const handleOpenRequest = (ride: Ride) => {
    setSelectedRequest(ride);
    fetchPassengerDetails(ride.passenger_id);
    setNewRequestAlert(null);
    setShowPassengerModal(true);
  };

  const handleShareTrip = async () => {
    if (!activeRide || !currentLocation) return;
    const url = `https://maps.google.com/?q=${currentLocation[0]},${currentLocation[1]}`;
    const text = `🚖 Conductor Zippy en servicio hacia ${activeRide.destination_label}. Ubicación en vivo: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Servicio Zippy en curso', text, url });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Ubicación copiada al portapapeles', 'success');
      }
    } catch {
      showToast('No se pudo compartir ubicación', 'warning');
    }
  };

  const handleDeleteRide = (rideId: string) => handleRejectRequest(rideId);
  const handleCallPassenger = () =>
    requestPassenger?.phone
      ? (window.location.href = `tel:${requestPassenger.phone}`)
      : showToast('Sin número disponible', 'error');

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setIsEditing(true);
  };

  const handleSaveProfile = async () => {
    if (!driverProfile.id) return;
    setLoading(true);
    try {
      let avatarUrl = driverProfile.avatarUrl;
      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop();
        const path = `avatars/driver_${driverProfile.id}_${Date.now()}.${ext}`;
        const { data, error: upErr } = await supabase.storage
          .from('zippy-media')
          .upload(path, avatarFile, { cacheControl: '3600', upsert: true });
        if (!upErr && data) {
          const { data: pub } = supabase.storage.from('zippy-media').getPublicUrl(data.path);
          avatarUrl = pub.publicUrl;
        }
      }

      const { error } = await updateProfileResilient(
        driverProfile.id,
        {
          full_name: driverProfile.name,
          phone: driverProfile.phone,
          car_model: driverProfile.carModel,
          car_plate: driverProfile.carPlate,
          avatar_url: avatarUrl,
        },
        { car_color: driverProfile.carColor }
      );
      if (error) throw new Error(error.message);

      setDriverProfile((prev) => ({ ...prev, avatarUrl }));
      setAvatarFile(null);
      setIsEditing(false);
      showToast('Perfil y vehículo actualizados en BD', 'success');
    } catch (e: any) {
      showToast('Error al guardar: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatTimer = (secs: number): string => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const getMapRoute = () => {
    if (
      !activeRide ||
      !activeRide.id ||
      rideStatus === RideStatus.IDLE ||
      rideStatus === RideStatus.COMPLETED ||
      rideStatus === RideStatus.PAYMENT_PENDING ||
      rideStatus === RideStatus.RATING
    ) {
      return { start: undefined, end: undefined };
    }
    if (
      rideStatus === RideStatus.ACCEPTED ||
      rideStatus === RideStatus.ARRIVED ||
      rideStatus === RideStatus.PASSENGER_READY
    ) {
      return {
        start: currentLocation,
        end:
          activeRide.pickup_lat && activeRide.pickup_lng
            ? ([activeRide.pickup_lat, activeRide.pickup_lng] as [number, number])
            : undefined,
      };
    }
    if (rideStatus === RideStatus.IN_PROGRESS) {
      return {
        start: currentLocation,
        end:
          activeRide.dest_lat && activeRide.dest_lng
            ? ([activeRide.dest_lat, activeRide.dest_lng] as [number, number])
            : undefined,
      };
    }
    return { start: undefined, end: undefined };
  };
  const mapRoute = getMapRoute();

  // --- EARNINGS BREAKDOWN BY PERIOD ---
  const filteredWalletRides = history.filter((r) => {
    if (!r.created_at) return walletPeriod === 'all';
    const d = new Date(r.created_at).getTime();
    const now = Date.now();
    if (walletPeriod === 'today') return now - d <= 24 * 60 * 60 * 1000;
    if (walletPeriod === 'week') return now - d <= 7 * 24 * 60 * 60 * 1000;
    return true;
  });
  const periodBaseEarnings = filteredWalletRides.reduce((acc, r) => acc + (r.price || 0), 0);
  const periodTips = filteredWalletRides.reduce((acc, r) => acc + (r.tip_amount || 0), 0);
  const periodTotal = periodBaseEarnings + periodTips;

  // --- INCOMING REQUEST POPUP WITH 20s TIMER, DISTANCE PREVIEW & REJECT ---
  const renderPassengerModal = () => {
    const target = selectedRequest || newRequestAlert;
    if (!target) return null;
    const price = negotiationPrices[target.id] || target.price;
    const distToPickup =
      currentLocation && target.pickup_lat && target.pickup_lng
        ? calculateHaversineKm(currentLocation[0], currentLocation[1], target.pickup_lat, target.pickup_lng)
        : null;
    const etaToPickup = distToPickup !== null ? Math.max(Math.round((distToPickup / 25) * 60), 1) : null;

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
        <div className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl relative animate-slide-up flex flex-col max-h-[90vh]">
          {/* Countdown Progress Bar */}
          <div className="w-full h-2 bg-gray-200">
            <div
              className="h-full bg-zippy-main transition-all duration-1000 ease-linear"
              style={{ width: `${(requestCountdown / REQUEST_TIMEOUT_SECONDS) * 100}%` }}
            />
          </div>

          <div className="bg-zippy-dark p-6 pb-10 text-center relative">
            <div className="absolute top-4 left-4 bg-zippy-main text-zippy-dark px-3 py-1 rounded-full font-black text-xs flex items-center gap-1">
              <Clock size={12} /> {requestCountdown}s
            </div>
            <button
              onClick={() => handleRejectRequest(target.id)}
              className="absolute top-4 right-4 z-20 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <X size={20} className="text-white" />
            </button>
            <div className="relative z-10 flex flex-col items-center mt-2">
              <div className="w-20 h-20 rounded-full p-1 bg-gradient-to-tr from-zippy-main to-white shadow-[0_0_30px_rgba(253,202,1,0.5)] mb-2">
                <img
                  src={requestPassenger?.photo || `https://ui-avatars.com/api/?name=Pasajero&background=random`}
                  className="w-full h-full rounded-full object-cover border-4 border-zippy-dark"
                />
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight">
                {requestPassenger?.name || 'Nuevo Pasajero'}
              </h2>
              <p className="text-zippy-main text-xs font-bold mt-0.5">
                ★ {requestPassenger?.rating?.toFixed(1) || '5.0'} •{' '}
                {target.vehicle_category || 'ECONOMICO'} •{' '}
                {target.payment_method === 'card'
                  ? 'Tarjeta'
                  : target.payment_method === 'wallet'
                  ? 'Billetera'
                  : 'Efectivo'}
              </p>
            </div>
          </div>

          <div className="flex-1 p-6 -mt-6 bg-white rounded-t-[32px] relative z-20 flex flex-col gap-4 overflow-y-auto">
            <div className="flex justify-between items-center bg-gray-50 p-4 rounded-3xl border-2 border-gray-100 shadow-sm">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  GANANCIA ESTIMADA
                </span>
                <span className="text-5xl font-black text-zippy-dark tracking-tighter leading-none">
                  ${price}
                </span>
              </div>
              <div className="text-right">
                {distToPickup !== null && (
                  <span className="block text-xs font-black text-blue-700 bg-blue-50 px-3 py-1 rounded-xl mb-1">
                    A {distToPickup.toFixed(1)} km ({etaToPickup} min)
                  </span>
                )}
                {target.distance_km ? (
                  <span className="text-[10px] font-bold text-gray-400 uppercase">
                    Viaje: {target.distance_km} km
                  </span>
                ) : null}
              </div>
            </div>

            <div className="space-y-3 relative pl-2">
              <div className="flex gap-3 items-start">
                <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <div className="w-2.5 h-2.5 bg-green-500 rounded-full"></div>
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Recoger en</p>
                  <h3 className="font-bold text-zippy-dark text-sm">{target.pickup_label}</h3>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <div className="w-2.5 h-2.5 bg-red-500 rounded-full"></div>
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Destino</p>
                  <h3 className="font-bold text-zippy-dark text-sm">{target.destination_label}</h3>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 pt-2 bg-white flex-shrink-0 border-t border-gray-50 flex gap-3">
            <button
              onClick={() => handleRejectRequest(target.id)}
              className="px-5 py-4 rounded-2xl bg-red-50 text-red-600 font-black text-xs uppercase hover:bg-red-100 active:scale-95 transition-all"
            >
              Rechazar
            </button>
            <button
              onClick={() => handleAcceptRequest(target)}
              disabled={loading}
              className="flex-1 py-4 rounded-2xl bg-zippy-main text-zippy-dark font-black text-lg uppercase shadow-[0_10px_30px_rgba(253,202,1,0.5)] hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 size={24} className="animate-spin" />
              ) : (
                <>
                  <Zap size={22} className="fill-zippy-dark" /> ACEPTAR
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // --- STEP 7: RATE PASSENGER MODAL ---
  const renderRatePassengerModal = () => (
    <div className="fixed inset-0 z-[10000] bg-zippy-dark/95 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
      <div className="bg-white w-full max-w-sm rounded-[36px] overflow-hidden shadow-2xl">
        <div className="bg-green-600 p-6 text-center text-white">
          <CheckCircle2 size={44} className="mx-auto mb-2" />
          <h3 className="text-xl font-black uppercase">Servicio Completado</h3>
          <p className="text-xs font-bold text-white/80">
            Califica a {requestPassenger?.name || 'tu pasajero'}
          </p>
        </div>
        <div className="p-6 space-y-5 text-center">
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setPassengerRating(star)}
                className="active:scale-90 transition-transform"
              >
                <Star
                  size={34}
                  className={star <= passengerRating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'}
                />
              </button>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {DRIVER_RATING_TAGS.map((tag) => {
              const active = passengerRatingTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() =>
                    setPassengerRatingTags((prev) =>
                      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                    )
                  }
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border ${
                    active
                      ? 'bg-zippy-dark text-white border-zippy-dark'
                      : 'bg-gray-50 text-gray-500 border-gray-200'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>

          <button
            onClick={handleSubmitPassengerRating}
            disabled={loading}
            className="w-full py-4 bg-zippy-dark text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl"
          >
            {loading ? <Loader2 className="animate-spin mx-auto" /> : 'Finalizar y Buscar Pasajeros'}
          </button>
        </div>
      </div>
    </div>
  );

  // --- EDITABLE PROFILE VIEW ---
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
          onClick={() => (isEditing ? handleSaveProfile() : setIsEditing(true))}
          className="absolute top-4 right-4 px-3 py-2 bg-zippy-main text-zippy-dark rounded-xl font-black text-[10px] uppercase flex items-center gap-1"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : isEditing ? (
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
                driverProfile.avatarUrl ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(driverProfile.name)}&background=000000&color=F5B901`
              }
              className="w-28 h-28 rounded-full border-4 border-zippy-main shadow-2xl overflow-hidden mb-3 object-cover"
            />
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-3 right-0 p-2 bg-zippy-main text-zippy-dark rounded-full shadow-lg"
            >
              <Camera size={16} />
            </button>
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tight">{driverProfile.name}</h2>
          <span
            className={`mt-1 px-3 py-1 rounded-full text-[10px] font-black uppercase ${
              driverProfile.isSuspended
                ? 'bg-red-500 text-white'
                : driverProfile.verificationStatus === 'pending'
                ? 'bg-yellow-400 text-zippy-dark'
                : 'bg-green-500 text-white'
            }`}
          >
            {driverProfile.isSuspended
              ? 'Cuenta Suspendida'
              : driverProfile.verificationStatus === 'pending'
              ? 'En Revisión'
              : 'Socio Verificado'}
          </span>
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-4">
          <h3 className="text-sm font-black text-zippy-dark uppercase tracking-widest border-b border-gray-100 pb-2">
            Vehículo Asignado
          </h3>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase">Modelo</label>
            <input
              readOnly={!isEditing}
              value={driverProfile.carModel}
              onChange={(e) => setDriverProfile({ ...driverProfile, carModel: e.target.value })}
              className={`w-full font-bold text-zippy-dark rounded-xl px-3 py-2 outline-none ${
                isEditing ? 'bg-gray-50 border border-zippy-main' : 'bg-transparent px-0'
              }`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase">Placas</label>
              <input
                readOnly={!isEditing}
                value={driverProfile.carPlate}
                onChange={(e) => setDriverProfile({ ...driverProfile, carPlate: e.target.value })}
                className={`w-full font-bold text-zippy-dark rounded-xl px-3 py-2 outline-none ${
                  isEditing ? 'bg-gray-50 border border-zippy-main' : 'bg-transparent px-0'
                }`}
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase">Color</label>
              <input
                readOnly={!isEditing}
                value={driverProfile.carColor}
                onChange={(e) => setDriverProfile({ ...driverProfile, carColor: e.target.value })}
                className={`w-full font-bold text-zippy-dark rounded-xl px-3 py-2 outline-none ${
                  isEditing ? 'bg-gray-50 border border-zippy-main' : 'bg-transparent px-0'
                }`}
              />
            </div>
          </div>
          <div className="h-px bg-gray-100 my-2"></div>
          <h3 className="text-sm font-black text-zippy-dark uppercase tracking-widest border-b border-gray-100 pb-2">
            Contacto
          </h3>
          <input
            readOnly={!isEditing}
            placeholder="Teléfono"
            value={driverProfile.phone}
            onChange={(e) => setDriverProfile({ ...driverProfile, phone: e.target.value })}
            className={`w-full font-bold text-zippy-dark rounded-xl px-3 py-2 outline-none ${
              isEditing ? 'bg-gray-50 border border-zippy-main' : 'bg-transparent px-0'
            }`}
          />
          <p className="font-bold text-gray-500 text-xs">{driverProfile.email}</p>
        </div>

        <button
          onClick={() => setIsApplying(true)}
          className="w-full py-4 rounded-2xl bg-blue-50 text-blue-700 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2"
        >
          <ShieldCheck size={18} /> Actualizar Documentación
        </button>

        <button
          onClick={refreshDriverData}
          className="w-full py-4 rounded-2xl bg-zippy-main/10 text-zippy-dark font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 border-2 border-zippy-main/20"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Sincronizar Datos
        </button>

        <button
          type="button"
          onClick={handleDriverLogout}
          className="w-full py-4 rounded-2xl bg-red-50 text-red-600 font-black text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"
        >
          <LogOut size={18} /> Cerrar Sesión
        </button>
      </div>
    </div>
  );

  // --- HISTORY VIEW (COMPLETED + ARCHIVED) ---
  const renderHistory = () => (
    <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24">
      <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10">
        <button
          onClick={() => setView('home')}
          className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-1">Historial</h2>
        <p className="text-center text-white/60 text-xs font-bold uppercase tracking-widest">
          {history.length} Viajes Realizados
        </p>
      </div>
      <div className="p-4 space-y-4">
        {history.length > 0 ? (
          history.map((ride) => (
            <div key={ride.id} className="bg-white p-5 rounded-[24px] shadow-sm border border-gray-100">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <span className="text-xl font-black text-zippy-dark">
                    ${(ride.price || 0) + (ride.tip_amount || 0)}
                  </span>
                  {(ride.tip_amount || 0) > 0 && (
                    <span className="ml-2 text-[10px] bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded font-black">
                      +${ride.tip_amount} propina
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded font-bold uppercase">
                    Completado
                  </span>
                  <p className="text-[10px] text-gray-400 font-bold mt-1">
                    {ride.created_at ? new Date(ride.created_at).toLocaleString() : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <p className="text-xs font-bold text-gray-500 truncate">{ride.pickup_label}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <p className="text-xs font-black text-zippy-dark truncate">{ride.destination_label}</p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-20 opacity-50">
            <History size={48} className="mx-auto mb-4 text-gray-300" />
            <p className="font-bold text-gray-400">Sin historial de viajes aún.</p>
          </div>
        )}
      </div>
    </div>
  );

  // --- WALLET VIEW WITH DAILY / WEEKLY / TOTAL BREAKDOWN + WITHDRAWAL ---
  const renderWallet = () => (
    <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24">
      <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10">
        <button
          onClick={() => setView('home')}
          className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-3">Mis Ganancias</h2>
        <div className="flex bg-white/10 p-1 rounded-xl max-w-xs mx-auto">
          {(['today', 'week', 'all'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setWalletPeriod(p)}
              className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${
                walletPeriod === p ? 'bg-zippy-main text-zippy-dark' : 'text-white/70'
              }`}
            >
              {p === 'today' ? 'Hoy' : p === 'week' ? 'Semana' : 'Total'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="bg-white p-8 rounded-[40px] shadow-xl border border-gray-100 text-center">
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
            Ganancias ({walletPeriod === 'today' ? 'Hoy' : walletPeriod === 'week' ? '7 días' : 'Histórico'})
          </p>
          <h3 className="text-5xl font-black text-zippy-dark tracking-tighter">${periodTotal.toFixed(2)}</h3>

          <div className="grid grid-cols-3 gap-2 mt-6 bg-gray-50 p-4 rounded-2xl">
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase">Tarifas</p>
              <p className="font-black text-zippy-dark text-sm">${periodBaseEarnings}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase">Propinas</p>
              <p className="font-black text-green-600 text-sm">${periodTips}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase">Viajes</p>
              <p className="font-black text-blue-600 text-sm">{filteredWalletRides.length}</p>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={refreshDriverData}
              className="flex-1 py-3 bg-gray-100 text-gray-600 font-black text-xs rounded-xl uppercase flex items-center justify-center gap-2 hover:bg-gray-200"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button
              onClick={() => setWithdrawModalOpen(true)}
              className="flex-1 py-3 bg-green-500 text-white font-black text-xs rounded-xl shadow-lg uppercase active:scale-95"
            >
              Retirar a Banco
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (!isAuthenticated) {
    return (
      <div className="w-full h-screen h-[100dvh] bg-zippy-dark flex flex-col items-center justify-center p-6 animate-fade-in overflow-y-auto">
        <NotificationToast
          message={toast.msg}
          type={toast.type}
          isVisible={toast.visible}
          onClose={() => setToast({ ...toast, visible: false })}
        />
        <img src="https://daloocomercializadora.com.mx/zippylogo.png" alt="Zippy Taxi" className="h-16 mb-6 object-contain" />
        <div className="bg-white p-6 rounded-[32px] w-full max-w-sm shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-[#F5B901]"></div>
          <h2 className="text-lg font-black text-center text-zippy-dark mb-4 uppercase tracking-widest">
            {authMode === 'login' ? 'Conductor' : 'Registro'}
          </h2>
          <form onSubmit={handleAuth} className="space-y-3">
            {authMode === 'register' && (
              <input
                required
                placeholder="Nombre Completo"
                className="w-full p-3 bg-gray-50 border rounded-xl font-bold text-sm"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            )}
            <input
              required
              type={authMode === 'login' ? 'text' : 'email'}
              placeholder={authMode === 'login' ? 'Usuario o Correo Electrónico' : 'Correo Electrónico'}
              className="w-full p-3 bg-gray-50 border rounded-xl font-bold text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="relative">
              <input
                required
                type={showPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                className="w-full p-3 bg-gray-50 border rounded-xl font-bold text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button className="w-full bg-[#005EDD] hover:bg-black text-white font-black py-3 rounded-xl shadow-lg active:scale-95 transition-all uppercase tracking-wide text-xs">
              {loading ? (
                <Loader2 className="animate-spin mx-auto w-5 h-5" />
              ) : authMode === 'login' ? (
                'Ingresar'
              ) : (
                'Crear Cuenta'
              )}
            </button>
            <button
              type="button"
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="w-full text-[10px] font-black text-[#005EDD] uppercase tracking-widest mt-2 underline text-center block"
            >
              {authMode === 'login' ? 'Regístrate' : 'Inicia Sesión'}
            </button>
            <button
              type="button"
              onClick={() => setIsApplying(true)}
              className="w-full py-2.5 bg-zippy-main/20 text-zippy-dark rounded-xl font-black text-[10px] uppercase tracking-wider mt-2"
            >
              Postularme con Documentos
            </button>
            <button
              type="button"
              onClick={onBack}
              className="w-full text-[9px] font-black text-gray-400 uppercase tracking-widest text-center mt-2 block"
            >
              Volver
            </button>
          </form>
        </div>
        <DriverRegistration
          isOpen={isApplying}
          onClose={() => setIsApplying(false)}
          onRegistrationComplete={() => setIsApplying(false)}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-screen h-[100dvh] bg-gray-100 flex flex-col relative overflow-hidden font-sans">
      <NotificationToast
        message={toast.msg}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast({ ...toast, visible: false })}
      />

      <MapVisual
        status={isOnline ? (rideStatus === RideStatus.IDLE ? 'ADMIN_HEATMAP' : rideStatus) : 'OFFLINE'}
        userLocation={isOnline ? currentLocation : undefined}
        driverLocation={isOnline ? currentLocation : undefined}
        routeStart={mapRoute.start}
        routeEnd={mapRoute.end}
      />

      {gpsError && isOnline && (
        <div className="absolute top-24 left-4 right-4 z-50 bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-lg flex items-center justify-center gap-2 animate-pulse border border-red-200">
          <AlertOctagon size={16} className="text-red-500" />
          <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide">Esperando señal GPS...</p>
          <button
            onClick={retryGps}
            className="bg-red-500 text-white px-2 py-1 rounded-lg text-[9px] font-black ml-2"
          >
            REINTENTAR
          </button>
        </div>
      )}

      {(showPassengerModal || newRequestAlert) && renderPassengerModal()}
      {showRatePassengerModal && renderRatePassengerModal()}

      {tipNotification && (
        <div className="absolute top-20 inset-x-4 z-50 animate-slide-down">
          <div className="bg-zippy-main text-zippy-dark p-4 rounded-2xl shadow-2xl flex items-center gap-4 border-2 border-white">
            <Gift size={24} className="text-zippy-dark" />
            <div className="flex-1">
              <h4 className="font-black uppercase text-sm">¡Propina!</h4>
              <p className="text-xs font-bold opacity-80">{tipNotification.message}</p>
            </div>
            <span className="text-xl font-black bg-white px-3 py-1 rounded-lg shadow-sm">
              ${tipNotification.amount}
            </span>
          </div>
        </div>
      )}

      {view === 'profile' && renderProfile()}
      {view === 'history' && renderHistory()}
      {view === 'wallet' && renderWallet()}

      {showSuccessOverlay && (
        <div className="fixed inset-0 z-[10000] bg-green-500 flex flex-col items-center justify-center animate-fade-in">
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mb-6 animate-bounce shadow-2xl">
            <Check size={64} className="text-green-600" />
          </div>
          <h1 className="text-5xl font-black text-white uppercase tracking-tighter text-center">¡ÉXITO!</h1>
          <p className="text-white/80 font-bold text-xl mt-2 tracking-widest uppercase">Viaje Aceptado</p>
        </div>
      )}

      {sosActive && (
        <div className="absolute inset-0 z-[500] bg-red-600 flex flex-col items-center justify-center text-center p-6 animate-pulse">
          <Siren size={80} className="text-white mb-6 animate-bounce" />
          <h1 className="text-4xl font-black text-white mb-2 uppercase tracking-tighter">¡ALERTA SOS!</h1>
          <p className="text-white/90 font-bold text-lg mb-8 max-w-xs">Ubicación enviada a seguridad.</p>
          <button
            onClick={() => setSosActive(false)}
            className="text-white/60 font-bold text-xs mt-4 underline"
          >
            Falsa alarma
          </button>
        </div>
      )}

      {/* TOP BAR */}
      <div className="absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-center bg-white/90 backdrop-blur-md border-b shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('profile')}
            className="w-11 h-11 rounded-2xl overflow-hidden border-2 border-blue-700 shadow-lg active:scale-90 transition-transform"
          >
            <img
              src={
                driverProfile.avatarUrl ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(driverProfile.name)}`
              }
              className="w-full h-full object-cover"
            />
          </button>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}
              ></div>
              <span className="font-black text-[10px] text-zippy-dark uppercase tracking-tight">
                {isOnline ? 'En Turno' : 'Desconectado'}
              </span>
            </div>
            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
              Unidad {driverProfile.taxiNumber}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleOnline}
            className={`px-6 py-3 rounded-2xl font-black text-[10px] uppercase transition-all shadow-xl active:scale-95 ${
              isOnline ? 'bg-red-600 text-white' : 'bg-[#005EDD] text-white'
            }`}
          >
            {isOnline ? 'Finalizar' : 'Iniciar'}
          </button>
          <button
            type="button"
            onClick={handleDriverLogout}
            title="Cerrar Sesión"
            className="p-3 rounded-2xl bg-red-50 text-red-600 hover:bg-red-100 shadow-md active:scale-95 transition-all"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      {/* ACCOUNT STATUS BANNER */}
      {(driverProfile.isSuspended ||
        driverProfile.verificationStatus === 'pending' ||
        driverProfile.verificationStatus === 'rejected') &&
        view === 'home' && (
          <div className="absolute top-24 left-4 right-4 z-30 bg-red-50 border-2 border-red-200 p-4 rounded-2xl shadow-lg">
            <p className="text-xs font-black text-red-700 uppercase">
              {driverProfile.isSuspended
                ? 'Cuenta Suspendida — Contacta al Administrador'
                : driverProfile.verificationStatus === 'pending'
                ? 'Cuenta en Revisión — Esperando aprobación de documentos'
                : 'Solicitud Rechazada — Actualiza tus documentos en Perfil'}
            </p>
          </div>
        )}

      {/* AVAILABLE RIDES LIST */}
      {isOnline && !activeRide && !pendingOffer && view === 'home' && !newRequestAlert && (
        <div
          className={`absolute top-24 left-4 right-4 z-20 flex flex-col gap-4 max-h-[60vh] transition-all duration-300 ${
            isRequestsMinimized ? 'h-12 overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          <div className="mt-2 space-y-4 pointer-events-auto pb-10">
            <div className="flex items-center justify-between bg-blue-900/95 backdrop-blur-md px-5 py-3 rounded-full shadow-2xl border border-white/10">
              <div className="flex items-center gap-2">
                <h3 className="text-[9px] font-black text-white uppercase tracking-[0.2em]">
                  Solicitudes ({availableRides.length})
                </h3>
                <div className="w-2 h-2 bg-zippy-accent rounded-full animate-ping"></div>
              </div>
              <button
                onClick={() => setIsRequestsMinimized(!isRequestsMinimized)}
                className="text-white hover:bg-white/20 rounded-full p-1 transition-colors"
              >
                {isRequestsMinimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            </div>
            {!isRequestsMinimized &&
              (availableRides.length === 0 ? (
                <div className="bg-white/80 p-10 rounded-[40px] text-center backdrop-blur-md border border-gray-100 shadow-xl">
                  <Loader2 className="animate-spin text-blue-700 mx-auto mb-4" size={32} />
                  <p className="text-[10px] font-black text-zippy-dark uppercase tracking-widest leading-relaxed">
                    Buscando pasajeros...
                  </p>
                </div>
              ) : (
                availableRides.map((ride) => (
                  <div
                    key={ride.id}
                    className="bg-white p-5 rounded-[32px] shadow-xl border border-gray-100 space-y-4"
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-[9px] font-black uppercase bg-zippy-main/20 text-zippy-dark px-2 py-0.5 rounded">
                          {ride.vehicle_category || 'ECONOMICO'} •{' '}
                          {ride.payment_method === 'card' ? 'Tarjeta' : 'Efectivo'}
                        </span>
                        <h4 className="font-black text-zippy-dark text-3xl tracking-tighter mt-1">
                          ${negotiationPrices[ride.id] || ride.price}
                        </h4>
                      </div>
                      <button
                        onClick={() => handleDeleteRide(ride.id)}
                        className="p-2 bg-red-50 text-red-500 rounded-xl font-black text-xs"
                        title="Rechazar"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="space-y-2 bg-gray-50/50 p-4 rounded-3xl border border-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                        <p className="text-[10px] font-bold text-gray-500 truncate uppercase tracking-tight">
                          {ride.pickup_label}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div>
                        <p className="text-[10px] font-black text-zippy-dark truncate uppercase tracking-tight">
                          {ride.destination_label}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenRequest(ride)}
                      className="w-full bg-blue-700 text-white font-black py-4 rounded-[24px] flex items-center justify-center gap-3 shadow-xl hover:scale-[1.02] active:scale-95 transition-all uppercase text-xs tracking-widest"
                    >
                      <Eye size={18} /> Ver Detalle y Aceptar
                    </button>
                  </div>
                ))
              ))}
          </div>
        </div>
      )}

      {/* ACTIVE RIDE PANEL */}
      <div
        className={`absolute inset-x-0 bottom-0 z-30 pointer-events-none p-0 flex flex-col transition-transform duration-300 ease-in-out ${
          isPanelMinimized ? 'translate-y-[82%]' : 'translate-y-0'
        }`}
      >
        {isOnline && (activeRide || view === 'home') && (
          <div className="pointer-events-auto flex justify-end px-4 pb-2">
            <button
              onClick={() => setIsPanelMinimized(!isPanelMinimized)}
              className="bg-white text-zippy-dark p-2 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 active:scale-90 transition-transform"
            >
              {isPanelMinimized ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
            </button>
          </div>
        )}

        {isOnline && activeRide ? (
          <div className="pointer-events-auto bg-white rounded-t-[40px] p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)] border-t-4 border-blue-700 animate-slide-up max-h-[75vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div className="max-w-[70%]">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">
                  {rideStatus === RideStatus.ACCEPTED
                    ? 'Hacia punto de recogida'
                    : rideStatus === RideStatus.ARRIVED || rideStatus === RideStatus.PASSENGER_READY
                    ? 'En punto de recogida'
                    : rideStatus === RideStatus.PAYMENT_PENDING
                    ? 'Cobro Pendiente'
                    : 'Viaje En Curso'}
                </p>
                <h3 className="text-lg font-black text-zippy-dark leading-tight tracking-tight truncate">
                  {rideStatus === RideStatus.ACCEPTED || rideStatus === RideStatus.ARRIVED
                    ? activeRide.pickup_label
                    : activeRide.destination_label}
                </h3>
              </div>
              <div className="text-right">
                {activeRide.is_paid ? (
                  <div className="bg-green-100 text-green-700 px-3 py-1 rounded-lg border border-green-200">
                    <p className="text-[9px] font-black uppercase tracking-widest">PAGO OK</p>
                  </div>
                ) : (
                  <p className="text-3xl font-black text-zippy-dark tracking-tighter">${activeRide.price}</p>
                )}
              </div>
            </div>

            {/* External Turn-by-Turn Navigation Buttons */}
            {(rideStatus === RideStatus.ACCEPTED || rideStatus === RideStatus.IN_PROGRESS) && (
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => openExternalNav('google')}
                  className="py-2.5 bg-blue-50 text-blue-700 rounded-xl font-black text-[10px] uppercase flex items-center justify-center gap-1.5 border border-blue-100"
                >
                  <Navigation size={14} /> Google Maps <ExternalLink size={12} />
                </button>
                <button
                  onClick={() => openExternalNav('waze')}
                  className="py-2.5 bg-cyan-50 text-cyan-800 rounded-xl font-black text-[10px] uppercase flex items-center justify-center gap-1.5 border border-cyan-100"
                >
                  <Navigation2 size={14} /> Waze <ExternalLink size={12} />
                </button>
              </div>
            )}

            {/* Quick Actions */}
            <div className="grid grid-cols-4 gap-2 mb-5">
              <button
                onClick={handleCallPassenger}
                className="flex flex-col items-center justify-center p-2.5 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"
              >
                <Phone size={18} className="text-zippy-dark mb-1" />
                <span className="text-[8px] font-black uppercase text-gray-500">Llamar</span>
              </button>
              <button
                onClick={() => setChatOpen(true)}
                className="flex flex-col items-center justify-center p-2.5 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"
              >
                <MessageSquare size={18} className="text-zippy-dark mb-1" />
                <span className="text-[8px] font-black uppercase text-gray-500">Chat</span>
              </button>
              <button
                onClick={handleShareTrip}
                className="flex flex-col items-center justify-center p-2.5 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"
              >
                <Share2 size={18} className="text-zippy-dark mb-1" />
                <span className="text-[8px] font-black uppercase text-gray-500">Share</span>
              </button>
              <button
                onClick={handleTriggerSOS}
                className="flex flex-col items-center justify-center p-2.5 bg-red-600 text-white rounded-2xl shadow-lg shadow-red-600/30 active:scale-90 transition-transform"
              >
                <Siren size={18} className="mb-1 animate-pulse" />
                <span className="text-[8px] font-black uppercase">SOS</span>
              </button>
            </div>

            {/* PHASE-SPECIFIC CONTROLS */}
            <div className="space-y-3">
              {rideStatus === RideStatus.ACCEPTED && (
                <button
                  onClick={() => handleUpdateRideStatus(RideStatus.ARRIVED)}
                  className="w-full bg-blue-700 text-white font-black py-5 rounded-[28px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all text-xs tracking-widest uppercase"
                >
                  <MapPin size={20} /> He llegado al punto de recogida
                </button>
              )}

              {(rideStatus === RideStatus.ARRIVED || rideStatus === RideStatus.PASSENGER_READY) && (
                <div className="space-y-3">
                  {/* Courtesy Waiting Timer */}
                  <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-blue-700" />
                      <span className="text-[10px] font-black text-blue-800 uppercase">
                        {rideStatus === RideStatus.PASSENGER_READY
                          ? 'Pasajero saliendo'
                          : 'Tiempo de espera (cortesía 3:00)'}
                      </span>
                    </div>
                    <span
                      className={`font-mono font-black text-sm ${
                        waitSeconds > 180 ? 'text-red-600' : 'text-blue-800'
                      }`}
                    >
                      {formatTimer(waitSeconds)}
                    </span>
                  </div>

                  {/* PIN Validation Input */}
                  {activeRide.pin_code && (
                    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                        <KeyRound size={14} className="text-zippy-dark" /> Ingresa el PIN del Pasajero (4 dígitos)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={enteredPin}
                        onChange={(e) => {
                          setEnteredPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 4));
                          setPinError('');
                        }}
                        placeholder="• • • •"
                        className="w-full text-center text-2xl font-black tracking-[0.5em] bg-white border-2 border-gray-200 rounded-xl py-2 text-zippy-dark outline-none focus:border-zippy-main"
                      />
                      {pinError && (
                        <p className="text-[10px] font-bold text-red-600 mt-1 text-center">{pinError}</p>
                      )}
                    </div>
                  )}

                  {/* Slide-to-Start Control */}
                  <div className="bg-green-50 border-2 border-green-200 rounded-[24px] p-3">
                    <p className="text-[10px] font-black text-green-700 uppercase tracking-widest text-center mb-2">
                      Desliza para Iniciar Viaje →
                    </p>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={slideProgress}
                      onChange={(e) => handleSlideToStart(Number(e.target.value))}
                      onMouseUp={() => slideProgress < 92 && setSlideProgress(0)}
                      onTouchEnd={() => slideProgress < 92 && setSlideProgress(0)}
                      className="w-full accent-green-600 cursor-pointer h-3"
                    />
                  </div>
                </div>
              )}

              {rideStatus === RideStatus.IN_PROGRESS && (
                <button
                  onClick={() => handleUpdateRideStatus(RideStatus.PAYMENT_PENDING)}
                  className="w-full bg-green-600 text-white font-black py-5 rounded-[28px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all text-xs tracking-widest uppercase"
                >
                  <DollarSign size={20} /> FINALIZAR VIAJE Y COBRAR
                </button>
              )}

              {rideStatus === RideStatus.PAYMENT_PENDING && (
                <div className="space-y-3">
                  <div className="bg-zippy-main/20 border-2 border-zippy-main rounded-2xl p-4 text-center">
                    <span className="text-[10px] font-black text-zippy-dark/70 uppercase tracking-widest block">
                      Pantalla de Cobro ({activeRide.payment_method === 'card' ? 'Tarjeta' : activeRide.payment_method === 'wallet' ? 'Billetera' : 'Efectivo'})
                    </span>
                    <span className="text-4xl font-black text-zippy-dark">${activeRide.price} MXN</span>
                  </div>
                  <button
                    onClick={handleConfirmCashReceived}
                    disabled={loading}
                    className="w-full bg-green-600 text-white font-black py-5 rounded-[28px] shadow-xl flex items-center justify-center gap-2 active:scale-95 text-xs tracking-widest uppercase"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <>
                        <Banknote size={20} />
                        {activeRide.payment_method === 'cash'
                          ? 'Confirmar Efectivo Recibido'
                          : 'Confirmar Cobro Completado'}
                      </>
                    )}
                  </button>
                </div>
              )}

              {(rideStatus === RideStatus.COMPLETED || rideStatus === RideStatus.RATING) && (
                <button
                  onClick={() => setShowRatePassengerModal(true)}
                  className="w-full bg-gray-800 text-white font-black py-5 rounded-[28px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all text-xs tracking-widest uppercase"
                >
                  <CheckCircle2 size={20} /> Calificar y Cerrar
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="pointer-events-auto bg-[#000000]/95 backdrop-blur-2xl rounded-[36px] p-2.5 flex items-center justify-between shadow-2xl border border-white/10 mx-2 mb-2">
            <button
              onClick={() => setView('home')}
              className={`flex-1 flex flex-col items-center py-3.5 rounded-2xl transition-all ${
                view === 'home' ? 'bg-[#005EDD] text-white shadow-lg' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <Map size={22} />
              <span className="text-[8px] font-black uppercase mt-1.5 tracking-widest">En Turno</span>
            </button>
            <button
              onClick={() => setView('history')}
              className={`flex-1 flex flex-col items-center py-3.5 rounded-2xl transition-all ${
                view === 'history' ? 'bg-[#005EDD] text-white shadow-lg' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <History size={22} />
              <span className="text-[8px] font-black uppercase mt-1.5 tracking-widest">Viajes</span>
            </button>
            <button
              onClick={() => setView('wallet')}
              className={`flex-1 flex flex-col items-center py-3.5 rounded-2xl transition-all ${
                view === 'wallet' ? 'bg-[#005EDD] text-white shadow-lg' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <Wallet size={22} />
              <span className="text-[8px] font-black uppercase mt-1.5 tracking-widest">Pagos</span>
            </button>
            <button
              onClick={() => setView('profile')}
              className={`flex-1 flex flex-col items-center py-3.5 rounded-2xl transition-all ${
                view === 'profile' ? 'bg-[#005EDD] text-white shadow-lg' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <User size={22} />
              <span className="text-[8px] font-black uppercase mt-1.5 tracking-widest">Perfil</span>
            </button>
          </div>
        )}
      </div>

      {withdrawModalOpen && (
        <div className="fixed inset-0 z-[130] bg-zippy-dark/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 relative shadow-2xl">
            <button
              onClick={() => setWithdrawModalOpen(false)}
              className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400"
            >
              <X size={18} />
            </button>
            <h3 className="text-lg font-black text-zippy-dark uppercase mb-2">Retiro Bancario</h3>
            <p className="text-xs text-gray-500 font-bold mb-4">
              Saldo disponible: <span className="text-green-600">${totalEarnings.toFixed(2)} MXN</span>
            </p>
            <input
              placeholder="CLABE Interbancaria (18 dígitos)"
              maxLength={18}
              value={bankClabe}
              onChange={(e) => setBankClabe(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold text-sm mb-4"
            />
            <button
              onClick={() => {
                if (bankClabe.length < 10) {
                  showToast('Ingresa una CLABE válida', 'warning');
                  return;
                }
                setWithdrawModalOpen(false);
                showToast('Solicitud de transferencia bancaria registrada (24h hábiles).', 'success');
              }}
              className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-xs uppercase"
            >
              Solicitar Transferencia
            </button>
          </div>
        </div>
      )}

      <DriverRegistration
        isOpen={isApplying}
        onClose={() => setIsApplying(false)}
        userId={driverProfile.id}
        onRegistrationComplete={() => {
          setIsApplying(false);
          showToast('Documentación enviada a revisión', 'success');
        }}
      />

      <ChatModal
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onEndChat={() => {
          setChatOpen(false);
          showToast('Chat finalizado', 'info');
        }}
        rideId={activeRide?.id || ''}
        currentUserRole="DRIVER"
        currentUserId={driverProfile.id}
        counterpartName={requestPassenger?.name || 'Pasajero'}
        counterpartPhone={requestPassenger?.phone}
      />
      <EmergencyDirectory isOpen={emergencyOpen} onClose={() => setEmergencyOpen(false)} />
    </div>
  );
};

export default DriverApp;
