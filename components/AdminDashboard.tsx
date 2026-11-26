import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Users, Car, Map, History, DollarSign,
  MapPin, TrendingUp, Settings, LogOut, CheckCircle,
  AlertTriangle, Menu, X, Activity, Star, BellRing, Send, Loader2, Info, Search, Filter, ClipboardList,
  Image as ImageIcon, Eye, FileText, Camera, ShieldCheck, Mail, Smartphone, FileUp, Navigation, Trash2,
  Trophy, Ban, RotateCcw, Siren, LifeBuoy, Plus, Globe
} from 'lucide-react';
import { generateAdminReport } from '../services/geminiService';
import MapVisual from './MapVisual';
import { supabase } from '../services/supabase';
import {
  MapEntity,
  DriverApplication,
  UserProfile,
  Ride,
  TariffConfig,
  GeofenceZone,
  SupportTicket,
} from '../types';
import {
  DEFAULT_TARIFF_CONFIG,
  deleteGeofence,
  fetchGeofences,
  fetchSupportTickets,
  fetchTariffConfig,
  saveGeofence,
  saveTariffConfig,
  updateProfileResilient,
  updateRideResilient,
  updateSupportTicketStatus,
} from '../services/rideService';

interface AdminDashboardProps {
  onBack: () => void;
}

type AdminView =
  | 'dashboard'
  | 'users'
  | 'drivers'
  | 'live_map'
  | 'push'
  | 'settings'
  | 'geofences'
  | 'support'
  | 'rides';

interface LeaderboardItem {
  driver_id: string;
  email: string;
  full_name: string;
  rating: number;
  total_earnings: number;
}

interface FinanceSummary {
  grossRevenue: number;
  platformCommission: number;
  totalTips: number;
  driverPayouts: number;
  completedTrips: number;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<AdminView>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [liveEntities, setLiveEntities] = useState<MapEntity[]>([]);
  const [liveCounts, setLiveCounts] = useState({ free: 0, busy: 0, sos: 0 });
  const [stats, setStats] = useState({ drivers: 0, activeRides: 0, pendingApps: 0 });
  const [finance, setFinance] = useState<FinanceSummary>({
    grossRevenue: 0,
    platformCommission: 0,
    totalTips: 0,
    driverPayouts: 0,
    completedTrips: 0,
  });
  const [driverApps, setDriverApps] = useState<DriverApplication[]>([]);
  const [loading, setLoading] = useState(false);

  // State for user management
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // State for rides
  const [adminRides, setAdminRides] = useState<Ride[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [reviewingApp, setReviewingApp] = useState<DriverApplication | null>(null);

  // Tariffs, Geofences & Support Tickets
  const [tariffConfig, setTariffConfig] = useState<TariffConfig>(DEFAULT_TARIFF_CONFIG);
  const [geofences, setGeofences] = useState<GeofenceZone[]>([]);
  const [newZone, setNewZone] = useState({
    name: '',
    center_lat: '19.4326',
    center_lng: '-99.1332',
    radius_km: '5',
    surcharge_percent: '15',
  });
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);

  // Push Notification State
  const [pushTitle, setPushTitle] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const [pushTarget, setPushTarget] = useState<'all' | 'drivers' | 'passengers'>('all');
  const [pushLoading, setPushLoading] = useState(false);

  // Real-time SOS Emergency Monitor
  const [sosRides, setSosRides] = useState<Ride[]>([]);

  // REAL-TIME SOS MONITOR
  useEffect(() => {
    const checkSos = async () => {
      const { data } = await supabase
        .from('rides')
        .select('*')
        .eq('sos_active', true)
        .order('sos_at', { ascending: false });
      setSosRides((data as Ride[]) || []);
    };

    checkSos();
    const interval = setInterval(checkSos, 5000);
    const channel = supabase
      .channel('admin_sos_rides')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => {
        checkSos();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleResolveSos = async (rideId: string) => {
    await updateRideResilient(rideId, { sos_active: false });
    setSosRides((prev) => prev.filter((r) => r.id !== rideId));
  };

  // LIVE MAP ("VISTA DE DIOS": Online free drivers + Active rides + SOS)
  useEffect(() => {
    if (activeTab !== 'live_map') return;

    const fetchEntities = async () => {
      const [onlineDriversRes, activeTripsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, car_model, car_plate, lat, lng, status')
          .eq('role', 'DRIVER')
          .eq('status', 'online')
          .not('lat', 'is', null),
        supabase
          .from('rides')
          .select('id, driver_id, driver_lat, driver_lng, status, sos_active, destination_label')
          .in('status', ['ACCEPTED', 'ARRIVED', 'PASSENGER_READY', 'IN_PROGRESS', 'PAYMENT_PENDING'])
          .not('driver_lat', 'is', null),
      ]);

      const busyDriverIds = new Set<string>();
      const entities: MapEntity[] = [];
      let sosCount = 0;
      let busyCount = 0;
      let freeCount = 0;

      if (activeTripsRes.data) {
        activeTripsRes.data.forEach((trip: any) => {
          if (trip.driver_id) busyDriverIds.add(trip.driver_id);
          if (!trip.driver_lat || !trip.driver_lng) return;
          if (trip.sos_active) sosCount++;
          else busyCount++;
          entities.push({
            id: `trip-${trip.id}`,
            type: 'driver',
            lat: trip.driver_lat,
            lng: trip.driver_lng,
            label: trip.sos_active
              ? `🚨 SOS ACTIVO • Destino: ${trip.destination_label || '---'}`
              : `En Viaje (${trip.status}) • ${trip.destination_label || ''}`,
            status: trip.sos_active ? 'SOS' : trip.status,
          });
        });
      }

      if (onlineDriversRes.data) {
        onlineDriversRes.data.forEach((drv: any) => {
          if (busyDriverIds.has(drv.id) || !drv.lat || !drv.lng) return;
          freeCount++;
          entities.push({
            id: `drv-${drv.id}`,
            type: 'driver',
            lat: drv.lat,
            lng: drv.lng,
            label: `Disponible: ${drv.full_name || 'Conductor'} (${drv.car_plate || 'S/P'})`,
            status: 'online',
          });
        });
      }

      setLiveEntities(entities);
      setLiveCounts({ free: freeCount, busy: busyCount, sos: sosCount });
    };

    fetchEntities();
    const interval = setInterval(fetchEntities, 5000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // INITIAL DATA PER TAB + REAL FINANCIAL COMPUTATION
  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      const currentTariff = await fetchTariffConfig();
      setTariffConfig(currentTariff);

      if (activeTab === 'dashboard') {
        const [{ count: dCount }, { count: rCount }, { count: pCount }, { data: completedRides }] =
          await Promise.all([
            supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'DRIVER'),
            supabase
              .from('rides')
              .select('*', { count: 'exact', head: true })
              .in('status', ['ACCEPTED', 'ARRIVED', 'PASSENGER_READY', 'IN_PROGRESS', 'PAYMENT_PENDING']),
            supabase
              .from('driver_applications')
              .select('*', { count: 'exact', head: true })
              .eq('status', 'pending'),
            supabase.from('rides').select('price, tip_amount, total_paid, status').in('status', ['COMPLETED', 'ARCHIVED']),
          ]);

        setStats({ drivers: dCount || 0, activeRides: rCount || 0, pendingApps: pCount || 0 });

        if (completedRides) {
          const grossRevenue = completedRides.reduce((sum: number, r: any) => sum + (r.price || 0), 0);
          const totalTips = completedRides.reduce((sum: number, r: any) => sum + (r.tip_amount || 0), 0);
          const commissionRate = (currentTariff.commissionRate || 15) / 100;
          const platformCommission = Number((grossRevenue * commissionRate).toFixed(2));
          const driverPayouts = Number((grossRevenue - platformCommission + totalTips).toFixed(2));
          setFinance({
            grossRevenue,
            platformCommission,
            totalTips,
            driverPayouts,
            completedTrips: completedRides.length,
          });
        }

        const { data: lbData } = await supabase
          .from('admin_leaderboard')
          .select('*')
          .order('total_earnings', { ascending: false })
          .limit(5);
        if (lbData) setLeaderboard(lbData as LeaderboardItem[]);

        if (!aiReport) generateAdminReport().then(setAiReport);
      } else if (activeTab === 'drivers') {
        const { data } = await supabase
          .from('driver_applications')
          .select('*')
          .order('created_at', { ascending: false });
        if (data) setDriverApps(data as DriverApplication[]);
      } else if (activeTab === 'users') {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });
        if (data) setAllUsers(data as UserProfile[]);
      } else if (activeTab === 'rides') {
        const { data } = await supabase
          .from('rides')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (data) setAdminRides(data as Ride[]);
      } else if (activeTab === 'geofences') {
        const zones = await fetchGeofences();
        setGeofences(zones);
      } else if (activeTab === 'support') {
        const tickets = await fetchSupportTickets();
        setSupportTickets(tickets);
      }
      setLoading(false);
    };
    fetchInitialData();
  }, [activeTab]);

  // Realtime rides subscription
  useEffect(() => {
    if (activeTab !== 'rides') return;
    const channel = supabase
      .channel('admin_rides_sub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setAdminRides((prev) => [payload.new as Ride, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setAdminRides((prev) => prev.map((r) => (r.id === payload.new.id ? (payload.new as Ride) : r)));
        } else if (payload.eventType === 'DELETE') {
          setAdminRides((prev) => prev.filter((r) => r.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab]);

  const handleDeleteRide = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este viaje permanentemente?')) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('delete_ride_by_admin', { ride_uuid: id });
      if (error) {
        const { error: delError } = await supabase.from('rides').delete().eq('id', id);
        if (delError) throw delError;
      }
      setAdminRides((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      alert('Error al eliminar: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveDriver = async (app: DriverApplication) => {
    if (!app) return;
    setLoading(true);
    try {
      await supabase.from('driver_applications').update({ status: 'approved' }).eq('id', app.id);
      await updateProfileResilient(
        app.user_id,
        {
          role: 'DRIVER',
          verification_status: 'verified',
          car_model: app.car_model,
          car_plate: app.car_plate,
          avatar_url: app.selfie_url,
        },
        { car_color: app.car_color, is_suspended: false }
      );
      setDriverApps((prev) => prev.filter((a) => a.id !== app.id));
      setReviewingApp(null);
      alert('Conductor aprobado y habilitado en la flota Zippy.');
    } catch (e: any) {
      alert('Error en aprobación: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRejectDriver = async (app: DriverApplication) => {
    if (!app) return;
    const reason = prompt('Motivo del rechazo (opcional):');
    setLoading(true);
    try {
      await supabase.from('driver_applications').update({ status: 'rejected' }).eq('id', app.id);
      if (app.user_id) {
        await supabase.from('profiles').update({ verification_status: 'rejected' }).eq('id', app.user_id);
      }
      setDriverApps((prev) => prev.filter((a) => a.id !== app.id));
      setReviewingApp(null);
      alert(`Solicitud rechazada. Motivo: ${reason || 'No especificado'}`);
    } catch (e: any) {
      alert('Error al rechazar: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- SUSPEND / REACTIVATE USER OR DRIVER ---
  const handleToggleSuspendUser = async (user: UserProfile) => {
    const nextSuspended = !user.is_suspended;
    setLoading(true);
    try {
      await updateProfileResilient(
        user.id,
        {
          verification_status: nextSuspended ? 'suspended' : 'verified',
          ...(nextSuspended ? { status: 'offline' } : {}),
        },
        { is_suspended: nextSuspended }
      );
      setAllUsers((prev) =>
        prev.map((u) =>
          u.id === user.id
            ? {
                ...u,
                is_suspended: nextSuspended,
                verification_status: nextSuspended ? 'suspended' : 'verified',
              }
            : u
        )
      );
    } catch (e: any) {
      alert('Error actualizando usuario: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // --- SAVE TARIFF CONFIG ---
  const handleSaveTariffs = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await saveTariffConfig(tariffConfig);
    setLoading(false);
    alert('Tarifas y comisiones actualizadas correctamente.');
  };

  // --- CREATE / DELETE GEOFENCE ---
  const handleCreateGeofence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZone.name.trim()) return;
    setLoading(true);
    const created = await saveGeofence({
      name: newZone.name.trim(),
      center_lat: Number(newZone.center_lat) || 19.4326,
      center_lng: Number(newZone.center_lng) || -99.1332,
      radius_km: Number(newZone.radius_km) || 3,
      surcharge_percent: Number(newZone.surcharge_percent) || 0,
      active: true,
    });
    setGeofences((prev) => [created, ...prev]);
    setNewZone({ ...newZone, name: '' });
    setLoading(false);
  };

  const handleDeleteGeofence = async (id: string) => {
    await deleteGeofence(id);
    setGeofences((prev) => prev.filter((z) => z.id !== id));
  };

  // --- SUPPORT TICKET ACTIONS ---
  const handleTicketAction = async (ticket: SupportTicket, status: SupportTicket['status']) => {
    let refundAmount: number | undefined;
    if (status === 'refunded') {
      const val = prompt('Monto del reembolso (MXN):', '50');
      if (val === null) return;
      refundAmount = Number(val) || 0;
    }
    await updateSupportTicketStatus(ticket.id, status, refundAmount);
    setSupportTickets((prev) =>
      prev.map((t) =>
        t.id === ticket.id
          ? { ...t, status, ...(refundAmount !== undefined ? { refund_amount: refundAmount } : {}) }
          : t
      )
    );
  };

  const filteredUsers = useMemo(() => {
    if (!searchTerm) return allUsers;
    return allUsers.filter(
      (user) =>
        user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allUsers, searchTerm]);

  const handleSendPush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pushTitle.trim() || !pushMessage.trim()) return alert('Completa el Título y Mensaje.');
    setPushLoading(true);
    try {
      let dbTarget = 'ALL';
      if (pushTarget === 'drivers') dbTarget = 'DRIVERS';
      if (pushTarget === 'passengers') dbTarget = 'PASSENGERS';
      const { error } = await supabase
        .from('notifications')
        .insert({ title: pushTitle, message: pushMessage, target: dbTarget });
      if (error) throw error;
      alert(`¡Notificación enviada con éxito a: ${dbTarget === 'ALL' ? 'TODOS' : dbTarget}!`);
      setPushTitle('');
      setPushMessage('');
    } catch (err: any) {
      alert('Error: ' + (err.message || 'Error de conexión.'));
    } finally {
      setPushLoading(false);
    }
  };

  const SidebarItem = ({ id, icon: Icon, label, badge }: any) => (
    <button
      onClick={() => {
        setActiveTab(id);
        if (window.innerWidth < 768) setSidebarOpen(false);
      }}
      className={`w-full flex items-center gap-3 p-3.5 rounded-2xl transition-all mb-1.5 ${
        activeTab === id
          ? 'bg-zippy-dark text-white font-black shadow-xl scale-[1.02]'
          : 'text-zippy-dark/70 hover:bg-white/60 font-bold'
      }`}
    >
      <Icon size={18} /> <span className="flex-1 text-left text-sm">{label}</span>
      {badge > 0 && (
        <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full animate-bounce font-black">
          {badge}
        </span>
      )}
    </button>
  );

  const hasSosAlert = sosRides.length > 0;

  return (
    <div
      className={`w-full h-full bg-gray-50 flex relative overflow-hidden font-sans transition-all duration-300 ${
        hasSosAlert ? 'ring-8 ring-red-600 ring-inset' : ''
      }`}
    >
      {hasSosAlert && (
        <div className="absolute inset-0 border-4 border-red-600 pointer-events-none z-[100] animate-pulse"></div>
      )}

      <div
        className={`fixed md:relative inset-y-0 left-0 z-50 w-72 bg-zippy-main flex flex-col transition-transform duration-500 border-r border-zippy-dark/5 shadow-2xl ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-6 flex justify-between items-center">
          <img src="https://tritex.com.mx/zippylogo.png" alt="Zippy Admin" className="h-9 object-contain" />
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-zippy-dark">
            <X />
          </button>
        </div>
        <nav className="flex-1 px-4 overflow-y-auto">
          <p className="text-[10px] font-black text-zippy-dark/40 uppercase tracking-[0.2em] mb-3 px-4">
            Centro de Control
          </p>
          <SidebarItem id="dashboard" icon={LayoutDashboard} label="Resumen y Finanzas" />
          <SidebarItem id="live_map" icon={Map} label="Vista de Dios" badge={sosRides.length} />
          <SidebarItem id="rides" icon={Navigation} label="Viajes" />
          <SidebarItem id="drivers" icon={ClipboardList} label="Auditoría Socios" badge={stats.pendingApps} />
          <SidebarItem id="users" icon={Users} label="Usuarios y Flota" />
          <SidebarItem id="settings" icon={Settings} label="Tarifas y Comisión" />
          <SidebarItem id="geofences" icon={Globe} label="Geocercas" />
          <SidebarItem
            id="support"
            icon={LifeBuoy}
            label="Soporte y Disputas"
            badge={supportTickets.filter((t) => t.status === 'open').length}
          />
          <SidebarItem id="push" icon={BellRing} label="Push Masivo" />
        </nav>
        <div className="p-5">
          <button
            onClick={onBack}
            className="w-full flex items-center justify-center gap-3 p-3.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-3xl font-black transition-colors text-xs uppercase"
          >
            <LogOut size={18} /> SALIR
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white p-5 shadow-sm flex justify-between items-center z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2 text-zippy-dark">
              <Menu />
            </button>
            <h1 className="text-xl font-black text-zippy-dark uppercase tracking-tight">
              {activeTab.replace('_', ' ')}
            </h1>
            {hasSosAlert && (
              <button
                onClick={() => setActiveTab('live_map')}
                className="bg-red-600 text-white px-3 py-1.5 rounded-full text-xs font-black animate-bounce flex items-center gap-1.5"
              >
                <Siren size={14} /> ¡{sosRides.length} ALERTA SOS ACTIVA!
              </button>
            )}
          </div>
          <div className="w-10 h-10 bg-zippy-dark rounded-2xl flex items-center justify-center text-white font-black">
            AD
          </div>
        </header>

        {/* ACTIVE SOS BAR */}
        {hasSosAlert && (
          <div className="bg-red-600 text-white px-6 py-3 flex flex-wrap items-center justify-between gap-3 z-20">
            <div className="flex items-center gap-3">
              <Siren size={20} className="animate-pulse" />
              <span className="text-xs font-black uppercase">
                Emergencia en viaje hacia {sosRides[0].destination_label} (
                {sosRides[0].sos_lat?.toFixed(4)}, {sosRides[0].sos_lng?.toFixed(4)})
              </span>
            </div>
            <button
              onClick={() => handleResolveSos(sosRides[0].id)}
              className="px-3 py-1 bg-white text-red-600 rounded-lg font-black text-[10px] uppercase"
            >
              Marcar Atendido
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto relative p-6 md:p-8">
          {loading && (
            <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-50">
              <Loader2 className="animate-spin text-zippy-dark" size={48} />
            </div>
          )}

          {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                <StatCard title="Conductores Flota" value={stats.drivers} icon={Car} />
                <StatCard title="Viajes en Curso" value={stats.activeRides} icon={Activity} />
                <StatCard
                  title="Apps Pendientes"
                  value={stats.pendingApps}
                  icon={FileUp}
                  isAlert={stats.pendingApps > 0}
                />
                <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex flex-col justify-center">
                  <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">
                    Comisión Plataforma ({tariffConfig.commissionRate}%)
                  </p>
                  <h3 className="text-3xl font-black text-green-600">
                    ${finance.platformCommission.toFixed(2)}
                  </h3>
                </div>
              </div>

              {/* REAL FINANCIAL REPORT */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-3xl border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase">Ingresos Brutos</p>
                  <p className="text-2xl font-black text-zippy-dark">${finance.grossRevenue.toFixed(2)}</p>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase">Propinas Pagadas</p>
                  <p className="text-2xl font-black text-yellow-600">${finance.totalTips.toFixed(2)}</p>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase">Liquidación Conductores</p>
                  <p className="text-2xl font-black text-blue-600">${finance.driverPayouts.toFixed(2)}</p>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase">Viajes Liquidados</p>
                  <p className="text-2xl font-black text-zippy-dark">{finance.completedTrips}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-yellow-100 text-yellow-600 rounded-lg">
                      <Trophy size={20} />
                    </div>
                    <h3 className="font-black text-zippy-dark uppercase tracking-widest">
                      Ranking Top Conductores
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                          <th className="pb-2">Email / ID</th>
                          <th className="pb-2">Rating</th>
                          <th className="pb-2 text-right">Ganancias Totales</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm font-medium text-gray-600">
                        {leaderboard.length > 0 ? (
                          leaderboard.map((d) => (
                            <tr
                              key={d.driver_id}
                              className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors"
                            >
                              <td className="py-3 font-bold text-zippy-dark text-xs">{d.email}</td>
                              <td className="py-3 flex items-center gap-1">
                                <Star size={12} className="text-yellow-500 fill-yellow-500" />{' '}
                                {d.rating ? d.rating.toFixed(1) : '5.0'}
                              </td>
                              <td className="py-3 text-right font-black text-green-600">
                                ${d.total_earnings ? d.total_earnings.toFixed(2) : '0.00'} MXN
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="py-4 text-center text-xs text-gray-400">
                              Sin datos de rendimiento aún.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 flex gap-6 items-start">
                  <div className="p-4 bg-zippy-main/20 rounded-2xl text-zippy-dark">
                    <Info size={24} />
                  </div>
                  <div>
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      Reporte Ejecutivo IA
                    </p>
                    <p className="text-sm font-bold text-zippy-dark mt-2 leading-relaxed">
                      {aiReport || 'Analizando datos de la flota...'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'live_map' && (
            <div className="absolute inset-0 z-0 bg-gray-200">
              <MapVisual status="live_map" entities={liveEntities} />
              <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-lg border border-zippy-dark/10 space-y-2">
                <h3 className="font-black text-zippy-dark text-xs uppercase tracking-widest">
                  Vista de Dios (En Vivo)
                </h3>
                <div className="flex gap-3 text-[11px] font-bold">
                  <span className="flex items-center gap-1 text-green-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block"></span> Libres:{' '}
                    {liveCounts.free}
                  </span>
                  <span className="flex items-center gap-1 text-yellow-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block"></span> En viaje:{' '}
                    {liveCounts.busy}
                  </span>
                  <span className="flex items-center gap-1 text-red-600">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block"></span> SOS:{' '}
                    {liveCounts.sos}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'drivers' && (
            <DriverApplicationsTable applications={driverApps} onReview={setReviewingApp} />
          )}
          {reviewingApp && (
            <DriverReviewModal
              app={reviewingApp}
              onClose={() => setReviewingApp(null)}
              onApprove={handleApproveDriver}
              onReject={handleRejectDriver}
              loading={loading}
            />
          )}

          {activeTab === 'users' && (
            <div className="animate-fade-in">
              <div className="relative mb-6">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                <input
                  type="text"
                  placeholder="Buscar por nombre o correo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white p-5 pl-16 rounded-2xl shadow-sm border border-gray-100 font-bold outline-none focus:ring-2 focus:ring-zippy-main"
                />
              </div>
              <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
                <UsersTable users={filteredUsers} onToggleSuspend={handleToggleSuspendUser} />
              </div>
            </div>
          )}

          {activeTab === 'rides' && (
            <div className="animate-fade-in">
              <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
                <RidesTable rides={adminRides} onDelete={handleDeleteRide} />
              </div>
            </div>
          )}

          {/* DYNAMIC TARIFFS & COMMISSION SETTINGS */}
          {activeTab === 'settings' && (
            <form
              onSubmit={handleSaveTariffs}
              className="max-w-3xl mx-auto bg-white p-8 rounded-[36px] shadow-sm border border-gray-100 space-y-6 animate-fade-in"
            >
              <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
                <div className="p-3 bg-zippy-main rounded-2xl text-zippy-dark">
                  <DollarSign size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-zippy-dark uppercase">
                    Tarifas Base, Dinámicas y Comisión
                  </h3>
                  <p className="text-xs font-bold text-gray-400">
                    Estos parámetros calculan en tiempo real las cotizaciones del pasajero.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase">Banderazo ($ MXN)</label>
                  <input
                    type="number"
                    value={tariffConfig.baseFare}
                    onChange={(e) =>
                      setTariffConfig({ ...tariffConfig, baseFare: Number(e.target.value) })
                    }
                    className="w-full mt-1 p-3.5 bg-gray-50 border rounded-xl font-black text-zippy-dark"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase">Costo por km ($)</label>
                  <input
                    type="number"
                    value={tariffConfig.costPerKm}
                    onChange={(e) =>
                      setTariffConfig({ ...tariffConfig, costPerKm: Number(e.target.value) })
                    }
                    className="w-full mt-1 p-3.5 bg-gray-50 border rounded-xl font-black text-zippy-dark"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase">Costo por min ($)</label>
                  <input
                    type="number"
                    value={tariffConfig.costPerMin}
                    onChange={(e) =>
                      setTariffConfig({ ...tariffConfig, costPerMin: Number(e.target.value) })
                    }
                    className="w-full mt-1 p-3.5 bg-gray-50 border rounded-xl font-black text-zippy-dark"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase">Tarifa Mínima ($)</label>
                  <input
                    type="number"
                    value={tariffConfig.minFare}
                    onChange={(e) =>
                      setTariffConfig({ ...tariffConfig, minFare: Number(e.target.value) })
                    }
                    className="w-full mt-1 p-3.5 bg-gray-50 border rounded-xl font-black text-zippy-dark"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase">Comisión Plataforma (%)</label>
                  <input
                    type="number"
                    value={tariffConfig.commissionRate}
                    onChange={(e) =>
                      setTariffConfig({ ...tariffConfig, commissionRate: Number(e.target.value) })
                    }
                    className="w-full mt-1 p-3.5 bg-gray-50 border rounded-xl font-black text-zippy-dark"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase">
                    Tarifa Dinámica (ej. 1.2x)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    value={tariffConfig.surgeMultiplier}
                    onChange={(e) =>
                      setTariffConfig({ ...tariffConfig, surgeMultiplier: Number(e.target.value) })
                    }
                    className="w-full mt-1 p-3.5 bg-gray-50 border rounded-xl font-black text-zippy-dark"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-4 bg-zippy-dark text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-zippy-light"
              >
                Guardar Configuración de Tarifas
              </button>
            </form>
          )}

          {/* GEOFENCES MANAGEMENT */}
          {activeTab === 'geofences' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
              <form
                onSubmit={handleCreateGeofence}
                className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
              >
                <div className="md:col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase">Nombre Zona</label>
                  <input
                    required
                    placeholder="Ej: Aeropuerto / Centro"
                    value={newZone.name}
                    onChange={(e) => setNewZone({ ...newZone, name: e.target.value })}
                    className="w-full mt-1 p-3 bg-gray-50 border rounded-xl font-bold text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase">Latitud</label>
                  <input
                    value={newZone.center_lat}
                    onChange={(e) => setNewZone({ ...newZone, center_lat: e.target.value })}
                    className="w-full mt-1 p-3 bg-gray-50 border rounded-xl font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase">Longitud</label>
                  <input
                    value={newZone.center_lng}
                    onChange={(e) => setNewZone({ ...newZone, center_lng: e.target.value })}
                    className="w-full mt-1 p-3 bg-gray-50 border rounded-xl font-mono text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase">Radio km</label>
                    <input
                      type="number"
                      value={newZone.radius_km}
                      onChange={(e) => setNewZone({ ...newZone, radius_km: e.target.value })}
                      className="w-full mt-1 p-3 bg-gray-50 border rounded-xl font-bold text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase">+% Extra</label>
                    <input
                      type="number"
                      value={newZone.surcharge_percent}
                      onChange={(e) => setNewZone({ ...newZone, surcharge_percent: e.target.value })}
                      className="w-full mt-1 p-3 bg-gray-50 border rounded-xl font-bold text-xs"
                    />
                  </div>
                </div>
                <button className="md:col-span-5 py-3.5 bg-zippy-dark text-white rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2">
                  <Plus size={16} /> Crear Geocerca
                </button>
              </form>

              <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 divide-y divide-gray-100">
                {geofences.length > 0 ? (
                  geofences.map((z) => (
                    <div key={z.id} className="p-5 flex justify-between items-center">
                      <div>
                        <p className="font-black text-zippy-dark">{z.name}</p>
                        <p className="text-xs text-gray-400 font-mono">
                          Centro: {z.center_lat}, {z.center_lng} • Radio: {z.radius_km} km • Recargo: +
                          {z.surcharge_percent}%
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteGeofence(z.id)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-xl"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="p-10 text-center text-gray-400 font-bold text-sm">
                    No hay geocercas configuradas aún.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* SUPPORT, DISPUTES, LOST ITEMS & REFUNDS */}
          {activeTab === 'support' && (
            <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-zippy-dark uppercase text-[10px] font-black tracking-widest">
                  <tr>
                    <th className="p-5">Usuario / Categoría</th>
                    <th className="p-5">Detalle</th>
                    <th className="p-5 text-center">Estado</th>
                    <th className="p-5 text-right">Resolución</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-medium text-gray-600 divide-y divide-gray-100">
                  {supportTickets.length > 0 ? (
                    supportTickets.map((t) => (
                      <tr key={t.id}>
                        <td className="p-5">
                          <div className="font-bold text-zippy-dark">{t.user_name || 'Usuario'}</div>
                          <span className="text-[10px] uppercase bg-gray-100 px-2 py-0.5 rounded font-black">
                            {t.category}
                          </span>
                        </td>
                        <td className="p-5">
                          <p className="font-bold text-zippy-dark text-xs">{t.subject}</p>
                          <p className="text-xs text-gray-500">{t.description}</p>
                        </td>
                        <td className="p-5 text-center">
                          <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-zippy-main/30 text-zippy-dark">
                            {t.status}
                            {t.refund_amount ? ` ($${t.refund_amount})` : ''}
                          </span>
                        </td>
                        <td className="p-5 text-right space-x-2">
                          <button
                            onClick={() => handleTicketAction(t, 'resolved')}
                            className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-[10px] font-black uppercase"
                          >
                            Resolver
                          </button>
                          <button
                            onClick={() => handleTicketAction(t, 'refunded')}
                            className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-[10px] font-black uppercase"
                          >
                            Reembolsar
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="p-10 text-center text-gray-400 font-bold">
                        Sin reportes de soporte o disputas pendientes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'push' && (
            <div className="max-w-4xl mx-auto animate-fade-in">
              <div className="bg-white p-8 rounded-[40px] shadow-xl border border-gray-100">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 bg-zippy-main rounded-2xl text-zippy-dark">
                    <BellRing size={24} />
                  </div>
                  <h3 className="text-xl font-black text-zippy-dark uppercase tracking-tight">
                    Nuevo Envío Masivo
                  </h3>
                </div>
                <form onSubmit={handleSendPush} className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">
                        Título
                      </label>
                      <input
                        type="text"
                        value={pushTitle}
                        onChange={(e) => setPushTitle(e.target.value)}
                        placeholder="Ej: ¡Alta Demanda!"
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold outline-none focus:border-zippy-dark"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">
                        Mensaje
                      </label>
                      <textarea
                        value={pushMessage}
                        onChange={(e) => setPushMessage(e.target.value)}
                        placeholder="Escribe el contenido..."
                        rows={4}
                        className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold outline-none focus:border-zippy-dark resize-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">
                        Audiencia
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setPushTarget('all')}
                          className={`p-3 rounded-xl font-bold text-xs uppercase border transition-all ${
                            pushTarget === 'all'
                              ? 'bg-zippy-dark text-white border-zippy-dark'
                              : 'bg-gray-50 text-gray-400 border-gray-100'
                          }`}
                        >
                          Todos
                        </button>
                        <button
                          type="button"
                          onClick={() => setPushTarget('drivers')}
                          className={`p-3 rounded-xl font-bold text-xs uppercase border transition-all ${
                            pushTarget === 'drivers'
                              ? 'bg-zippy-dark text-white border-zippy-dark'
                              : 'bg-gray-50 text-gray-400 border-gray-100'
                          }`}
                        >
                          Conductores
                        </button>
                        <button
                          type="button"
                          onClick={() => setPushTarget('passengers')}
                          className={`p-3 rounded-xl font-bold text-xs uppercase border transition-all ${
                            pushTarget === 'passengers'
                              ? 'bg-zippy-dark text-white border-zippy-dark'
                              : 'bg-gray-50 text-gray-400 border-gray-100'
                          }`}
                        >
                          Pasajeros
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-6 flex flex-col justify-end">
                    <div className="bg-zippy-main/10 border-2 border-dashed border-zippy-main/20 rounded-[32px] p-6 flex flex-col items-center justify-center text-center">
                      <BellRing size={32} className="text-zippy-dark mb-3" />
                      <p className="text-zippy-dark font-bold text-sm">{pushTitle || 'Título'}</p>
                      <p className="text-zippy-dark/60 text-xs mt-1">{pushMessage || 'Mensaje...'}</p>
                    </div>
                    <button
                      type="submit"
                      disabled={pushLoading}
                      className="w-full bg-zippy-main text-zippy-dark font-black py-5 rounded-[24px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all hover:brightness-105 disabled:opacity-70"
                    >
                      {pushLoading ? <Loader2 className="animate-spin" /> : <Send size={20} />} ENVIAR
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, isAlert }: any) => (
  <div
    className={`bg-white p-6 rounded-[32px] shadow-sm border ${
      isAlert ? 'border-red-200 bg-red-50' : 'border-gray-100'
    }`}
  >
    <div className="flex items-center gap-3 mb-2">
      <div className={`p-2 rounded-lg ${isAlert ? 'bg-red-100' : 'bg-gray-100'}`}>
        <Icon size={16} className={isAlert ? 'text-red-600' : 'text-gray-500'} />
      </div>
      <p className={`text-xs font-black uppercase tracking-widest ${isAlert ? 'text-red-700' : 'text-gray-400'}`}>
        {title}
      </p>
    </div>
    <h3 className={`text-4xl font-black ${isAlert ? 'text-red-600' : 'text-zippy-dark'}`}>{value}</h3>
  </div>
);

const DriverApplicationsTable = ({
  applications,
  onReview,
}: {
  applications: DriverApplication[];
  onReview: (app: DriverApplication) => void;
}) => (
  <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
    <table className="w-full text-left">
      <thead className="bg-gray-50 text-zippy-dark uppercase text-[10px] font-black tracking-widest">
        <tr>
          <th className="p-6">Solicitante</th>
          <th className="p-6">Vehículo</th>
          <th className="p-6 text-center">Vigencia Docs</th>
          <th className="p-6 text-right">Acción</th>
        </tr>
      </thead>
      <tbody className="text-sm font-medium text-gray-600 divide-y divide-gray-100">
        {applications.length > 0 ? (
          applications.map((app) => {
            const expired =
              (app.license_expiry && new Date(app.license_expiry) < new Date()) ||
              (app.insurance_expiry && new Date(app.insurance_expiry) < new Date());
            return (
              <tr key={app.id}>
                <td className="p-6">
                  <div className="font-bold text-zippy-dark">{app.full_name}</div>
                  <div className="text-xs text-gray-400">{app.phone}</div>
                </td>
                <td className="p-6">
                  {app.car_model}{' '}
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded-md font-mono">{app.car_plate}</span>
                </td>
                <td className="p-6 text-center text-xs">
                  {expired ? (
                    <span className="bg-red-100 text-red-700 px-2 py-1 rounded font-black uppercase text-[10px]">
                      Documento Vencido
                    </span>
                  ) : (
                    <span className="text-green-600 font-bold text-xs">Vigente</span>
                  )}
                </td>
                <td className="p-6 text-right">
                  <button
                    onClick={() => onReview(app)}
                    className="px-4 py-2 bg-zippy-dark text-white font-bold text-xs rounded-xl shadow-lg hover:bg-zippy-light"
                  >
                    Revisar
                  </button>
                </td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan={4} className="p-10 text-center text-gray-400 font-bold">
              No hay solicitudes pendientes.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

const UsersTable = ({
  users,
  onToggleSuspend,
}: {
  users: UserProfile[];
  onToggleSuspend: (u: UserProfile) => void;
}) => (
  <table className="w-full text-left">
    <thead className="bg-gray-50 text-zippy-dark uppercase text-[10px] font-black tracking-widest">
      <tr>
        <th className="p-5">Usuario</th>
        <th className="p-5">Contacto</th>
        <th className="p-5 text-center">Rol</th>
        <th className="p-5 text-center">Estatus</th>
        <th className="p-5 text-right">Acción</th>
      </tr>
    </thead>
    <tbody className="text-sm font-medium text-gray-600 divide-y divide-gray-100">
      {users.length > 0 ? (
        users.map((user) => {
          const suspended = user.is_suspended || user.verification_status === 'suspended';
          return (
            <tr key={user.id}>
              <td className="p-5 flex items-center gap-3">
                <img
                  src={user.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name || 'U')}`}
                  className="w-10 h-10 rounded-full object-cover"
                />
                <span className="font-bold text-zippy-dark">{user.full_name}</span>
              </td>
              <td className="p-5">
                <div className="font-mono text-xs bg-gray-100 px-2 py-1 rounded-md inline-block">
                  {user.email}
                </div>
              </td>
              <td className="p-5 text-center">
                <span
                  className={`px-3 py-1 rounded-full text-[10px] font-black text-white ${
                    user.role === 'DRIVER' ? 'bg-blue-600' : 'bg-gray-400'
                  }`}
                >
                  {user.role}
                </span>
              </td>
              <td className="p-5 text-center">
                {suspended ? (
                  <span className="text-red-600 font-bold text-xs flex items-center justify-center gap-1">
                    <Ban size={14} /> Suspendido
                  </span>
                ) : (
                  <span className="text-green-600 font-bold text-xs flex items-center justify-center gap-1">
                    <CheckCircle size={14} /> Activo
                  </span>
                )}
              </td>
              <td className="p-5 text-right">
                <button
                  onClick={() => onToggleSuspend(user)}
                  className={`px-3 py-1.5 rounded-xl font-black text-[10px] uppercase ${
                    suspended
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                >
                  {suspended ? 'Reactivar' : 'Suspender'}
                </button>
              </td>
            </tr>
          );
        })
      ) : (
        <tr>
          <td colSpan={5} className="p-10 text-center text-gray-400 font-bold">
            No se encontraron usuarios.
          </td>
        </tr>
      )}
    </tbody>
  </table>
);

const RidesTable = ({ rides, onDelete }: { rides: Ride[]; onDelete: (id: string) => void }) => (
  <table className="w-full text-left">
    <thead className="bg-gray-50 text-zippy-dark uppercase text-[10px] font-black tracking-widest">
      <tr>
        <th className="p-6">Estado</th>
        <th className="p-6">Trayecto</th>
        <th className="p-6">Precio</th>
        <th className="p-6 text-right">Acción</th>
      </tr>
    </thead>
    <tbody className="text-sm font-medium text-gray-600 divide-y divide-gray-100">
      {rides.length > 0 ? (
        rides.map((ride) => (
          <tr key={ride.id} className="hover:bg-gray-50 transition-colors">
            <td className="p-6">
              <span
                className={`px-3 py-1 rounded-full text-[10px] font-black text-white uppercase ${
                  ride.status === 'COMPLETED' || ride.status === 'ARCHIVED'
                    ? 'bg-green-500'
                    : ride.status === 'REQUESTING'
                    ? 'bg-yellow-500 animate-pulse'
                    : ride.status === 'IN_PROGRESS'
                    ? 'bg-blue-600'
                    : ride.status === 'PAYMENT_PENDING'
                    ? 'bg-purple-600'
                    : ride.status === 'CANCELLED'
                    ? 'bg-red-500'
                    : 'bg-gray-400'
                }`}
              >
                {ride.status}
              </span>
              <div className="text-[10px] text-gray-400 mt-2 font-bold">
                {new Date(ride.created_at || '').toLocaleString()}
              </div>
            </td>
            <td className="p-6">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="font-bold text-zippy-dark">{ride.pickup_label}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="font-bold text-gray-500">{ride.destination_label}</span>
                </div>
              </div>
            </td>
            <td className="p-6">
              <span className="font-black text-zippy-dark text-lg">${ride.total_paid || ride.price}</span>
              {(ride.tip_amount || 0) > 0 && (
                <span className="block text-[10px] font-bold text-green-600">
                  +${ride.tip_amount} propina
                </span>
              )}
            </td>
            <td className="p-6 text-right">
              <button
                onClick={() => onDelete(ride.id)}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Eliminar permanentemente"
              >
                <Trash2 size={16} />
              </button>
            </td>
          </tr>
        ))
      ) : (
        <tr>
          <td colSpan={4} className="p-10 text-center text-gray-400 font-bold">
            No hay viajes registrados.
          </td>
        </tr>
      )}
    </tbody>
  </table>
);

const DriverReviewModal = ({
  app,
  onClose,
  onApprove,
  onReject,
  loading,
}: {
  app: DriverApplication;
  onClose: () => void;
  onApprove: (app: DriverApplication) => void;
  onReject: (app: DriverApplication) => void;
  loading: boolean;
}) => {
  const [activeDoc, setActiveDoc] = useState(app.selfie_url);
  const docs = [
    { key: 'selfie_url', label: 'Selfie', icon: Camera },
    { key: 'license_photo_url', label: 'Licencia', icon: ShieldCheck },
    { key: 'ine_front_url', label: 'INE Oficial', icon: FileText },
    { key: 'circulation_card_url', label: 'Tarjeta de Circulación', icon: FileText },
    { key: 'insurance_policy_url', label: 'Póliza de Seguro', icon: ShieldCheck },
    { key: 'background_check_url', label: 'Antecedentes No Penales', icon: FileText },
    { key: 'car_photo_front_url', label: 'Auto (Frente)', icon: Car },
    { key: 'car_photo_back_url', label: 'Auto (Atrás)', icon: Car },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-zippy-dark/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-6xl h-[90vh] rounded-[32px] shadow-2xl flex overflow-hidden">
        <div className="w-1/3 bg-gray-50 border-r border-gray-100 flex flex-col">
          <div className="p-6 border-b border-gray-100">
            <h3 className="font-black text-zippy-dark text-xl">{app.full_name}</h3>
            <p className="text-xs text-gray-400 font-bold">{app.email}</p>
            {(app.license_expiry || app.insurance_expiry) && (
              <div className="mt-2 text-[10px] font-bold text-gray-500 space-y-0.5">
                {app.license_expiry && <p>Vigencia Licencia: {app.license_expiry}</p>}
                {app.insurance_expiry && <p>Vigencia Seguro: {app.insurance_expiry}</p>}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {docs.map(
              (doc) =>
                (app as any)[doc.key] && (
                  <button
                    key={doc.key}
                    onClick={() => setActiveDoc((app as any)[doc.key])}
                    className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 text-left transition-all ${
                      activeDoc === (app as any)[doc.key]
                        ? 'bg-zippy-main/20 border-zippy-main'
                        : 'bg-white hover:border-gray-200'
                    }`}
                  >
                    <doc.icon size={16} className="text-zippy-dark" />{' '}
                    <span className="text-xs font-bold text-zippy-dark uppercase">{doc.label}</span>
                  </button>
                )
            )}
          </div>
          <div className="p-6 border-t border-gray-100 bg-white grid grid-cols-2 gap-3">
            <button
              disabled={loading}
              onClick={() => onReject(app)}
              className="py-4 rounded-xl bg-red-50 text-red-600 font-black text-xs uppercase hover:bg-red-100 disabled:opacity-50"
            >
              Rechazar
            </button>
            <button
              disabled={loading}
              onClick={() => onApprove(app)}
              className="py-4 rounded-xl bg-green-500 text-white font-black text-xs uppercase shadow-lg hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : 'Aprobar'}
            </button>
          </div>
        </div>
        <div className="flex-1 bg-gray-900 flex flex-col relative items-center justify-center p-10">
          <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-white/10 text-white rounded-full">
            <X />
          </button>
          {activeDoc ? (
            <img src={activeDoc} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
          ) : (
            <div className="text-white/30 text-center">
              <FileText className="w-16 h-16 mx-auto mb-4" />
              <p className="font-bold">Selecciona un documento</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
