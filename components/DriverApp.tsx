
import React, { useState, useEffect, useRef } from 'react';
import { 
  Power, Map, Loader2, Star, BellRing, X, Navigation, CheckCircle, TrendingUp, 
  DollarSign, LogOut, Phone, MessageCircle, Navigation2, Minus, Plus, 
  User, History, Wallet, ChevronRight, Camera, Save, MapPin, Calendar, Clock,
  ArrowLeft, Mail, ShieldCheck, CreditCard, Filter, Eye, EyeOff, Smartphone, Shield, Wind, VolumeX, AlertOctagon,
  Gift, Trash2, Share2, Siren, MessageSquare, Car, ChevronDown, ChevronUp,
  XCircle, CheckSquare, Zap, Check, CheckCircle2, RotateCcw, RefreshCw
} from 'lucide-react';
import MapVisual from './MapVisual';
import { RideStatus, Ride } from '../types';
import { supabase } from '../services/supabase';
import DriverRegistration from './DriverRegistration';
import ChatModal from './ChatModal';
import EmergencyDirectory from './EmergencyDirectory';
import NotificationToast, { NotificationType } from './NotificationToast';

interface DriverAppProps {
  onBack: () => void;
}

const SOUNDS = {
  newRequest: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3', 
  assigned: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',    
  cancel: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',      
  message: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',      
  sos: 'https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3', 
  cash: 'https://assets.mixkit.co/active_storage/sfx/2004/2004-preview.mp3' 
};

// --- VOICE COMMAND HELPER ---
const speak = (text: string) => {
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
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const soundLoopRef = useRef<number | null>(null); 
  
  const [toast, setToast] = useState<{msg: string, type: NotificationType, visible: boolean}>({ msg: '', type: 'info', visible: false });
  const [tipNotification, setTipNotification] = useState<{message: string, amount: number} | null>(null);

  const [showPassengerModal, setShowPassengerModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<Ride | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  
  const [sosActive, setSosActive] = useState(false);
  
  const [pendingOffer, setPendingOffer] = useState<{ rideId: string, offerId: string } | null>(null);
  
  const [requestPassenger, setRequestPassenger] = useState<{name: string, rating: number, trips: number, photo: string, phone?: string} | null>(null);
  
  // FIX: Initialize with undefined to trigger MapVisual loading state
  const [currentLocation, setCurrentLocation] = useState<[number, number] | undefined>(undefined);
  const [gpsError, setGpsError] = useState(false);

  const [negotiationPrices, setNegotiationPrices] = useState<{[key: string]: number}>({});
  
  const [driverProfile, setDriverProfile] = useState({
      id: '', name: '', email: '', phone: '', rating: 4.9, carModel: '', carPlate: '', carColor: '', taxiNumber: '', avatarUrl: '', tripsToday: 0, earningsToday: 0, licenseStatus: ''
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

  // REFERENCIA PARA COORDENADAS
  const locationRef = useRef<[number, number] | undefined>(undefined);

  const playSound = (soundUrl: string, loop = false) => {
      const audio = new Audio(soundUrl);
      audio.loop = loop;
      audio.play().catch(e => console.warn('Audio play failed (interaction needed):', e));
      return audio;
  };

  const showToast = (msg: string, type: NotificationType) => {
      setToast({ msg, type, visible: true });
  };

  // Helper to "warm up" audio context on user interaction (Go Online)
  const unlockAudio = () => {
      const audio = new Audio(SOUNDS.newRequest);
      audio.volume = 0;
      audio.play().then(() => {
          audio.pause();
          audio.currentTime = 0;
      }).catch(() => {});
  };

  const toggleOnline = () => {
      if (!isOnline) {
          unlockAudio(); // Unlock audio when going online
          showToast("Conectando... Esperando viajes", "info");
      }
      setIsOnline(!isOnline);
  };

  useEffect(() => {
      if (newRequestAlert && !showPassengerModal) {
          console.log("Playing Alert Sound for New Request");
          playSound(SOUNDS.newRequest);
          speak("Nueva solicitud de viaje cercana."); // VOICE ALERT
          soundLoopRef.current = window.setInterval(() => {
              playSound(SOUNDS.newRequest);
              if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]); 
          }, 3000);
      } else {
          if (soundLoopRef.current) {
              clearInterval(soundLoopRef.current);
              soundLoopRef.current = null;
          }
      }
      return () => { if (soundLoopRef.current) clearInterval(soundLoopRef.current); };
  }, [newRequestAlert, showPassengerModal]);

  useEffect(() => {
    const checkSession = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
            if (profile) {
                setDriverProfile(prev => ({ 
                    ...prev, 
                    id: session.user.id, name: profile.full_name || 'Conductor Zippy', email: profile.email || '', taxiNumber: profile.taxi_number || 'S/N', carModel: profile.car_model || 'Vehículo', carPlate: profile.car_plate || '---', phone: profile.phone || '', avatarUrl: profile.avatar_url || ''
                }));
                setIsAuthenticated(true);
                if (profile.status === 'online') setIsOnline(true);
            }
        }
    };
    checkSession();
  }, []);

  // --- MANUAL DATA REFRESH FUNCTION ---
  // This logic is crucial for fixing "stuck" rides. It verifies against the DB.
  const refreshDriverData = async () => {
      if (!driverProfile.id) return;
      setLoading(true);
      try {
          // 1. Refresh Earnings & History (INCLUYE PROPINAS)
          const { data: rides } = await supabase.from('rides')
              .select('*')
              .eq('driver_id', driverProfile.id)
              .eq('status', 'COMPLETED')
              .order('created_at', { ascending: false });
          
          if (rides) {
              setHistory(rides as Ride[]);
              // Sumar precio + propina
              const total = rides.reduce((acc, r) => acc + (r.price || 0) + (r.tip_amount || 0), 0);
              setTotalEarnings(total);
          }

          // 2. Refresh Profile Stats
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', driverProfile.id).single();
          if (profile) {
              setDriverProfile(prev => ({ ...prev, rating: profile.rating, tripsToday: profile.trips_completed || 0 }));
          }

          // 3. CHECK ACTIVE RIDE STATUS (The Fix for Stuck Rides)
          if (activeRide) {
              const { data: ride } = await supabase.from('rides').select('*').eq('id', activeRide.id).single();
              if (ride) {
                  // If DB says archived or completed+paid, but local is active -> FORCE CLOSE
                  if (ride.status === 'ARCHIVED' || (ride.status === 'COMPLETED' && ride.is_paid)) {
                      handleResetToIdle();
                      showToast("Sincronización: Viaje finalizado detectado.", "info");
                  } else if (ride.status !== rideStatus) {
                      // Just update status if it changed but still active
                      setRideStatus(ride.status as RideStatus);
                      setActiveRide(ride);
                  }
              } else {
                  // Ride deleted? Force close.
                  handleResetToIdle();
              }
          }

          showToast("Datos y estado actualizados", "success");
      } catch (error) {
          console.error(error);
          showToast("Error al sincronizar datos", "error");
      } finally {
          setLoading(false);
      }
  };

  // --- FETCH HISTORY & EARNINGS WHEN VIEW CHANGES ---
  useEffect(() => {
      if (isAuthenticated && driverProfile.id && (view === 'history' || view === 'wallet')) {
          refreshDriverData(); // Use the smart refresh
      }
  }, [view, isAuthenticated, driverProfile.id]);

  // --- LOGICA GPS ROBUSTA + HEARTBEAT ---
  useEffect(() => {
    if (!isAuthenticated || !driverProfile.id) return;

    if (!isOnline) {
        setGpsError(false);
        return;
    }

    if (!('geolocation' in navigator)) {
        alert("GPS no soportado. No podrás recibir viajes.");
        return;
    }

    // 1. WATCH POSITION (Navegador)
    const watchId = navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            setCurrentLocation([latitude, longitude]);
            locationRef.current = [latitude, longitude]; // Guardar en ref para el intervalo
            setGpsError(false);
        },
        (error) => {
            console.error("GPS Error:", error);
            if(error.code === 1) showToast("GPS Bloqueado. Habilita permisos.", 'error');
        },
        { 
            enableHighAccuracy: true, 
            maximumAge: 0, 
            timeout: 10000 
        }
    );

    // 2. HEARTBEAT INTERVAL (Cada 3 segs a DB) - Sincronización forzada
    const heartbeat = setInterval(async () => {
        if (!locationRef.current) return;
        const [lat, lng] = locationRef.current;

        // Actualizar Perfil (Siempre, para que el mapa admin lo vea)
        await supabase.from('profiles').update({ lat, lng }).eq('id', driverProfile.id);

        // Actualizar Viaje Activo (Si existe)
        if (activeRide?.id) {
             await supabase.from('rides').update({ driver_lat: lat, driver_lng: lng }).eq('id', activeRide.id);
        }
    }, 3000);

    return () => {
        navigator.geolocation.clearWatch(watchId);
        clearInterval(heartbeat);
    };
  }, [isAuthenticated, isOnline, activeRide?.id, driverProfile.id]);

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


  // --- REALTIME SUBSCRIPTION FOR NEW RIDES ---
  useEffect(() => {
    if (!isAuthenticated || !driverProfile.id) return;

    const fetchRequesting = async () => {
        const { data } = await supabase.from('rides').select('*').eq('status', RideStatus.REQUESTING);
        if(data) {
            const ignored = JSON.parse(localStorage.getItem('zippy_ignored_rides') || '[]');
            const valid = data.filter(r => !ignored.includes(r.id));
            setAvailableRides(valid);
            valid.forEach(r => setNegotiationPrices(prev => ({...prev, [r.id]: r.price})));
        }
        
        // CHECK FOR ACTIVE RIDE
        const { data: active } = await supabase.from('rides').select('*').eq('driver_id', driverProfile.id).in('status', ['ACCEPTED', 'ARRIVED', 'PASSENGER_READY', 'IN_PROGRESS', 'COMPLETED']).single();
        if(active) {
            setActiveRide(active);
            setRideStatus(active.status as RideStatus);
            if(active.passenger_id) fetchPassengerDetails(active.passenger_id);
        } else {
            // IF NO ACTIVE RIDE FOUND IN DB, ENSURE UI IS RESET
            // Only reset if we THINK we have an active ride locally but DB says no
            if (activeRide) handleResetToIdle();
        }
    };
    
    // Initial fetch
    if(isOnline) fetchRequesting();

    // BACKUP POLLING (Every 5s) to catch state changes if WebSocket fails
    const backupInterval = setInterval(async () => {
        if (!isOnline || !driverProfile.id) return;
        
        // Check current ride status if active
        if (activeRide) {
            const { data } = await supabase.from('rides').select('*').eq('id', activeRide.id).single();
            if (data) {
                if (data.status === 'ARCHIVED' || (data.status === 'COMPLETED' && data.is_paid)) {
                    handleResetToIdle(); // Force close
                } else if (data.status !== activeRide.status) {
                    setActiveRide(data); // Sync status
                    setRideStatus(data.status as RideStatus);
                }
            }
        }
    }, 5000);

    const channel = supabase.channel('driver_main_channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, (payload) => {
            const newRide = payload.new as Ride;
            const currentIgnored = JSON.parse(localStorage.getItem('zippy_ignored_rides') || '[]');
            
            // Check if status is requesting (or just handle any new ride that is requesting)
            if (newRide.status === 'REQUESTING' && !currentIgnored.includes(newRide.id)) {
                setAvailableRides(prev => { 
                    if (prev.find(r => r.id === newRide.id)) return prev; 
                    return [newRide, ...prev]; 
                });
                setNegotiationPrices(prev => ({...prev, [newRide.id]: newRide.price}));
                setNewRequestAlert(newRide); 
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, (payload) => {
            const updated = payload.new as any;
            
            if (updated.driver_id === driverProfile.id && updated.status === RideStatus.ACCEPTED) {
                setPendingOffer(null); 
                setActiveRide(updated); 
                setRideStatus(RideStatus.ACCEPTED);
                setAvailableRides(prev => prev.filter(r => r.id !== updated.id)); 
                if (updated.passenger_id) fetchPassengerDetails(updated.passenger_id);
                playSound(SOUNDS.assigned); 
                speak("Navegando al punto de recogida."); // VOICE
                setNewRequestAlert(null); 
                setShowPassengerModal(false);
            }
            
            // LISTENER DE ESTADO FINAL: Si el viaje cambia a COMPLETED/PAID o ARCHIVED -> Resetear UI
            if (activeRide && updated.id === activeRide.id) {
                
                // 1. Pago recibido - FORCE CLOSE UI
                if(updated.is_paid && !activeRide.is_paid) {
                    playSound(SOUNDS.cash);
                    speak("Pago recibido exitosamente."); // VOICE
                    showToast('¡Pago Recibido! Cerrando viaje...', 'success');
                    
                    // Actualizar ganancias localmente antes de cerrar
                    setDriverProfile(prev => ({ 
                        ...prev, 
                        tripsToday: prev.tripsToday + 1, 
                        earningsToday: prev.earningsToday + updated.price 
                    }));

                    // Force close shortly after payment confirmation
                    setTimeout(handleResetToIdle, 1500); 
                }
                
                // 2. DETECCIÓN DE PROPINA EN TIEMPO REAL
                if (updated.tip_amount && updated.tip_amount > (activeRide.tip_amount || 0)) {
                    playSound(SOUNDS.cash);
                    speak("¡Recibiste una propina!"); // VOICE
                    setTipNotification({
                        message: '¡El pasajero ha enviado una propina!',
                        amount: updated.tip_amount
                    });
                    
                    // Auto-ocultar notificación
                    setTimeout(() => setTipNotification(null), 5000);
                    
                    // Actualizar estado local del viaje
                    setActiveRide(prev => prev ? ({...prev, tip_amount: updated.tip_amount}) : null);
                }

                // 3. Archivado por pasajero o completado con pago
                if (updated.status === 'ARCHIVED' || (updated.status === 'COMPLETED' && updated.is_paid)) {
                    showToast('Viaje finalizado. Buscando pasajeros...', 'info');
                    handleResetToIdle();
                }
                
                // 4. Cancelado
                if (updated.status === 'CANCELLED') {
                    playSound(SOUNDS.cancel);
                    speak("El pasajero ha cancelado el viaje."); // VOICE
                    showToast('Viaje cancelado por el pasajero.', 'error');
                    handleResetToIdle();
                }

                // 5. Actualización normal de estado (si no está finalizado)
                if (!['ARCHIVED', 'CANCELLED'].includes(updated.status) && !updated.is_paid) {
                    setRideStatus(updated.status as RideStatus);
                    setActiveRide(prev => prev ? ({ ...prev, status: updated.status, is_paid: updated.is_paid }) : null);
                }
            }
            
            if (updated.status !== 'REQUESTING' && updated.driver_id !== driverProfile.id) {
                setAvailableRides(prev => prev.filter(r => r.id !== updated.id));
                if(newRequestAlert?.id === updated.id) {
                    setNewRequestAlert(null);
                    setShowPassengerModal(false);
                }
            }
        })
        .subscribe((status) => {
            console.log("Supabase Channel Status:", status);
        });
        
    const msgChannel = supabase.channel(`driver_messages:${driverProfile.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `ride_id=eq.${activeRide?.id}` }, (payload) => {
        const msg = payload.new;
        if (msg.sender_id !== driverProfile.id) { 
            setChatOpen(true); 
            playSound(SOUNDS.message); 
            speak("Nuevo mensaje del pasajero."); // VOICE
            showToast('Nuevo mensaje del pasajero', 'message');
        }
    }).subscribe();

    return () => { 
        supabase.removeChannel(channel); 
        supabase.removeChannel(msgChannel);
        clearInterval(backupInterval);
    };
  }, [isAuthenticated, isOnline, driverProfile.id, activeRide?.id, rideStatus, activeRide?.is_paid, activeRide?.tip_amount]);

  // ... (Resto de funciones de autenticación, modal, etc. se mantienen igual)
  const fetchPassengerDetails = async (passengerId: string) => {
      const { data } = await supabase.from('profiles').select('full_name, rating, avatar_url, phone').eq('id', passengerId).single();
      if (data) { setRequestPassenger({ name: data.full_name || 'Ian Anguiano', rating: data.rating || 5.0, trips: 1, photo: data.avatar_url || `https://ui-avatars.com/api/?name=${data.full_name}&background=random`, phone: data.phone }); }
  };
  const handleAuth = async (e: React.FormEvent) => { e.preventDefault(); setLoading(true); try { if (authMode === 'login') { const { data, error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; if (data.user) { const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single(); setDriverProfile(prev => ({ ...prev, id: data.user!.id, name: profile.full_name, email: profile.email, taxiNumber: profile.taxi_number, carModel: profile.car_model, carPlate: profile.car_plate, phone: profile.phone, avatarUrl: profile.avatar_url })); setIsAuthenticated(true); } } else { const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, role: 'DRIVER' } } }); if (error) throw error; alert('¡Registro exitoso!'); setAuthMode('login'); } } catch (err: any) { alert("Error: " + err.message); } finally { setLoading(false); } };
  
  const handleAcceptRequest = async (overrideRequest?: Ride) => { 
      const target = overrideRequest || selectedRequest || newRequestAlert; 
      if (!target) return; 
      if (!currentLocation) { alert("Esperando ubicación GPS..."); return; } 
      setLoading(true); 
      const agreedPrice = negotiationPrices[target.id] || target.price; 
      try { 
          const { error } = await supabase.from('rides').update({ 
              status: 'ACCEPTED', 
              driver_id: driverProfile.id, 
              price: agreedPrice, 
              driver_lat: currentLocation[0], 
              driver_lng: currentLocation[1] 
          }).eq('id', target.id); 
          
          if (error) throw error; 
          
          // Send automatic message to ensure passenger gets notified via chat channel as well
          await supabase.from('messages').insert({
              ride_id: target.id,
              sender_id: driverProfile.id,
              role: 'DRIVER',
              text: '¡Hola! He aceptado tu viaje. Voy en camino.'
          });

          playSound(SOUNDS.assigned); 
          setNewRequestAlert(null); 
          setShowPassengerModal(false); 
          setShowSuccessOverlay(true); 
          
          setTimeout(() => { 
              setShowSuccessOverlay(false); 
              setActiveRide({ ...target, status: RideStatus.ACCEPTED, driver_id: driverProfile.id, price: agreedPrice }); 
              setRideStatus(RideStatus.ACCEPTED); 
              setAvailableRides(prev => prev.filter(r => r.id !== target.id)); 
              if(target.passenger_id) fetchPassengerDetails(target.passenger_id); 
          }, 1500); 
      } catch (err: any) { alert("Error: " + err.message); } finally { setLoading(false); } 
  };
  
  const handleCancelOffer = async () => { if (pendingOffer) { setPendingOffer(null); showToast('Oferta cancelada.', 'info'); } };
  
  const handleUpdateRideStatus = async (newStatus: RideStatus) => { 
      if (!activeRide) return; 
      if (!currentLocation) {alert("GPS requerido"); return;} 
      try { 
          const { error } = await supabase.from('rides').update({ status: newStatus, driver_lat: currentLocation[0], driver_lng: currentLocation[1] }).eq('id', activeRide.id); 
          if (error) throw error; 
          setRideStatus(newStatus); 
          setActiveRide(prev => prev ? ({...prev, status: newStatus}) : null); 
          
          if (newStatus === RideStatus.ARRIVED) { 
              playSound(SOUNDS.newRequest); 
              speak("Has llegado al punto de recogida."); // VOICE
              showToast('Has notificado tu llegada.', 'info'); 
              await supabase.from('messages').insert({ ride_id: activeRide.id, sender_id: driverProfile.id, text: '¡Hola! Ya llegué al punto.', role: 'DRIVER' }); 
          } 
          
          if (newStatus === RideStatus.IN_PROGRESS) {
              speak("Iniciando viaje al destino."); // VOICE
          }

          if (newStatus === RideStatus.COMPLETED) { 
              if (activeRide.is_paid) { 
                  playSound(SOUNDS.cash); 
                  setDriverProfile(prev => ({ ...prev, tripsToday: prev.tripsToday + 1, earningsToday: prev.earningsToday + activeRide.price })); 
                  showToast('Viaje finalizado.', 'success'); 
                  // AUTO CLOSE IF PAID
                  setTimeout(handleResetToIdle, 1500); 
              } else { 
                  playSound(SOUNDS.cash); 
                  speak("Viaje finalizado. Cobrando al pasajero."); // VOICE
                  showToast('Cobro exitoso. Esperando confirmación...', 'success'); 
              } 
          } 
      } catch (err: any) { alert("Error: " + err.message); } 
  };
  
  // FUNCION RESET TOTAL (FIXED): Limpia todo el estado local para volver a "Buscando pasajeros"
  const handleResetToIdle = () => { 
      // 1. Clear Active Ride State
      setActiveRide(null); 
      setRideStatus(RideStatus.IDLE); 
      
      // 2. Clear Requests/Alerts
      setNewRequestAlert(null); 
      setSelectedRequest(null);
      setPendingOffer(null);
      setRequestPassenger(null);
      
      // 3. Reset View
      setView('home'); 
      setNegotiationPrices({});
      
      // 4. Fetch Available Rides Again
      const fetchRequesting = async () => { 
          const { data } = await supabase.from('rides').select('*').eq('status', RideStatus.REQUESTING); 
          if(data) { 
              const ignored = JSON.parse(localStorage.getItem('zippy_ignored_rides') || '[]'); 
              const valid = data.filter(r => !ignored.includes(r.id)); 
              setAvailableRides(valid); 
          } else {
              setAvailableRides([]);
          }
      }; 
      fetchRequesting(); 
  };
  
  const handleTriggerSOS = async () => { if (!activeRide || !currentLocation) return; if (!confirm("¿CONFIRMAS QUE ESTÁS EN PELIGRO?")) return; try { await supabase.from('rides').update({ sos_active: true, sos_triggered_by: driverProfile.id, sos_at: new Date().toISOString(), sos_lat: currentLocation[0], sos_lng: currentLocation[1] }).eq('id', activeRide.id); setSosActive(true); showToast('ALERTA SOS ENVIADA.', 'error'); setEmergencyOpen(true); } catch (err: any) { alert("Error: " + err.message); } };
  const handleOpenRequest = (ride: Ride) => { setSelectedRequest(ride); fetchPassengerDetails(ride.passenger_id); setNewRequestAlert(null); setShowPassengerModal(true); };
  const handleShareTrip = async () => { /* Share */ };
  const handleDeleteRide = async (rideId: string) => { const ignored = JSON.parse(localStorage.getItem('zippy_ignored_rides') || '[]'); localStorage.setItem('zippy_ignored_rides', JSON.stringify([...ignored, rideId])); setAvailableRides(prev => prev.filter(r => r.id !== rideId)); if(newRequestAlert?.id === rideId) setNewRequestAlert(null); };
  const adjustPrice = (rideId: string, amount: number) => setNegotiationPrices(prev => ({ ...prev, [rideId]: Math.max((prev[rideId] || 0) + amount, 0) }));
  const handleCallPassenger = () => requestPassenger?.phone ? window.location.href = `tel:${requestPassenger.phone}` : showToast("Sin número disponible", 'error');
  const handleAvatarChange = (e: any) => { if(e.target.files[0]) { setAvatarFile(e.target.files[0]); setAvatarPreview(URL.createObjectURL(e.target.files[0])); setIsEditing(true); }};
  const handleSaveProfile = async () => { setLoading(true); setTimeout(() => { setLoading(false); setIsEditing(false); showToast("Perfil actualizado", "success"); }, 1000); };

  // Calculate Map Props specifically to clear route when inactive
  const getMapRoute = () => {
      if (!activeRide || !activeRide.id || rideStatus === RideStatus.IDLE || rideStatus === RideStatus.COMPLETED) {
          return { start: undefined, end: undefined };
      }
      // If we are picking up passenger
      if (rideStatus === RideStatus.ACCEPTED || rideStatus === RideStatus.ARRIVED) {
          return { 
              start: currentLocation, 
              end: (activeRide.pickup_lat && activeRide.pickup_lng) ? [activeRide.pickup_lat, activeRide.pickup_lng] as [number, number] : undefined 
          };
      }
      // If we are going to destination
      if (rideStatus === RideStatus.IN_PROGRESS || rideStatus === RideStatus.PASSENGER_READY) {
          return { 
              start: currentLocation, 
              end: (activeRide.dest_lat && activeRide.dest_lng) ? [activeRide.dest_lat, activeRide.dest_lng] as [number, number] : undefined
          };
      }
      return { start: undefined, end: undefined };
  };
  const mapRoute = getMapRoute();

  // Render Functions (PassengerModal, Profile, History, Wallet, Auth) - same as before, simplified for brevity in XML
  const renderPassengerModal = () => { const target = selectedRequest || newRequestAlert; if (!target) return null; const price = negotiationPrices[target.id] || target.price; return ( <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"> <div className="bg-white w-full max-w-md rounded-[32px] overflow-hidden shadow-2xl relative animate-slide-up flex flex-col max-h-[90vh]"> <div className="bg-zippy-dark p-6 pb-10 text-center relative"> <button onClick={() => { setShowPassengerModal(false); setNewRequestAlert(null); }} className="absolute top-4 right-4 z-20 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"><X size={24} className="text-white" /></button> <div className="relative z-10 flex flex-col items-center mt-2"> <div className="w-24 h-24 rounded-full p-1 bg-gradient-to-tr from-zippy-main to-white shadow-[0_0_30px_rgba(253,202,1,0.5)] mb-3 animate-bounce"> <img src={requestPassenger?.photo || `https://ui-avatars.com/api/?name=User&background=random`} className="w-full h-full rounded-full object-cover border-4 border-zippy-dark" /> </div> <h2 className="text-3xl font-black text-white tracking-tight">{requestPassenger?.name || 'Pasajero'}</h2> </div> </div> <div className="flex-1 p-6 -mt-6 bg-white rounded-t-[32px] relative z-20 flex flex-col gap-4 overflow-y-auto"> <div className="flex justify-between items-center bg-gray-50 p-5 rounded-3xl border-2 border-gray-100 shadow-sm"> <div className="flex flex-col"> <span className="text-xs font-black text-gray-400 uppercase tracking-widest">GANANCIA TOTAL</span> <span className="text-6xl font-black text-zippy-dark tracking-tighter leading-none">${price}</span> </div> </div> <div className="space-y-4 relative pl-4 mt-2"> <div className="flex gap-4 items-start"> <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0"><div className="w-3 h-3 bg-green-500 rounded-full"></div></div> <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Recoger en</p><h3 className="font-bold text-zippy-dark text-lg">{target.pickup_label}</h3></div> </div> <div className="flex gap-4 items-start"> <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0"><div className="w-3 h-3 bg-red-500 rounded-full"></div></div> <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Destino</p><h3 className="font-bold text-zippy-dark text-lg">{target.destination_label}</h3></div> </div> </div> </div> <div className="p-6 pt-2 bg-white flex-shrink-0 border-t border-gray-50"> <button onClick={() => handleAcceptRequest(target)} disabled={loading} className="w-full py-5 rounded-2xl bg-zippy-main text-zippy-dark font-black text-2xl uppercase shadow-[0_10px_40px_rgba(253,202,1,0.5)] hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 animate-pulse mb-3"> {loading ? <Loader2 size={28} className="animate-spin" /> : <><Zap size={28} className="fill-zippy-dark" /> ACEPTAR VIAJE</>} </button> </div> </div> </div> ); };
  const renderProfile = () => ( <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24"> <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative"> <button onClick={() => setView('home')} className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"><ArrowLeft size={20} /></button> <div className="flex flex-col items-center"> <img src={avatarPreview || driverProfile.avatarUrl || `https://ui-avatars.com/api/?name=${driverProfile.name}&background=003A70&color=fff`} className="w-28 h-28 rounded-full border-4 border-zippy-main shadow-2xl overflow-hidden mb-4 object-cover" /> <h2 className="text-2xl font-black uppercase tracking-tight">{driverProfile.name}</h2> </div> </div> <div className="p-6 space-y-6"> <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-4"> <h3 className="text-sm font-black text-zippy-dark uppercase tracking-widest border-b border-gray-100 pb-2">Vehículo</h3> <p className="font-bold text-zippy-dark">{driverProfile.carModel} - {driverProfile.carPlate}</p> <div className="h-px bg-gray-100 my-2"></div> <h3 className="text-sm font-black text-zippy-dark uppercase tracking-widest border-b border-gray-100 pb-2">Contacto</h3> <p className="font-bold text-zippy-dark">{driverProfile.email}</p> </div> <button onClick={refreshDriverData} className="w-full py-4 rounded-2xl bg-zippy-main/10 text-zippy-dark font-black text-sm uppercase tracking-widest shadow-none flex items-center justify-center gap-2 mt-2 hover:bg-zippy-main/20 transition-colors border-2 border-zippy-main/20"> <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Actualizar Datos </button> <button onClick={onBack} className="w-full py-4 rounded-2xl bg-red-50 text-red-600 font-black text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 mt-4 hover:bg-red-100 transition-colors"><LogOut size={18} /> Cerrar Sesión</button> </div> </div> );
  const renderHistory = () => ( <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24"> <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10"> <button onClick={() => setView('home')} className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"><ArrowLeft size={20} /></button> <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-2">Historial</h2> </div> <div className="p-4 space-y-4"> {history.length > 0 ? history.map(ride => ( <div key={ride.id} className="bg-white p-5 rounded-[24px] shadow-sm border border-gray-100"> <div className="flex justify-between items-start mb-4"> <span className="text-lg font-black text-zippy-dark">${ride.price}</span> <span className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded font-bold uppercase">Completado</span> </div> <div className="flex flex-col gap-1"> <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500"></div><p className="text-xs font-bold text-gray-500">{ride.pickup_label}</p></div> <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500"></div><p className="text-xs font-black text-zippy-dark">{ride.destination_label}</p></div> </div> </div> )) : ( <div className="text-center py-20 opacity-50"><History size={48} className="mx-auto mb-4 text-gray-300"/><p className="font-bold text-gray-400">Sin historial de viajes aún.</p></div> )} </div> </div> );
  const renderWallet = () => ( <div className="absolute inset-0 z-40 bg-gray-100 flex flex-col overflow-y-auto animate-slide-up pb-24"> <div className="bg-zippy-dark text-white p-8 pt-10 rounded-b-[40px] shadow-xl relative sticky top-0 z-10"> <button onClick={() => setView('home')} className="absolute top-4 left-4 p-2 bg-white/10 rounded-full hover:bg-white/20"><ArrowLeft size={20} /></button> <h2 className="text-2xl font-black text-center uppercase tracking-tight mb-2">Mi Cartera</h2> </div> <div className="p-6"> <div className="bg-white p-8 rounded-[40px] shadow-xl border border-gray-100 text-center mb-6"> <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Balance Total</p> <h3 className="text-5xl font-black text-zippy-dark tracking-tighter">${totalEarnings.toFixed(2)}</h3> <div className="mt-6 flex gap-3"> <button onClick={refreshDriverData} className="flex-1 py-3 bg-gray-100 text-gray-600 font-black text-xs rounded-xl shadow-none uppercase flex items-center justify-center gap-2 hover:bg-gray-200"> <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar </button> <button className="flex-1 py-3 bg-green-500 text-white font-black text-xs rounded-xl shadow-lg uppercase">Retirar</button> </div> </div> </div> </div> );

  if (!isAuthenticated) return ( <div className="w-full h-full bg-zippy-dark flex flex-col items-center justify-center p-6 animate-fade-in"> <img src="https://tritex.com.mx/zippylogo.png" className="h-12 mb-8 filter invert" /> <div className="bg-white p-6 rounded-[32px] w-full max-w-sm shadow-2xl relative overflow-hidden"> <h2 className="text-lg font-black text-center text-zippy-dark mb-4 uppercase tracking-widest">{authMode === 'login' ? 'Conductor' : 'Registro'}</h2> <form onSubmit={handleAuth} className="space-y-3"> {authMode === 'register' && (<input required placeholder="Nombre Completo" className="w-full p-3 bg-gray-50 border rounded-xl font-bold text-sm" value={fullName} onChange={e=>setFullName(e.target.value)} />)} <input required type="email" placeholder="Correo Electrónico" className="w-full p-3 bg-gray-50 border rounded-xl font-bold text-sm" value={email} onChange={e=>setEmail(e.target.value)} /> <div className="relative"><input required type={showPassword ? "text" : "password"} placeholder="Contraseña" className="w-full p-3 bg-gray-50 border rounded-xl font-bold text-sm" value={password} onChange={e=>setPassword(e.target.value)} /><button type="button" onClick={()=>setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div> <button className="w-full bg-blue-700 text-white font-black py-3 rounded-xl shadow-lg active:scale-95 transition-all uppercase tracking-wide text-xs">{loading ? <Loader2 className="animate-spin mx-auto w-5 h-5" /> : authMode === 'login' ? 'Ingresar' : 'Crear Cuenta'}</button> <button type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="w-full text-[10px] font-black text-blue-700 uppercase tracking-widest mt-2 underline text-center block">{authMode === 'login' ? 'Regístrate' : 'Inicia Sesión'}</button> <button type="button" onClick={onBack} className="w-full text-[9px] font-black text-gray-400 uppercase tracking-widest text-center mt-3 block">Volver</button> </form> </div> <DriverRegistration isOpen={isApplying} onClose={() => setIsApplying(false)} onRegistrationComplete={() => setIsApplying(false)} /> </div> );

  return (
    <div className="w-full h-full bg-gray-100 flex flex-col relative overflow-hidden font-sans">
        <NotificationToast message={toast.msg} type={toast.type} isVisible={toast.visible} onClose={() => setToast({ ...toast, visible: false })} />
        
        <MapVisual 
            status={isOnline ? (rideStatus === RideStatus.IDLE ? 'ADMIN_HEATMAP' : rideStatus) : 'OFFLINE'} 
            userLocation={isOnline ? currentLocation : undefined} // IMPORTANT: Pass currentLocation to userLocation prop so map centers on driver
            driverLocation={isOnline ? currentLocation : undefined} // Also pass as driverLocation for marker icon logic
            routeStart={mapRoute.start} 
            routeEnd={mapRoute.end} 
        />
        
        {gpsError && isOnline && (
            <div className="absolute top-24 left-4 right-4 z-50 bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-lg flex items-center justify-center gap-2 animate-pulse border border-red-200">
                <AlertOctagon size={16} className="text-red-500" />
                <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide">Esperando señal GPS...</p>
                <button onClick={retryGps} className="bg-red-500 text-white px-2 py-1 rounded-lg text-[9px] font-black ml-2">REINTENTAR</button>
            </div>
        )}

        {/* MODAL DE SOLICITUD TIENE PRIORIDAD */}
        {(showPassengerModal || newRequestAlert) && renderPassengerModal()}

        {tipNotification && (
            <div className="absolute top-20 inset-x-4 z-50 animate-slide-down">
                <div className="bg-zippy-main text-zippy-dark p-4 rounded-2xl shadow-2xl flex items-center gap-4 border-2 border-white">
                    <Gift size={24} className="text-zippy-dark" />
                    <div className="flex-1">
                        <h4 className="font-black uppercase text-sm">¡Propina!</h4>
                        <p className="text-xs font-bold opacity-80">{tipNotification.message}</p>
                    </div>
                    <span className="text-xl font-black bg-white px-3 py-1 rounded-lg shadow-sm">${tipNotification.amount}</span>
                </div>
            </div>
        )}
        
        {view === 'profile' && renderProfile()}{view === 'history' && renderHistory()}{view === 'wallet' && renderWallet()}
        {showSuccessOverlay && ( <div className="fixed inset-0 z-[10000] bg-green-500 flex flex-col items-center justify-center animate-fade-in"> <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mb-6 animate-bounce shadow-2xl"> <Check size={64} className="text-green-600" /> </div> <h1 className="text-5xl font-black text-white uppercase tracking-tighter text-center">¡ÉXITO!</h1> <p className="text-white/80 font-bold text-xl mt-2 tracking-widest uppercase">Viaje Aceptado</p> </div> )}
        {sosActive && ( <div className="absolute inset-0 z-[500] bg-red-600 flex flex-col items-center justify-center text-center p-6 animate-pulse"> <Siren size={80} className="text-white mb-6 animate-bounce" /> <h1 className="text-4xl font-black text-white mb-2 uppercase tracking-tighter">¡ALERTA SOS!</h1> <p className="text-white/90 font-bold text-lg mb-8 max-w-xs">Ubicación enviada a seguridad.</p> <button onClick={() => setSosActive(false)} className="text-white/60 font-bold text-xs mt-4 underline">Falsa alarma</button> </div> )}
        <div className="absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-center bg-white/90 backdrop-blur-md border-b shadow-sm"> <div className="flex items-center gap-3"><button onClick={() => setView('profile')} className="w-11 h-11 rounded-2xl overflow-hidden border-2 border-blue-700 shadow-lg active:scale-90 transition-transform"><img src={driverProfile.avatarUrl || `https://ui-avatars.com/api/?name=${driverProfile.name}`} className="w-full h-full object-cover" /></button><div className="flex flex-col"><div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div><span className="font-black text-[10px] text-zippy-dark uppercase tracking-tight">{isOnline ? 'En Turno' : 'Desconectado'}</span></div><span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Unidad {driverProfile.taxiNumber}</span></div></div> <button onClick={toggleOnline} className={`px-8 py-3 rounded-2xl font-black text-[10px] uppercase transition-all shadow-xl active:scale-95 ${isOnline ? 'bg-red-600 text-white' : 'bg-blue-700 text-white'}`}>{isOnline ? 'Finalizar' : 'Iniciar'}</button> </div>
        
        {/* LISTA DE TARIFAS - SOLO VISIBLE SI NO HAY VIAJE ACTIVO Y NO HAY ALERTA */}
        {isOnline && !activeRide && !pendingOffer && view === 'home' && !newRequestAlert && ( <div className={`absolute top-24 left-4 right-4 z-20 flex flex-col gap-4 max-h-[60vh] transition-all duration-300 ${isRequestsMinimized ? 'h-12 overflow-hidden' : 'overflow-y-auto'}`}> <div className="mt-2 space-y-4 pointer-events-auto pb-10"> <div className="flex items-center justify-between bg-blue-900/95 backdrop-blur-md px-5 py-3 rounded-full shadow-2xl border border-white/10"> <div className="flex items-center gap-2"> <h3 className="text-[9px] font-black text-white uppercase tracking-[0.2em]">Tarifas</h3> <div className="w-2 h-2 bg-zippy-accent rounded-full animate-ping"></div> </div> <button onClick={() => setIsRequestsMinimized(!isRequestsMinimized)} className="text-white hover:bg-white/20 rounded-full p-1 transition-colors"> {isRequestsMinimized ? <ChevronDown size={16}/> : <ChevronUp size={16}/>} </button> </div> {!isRequestsMinimized && ( availableRides.length === 0 ? (<div className="bg-white/80 p-10 rounded-[40px] text-center backdrop-blur-md border border-gray-100 shadow-xl"><Loader2 className="animate-spin text-blue-700 mx-auto mb-4" size={32} /><p className="text-[10px] font-black text-zippy-dark uppercase tracking-widest leading-relaxed">Buscando pasajeros...</p></div>) : (availableRides.map(ride => (<div key={ride.id} className="bg-white p-6 rounded-[40px] shadow-2xl border border-gray-50 flex flex-col gap-4 animate-slide-up hover:border-blue-700/20 transition-all"><div className="flex justify-between items-start"><div><div className="flex items-center gap-2 mb-1"><p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Oferta</p><button onClick={(e) => { e.stopPropagation(); handleDeleteRide(ride.id); }} className="flex items-center gap-1 px-2 py-1 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg transition-colors group"><Trash2 size={12} /><span className="text-[9px] font-black uppercase">X</span></button></div><h4 className="font-black text-zippy-dark text-3xl tracking-tighter">${negotiationPrices[ride.id] || ride.price}</h4></div></div><div className="space-y-2 bg-gray-50/50 p-4 rounded-3xl border border-gray-50"><div className="flex items-center gap-3"><div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div><p className="text-[9px] font-bold text-gray-500 truncate uppercase tracking-tight">{ride.pickup_label}</p></div><div className="flex items-center gap-3"><div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div><p className="text-[9px] font-black text-zippy-dark truncate uppercase tracking-tight">{ride.destination_label}</p></div></div><button onClick={() => handleOpenRequest(ride)} className="w-full bg-blue-700 text-white font-black py-5 rounded-[28px] flex items-center justify-center gap-3 shadow-2xl shadow-blue-700/30 hover:scale-[1.02] active:scale-95 transition-all uppercase text-xs tracking-widest"><Eye size={20} /> Ver Detalle</button></div>))) )} </div> </div> )}
        
        {/* RIDE PANEL - COMPLETELY CONDITIONAL ON activeRide */}
        <div className={`absolute inset-x-0 bottom-0 z-30 pointer-events-none p-0 flex flex-col transition-transform duration-300 ease-in-out ${isPanelMinimized ? 'translate-y-[85%]' : 'translate-y-0'}`}> {(isOnline && (activeRide || view === 'home')) && ( <div className="pointer-events-auto flex justify-end px-4 pb-2"> <button onClick={() => setIsPanelMinimized(!isPanelMinimized)} className="bg-white text-zippy-dark p-2 rounded-full shadow-lg border border-gray-100 hover:bg-gray-50 active:scale-90 transition-transform"> {isPanelMinimized ? <ChevronUp size={24} /> : <ChevronDown size={24} />} </button> </div> )} 
        {isOnline && activeRide ? ( <div className="pointer-events-auto bg-white rounded-[40px] p-8 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)] border-4 border-blue-700 animate-slide-up"> <div className="flex justify-between items-center mb-6"> <div className="max-w-[70%]"> <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">En Curso</p> <h3 className="text-xl font-black text-zippy-dark leading-tight tracking-tight">{activeRide.destination_label}</h3> </div> <div className="text-right"> {activeRide.is_paid ? <div className="bg-green-100 text-green-700 px-3 py-1 rounded-lg border border-green-200"><p className="text-[8px] font-black uppercase tracking-widest">PAGO OK</p></div> : <p className="text-4xl font-black text-zippy-dark tracking-tighter">${activeRide.price}</p>} </div> </div> <div className="grid grid-cols-4 gap-2 mb-6"> <button onClick={handleCallPassenger} className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"><Phone size={20} className="text-zippy-dark mb-1" /><span className="text-[8px] font-black uppercase text-gray-500">Llamar</span></button> <button onClick={() => setChatOpen(true)} className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"><MessageSquare size={20} className="text-zippy-dark mb-1" /><span className="text-[8px] font-black uppercase text-gray-500">Chat</span></button> <button onClick={handleShareTrip} className="flex flex-col items-center justify-center p-3 bg-gray-100 rounded-2xl active:scale-95 transition-transform hover:bg-zippy-main/20"><Share2 size={20} className="text-zippy-dark mb-1" /><span className="text-[8px] font-black uppercase text-gray-500">Share</span></button> <button onClick={handleTriggerSOS} className="flex flex-col items-center justify-center p-3 bg-red-600 text-white rounded-2xl shadow-lg shadow-red-600/30 active:scale-90 transition-transform"><Siren size={20} className="mb-1 animate-pulse" /><span className="text-[8px] font-black uppercase">SOS</span></button> </div> <div className="grid grid-cols-1 gap-3"> {rideStatus === RideStatus.ACCEPTED && (<button onClick={() => handleUpdateRideStatus(RideStatus.ARRIVED)} className="w-full bg-blue-700 text-white font-black py-5 rounded-[28px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all text-xs tracking-widest uppercase"><MapPin size={20} /> Ya llegué</button>)} {rideStatus === RideStatus.ARRIVED && (<button disabled className="w-full bg-gray-200 text-gray-500 font-black py-5 rounded-[28px] shadow-none flex items-center justify-center gap-3 text-xs tracking-widest uppercase cursor-not-allowed border-2 border-gray-300 border-dashed"><Loader2 size={20} className="animate-spin" /> Esperando...</button>)} {rideStatus === RideStatus.PASSENGER_READY && (<button onClick={() => handleUpdateRideStatus(RideStatus.IN_PROGRESS)} className="w-full bg-green-500 text-white font-black py-5 rounded-[28px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all text-xs tracking-widest uppercase ring-4 ring-green-500/30 animate-pulse"><TrendingUp size={20} /> INICIAR VIAJE</button>)} {rideStatus === RideStatus.IN_PROGRESS && (<button onClick={() => handleUpdateRideStatus(RideStatus.COMPLETED)} className="w-full bg-green-600 text-white font-black py-5 rounded-[28px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all text-xs tracking-widest uppercase"><DollarSign size={20} /> {activeRide.is_paid ? 'FINALIZAR' : 'COBRAR'}</button>)} {rideStatus === RideStatus.COMPLETED && (<button onClick={handleResetToIdle} className="w-full bg-gray-800 text-white font-black py-5 rounded-[28px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all text-xs tracking-widest uppercase"><CheckCircle2 size={20} /> Cerrar</button>)} </div> </div> ) : ( <div className="pointer-events-auto bg-blue-950/95 backdrop-blur-2xl rounded-[36px] p-2.5 flex items-center justify-between shadow-2xl border border-white/10 mx-2 mb-2"> <button onClick={() => setView('home')} className={`flex-1 flex flex-col items-center py-3.5 rounded-2xl transition-all ${view === 'home' ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}><Map size={22} className={view === 'home' ? 'fill-white/10' : ''} /><span className="text-[8px] font-black uppercase mt-1.5 tracking-widest">En Turno</span></button> <button onClick={() => setView('history')} className={`flex-1 flex flex-col items-center py-3.5 rounded-2xl transition-all ${view === 'history' ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}><History size={22} className={view === 'history' ? 'fill-white/10' : ''} /><span className="text-[8px] font-black uppercase mt-1.5 tracking-widest">Viajes</span></button> <button onClick={() => setView('wallet')} className={`flex-1 flex flex-col items-center py-3.5 rounded-2xl transition-all ${view === 'wallet' ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}><Wallet size={22} className={view === 'wallet' ? 'fill-white/10' : ''} /><span className="text-[8px] font-black uppercase mt-1.5 tracking-widest">Pagos</span></button> <button onClick={() => setView('profile')} className={`flex-1 flex flex-col items-center py-3.5 rounded-2xl transition-all ${view === 'profile' ? 'bg-blue-600 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}><User size={22} className={view === 'profile' ? 'fill-white/10' : ''} /><span className="text-[8px] font-black uppercase mt-1.5 tracking-widest">Perfil</span></button> </div> )} </div>

        <ChatModal isOpen={chatOpen} onClose={() => setChatOpen(false)} onEndChat={() => { setChatOpen(false); showToast("Chat finalizado", "info"); }} rideId={activeRide?.id || ''} currentUserRole="DRIVER" currentUserId={driverProfile.id} counterpartName={requestPassenger?.name || 'Pasajero'} counterpartPhone={requestPassenger?.phone} />
        <EmergencyDirectory isOpen={emergencyOpen} onClose={()=>setEmergencyOpen(false)} />
    </div>
  );
};

export default DriverApp;
