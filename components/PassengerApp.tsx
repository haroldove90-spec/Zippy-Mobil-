
import React, { useState, useEffect, useRef } from 'react';
import { 
  Menu, Navigation, MessageSquare, ShieldCheck, MapPin, Loader2, Calendar, Clock, Lock, 
  Eye, EyeOff, Star, BellRing, X, ChevronRight, Check, History, CreditCard, User, 
  ArrowLeft, Save, Plus, Wallet, TrendingUp, Truck, Wrench, Siren, Disc, Briefcase,
  HeartPulse, LogOut, DollarSign, Share2, Phone, Award, CheckCircle2, Camera, ThumbsUp, CheckCircle, Car,
  Gift, ChevronDown, ChevronUp, XCircle, Trash2, Home, Building2, AlertCircle, RefreshCw, Receipt, Bell, RotateCcw, Banknote,
  LifeBuoy, FileText, Zap, Coins
} from 'lucide-react';
import { RideStatus, DriverTarifa, Ride, MapEntity } from '../types';
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

declare var google: any;

interface PassengerAppProps {
  onBack: () => void;
}

const SOUNDS = {
  driverFound: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3', // Success/Offer Chime
  driverArrived: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3', // Ping
  message: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',
  sos: 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3', // Siren
  cashRegister: 'https://assets.mixkit.co/active_storage/sfx/2004/2004-preview.mp3', // Payment Success
  cancel: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3' // Cancel Sound
};

// --- VOICE COMMAND HELPER ---
const speak = (text: string) => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel(); // Cancelar cualquier audio previo
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX'; // Español Latino
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
};

const calculateFinalFare = (distanceKm: number): number => {
    const BASE_FARE = 35.00; 
    const COST_PER_KM = 12.00;
    const dist = Math.max(distanceKm, 1); 
    const total = BASE_FARE + (dist * COST_PER_KM);
    return Math.round(total);
};

const PassengerApp: React.FC<PassengerAppProps> = ({ onBack }) => {
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
  
  // TIP & PAYMENT FLOW STATE
  const [showReceiptModal, setShowReceiptModal] = useState(false); 
  const [finalFare, setFinalFare] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash'); 
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [rating, setRating] = useState(0);
  
  const [toast, setToast] = useState<{msg: string, type: NotificationType, visible: boolean}>({ msg: '', type: 'info', visible: false });

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
  
  const [destinationCoords, setDestinationCoords] = useState<[number, number]>([19.5108, -99.2335]);
  const [routeStart, setRouteStart] = useState<[number, number] | undefined>(undefined);
  const [routeEnd, setRouteEnd] = useState<[number, number] | undefined>(undefined);
  
  const [history, setHistory] = useState<Ride[]>([]);

  const [userProfile, setUserProfile] = useState({
      id: '', name: '', email: '', phone: '', avatar_url: '', card_name: '', card_last4: '', card_expiry: '', card_brand: '', saved_home: '', saved_work: ''
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [calculatedPrice, setCalculatedPrice] = useState<number>(0); 
  const [smartAdvice, setSmartAdvice] = useState<{advice: string, prob: number} | null>(null);

  const playSound = (soundUrl: string, loop = false) => {
      const audio = new Audio(soundUrl);
      audio.loop = loop;
      audio.play().catch(e => console.warn('Audio play failed (interaction needed):', e));
      return audio;
  };

  const showToast = (msg: string, type: NotificationType) => {
      setToast({ msg, type, visible: true });
  };

  // --- AUTO-COMPLETE ADDRESS LOGIC ---
  const reverseGeocode = (lat: number, lng: number) => {
      if (typeof google === 'undefined') return;
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results: any, status: any) => {
          if (status === 'OK' && results[0]) {
              const address = results[0].formatted_address;
              const simpleAddress = address.split(',').slice(0, 2).join(',');
              setPickup(simpleAddress);
          }
      });
  };

  // --- 1. ACTIVACIÓN DE GPS REAL (High Accuracy Obligatorio) ---
  useEffect(() => {
    if (!('geolocation' in navigator)) {
        showToast("Tu dispositivo no soporta GPS.", "error");
        return;
    }

    const geoOptions = {
        enableHighAccuracy: true, 
        timeout: 10000,           
        maximumAge: 0             
    };

    const handleSuccess = (position: GeolocationPosition) => {
        const { latitude, longitude, accuracy } = position.coords;
        setPassengerLocation(prev => {
            if (!prev) {
                reverseGeocode(latitude, longitude);
                return [latitude, longitude];
            }
            const dist = Math.abs(prev[0] - latitude) + Math.abs(prev[1] - longitude);
            return dist > 0.0001 ? [latitude, longitude] : prev;
        });
        setGpsAccuracy(accuracy);
    };

    const handleError = (error: GeolocationPositionError) => {
        if(error.code === 1) showToast("Permiso de ubicación denegado.", "error");
        if(error.code === 3) showToast("Buscando señal GPS...", "warning");
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, geoOptions);
    const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, geoOptions);

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // --- FETCH HISTORY ---
  useEffect(() => {
      if ((view === 'history' || view === 'payment') && userProfile.id) {
          const fetchHistory = async () => {
              const { data } = await supabase.from('rides').select('*').eq('passenger_id', userProfile.id).in('status', ['COMPLETED', 'ARCHIVED', 'CANCELLED']).order('created_at', { ascending: false });
              if (data) setHistory(data as Ride[]);
          };
          fetchHistory();
      }
  }, [view, userProfile.id]);

  // --- CALCULATE PRICE ---
  useEffect(() => {
      if (status === RideStatus.IDLE && passengerLocation && destinationCoords) {
          const dist = calculateDistance(passengerLocation[0], passengerLocation[1], destinationCoords[0], destinationCoords[1]);
          const price = calculateFinalFare(dist);
          setCalculatedPrice(price);
      }
  }, [passengerLocation, destinationCoords, status]);

  // --- SESSION RECOVERY ---
  useEffect(() => {
    const checkSession = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
                if (profile) {
                    setUserProfile(prev => ({ 
                      ...prev, id: session.user.id, name: profile.full_name || 'Usuario Zippy', email: profile.email || '', phone: profile.phone || '', avatar_url: profile.avatar_url || '', card_name: profile.card_name, card_last4: profile.card_last4, card_expiry: profile.card_expiry, card_brand: profile.card_brand, saved_home: profile.saved_home, saved_work: profile.saved_work,
                    }));
                    setDriverApplicationStatus(profile.verification_status || 'unverified');
                    setIsAuthenticated(true);

                    const { data: activeRideData } = await supabase.from('rides').select('*').eq('passenger_id', session.user.id).order('created_at', { ascending: false }).limit(1).single();

                    if (activeRideData) {
                        const restoredRide = activeRideData as Ride;
                        if (['ARCHIVED', 'COMPLETED', 'CANCELLED'].includes(restoredRide.status)) {
                             setActiveRide(null); setStatus(RideStatus.IDLE);
                        } else {
                            setActiveRide(restoredRide);
                            setStatus(restoredRide.status as RideStatus);
                            // Restore payment method if exists
                            if (restoredRide.payment_method) setPaymentMethod(restoredRide.payment_method);
                            setPickup(restoredRide.pickup_label || '');
                            setDestination(restoredRide.destination_label || '');
                            setCalculatedPrice(restoredRide.price);
                            if (restoredRide.dest_lat && restoredRide.dest_lng) {
                                setDestinationCoords([restoredRide.dest_lat, restoredRide.dest_lng]);
                            }
                            if (restoredRide.driver_lat && restoredRide.driver_lng) {
                                setDriverLocation([restoredRide.driver_lat, restoredRide.driver_lng]);
                            }
                            if (restoredRide.status === 'ARRIVED') setShowArrivalOverlay(true); 
                            if (restoredRide.driver_id && ['ACCEPTED', 'ARRIVED', 'PASSENGER_READY', 'IN_PROGRESS', 'RATING'].includes(restoredRide.status)) {
                                fetchDriverProfile(restoredRide.driver_id, restoredRide.price, restoredRide.id);
                            }
                        }
                    }
                }
            }
        } catch (error) { console.error("Error restoring session:", error); }
    };
    checkSession();
  }, []);

  const fetchDriverProfile = async (driverId: string, price: number, rideId: string) => {
      const { data: driverData } = await supabase.from('profiles').select('*').eq('id', driverId).single();
      const drvInfo = { id: 'assigned-' + driverId, ride_id: rideId, driver_id: driverId, name: driverData?.full_name || 'Daniel Anguiano', rating: driverData?.rating || 5.0, carModel: driverData?.car_model || 'Vehículo', carPlate: driverData?.car_plate || '---', taxiNumber: driverData?.taxi_number || '---', price: price, eta: 5, avatarUrl: driverData?.avatar_url || '', distance: 0, tripsCompleted: driverData?.trips_completed || 0, phone: driverData?.phone };
      setSelectedDriver(drvInfo); 
  };

  // --- 3. SINCRONIZACIÓN REALTIME (Recibir coordenadas del conductor) ---
  useEffect(() => {
    if (!activeRide?.id) return;
    const activeRideId = activeRide.id;

    // A. Subscripción Realtime (WebSockets)
    const statusChannel = supabase.channel(`ride-tracking-${activeRideId}`)
      .on('postgres_changes', { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'rides', 
          filter: `id=eq.${activeRideId}` 
      }, async (payload) => {
        handleRideUpdate(payload.new);
      }).subscribe();
      
    // B. POLLING DE RESPALDO (Sondeo cada 4 segundos por si falla Realtime)
    const pollingInterval = setInterval(async () => {
        const { data } = await supabase.from('rides').select('*').eq('id', activeRideId).single();
        if (data) {
            handleRideUpdate(data);
        }
    }, 4000);

    // Offers Channel (Solo relevante en etapa REQUESTING)
    const offersChannel = supabase.channel(`ride-offers-${activeRideId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_offers', filter: `ride_id=eq.${activeRideId}` }, (payload) => {
        const newOffer = payload.new as any;
        playSound(SOUNDS.driverFound);
        speak(`Nueva oferta de ${newOffer.offered_price} pesos.`); // VOICE
        const mappedTarifa: DriverTarifa = { id: newOffer.id, ride_id: newOffer.ride_id, driver_id: newOffer.driver_id, name: newOffer.driver_name, rating: newOffer.driver_rating, carModel: newOffer.car_model, carPlate: newOffer.car_plate, taxiNumber: newOffer.taxi_number, price: newOffer.offered_price, eta: newOffer.eta, avatarUrl: newOffer.avatar_url, distance: newOffer.distance, tripsCompleted: newOffer.trips_completed };
        setAvailableTarifas(prev => { if (prev.some(t => t.id === mappedTarifa.id)) return prev; return [mappedTarifa, ...prev]; });
        showToast(`Nueva oferta de ${mappedTarifa.name}: $${mappedTarifa.price}`, 'success');
    }).subscribe();
    
    // Message Channel
    const msgChannel = supabase.channel(`passenger_messages:${userProfile.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ride_id=eq.${activeRide?.id}` }, (payload) => {
        const msg = payload.new;
        if (msg.sender_id !== userProfile.id) { 
            playSound(SOUNDS.message); 
            speak("Tienes un nuevo mensaje del conductor."); // VOICE
            showToast('Nuevo mensaje del conductor', 'message'); 
        }
    }).subscribe();

    return () => { 
        supabase.removeChannel(statusChannel); 
        supabase.removeChannel(offersChannel); 
        supabase.removeChannel(msgChannel);
        clearInterval(pollingInterval);
    };
  }, [activeRide?.id, userProfile.id]);

  // Manejo Centralizado de Actualizaciones (Para Realtime y Polling)
  const handleRideUpdate = (updatedRide: any) => {
        if (!updatedRide) return;
        const newStatus = updatedRide.status;

        // Actualizar coordenadas del conductor
        if (updatedRide.driver_lat && updatedRide.driver_lng) {
            if (updatedRide.driver_lat !== 0 && updatedRide.driver_lng !== 0) {
                setDriverLocation([updatedRide.driver_lat, updatedRide.driver_lng]);
            }
        }

        // Si el estado cambió, actualizar localmente
        if (activeRide?.status !== newStatus) {
            setActiveRide(updatedRide);
            
            if (newStatus === RideStatus.ACCEPTED) {
                setAvailableTarifas([]);
                if (updatedRide.driver_id && !selectedDriver) fetchDriverProfile(updatedRide.driver_id, updatedRide.price, updatedRide.id);
                setStatus(RideStatus.ACCEPTED);
                playSound(SOUNDS.driverFound); 
                speak("Conductor asignado. Tu Zippy va en camino.");
                showToast('¡Conductor asignado! Tu Zippy va en camino.', 'success');
            } 
            else if (newStatus === RideStatus.ARRIVED) { 
                setStatus(RideStatus.ARRIVED); 
                if (!showArrivalOverlay && status !== RideStatus.PASSENGER_READY) {
                    setShowArrivalOverlay(true);
                    playSound(SOUNDS.driverArrived); 
                    speak("Tu conductor ha llegado por ti.");
                }
            } 
            else if (newStatus === RideStatus.PASSENGER_READY) {
                setStatus(RideStatus.PASSENGER_READY);
                setShowArrivalOverlay(false);
            }
            else if (newStatus === RideStatus.IN_PROGRESS) { 
                setStatus(RideStatus.IN_PROGRESS); 
                setShowArrivalOverlay(false);
                if (status !== RideStatus.IN_PROGRESS) speak("Iniciando viaje a tu destino.");
            } 
            else if (newStatus === RideStatus.COMPLETED) { 
                setStatus(RideStatus.COMPLETED);
                setFinalFare(updatedRide.price);
                if (!updatedRide.is_paid) {
                    setShowReceiptModal(true); 
                    playSound(SOUNDS.cashRegister);
                    speak("Hemos llegado a tu destino. Por favor realiza el pago.");
                }
            } else if (newStatus === 'ARCHIVED') {
                setActiveRide(null);
                setStatus(RideStatus.IDLE);
                setShowReceiptModal(false);
                setPickup('');
                setDestination('');
                setDriverLocation(undefined);
                setRouteStart(undefined);
                setRouteEnd(undefined);
                setSelectedDriver(null);
                showToast("Viaje completado.", "success");
            }
        } else {
            // Si el estado es el mismo, solo actualizar coordenadas y timestamps
            setActiveRide(updatedRide);
        }
  };

  // --- LOGICA DE RUTAS MAPA ---
  useEffect(() => {
      if (status === RideStatus.REQUESTING && passengerLocation) {
          setRouteStart(passengerLocation);
          setRouteEnd(destinationCoords);
          return;
      }
      if ((status === RideStatus.ACCEPTED || status === RideStatus.ARRIVED) && driverLocation && passengerLocation) {
          setRouteStart(driverLocation);
          setRouteEnd(passengerLocation);
          return;
      }
      if (status === RideStatus.IN_PROGRESS && driverLocation) {
          setRouteStart(driverLocation);
          setRouteEnd(destinationCoords);
          return;
      }
      if (status === RideStatus.IDLE) {
          setRouteStart(undefined);
          setRouteEnd(undefined);
      }
  }, [status, driverLocation, passengerLocation, destinationCoords]);


  const handlePassengerReady = async () => { if (!activeRide) return; setLoading(true); try { await supabase.from('rides').update({ status: 'PASSENGER_READY' }).eq('id', activeRide.id); setStatus(RideStatus.PASSENGER_READY); setShowArrivalOverlay(false); showToast('Has notificado al conductor que vas saliendo.', 'success'); } catch (err: any) { alert("Error: " + err.message); } finally { setLoading(false); } };
  const handleRequestRide = async () => { 
      if (!destination) return alert("Por favor indica un destino."); 
      if (!passengerLocation) return alert("Esperando señal GPS... Revisa tu ubicación.");
      setLoading(true); 
      try { 
          const dist = calculateDistance(passengerLocation[0], passengerLocation[1], destinationCoords[0], destinationCoords[1]); 
          const realPrice = calculateFinalFare(dist); 
          const payload = { 
              passenger_id: userProfile.id, 
              pickup_label: pickup || 'Mi Ubicación', 
              destination_label: destination, 
              price: realPrice, 
              status: RideStatus.REQUESTING, 
              pickup_lat: passengerLocation[0], 
              pickup_lng: passengerLocation[1], 
              dest_lat: destinationCoords[0], 
              dest_lng: destinationCoords[1], 
              payment_method: paymentMethod // Store selected method
          }; 
          const { data, error } = await supabase.from('rides').insert(payload).select().single(); 
          if (error) throw error; 
          setActiveRide(data); 
          setStatus(RideStatus.REQUESTING); 
          setAvailableTarifas([]); 
          setCalculatedPrice(realPrice); 
          showToast(`Solicitando viaje por ~$${realPrice}.00`, "info"); 
      } catch (err: any) { 
          console.error(err); 
          alert("Error al solicitar: " + (err.message || "Verifica tu conexión")); 
      } finally { 
          setLoading(false); 
      } 
  };
  const handleAcceptTarifa = async (tarifa: DriverTarifa) => { let driverPhone = ''; if (tarifa.driver_id) { const { data } = await supabase.from('profiles').select('phone').eq('id', tarifa.driver_id).single(); if (data) driverPhone = data.phone; } setSelectedDriver({ ...tarifa, phone: driverPhone }); setLoading(true); try { if (activeRide?.id) { await supabase.from('rides').update({ status: 'ACCEPTED', driver_id: tarifa.driver_id, price: tarifa.price }).eq('id', activeRide.id); } setStatus(RideStatus.ACCEPTED); showToast("Has aceptado al conductor.", "success"); } catch (err: any) { alert("Error: " + err.message); } finally { setLoading(false); } };
  
  // --- COMBINED FINALIZATION LOGIC ---
  const handleFinishRide = async () => {
      if (!activeRide) return;
      setLoading(true);
      try {
          const basePrice = activeRide.price || finalFare;
          const total = basePrice + tipAmount;
          const finalRating = rating || 5;

          const { error } = await supabase.from('rides').update({
              is_paid: true,
              tip_amount: tipAmount,
              total_paid: total,
              rating_given: finalRating,
              status: 'ARCHIVED'
          }).eq('id', activeRide.id);

          if (error) throw error;

          // Sound and Toast
          playSound(SOUNDS.cashRegister);
          speak("Pago confirmado. Gracias por viajar con Zippy."); // VOICE
          showToast(`Viaje finalizado. Total: $${total}`, "success");

          // Reset ALL State
          setActiveRide(null);
          setStatus(RideStatus.IDLE);
          setAvailableTarifas([]);
          setSelectedDriver(null);
          setDriverLocation(undefined);
          setRouteStart(undefined);
          setRouteEnd(undefined);
          setPickup('');
          setDestination('');
          setShowReceiptModal(false);
          setTipAmount(0);
          setRating(0);

      } catch (err: any) {
          alert("Error al finalizar: " + err.message);
      } finally {
          setLoading(false);
      }
  };
  
  const handleOpenEarlyPayment = () => { 
      // If early payment, show Receipt first
      setFinalFare(activeRide?.price || 0); 
      setShowReceiptModal(true);
  }; 

  const handleTriggerSOS = async () => { 
      if (!activeRide || !passengerLocation) return; 
      if (!confirm("¿ESTÁS EN PELIGRO?")) return; 
      try { 
          await supabase.from('rides').update({ 
              sos_active: true, 
              sos_triggered_by: userProfile.id, 
              sos_at: new Date().toISOString(), 
              sos_lat: passengerLocation[0], 
              sos_lng: passengerLocation[1] 
          }).eq('id', activeRide.id); 
          setSosActive(true); 
          setEmergencyOpen(true); 
          showToast("ALERTA SOS ENVIADA", 'error'); 
          playSound(SOUNDS.sos); 
      } catch (e: any) { 
          console.error(e); 
      } 
  };
  const handleAuth = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); try { if (authMode === 'login') { const { data, error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; if (data.user) { const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single(); if (profile) { setUserProfile(prev => ({ ...prev, id: data.user!.id, name: profile.full_name || 'Usuario', email: profile.email || '', phone: profile.phone || '' })); setIsAuthenticated(true); } } } else { const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, role: 'PASSENGER' } } }); if (error) throw error; alert('Registro exitoso. Inicia sesión.'); setAuthMode('login'); } } catch (err: any) { alert(err.message); } finally { setLoading(false); } };
  const handleSaveCard = async (cardData: any) => { setLoading(true); try { const { error } = await supabase.from('profiles').update({ card_last4: cardData.number.slice(-4), card_brand: cardData.brand, card_name: cardData.name, card_expiry: cardData.expiry }).eq('id', userProfile.id); if (error) throw error; setUserProfile(prev => ({ ...prev, card_last4: cardData.number.slice(-4), card_brand: cardData.brand })); setAddCardOpen(false); showToast("Tarjeta guardada correctamente", 'success'); } catch (e: any) { alert(e.message); } finally { setLoading(false); } };
  const handleScheduleRide = async (datetime: string) => { 
      if(!passengerLocation) return alert("Esperando ubicación...");
      setLoading(true); 
      try { 
          const { error } = await supabase.from('rides').insert({ 
              passenger_id: userProfile.id, 
              pickup_label: pickup, 
              destination_label: destination, 
              pickup_lat: passengerLocation[0], 
              pickup_lng: passengerLocation[1], 
              dest_lat: destinationCoords[0], 
              dest_lng: destinationCoords[1], 
              price: calculatedPrice, 
              status: 'SCHEDULED', 
              scheduled_for: datetime 
          }); 
          if (error) throw error; 
          setScheduleModalOpen(false); 
          showToast(`Viaje programado para ${new Date(datetime).toLocaleString()}`, 'success'); 
      } catch (e: any) { 
          alert(e.message); 
      } finally { 
          setLoading(false); 
      } 
  };
  const handleRefreshConnection = async () => { setLoading(true); try { if (activeRide) { const { data: ride } = await supabase.from('rides').select('*').eq('id', activeRide.id).single(); if (ride) { setActiveRide(ride); if (ride.status !== status) setStatus(ride.status); } const { data: offers } = await supabase.from('ride_offers').select('*').eq('ride_id', activeRide.id); if (offers) { const newOffers = offers.map((o: any) => ({ id: o.id, ride_id: o.ride_id, driver_id: o.driver_id, name: o.driver_name, rating: o.driver_rating, carModel: o.car_model, carPlate: o.car_plate, taxiNumber: o.taxi_number, price: o.offered_price, eta: o.eta, avatarUrl: o.avatar_url, distance: o.distance, tripsCompleted: o.trips_completed })); setAvailableTarifas(newOffers); } } showToast("Sincronizado", 'success'); } catch(e) { console.error(e); } finally { setLoading(false); } };
  const handleCancelSearch = async () => { if (!activeRide) return; if (!confirm("¿Cancelar búsqueda?")) return; setLoading(true); try { await supabase.from('rides').update({ status: 'CANCELLED' }).eq('id', activeRide.id); setStatus(RideStatus.IDLE); setActiveRide(null); setAvailableTarifas([]); showToast("Búsqueda cancelada", 'info'); } catch (e: any) { alert(e.message); } finally { setLoading(false); } };
  const handleCancelRide = async () => { if (!activeRide) return; if (!confirm("¿Seguro que deseas cancelar?")) return; try { await supabase.from('rides').update({ status: 'CANCELLED' }).eq('id', activeRide.id); setStatus(RideStatus.IDLE); setActiveRide(null); setSelectedDriver(null); } catch (e: any) { alert(e.message); } };
  const handleCallDriver = () => selectedDriver?.phone ? window.location.href = `tel:${selectedDriver.phone}` : showToast("Número no disponible", 'error');
  const handleShareTrip = async () => { };

  const renderReceiptModal = () => { const totalToPay = (activeRide?.price || finalFare) + tipAmount; const isEarlyPayment = status === RideStatus.IN_PROGRESS || status === RideStatus.ARRIVED || status === RideStatus.ACCEPTED; return ( <div className="fixed inset-0 z-[120] bg-zippy-dark/95 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in"> <div className="bg-white w-full max-w-sm rounded-[40px] shadow-2xl overflow-hidden relative animate-scale-up flex flex-col max-h-[90vh]"> <div className="bg-zippy-main p-6 text-center relative overflow-hidden flex-shrink-0"> <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-white/10 rotate-12"></div> <button onClick={() => setShowReceiptModal(false)} className="absolute top-4 right-4 p-2 bg-white/20 rounded-full hover:bg-white/40 text-zippy-dark"><X size={20}/></button> <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg animate-bounce"> <Receipt size={32} className="text-zippy-dark" /> </div> <h2 className="text-xl font-black text-zippy-dark uppercase tracking-tight">{isEarlyPayment ? 'Pago Anticipado' : 'Resumen de Viaje'}</h2> <p className="text-zippy-dark/70 font-bold text-xs uppercase tracking-widest mt-1">Total a Pagar</p> </div> <div className="p-6 overflow-y-auto"> <div className="text-center mb-6"> <span className="text-5xl font-black text-zippy-dark tracking-tighter block">${totalToPay}</span> {tipAmount > 0 && <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-md">Incluye ${tipAmount} propina</span>} </div> <div className="mb-6"> <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 text-center">¿Deseas agregar propina?</p> <div className="flex justify-center gap-3 mb-3"> {[10, 20, 50].map((amount) => ( <button key={amount} onClick={() => setTipAmount(amount === tipAmount ? 0 : amount)} className={`w-14 h-14 rounded-full border-2 flex items-center justify-center font-black text-sm transition-all ${tipAmount === amount ? 'bg-zippy-dark text-white border-zippy-dark scale-110' : 'bg-gray-50 border-gray-100 text-gray-400 hover:border-zippy-main'}`} > ${amount} </button> ))} </div> <div className="bg-gray-50 p-3 rounded-xl flex items-center gap-2 border border-gray-100"> <Coins size={16} className="text-gray-400" /> <input type="number" placeholder="Otro monto" value={tipAmount > 0 && ![10, 20, 50].includes(tipAmount) ? tipAmount : ''} onChange={(e) => setTipAmount(Number(e.target.value))} className="bg-transparent w-full font-bold text-zippy-dark outline-none text-sm" /> </div> </div> <div className="w-full h-px bg-gray-100 my-4"></div> {!isEarlyPayment && ( <div className="flex flex-col items-center gap-3 mb-6"> <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Califica tu experiencia</p> <div className="flex gap-2"> {[1, 2, 3, 4, 5].map((r) => ( <button key={r} onClick={() => setRating(r)} className="transform hover:scale-125 transition-transform active:scale-95"><Star size={32} className={`${r <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'}`} /></button> ))} </div> </div> )} <button onClick={handleFinishRide} disabled={loading} className="w-full bg-zippy-dark text-white font-black py-5 rounded-2xl shadow-xl active:scale-95 transition-transform uppercase text-sm tracking-widest flex items-center justify-center gap-2"> {loading ? <Loader2 className="animate-spin" /> : 'PAGAR Y FINALIZAR'} </button> </div> </div> </div> ); };
  const renderPayment = () => { const totalSpent = history.reduce((acc, ride) => acc + ride.price, 0); return ( <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24"> <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10"> <button onClick={() => setView('home')} className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"><ArrowLeft size={20} /></button> <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-2">Billetera</h2> <p className="text-center text-white/60 text-xs font-bold uppercase tracking-widest">Métodos de Pago y Saldo</p> </div> <div className="p-6"> <div className="bg-white p-6 rounded-[32px] shadow-lg border border-gray-100 mb-6 relative overflow-hidden"> <div className="absolute -right-10 -top-10 w-40 h-40 bg-zippy-main/20 rounded-full blur-2xl"></div> <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Tu Saldo Zippy</p> <h3 className="text-4xl font-black text-zippy-dark tracking-tighter">$0.00 <span className="text-sm text-gray-400 font-bold">MXN</span></h3> <div className="mt-4 flex gap-3"> <button className="flex-1 py-3 bg-zippy-dark text-white rounded-xl font-bold text-xs shadow-md">Recargar</button> <button className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-xs">Retirar</button> </div> </div> <div className="mb-6"> <div className="flex justify-between items-center mb-3 px-2"> <h4 className="font-black text-zippy-dark text-sm uppercase tracking-wide">Mis Tarjetas</h4> <button onClick={() => setAddCardOpen(true)} className="p-2 bg-white rounded-full shadow-sm text-blue-600"><Plus size={16}/></button> </div> {userProfile.card_last4 ? ( <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-5 rounded-2xl shadow-xl text-white relative overflow-hidden"> <div className="absolute right-4 top-4 opacity-50"><CreditCard size={32}/></div> <p className="font-mono text-xs opacity-70 mb-8">{userProfile.card_brand || 'Tarjeta'}</p> <p className="font-mono text-xl tracking-widest mb-4">•••• •••• •••• {userProfile.card_last4}</p> <div className="flex justify-between items-end"> <p className="text-xs font-bold uppercase opacity-70">{userProfile.card_name}</p> <p className="text-xs font-bold opacity-70">{userProfile.card_expiry}</p> </div> </div> ) : ( <div onClick={() => setAddCardOpen(true)} className="border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center text-gray-400 cursor-pointer hover:border-zippy-main hover:bg-zippy-main/5 transition-all"> <CreditCard size={24} className="mx-auto mb-2 opacity-50"/> <p className="text-xs font-bold uppercase">Agregar Tarjeta</p> </div> )} </div> <div> <h4 className="font-black text-zippy-dark text-sm uppercase tracking-wide mb-3 px-2">Movimientos Recientes</h4> <div className="bg-white rounded-[24px] p-2 shadow-sm border border-gray-100"> {history.slice(0, 5).map(ride => ( <div key={ride.id} className="flex justify-between items-center p-4 border-b border-gray-50 last:border-0"> <div className="flex items-center gap-3"> <div className="p-2 bg-gray-100 rounded-full text-gray-500"><Car size={16}/></div> <div> <p className="font-bold text-zippy-dark text-xs">Viaje a {ride.destination_label.split(',')[0]}</p> <p className="text-[10px] text-gray-400 font-bold">{new Date(ride.created_at || '').toLocaleDateString()}</p> </div> </div> <span className="font-black text-zippy-dark text-sm">-${ride.price}</span> </div> ))} {history.length === 0 && <p className="text-center py-6 text-xs text-gray-400 font-bold">Sin movimientos</p>} </div> </div> </div> </div> ); };
  const renderHistory = () => ( <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24"> <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10"> <button onClick={() => setView('home')} className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"><ArrowLeft size={20} /></button> <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-2">Mis Viajes</h2> <p className="text-center text-white/60 text-xs font-bold uppercase tracking-widest">Historial de Trayectos</p> </div> <div className="p-4 space-y-4"> {history.length > 0 ? history.map(ride => ( <div key={ride.id} className="bg-white p-5 rounded-[24px] shadow-sm border border-gray-100"> <div className="flex justify-between items-center mb-4"> <img src="https://tritex.com.mx/zippyicono.png" className="h-6 object-contain filter grayscale opacity-50" /> <div className="text-right"> <span className="text-[10px] font-bold text-gray-400 uppercase">{new Date(ride.created_at || '').toLocaleDateString()}</span> <span className="text-[10px] font-bold text-gray-300 uppercase block">{new Date(ride.created_at || '').toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span> </div> </div> <div className="space-y-3 mb-4 relative pl-3"> <div className="absolute top-2 bottom-2 left-[5px] w-0.5 bg-gray-100"></div> <div className="flex items-start gap-3 relative z-10"> <div className="w-3 h-3 bg-green-500 rounded-full border-2 border-white shadow-sm mt-0.5"></div> <p className="text-xs font-bold text-gray-500 truncate w-full">{ride.pickup_label}</p> </div> <div className="flex items-start gap-3 relative z-10"> <div className="w-3 h-3 bg-red-500 rounded-full border-2 border-white shadow-sm mt-0.5"></div> <p className="text-xs font-black text-zippy-dark truncate w-full">{ride.destination_label}</p> </div> </div> <div className="w-full h-px bg-gray-50 mb-3"></div> <div className="flex justify-between items-center"> <div className="flex items-center gap-2"> <div className={`p-1.5 rounded-lg ${ride.payment_method === 'card' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}> {ride.payment_method === 'card' ? <CreditCard size={14}/> : <Banknote size={14}/>} </div> <div className="flex flex-col items-end"> <span className="text-[8px] font-black text-gray-400 uppercase">Total Pagado</span> <div className="flex flex-col items-end"> <span className="text-lg font-black text-zippy-dark">${(ride as any).total_paid || ride.price}</span> {(ride.tip_amount || 0) > 0 && <span className="text-[10px] text-green-600 font-bold">+${ride.tip_amount} propina</span>} </div> </div> </div> {ride.rating_given && ( <div className="flex items-center gap-1 bg-yellow-50 px-2 py-1 rounded-lg"> <Star size={12} className="fill-yellow-500 text-yellow-500" /> <span className="text-xs font-black text-yellow-600">{ride.rating_given}</span> </div> )} </div> </div> )) : ( <div className="text-center py-20 opacity-50"> <History size={48} className="mx-auto mb-4 text-gray-300"/> <p className="font-bold text-gray-400 text-sm">Aún no tienes viajes registrados.</p> </div> )} </div> </div> );
  const renderProfile = () => ( <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24"> <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative"> <button onClick={() => setView('home')} className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"><ArrowLeft size={20} /></button> <div className="flex flex-col items-center"> <img src={avatarPreview || userProfile.avatar_url || `https://ui-avatars.com/api/?name=${userProfile.name}&background=003A70&color=fff`} className="w-28 h-28 rounded-full border-4 border-zippy-main shadow-2xl overflow-hidden mb-4 object-cover" /> <h2 className="text-2xl font-black uppercase tracking-tight">{userProfile.name}</h2> <p className="text-xs text-white/70 font-bold">{userProfile.email}</p> </div> </div> <div className="p-6 space-y-6"> <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-4"> <h3 className="text-sm font-black text-zippy-dark uppercase tracking-widest border-b border-gray-100 pb-2">Mis Datos</h3> <div className="flex items-center gap-3"> <Phone size={16} className="text-gray-400"/> <input value={userProfile.phone} readOnly className="flex-1 font-bold text-zippy-dark bg-transparent outline-none"/> </div> <div className="flex items-center gap-3"> <Home size={16} className="text-gray-400"/> <input placeholder="Casa (Sin guardar)" value={userProfile.saved_home} readOnly className="flex-1 font-bold text-zippy-dark bg-transparent outline-none"/> </div> <div className="flex items-center gap-3"> <Building2 size={16} className="text-gray-400"/> <input placeholder="Trabajo (Sin guardar)" value={userProfile.saved_work} readOnly className="flex-1 font-bold text-zippy-dark bg-transparent outline-none"/> </div> </div> <button onClick={onBack} className="w-full py-4 rounded-2xl bg-red-50 text-red-600 font-black text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 mt-4 hover:bg-red-100 transition-colors"><LogOut size={18} /> Cerrar Sesión</button> </div> </div> );
  const renderServices = () => ( <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24"> <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10"> <button onClick={() => setView('home')} className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"><ArrowLeft size={20} /></button> <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-2">Servicios</h2> <p className="text-center text-white/60 text-xs font-bold uppercase tracking-widest">Asistencia y Ayuda</p> </div> <div className="p-6 grid grid-cols-2 gap-4"> <button onClick={() => setAssistantOpen(true)} className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col items-center gap-3 hover:scale-105 transition-transform"> <div className="p-4 bg-zippy-main/20 rounded-full text-zippy-dark"><MessageSquare size={32}/></div> <span className="font-black text-zippy-dark text-xs uppercase">Asistente IA</span> </button> <button onClick={() => setEmergencyOpen(true)} className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col items-center gap-3 hover:scale-105 transition-transform"> <div className="p-4 bg-red-100 rounded-full text-red-600"><Siren size={32}/></div> <span className="font-black text-zippy-dark text-xs uppercase">Emergencias</span> </button> <button className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col items-center gap-3 hover:scale-105 transition-transform opacity-50"> <div className="p-4 bg-gray-100 rounded-full text-gray-500"><FileText size={32}/></div> <span className="font-black text-zippy-dark text-xs uppercase">Facturación</span> </button> <button className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col items-center gap-3 hover:scale-105 transition-transform opacity-50"> <div className="p-4 bg-gray-100 rounded-full text-gray-500"><LifeBuoy size={32}/></div> <span className="font-black text-zippy-dark text-xs uppercase">Soporte</span> </button> </div> </div> );

  return (
    <div className="relative w-full h-full bg-gray-100 overflow-hidden flex flex-col font-sans">
      <NotificationToast message={toast.msg} type={toast.type} isVisible={toast.visible} onClose={() => setToast({ ...toast, visible: false })} />
      
      {/* MAPA REPOTENCIADO: Pasamos gpsAccuracy para el círculo */}
      <MapVisual 
        status={status === RideStatus.RATING ? RideStatus.COMPLETED : status} 
        entities={nearbyDrivers} 
        userLocation={passengerLocation} 
        driverLocation={driverLocation} 
        routeStart={routeStart} 
        routeEnd={routeEnd} 
        gpsAccuracy={gpsAccuracy}
      />
      
      {showReceiptModal && renderReceiptModal()}
      {showArrivalOverlay && !showReceiptModal && ( <div className="fixed inset-0 z-[100] bg-green-600/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-bounce-in text-center"> <div className="w-40 h-40 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl animate-ping-slow"> <Bell size={64} className="text-green-600 animate-swing" /> </div> <h1 className="text-5xl font-black text-white uppercase tracking-tighter mb-4 leading-none">¡Tu Zippy<br/>ha llegado!</h1> <p className="text-white/90 font-bold text-xl uppercase tracking-widest max-w-xs leading-relaxed"> Sal al punto de encuentro. El conductor te está esperando. </p> <button onClick={handlePassengerReady} disabled={loading} className="mt-12 px-10 py-5 bg-white text-green-700 font-black rounded-3xl shadow-xl active:scale-95 transition-transform text-lg uppercase tracking-wide flex items-center gap-3"> {loading ? <Loader2 className="animate-spin" /> : <><ThumbsUp size={24} /> Voy Saliendo</>} </button> </div> )}
      {view === 'history' && renderHistory()}
      {view === 'payment' && renderPayment()}
      {view === 'profile' && renderProfile()}
      {view === 'services' && renderServices()}
      {view === 'home' && status !== RideStatus.RATING && !showReceiptModal && ( <div className={`absolute inset-x-0 bottom-0 z-30 pointer-events-none p-0 flex flex-col overflow-hidden transition-transform duration-300 ease-in-out ${isMinimized ? 'translate-y-[85%]' : 'translate-y-0'}`}> <div className="pointer-events-auto flex justify-end px-4 pb-2"> <button onClick={() => setIsMinimized(!isMinimized)} className="bg-white text-zippy-dark p-2 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 active:scale-90 transition-transform"> {isMinimized ? <ChevronUp size={24} /> : <ChevronDown size={24} />} </button> </div>
      {status === RideStatus.IDLE && ( <div className="pointer-events-auto bg-white rounded-t-[40px] p-8 shadow-2xl border-t border-gray-100 animate-slide-up pb-10"> <div className="text-center mb-8"> <img src="https://tritex.com.mx/zippylogo.png" className="h-8 mx-auto mb-2 object-contain" /> <h2 className="text-2xl font-black text-zippy-dark tracking-tight">¿A dónde <span className="text-zippy-main">vamos?</span></h2> </div> <div className="space-y-4 mb-6"> <div className="bg-gray-50 p-4 rounded-2xl flex items-center gap-4 border border-gray-100"> <MapPin size={20} className="text-green-500" /> <input type="text" value={pickup} onChange={e=>setPickup(e.target.value)} placeholder="¿Dónde te recogemos?" className="bg-transparent w-full font-bold outline-none text-zippy-dark" /> </div> <div className="bg-gray-50 p-4 rounded-2xl flex items-center gap-4 border border-gray-100 focus-within:border-zippy-main relative"> <Navigation size={20} className="text-red-500 flex-shrink-0" /> <input type="text" value={destination} onChange={e=>setDestination(e.target.value)} placeholder="¿A dónde vas?" className="bg-transparent w-full font-bold outline-none text-zippy-dark" /> <div className="flex gap-2"> <button onClick={() => userProfile.saved_home && setDestination(userProfile.saved_home)} className="p-2 bg-gray-200 rounded-full hover:bg-zippy-main/50"><Home size={14}/></button> <button onClick={() => userProfile.saved_work && setDestination(userProfile.saved_work)} className="p-2 bg-gray-200 rounded-full hover:bg-zippy-main/50"><Building2 size={14}/></button> </div> </div> </div> <div className="flex items-center justify-between mb-6 bg-gray-50 p-4 rounded-2xl"> <div className="flex items-center gap-3"> <span className="text-2xl font-black text-zippy-dark">$</span> <input type="number" value={calculatedPrice} onChange={e=>setCalculatedPrice(Number(e.target.value))} className="bg-transparent text-2xl font-black text-zippy-dark outline-none w-20" /> </div> <div className="text-right"> <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">TU TARIFA</span> {smartAdvice && <span className="text-[9px] font-bold text-zippy-main">{smartAdvice.advice}</span>} </div> </div> 
      {/* Payment Selection for Request */}
      <div className="flex bg-gray-50 p-1 rounded-xl mb-4 border border-gray-100">
          <button onClick={() => setPaymentMethod('cash')} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase flex items-center justify-center gap-2 transition-all ${paymentMethod === 'cash' ? 'bg-white text-zippy-dark shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'}`}>
              <Banknote size={16} /> Efectivo
          </button>
          <button onClick={() => setPaymentMethod('card')} className={`flex-1 py-3 rounded-lg text-xs font-black uppercase flex items-center justify-center gap-2 transition-all ${paymentMethod === 'card' ? 'bg-white text-zippy-dark shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'}`}>
              <CreditCard size={16} /> Tarjeta
          </button>
      </div>
      <div className="flex gap-4"> <button onClick={handleRequestRide} className="flex-1 bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-transform uppercase text-sm tracking-widest">PEDIR AHORA</button> <button onClick={() => setScheduleModalOpen(true)} className="p-4 bg-gray-100 text-gray-500 rounded-2xl active:scale-90 transition-transform"><Calendar size={20} /></button> </div> </div> )}
      {status === RideStatus.REQUESTING && ( <div className="pointer-events-auto bg-white rounded-t-[40px] p-6 shadow-2xl flex-1 flex flex-col overflow-hidden animate-slide-up h-[60vh]"> <div className="flex justify-between items-center mb-6"> <h3 className="text-xl font-black text-zippy-dark uppercase tracking-tight">Conductores Cerca</h3> <button onClick={handleRefreshConnection} disabled={loading} className="text-zippy-dark/50 hover:text-zippy-dark transition-colors p-2 rounded-full active:scale-90" title="Refrescar Conexión"><RotateCcw size={20} className={loading ? 'animate-spin' : ''} /></button> </div> <div className="flex-1 overflow-y-auto"> {availableTarifas.length > 0 ? ( <OffersList tarifas={availableTarifas} onAccept={handleAcceptTarifa} onDecline={(id) => setAvailableTarifas(prev => prev.filter(o => o.id !== id))} onViewProfile={setViewingDriver} /> ) : ( <div className="space-y-3 pb-20 p-1 flex flex-col items-center justify-center h-full"> <div className="text-center mb-4"> <Loader2 className="w-12 h-12 text-zippy-dark animate-spin mx-auto mb-4" /> <p className="text-sm font-bold text-gray-500 animate-pulse">Negociando con conductores cercanos...</p> </div> </div> )} </div> <div className="pt-4 border-t border-gray-100"> <button onClick={handleCancelSearch} disabled={loading} className="w-full bg-red-600 text-white font-black py-5 rounded-2xl shadow-xl shadow-red-600/30 hover:bg-red-700 transition-all uppercase text-xs tracking-widest flex items-center justify-center gap-3 active:scale-95">{loading ? <Loader2 className="animate-spin" /> : <><XCircle size={18} /> CANCELAR BÚSQUEDA</>}</button> </div> </div> )}
      {(status === RideStatus.ACCEPTED || status === RideStatus.ARRIVED || status === RideStatus.PASSENGER_READY || status === RideStatus.IN_PROGRESS) && selectedDriver && !showReceiptModal && ( <div className={`pointer-events-auto bg-white rounded-t-[40px] shadow-[0_-10px_40px_rgba(0,0,0,0.15)] animate-slide-up relative overflow-hidden transition-all duration-500 ${status === RideStatus.ARRIVED ? 'border-t-8 border-green-500 shadow-[0_0_50px_rgba(34,197,94,0.4)]' : ''}`}> <div className={`px-6 py-2 flex items-center justify-between ${status === RideStatus.ARRIVED ? 'bg-green-600' : 'bg-green-600'}`}> <div className="flex items-center gap-2 text-white"> <ShieldCheck size={16} /> <span className="text-[10px] font-black uppercase tracking-widest">Conductor 100% Verificado</span> </div> <button onClick={handleCancelRide} className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2 py-1 rounded-lg transition-colors"> <XCircle size={12} className="text-white" /> <span className="text-[9px] font-black text-white uppercase">Cancelar</span> </button> </div> <div className="p-6 pb-8"> <div className="flex items-start justify-between mb-6"> <div className="flex items-center gap-4"> <div className={`w-16 h-16 rounded-full p-1 bg-gradient-to-tr from-zippy-main to-zippy-dark transition-all ${status === RideStatus.ARRIVED ? 'scale-110 ring-4 ring-green-400 ring-offset-2' : ''}`}> <img src={selectedDriver.avatarUrl} alt="Driver" className="w-full h-full rounded-full object-cover border-2 border-white" /> </div> <div> <h2 className="text-2xl font-black text-zippy-dark leading-none mb-1">{selectedDriver.name}</h2> <div className="flex items-center gap-2 text-gray-500 text-[10px] font-bold uppercase"> <span>★ {selectedDriver.rating}</span> <span>•</span> <span>{selectedDriver.tripsCompleted} Viajes</span> </div> </div> </div> {activeRide?.is_paid ? ( <div className="px-4 py-2 rounded-xl bg-green-100 text-green-700 font-black text-[10px] uppercase tracking-widest flex items-center gap-2 shadow-sm border border-green-200"> <CheckCircle2 size={14} /> PAGO LISTO </div> ) : ( status === RideStatus.IN_PROGRESS ? ( <button onClick={handleOpenEarlyPayment} className="px-4 py-2 rounded-xl bg-zippy-dark text-white font-black text-[10px] uppercase tracking-widest shadow-lg animate-pulse hover:scale-105 transition-transform"> PAGAR AHORA </button> ) : ( <div className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-md ${status === RideStatus.ARRIVED ? 'bg-green-500 text-white animate-pulse scale-110' : 'bg-zippy-dark text-white'}`}> {status === RideStatus.ARRIVED ? '¡Llegó por ti!' : '3 min'} </div> ) )} </div> <div className={`flex gap-4 mb-6 p-4 rounded-3xl border transition-colors ${status === RideStatus.ARRIVED ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}> <div className="flex-1 flex flex-col justify-center"> <h3 className="font-bold text-zippy-dark text-sm">{selectedDriver.carModel}</h3> <div className="flex items-center gap-3 mt-1"> <div className="bg-white border border-gray-200 px-2 py-1 rounded text-xs font-mono font-bold text-gray-600">{selectedDriver.carPlate}</div> <span className="text-[10px] font-black text-gray-400 uppercase">Econ. {selectedDriver.taxiNumber}</span> </div> </div> </div> <div className="grid grid-cols-4 gap-2"> <button onClick={handleCallDriver} className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"><Phone size={20} className="text-zippy-dark mb-1" /><span className="text-[8px] font-black uppercase text-gray-500">Llamar</span></button> <button disabled={status === RideStatus.COMPLETED} onClick={() => setChatOpen(true)} className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20 disabled:opacity-50"><MessageSquare size={20} className="text-zippy-dark mb-1" /><span className="text-[8px] font-black uppercase text-gray-500">Chat</span></button> <button onClick={handleShareTrip} className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"><Share2 size={20} className="text-zippy-dark mb-1" /><span className="text-[8px] font-black uppercase text-gray-500">Compartir</span></button> <button onClick={handleTriggerSOS} className="flex flex-col items-center justify-center p-3 bg-red-600 text-white rounded-2xl shadow-lg shadow-red-600/30 active:scale-90 transition-transform"><Siren size={20} className="mb-1 animate-pulse" /><span className="text-[8px] font-black uppercase">SOS</span></button> </div> </div> </div> )} </div> )}
      {view === 'home' && status !== RideStatus.RATING && !showReceiptModal && ( <div className="absolute top-0 left-0 right-0 p-4 z-30 flex justify-between items-center"> <button onClick={() => setDrawerOpen(true)} className="p-4 bg-white shadow-xl rounded-2xl text-zippy-dark active:scale-90 transition-transform"><Menu size={24}/></button> <div className="flex gap-2"> <button onClick={onBack} className="p-4 bg-white shadow-xl rounded-2xl text-red-500 active:scale-90 transition-transform"><LogOut size={24}/></button> <button onClick={() => setAssistantOpen(true)} className="p-4 bg-zippy-dark text-zippy-accent shadow-xl rounded-2xl animate-pulse"><MessageSquare size={24}/></button> </div> </div> )}
      <Drawer isOpen={drawerOpen} onClose={()=>setDrawerOpen(false)} onLogout={onBack} currentView={view} onChangeView={setView} onOpenEmergency={()=>setEmergencyOpen(true)} onOpenDriverReg={()=>setDriverRegOpen(true)} userName={userProfile.name} driverApplicationStatus={driverApplicationStatus} onOpenDriverStatus={() => setDriverStatusViewOpen(true)} />
      <AssistantModal isOpen={assistantOpen} onClose={()=>setAssistantOpen(false)} />
      <EmergencyDirectory isOpen={emergencyOpen} onClose={()=>setEmergencyOpen(false)} />
      <DriverRegistration isOpen={driverRegOpen} onClose={()=>setDriverRegOpen(false)} userId={userProfile.id} onRegistrationComplete={() => { setDriverRegOpen(false); const refetchProfile = async () => { const { data: profile } = await supabase.from('profiles').select('verification_status').eq('id', userProfile.id).single(); if (profile) { setDriverApplicationStatus(profile.verification_status || 'pending'); } }; refetchProfile(); }} />
      {addCardOpen && <AddCardModal onClose={() => setAddCardOpen(false)} onSave={handleSaveCard} loading={loading} />}
      {scheduleModalOpen && <ScheduleRideModal onClose={() => setScheduleModalOpen(false)} onSchedule={handleScheduleRide} loading={loading} />}
      {driverStatusViewOpen && <ApplicationStatus isOpen={driverStatusViewOpen} onClose={() => setDriverStatusViewOpen(false)} status={driverApplicationStatus} />}
      <ChatModal isOpen={chatOpen} onClose={() => setChatOpen(false)} onEndChat={() => { setChatOpen(false); showToast("Chat finalizado", "info"); }} rideId={activeRide?.id || ''} currentUserRole="PASSENGER" currentUserId={userProfile.id} counterpartName={selectedDriver?.name || 'Conductor'} counterpartPhone={selectedDriver?.phone} />
      {!isAuthenticated && ( <div className="fixed inset-0 z-[100] bg-zippy-dark/95 backdrop-blur-xl flex items-center justify-center p-6 animate-fade-in"> <div className="bg-white p-8 rounded-[40px] w-full max-w-sm shadow-2xl overflow-hidden relative"> <div className="absolute top-0 left-0 w-full h-2 bg-zippy-main"></div> <div className="text-center mb-8"> <img src="https://tritex.com.mx/zippylogo.png" className="h-10 mx-auto mb-4 object-contain" /> <h2 className="text-2xl font-black text-zippy-dark uppercase tracking-tight">{authMode === 'login' ? 'Bienvenido' : 'Crear Cuenta'}</h2> <p className="text-gray-400 text-xs font-bold mt-1">Ingresa tus datos para continuar</p> </div> <form onSubmit={handleAuth} className="space-y-4"> {authMode === 'register' && ( <input required placeholder="Nombre Completo" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold text-sm outline-none focus:border-zippy-main transition-colors" value={fullName} onChange={e=>setFullName(e.target.value)} /> )} <input required type="email" placeholder="Correo Electrónico" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold text-sm outline-none focus:border-zippy-main transition-colors" value={email} onChange={e=>setEmail(e.target.value)} /> <div className="relative"> <input required type={showPassword ? "text" : "password"} placeholder="Contraseña" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold text-sm outline-none focus:border-zippy-main transition-colors" value={password} onChange={e=>setPassword(e.target.value)} /> <button type="button" onClick={()=>setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-zippy-dark"> {showPassword ? <EyeOff size={20} /> : <Eye size={20} />} </button> </div> <button className="w-full bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl hover:bg-zippy-light transition-all flex items-center justify-center gap-2 mt-4 active:scale-95"> {loading ? <Loader2 className="animate-spin" /> : authMode === 'login' ? 'INICIAR SESIÓN' : 'REGISTRARME'} </button> <div className="text-center mt-6"> <button type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="text-zippy-main font-black text-xs uppercase tracking-widest hover:underline decoration-2 underline-offset-4"> {authMode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia Sesión'} </button> </div> </form> <button onClick={onBack} className="absolute top-4 right-4 p-2 text-gray-300 hover:text-gray-500"><X size={20} /></button> </div> </div> )}
    </div>
  );
};

const AddCardModal = ({ onClose, onSave, loading }: { onClose: () => void, onSave: (data: any) => void, loading: boolean }) => {
    const [cardData, setCardData] = useState({ number: '', name: '', expiry: '', cvv: '' }); const [cardBrand, setCardBrand] = useState('');
    const formatCardNumber = (value: string) => { const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, ''); const matches = v.match(/\d{4,16}/g); const match = (matches && matches[0]) || ''; const parts = []; for (let i = 0, len = match.length; i < len; i += 4) { parts.push(match.substring(i, i + 4)); } if (parts.length) return parts.join(' '); return value; };
    const formatExpiry = (value: string) => { const v = value.replace(/[^0-9]/gi, ''); if (v.length >= 3) return `${v.slice(0, 2)}/${v.slice(2, 4)}`; return v; };
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { let { name, value } = e.target; if (name === 'number') { value = formatCardNumber(value); if (value.startsWith('4')) setCardBrand('Visa'); else if (value.startsWith('5')) setCardBrand('Mastercard'); else setCardBrand(''); } if (name === 'expiry') value = formatExpiry(value); if (name === 'cvv') value = value.replace(/[^0-9]/gi, '').slice(0, 4); setCardData(prev => ({ ...prev, [name]: value })); };
    const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave({ ...cardData, brand: cardBrand, number: cardData.number.replace(/\s/g, '') }); };
    return ( <div className="fixed inset-0 z-[100] bg-zippy-dark/90 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in"> <div className="bg-white w-full max-w-sm rounded-[32px] shadow-2xl overflow-hidden relative"> <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400 hover:text-zippy-dark z-20"><X size={20} /></button> <div className="p-6"> <h2 className="text-xl font-black text-zippy-dark uppercase mb-6">Agregar Tarjeta</h2> <form onSubmit={handleSubmit} className="space-y-4"> <input name="number" value={cardData.number} onChange={handleInputChange} maxLength={19} placeholder="Número de Tarjeta" className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm" /> <input name="name" value={cardData.name} onChange={handleInputChange} placeholder="Nombre en la Tarjeta" className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm" /> <div className="grid grid-cols-2 gap-3"> <input name="expiry" value={cardData.expiry} onChange={handleInputChange} maxLength={5} placeholder="MM/AA" className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm" /> <input name="cvv" value={cardData.cvv} onChange={handleInputChange} maxLength={4} placeholder="CVV" className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm" /> </div> <button disabled={loading} className="w-full bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl flex items-center justify-center gap-2"> {loading ? <Loader2 className="animate-spin"/> : 'Guardar Tarjeta'} </button> </form> </div> </div> </div> );
};

const ScheduleRideModal = ({ onClose, onSchedule, loading }: { onClose: () => void, onSchedule: (datetime: string) => void, loading: boolean }) => {
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [time, setTime] = useState(new Date(Date.now() + 3600000).toTimeString().substring(0,5));

    const handleSubmit = () => {
        const scheduledDateTime = new Date(`${date}T${time}`);
        if (scheduledDateTime < new Date()) { alert("Selecciona una hora futura."); return; }
        onSchedule(scheduledDateTime.toISOString());
    };
    
    return ( <div className="fixed inset-0 z-[100] bg-zippy-dark/90 backdrop-blur-xl flex items-center justify-center p-4 animate-fade-in"> <div className="bg-white w-full max-w-sm rounded-[32px] shadow-2xl p-6 relative"> <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-400"><X size={20}/></button> <div className="text-center mb-6"> <Calendar size={32} className="mx-auto text-zippy-main mb-2"/> <h2 className="text-xl font-black text-zippy-dark uppercase">Programar Viaje</h2> </div> <div className="space-y-4"> <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm"/> <input type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm"/> </div> <button onClick={handleSubmit} disabled={loading} className="w-full bg-zippy-dark text-white font-black py-4 rounded-2xl shadow-xl mt-6"> {loading ? <Loader2 className="animate-spin mx-auto"/> : 'Confirmar Horario'} </button> </div> </div> );
};

export default PassengerApp;
