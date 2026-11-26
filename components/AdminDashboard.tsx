
import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Users, Car, Map, History, DollarSign, 
  MapPin, TrendingUp, Settings, LogOut, CheckCircle, 
  AlertTriangle, Menu, X, Activity, Star, BellRing, Send, Loader2, Info, Search, Filter, ClipboardList,
  Image as ImageIcon, Eye, FileText, Camera, ShieldCheck, Mail, Smartphone, FileUp, Navigation, Trash2,
  Trophy
} from 'lucide-react';
import { generateAdminReport } from '../services/geminiService';
import MapVisual from './MapVisual';
import { supabase } from '../services/supabase';
import { MapEntity, DriverApplication, UserProfile, Ride } from '../types';

interface AdminDashboardProps {
  onBack: () => void;
}

type AdminView = 'dashboard' | 'users' | 'drivers' | 'live_map' | 'push' | 'media' | 'settings' | 'rides';

interface LeaderboardItem {
  driver_id: string;
  email: string;
  full_name: string;
  rating: number;
  total_earnings: number;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<AdminView>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [liveEntities, setLiveEntities] = useState<MapEntity[]>([]);
  const [stats, setStats] = useState({ drivers: 0, activeRides: 0, pendingApps: 0 });
  const [driverApps, setDriverApps] = useState<DriverApplication[]>([]);
  const [loading, setLoading] = useState(false);
  
  // State for user management
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // State for rides
  const [adminRides, setAdminRides] = useState<Ride[]>([]);
  
  // State for Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  
  const [reviewingApp, setReviewingApp] = useState<DriverApplication | null>(null);

  // Push Notification State
  const [pushTitle, setPushTitle] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const [pushTarget, setPushTarget] = useState<'all' | 'drivers' | 'passengers'>('all');
  const [pushLoading, setPushLoading] = useState(false);
  
  // NEW: Urgent Alert State
  const [urgentAlert, setUrgentAlert] = useState(false);

  // URGENT ALERT MONITOR ($99 RIDES)
  useEffect(() => {
    const checkUrgent = async () => {
        const { data } = await supabase.from('rides')
            .select('price, status')
            .eq('status', 'REQUESTING')
            .eq('price', 99); 
        if (data && data.length > 0) setUrgentAlert(true);
        else setUrgentAlert(false);
    }
    
    checkUrgent();
    const interval = setInterval(checkUrgent, 5000); // Poll every 5s
    
    const channel = supabase.channel('admin_urgent_rides')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => {
            checkUrgent();
        })
        .subscribe();
        
    return () => {
        clearInterval(interval);
        supabase.removeChannel(channel);
    }
  }, []);

  // LIVE MAP FEED (UPDATED TO USE RIDES TABLE)
  useEffect(() => {
    if (activeTab !== 'live_map') return;
    
    const fetchEntities = async () => {
        // Consultar coordenadas de viajes activos en la tabla 'rides'
        const { data: activeTrips } = await supabase
            .from('rides')
            .select('driver_id, driver_lat, driver_lng, status')
            .in('status', ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'])
            .not('driver_lat', 'is', null);

        if (activeTrips && activeTrips.length > 0) {
            setLiveEntities(activeTrips.map(trip => ({
                id: trip.driver_id || 'unknown',
                type: 'driver',
                lat: trip.driver_lat || 0,
                lng: trip.driver_lng || 0,
                label: `En Viaje (${trip.status})`,
                status: trip.status
            })));
        } else {
            setLiveEntities([]);
        }
    };

    fetchEntities(); 
    const interval = setInterval(fetchEntities, 5000); // Actualización cada 5s
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      if (activeTab === 'dashboard') {
          const { count: dCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'DRIVER');
          const { count: rCount } = await supabase.from('rides').select('*', { count: 'exact', head: true }).in('status', ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS']);
          const { count: pCount } = await supabase.from('driver_applications').select('*', { count: 'exact', head: true }).eq('status', 'pending');
          setStats({ drivers: dCount || 0, activeRides: rCount || 0, pendingApps: pCount || 0 });
          
          // Fetch Leaderboard from View
          const { data: lbData } = await supabase.from('admin_leaderboard').select('*').order('total_earnings', { ascending: false }).limit(5);
          if (lbData) setLeaderboard(lbData as LeaderboardItem[]);
          
          if (!aiReport) generateAdminReport().then(setAiReport);
      } else if (activeTab === 'drivers') {
          const { data } = await supabase.from('driver_applications').select('*').order('created_at', { ascending: false });
          if (data) setDriverApps(data as DriverApplication[]);
      } else if (activeTab === 'users') {
          const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
          if (data) setAllUsers(data as UserProfile[]);
      } else if (activeTab === 'rides') {
          const { data } = await supabase.from('rides').select('*').order('created_at', { ascending: false }).limit(50);
          if (data) setAdminRides(data as Ride[]);
      }
      setLoading(false);
    };
    fetchInitialData();
  }, [activeTab]);

  // Realtime rides subscription
  useEffect(() => {
      if (activeTab !== 'rides') return;
      const channel = supabase.channel('admin_rides_sub')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, (payload) => {
            if (payload.eventType === 'INSERT') {
                setAdminRides(prev => [payload.new as Ride, ...prev]);
            } else if (payload.eventType === 'UPDATE') {
                setAdminRides(prev => prev.map(r => r.id === payload.new.id ? payload.new as Ride : r));
            } else if (payload.eventType === 'DELETE') {
                setAdminRides(prev => prev.filter(r => r.id !== payload.old.id));
            }
        })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
  }, [activeTab]);

  const handleDeleteRide = async (id: string) => {
      if (!confirm("¿Estás seguro de que quieres eliminar este viaje de la base de datos? Esta acción es irreversible.")) return;
      setLoading(true);
      try {
          const { error } = await supabase.rpc('delete_ride_by_admin', { ride_uuid: id });
          if (error) {
            const { error: delError } = await supabase.from('rides').delete().eq('id', id);
            if (delError) throw delError;
          }
          setAdminRides(prev => prev.filter(r => r.id !== id));
          alert("Viaje eliminado correctamente.");
      } catch (e: any) {
          alert("Error al eliminar: " + e.message);
      } finally {
          setLoading(false);
      }
  };

  const handleApproveDriver = async (app: DriverApplication) => {
      if (!app) return; setLoading(true);
      try {
          await supabase.from('driver_applications').update({ status: 'approved' }).eq('id', app.id);
          await supabase.from('profiles').update({ role: 'DRIVER', verification_status: 'verified', car_model: app.car_model, car_plate: app.car_plate, car_color: app.car_color, avatar_url: app.selfie_url }).eq('id', app.user_id);
          setDriverApps(prev => prev.filter(a => a.id !== app.id));
          setReviewingApp(null);
          alert("Conductor aprobado y habilitado en la flota Zippy.");
      } catch (e: any) { alert("Error en aprobación: " + e.message); } finally { setLoading(false); }
  };

  const handleRejectDriver = async (app: DriverApplication) => {
    if (!app) return;
    const reason = prompt("Motivo del rechazo (opcional):");
    setLoading(true);
    try {
        await supabase.from('driver_applications').update({ status: 'rejected' }).eq('id', app.id);
        if (app.user_id) await supabase.from('profiles').update({ verification_status: 'rejected' }).eq('id', app.user_id);
        setDriverApps(prev => prev.filter(a => a.id !== app.id));
        setReviewingApp(null);
        alert(`Solicitud rechazada. Motivo: ${reason || 'No especificado'}`);
    } catch (e: any) { alert("Error al rechazar: " + e.message); } finally { setLoading(false); }
  };

  const filteredUsers = useMemo(() => {
    if (!searchTerm) return allUsers;
    return allUsers.filter(user =>
      user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [allUsers, searchTerm]);

  const handleSendPush = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!pushTitle.trim() || !pushMessage.trim()) return alert("Completa el Título y Mensaje.");
      setPushLoading(true);
      try {
          let dbTarget = 'ALL';
          if (pushTarget === 'drivers') dbTarget = 'DRIVERS';
          if (pushTarget === 'passengers') dbTarget = 'PASSENGERS';
          const { error } = await supabase.from('notifications').insert({ title: pushTitle, message: pushMessage, target: dbTarget });
          if (error) throw error;
          alert(`¡Notificación enviada con éxito a: ${dbTarget === 'ALL' ? 'TODOS' : dbTarget}!`);
          setPushTitle(''); setPushMessage('');
      } catch (err: any) { alert("Error: " + (err.message || "Error de conexión.")); } finally { setPushLoading(false); }
  };

  const SidebarItem = ({ id, icon: Icon, label, badge }: any) => (
    <button onClick={() => { setActiveTab(id); if(window.innerWidth < 768) setSidebarOpen(false); }} className={`w-full flex items-center gap-3 p-4 rounded-2xl transition-all mb-2 ${activeTab === id ? 'bg-zippy-dark text-white font-black shadow-xl scale-[1.02]' : 'text-zippy-dark/70 hover:bg-white/60 font-bold'}`}>
      <Icon size={20} /> <span className="flex-1 text-left">{label}</span>
      {badge > 0 && <span className="bg-red-500 text-white text-[10px] px-2 py-1 rounded-full animate-bounce font-black">{badge}</span>}
    </button>
  );

  return (
    <div className={`w-full h-full bg-gray-50 flex relative overflow-hidden font-sans transition-all duration-300 ${urgentAlert ? 'ring-8 ring-red-500 ring-inset' : ''}`}>
      {/* RED FLASHING OVERLAY FOR URGENCY */}
      {urgentAlert && <div className="absolute inset-0 border-4 border-red-500 pointer-events-none z-[100] animate-pulse"></div>}

      <div className={`fixed md:relative inset-y-0 left-0 z-50 w-72 bg-zippy-main flex flex-col transition-transform duration-500 border-r border-zippy-dark/5 shadow-2xl ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-8 flex justify-between items-center"><img src="https://tritex.com.mx/zippylogo.png" alt="Zippy Admin" className="h-10 object-contain" /><button onClick={() => setSidebarOpen(false)} className="md:hidden text-zippy-dark"><X /></button></div>
        <nav className="flex-1 px-4 space-y-4">
           <div>
               <p className="text-[10px] font-black text-zippy-dark/30 uppercase tracking-[0.2em] mb-4 px-4">Centro de Control</p>
               <SidebarItem id="dashboard" icon={LayoutDashboard} label="Resumen" />
               <SidebarItem id="rides" icon={Navigation} label="Viajes" />
               <SidebarItem id="live_map" icon={Map} label="Mapa Operativo" />
               <SidebarItem id="drivers" icon={ClipboardList} label="Auditoría" badge={stats.pendingApps} />
               <SidebarItem id="users" icon={Users} label="Usuarios" />
               <SidebarItem id="push" icon={BellRing} label="Push Masivo" />
           </div>
        </nav>
        <div className="p-6"><button onClick={onBack} className="w-full flex items-center justify-center gap-3 p-4 text-red-600 bg-red-50 hover:bg-red-100 rounded-3xl font-black transition-colors"><LogOut size={20} /> SALIR</button></div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white p-6 shadow-sm flex justify-between items-center z-10">
            <div className="flex items-center gap-4">
                <button onClick={()=>setSidebarOpen(true)} className="md:hidden p-2 text-zippy-dark"><Menu /></button>
                <h1 className="text-2xl font-black text-zippy-dark uppercase tracking-tight">{activeTab.replace('_', ' ')}</h1>
                {urgentAlert && <div className="bg-red-600 text-white px-3 py-1 rounded-full text-xs font-black animate-bounce">¡VIAJE CRÍTICO $99!</div>}
            </div>
            <div className="w-10 h-10 bg-zippy-dark rounded-2xl flex items-center justify-center text-white font-black">AD</div>
        </header>

        <main className="flex-1 overflow-y-auto relative p-6 md:p-10">
            {loading && <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-50"><Loader2 className="animate-spin text-zippy-dark" size={48} /></div>}
            
            {activeTab === 'dashboard' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fade-in">
                    <StatCard title="Conductores Activos" value={stats.drivers} icon={Car} />
                    <StatCard title="Viajes en Curso" value={stats.activeRides} icon={Activity} />
                    <StatCard title="Apps Pendientes" value={stats.pendingApps} icon={FileUp} isAlert={stats.pendingApps > 0} />
                    <div className="md:col-span-1 lg:col-span-1 bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 flex flex-col justify-center">
                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Ganancias Plataforma</p>
                        <h3 className="text-4xl font-black text-green-600">$4,250.00</h3>
                    </div>
                    
                    {/* LEADERBOARD SECTION */}
                    <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 col-span-1 md:col-span-2 lg:col-span-2">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-yellow-100 text-yellow-600 rounded-lg"><Trophy size={20}/></div>
                            <h3 className="font-black text-zippy-dark uppercase tracking-widest">Ranking Top Conductores</h3>
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
                                    {leaderboard.length > 0 ? leaderboard.map((d) => (
                                        <tr key={d.driver_id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                                            <td className="py-3">
                                                <div className="font-bold text-zippy-dark text-xs">{d.email}</div>
                                            </td>
                                            <td className="py-3 flex items-center gap-1">
                                                <Star size={12} className="text-yellow-500 fill-yellow-500" /> {d.rating ? d.rating.toFixed(1) : '5.0'}
                                            </td>
                                            <td className="py-3 text-right font-black text-green-600">
                                                ${d.total_earnings ? d.total_earnings.toFixed(2) : '0.00'} MXN
                                            </td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan={3} className="py-4 text-center text-xs text-gray-400">Sin datos de rendimiento aun.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="md:col-span-2 lg:col-span-2 bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 flex gap-6 items-start">
                        <div className="p-4 bg-zippy-main/20 rounded-2xl text-zippy-dark"><Info size={24}/></div>
                        <div>
                            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Reporte Ejecutivo IA</p>
                            <p className="text-sm font-bold text-zippy-dark mt-2 leading-relaxed">{aiReport || 'Analizando datos de la flota...'}</p>
                        </div>
                    </div>
                </div>
            )}
            
            {activeTab === 'live_map' && (
                <div className="absolute inset-0 z-0 bg-gray-200">
                    <MapVisual status="live_map" entities={liveEntities} />
                    <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-lg border border-zippy-dark/10">
                        <h3 className="font-black text-zippy-dark text-xs uppercase tracking-widest mb-1">Mapa Operativo</h3>
                        <p className="text-[10px] font-bold text-gray-500">Mostrando {liveEntities.length} unidades activas en ruta.</p>
                    </div>
                </div>
            )}
            
            {activeTab === 'drivers' && <DriverApplicationsTable applications={driverApps} onReview={setReviewingApp} />}
            {reviewingApp && <DriverReviewModal app={reviewingApp} onClose={() => setReviewingApp(null)} onApprove={handleApproveDriver} onReject={handleRejectDriver} loading={loading} />}
            
            {activeTab === 'users' && (<div className="animate-fade-in"><div className="relative mb-6"><Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" size={20}/><input type="text" placeholder="Buscar por nombre o correo..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-white p-5 pl-16 rounded-2xl shadow-sm border border-gray-100 font-bold outline-none focus:ring-2 focus:ring-zippy-main"/></div><div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden"><UsersTable users={filteredUsers} /></div></div>)}

            {activeTab === 'rides' && (<div className="animate-fade-in"><div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden"><RidesTable rides={adminRides} onDelete={handleDeleteRide} /></div></div>)}

            {activeTab === 'push' && (<div className="max-w-4xl mx-auto animate-fade-in"><div className="bg-white p-8 rounded-[40px] shadow-xl border border-gray-100"><div className="flex items-center gap-3 mb-6"><div className="p-3 bg-zippy-main rounded-2xl text-zippy-dark"><BellRing size={24} /></div><h3 className="text-xl font-black text-zippy-dark uppercase tracking-tight">Nuevo Envío Masivo</h3></div><form onSubmit={handleSendPush} className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6"><div className="space-y-4"><div className="space-y-2"><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">Título</label><input type="text" value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} placeholder="Ej: ¡Alta Demanda!" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold outline-none focus:border-zippy-dark" /></div><div className="space-y-2"><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">Mensaje</label><textarea value={pushMessage} onChange={(e) => setPushMessage(e.target.value)} placeholder="Escribe el contenido..." rows={4} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold outline-none focus:border-zippy-dark resize-none" /></div><div className="space-y-2"><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">Audiencia</label><div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => setPushTarget('all')} className={`p-3 rounded-xl font-bold text-xs uppercase border transition-all ${pushTarget === 'all' ? 'bg-zippy-dark text-white border-zippy-dark' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>Todos</button><button type="button" onClick={() => setPushTarget('drivers')} className={`p-3 rounded-xl font-bold text-xs uppercase border transition-all ${pushTarget === 'drivers' ? 'bg-zippy-dark text-white border-zippy-dark' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>Conductores</button><button type="button" onClick={() => setPushTarget('passengers')} className={`p-3 rounded-xl font-bold text-xs uppercase border transition-all ${pushTarget === 'passengers' ? 'bg-zippy-dark text-white border-zippy-dark' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>Pasajeros</button></div></div></div><div className="space-y-6 flex flex-col justify-end"><div className="bg-zippy-main/10 border-2 border-dashed border-zippy-main/20 rounded-[32px] p-6 flex flex-col items-center justify-center text-center"><BellRing size={32} className="text-zippy-dark mb-3" /><p className="text-zippy-dark font-bold text-sm">{pushTitle || 'Título'}</p><p className="text-zippy-dark/60 text-xs mt-1">{pushMessage || 'Mensaje...'}</p></div><button type="submit" disabled={pushLoading} className="w-full bg-zippy-main text-zippy-dark font-black py-5 rounded-[24px] shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all hover:brightness-105 disabled:opacity-70">{pushLoading ? <Loader2 className="animate-spin" /> : <Send size={20} />} ENVIAR</button></div></form></div></div>)}
        </main>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, isAlert }: any) => (
  <div className={`bg-white p-8 rounded-[32px] shadow-sm border ${isAlert ? 'border-red-200 bg-red-50' : 'border-gray-100'}`}>
    <div className="flex items-center gap-3 mb-2">
      <div className={`p-2 rounded-lg ${isAlert ? 'bg-red-100' : 'bg-gray-100'}`}><Icon size={16} className={isAlert ? 'text-red-600' : 'text-gray-500'}/></div>
      <p className={`text-xs font-black uppercase tracking-widest ${isAlert ? 'text-red-700' : 'text-gray-400'}`}>{title}</p>
    </div>
    <h3 className={`text-5xl font-black ${isAlert ? 'text-red-600' : 'text-zippy-dark'}`}>{value}</h3>
  </div>
);

const DriverApplicationsTable = ({ applications, onReview }: { applications: DriverApplication[], onReview: (app: DriverApplication) => void }) => (
  <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
    <table className="w-full text-left">
      <thead className="bg-gray-50 text-zippy-dark uppercase text-[10px] font-black tracking-widest"><tr><th className="p-6">Solicitante</th><th className="p-6">Vehículo</th><th className="p-6 text-center">Fecha</th><th className="p-6 text-right">Acción</th></tr></thead>
      <tbody className="text-sm font-medium text-gray-600 divide-y divide-gray-100">
        {applications.length > 0 ? applications.map(app => (
          <tr key={app.id}>
            <td className="p-6"><div className="font-bold text-zippy-dark">{app.full_name}</div><div className="text-xs text-gray-400">{app.phone}</div></td>
            <td className="p-6">{app.car_model} <span className="text-xs bg-gray-100 px-2 py-1 rounded-md font-mono">{app.car_plate}</span></td>
            <td className="p-6 text-center text-xs">{new Date(app.created_at).toLocaleDateString()}</td>
            <td className="p-6 text-right"><button onClick={() => onReview(app)} className="px-4 py-2 bg-zippy-dark text-white font-bold text-xs rounded-xl shadow-lg hover:bg-zippy-light">Revisar</button></td>
          </tr>
        )) : (<tr><td colSpan={4} className="p-10 text-center text-gray-400 font-bold">No hay solicitudes pendientes.</td></tr>)}
      </tbody>
    </table>
  </div>
);

const UsersTable = ({ users }: { users: UserProfile[] }) => (
  <table className="w-full text-left">
    <thead className="bg-gray-50 text-zippy-dark uppercase text-[10px] font-black tracking-widest"><tr><th className="p-6">Usuario</th><th className="p-6">Contacto</th><th className="p-6 text-center">Rol</th><th className="p-6 text-center">Estatus</th></tr></thead>
    <tbody className="text-sm font-medium text-gray-600 divide-y divide-gray-100">
      {users.length > 0 ? users.map(user => (
        <tr key={user.id}>
          <td className="p-6 flex items-center gap-3"><img src={user.avatar_url || `https://ui-avatars.com/api/?name=${user.full_name}`} className="w-10 h-10 rounded-full object-cover"/><span className="font-bold text-zippy-dark">{user.full_name}</span></td>
          <td className="p-6"><div className="font-mono text-xs bg-gray-100 px-2 py-1 rounded-md inline-block">{user.email}</div></td>
          <td className="p-6 text-center"><span className={`px-3 py-1 rounded-full text-[10px] font-black text-white ${user.role === 'DRIVER' ? 'bg-blue-600' : 'bg-gray-400'}`}>{user.role}</span></td>
          <td className="p-6 text-center"><span className="text-green-500 font-bold text-xs flex items-center justify-center gap-1"><CheckCircle size={14}/> Activo</span></td>
        </tr>
      )) : (<tr><td colSpan={4} className="p-10 text-center text-gray-400 font-bold">No se encontraron usuarios.</td></tr>)}
    </tbody>
  </table>
);

const RidesTable = ({ rides, onDelete }: { rides: Ride[], onDelete: (id: string) => void }) => (
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
      {rides.length > 0 ? rides.map(ride => (
        <tr key={ride.id} className="hover:bg-gray-50 transition-colors">
          <td className="p-6">
            <span className={`px-3 py-1 rounded-full text-[10px] font-black text-white uppercase ${
              ride.status === 'COMPLETED' ? 'bg-green-500' :
              ride.status === 'REQUESTING' ? 'bg-yellow-500 animate-pulse' :
              ride.status === 'IN_PROGRESS' ? 'bg-blue-600' :
              ride.status === 'CANCELLED' ? 'bg-red-500' : 'bg-gray-400'
            }`}>
              {ride.status}
            </span>
            <div className="text-[10px] text-gray-400 mt-2 font-bold">{new Date(ride.created_at || '').toLocaleString()}</div>
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
            <span className="font-black text-zippy-dark text-lg">${ride.price}</span>
          </td>
          <td className="p-6 text-right">
            <button onClick={() => onDelete(ride.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar permanentemente">
                <Trash2 size={16} />
            </button>
          </td>
        </tr>
      )) : (
        <tr><td colSpan={4} className="p-10 text-center text-gray-400 font-bold">No hay viajes registrados.</td></tr>
      )}
    </tbody>
  </table>
);

const DriverReviewModal = ({ app, onClose, onApprove, onReject, loading }: { app: DriverApplication, onClose: () => void, onApprove: (app: DriverApplication) => void, onReject: (app: DriverApplication) => void, loading: boolean }) => {
  const [activeDoc, setActiveDoc] = useState(app.selfie_url);
  const docs = [
    { key: 'selfie_url', label: 'Selfie', icon: Camera },
    { key: 'license_photo_url', label: 'Licencia', icon: ShieldCheck },
    { key: 'ine_front_url', label: 'INE Oficial', icon: FileText },
    { key: 'car_photo_front_url', label: 'Auto (Frente)', icon: Car },
    { key: 'car_photo_back_url', label: 'Auto (Atrás)', icon: Car },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-zippy-dark/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-6xl h-[90vh] rounded-[32px] shadow-2xl flex overflow-hidden">
        <div className="w-1/3 bg-gray-50 border-r border-gray-100 flex flex-col">
          <div className="p-6 border-b border-gray-100"><h3 className="font-black text-zippy-dark text-xl">{app.full_name}</h3><p className="text-xs text-gray-400 font-bold">{app.email}</p></div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {docs.map(doc => (app as any)[doc.key] && (
              <button key={doc.key} onClick={() => setActiveDoc((app as any)[doc.key])} className={`w-full p-3 rounded-xl border-2 flex items-center gap-3 text-left transition-all ${activeDoc === (app as any)[doc.key] ? 'bg-zippy-main/20 border-zippy-main' : 'bg-white hover:border-gray-200'}`}>
                <doc.icon size={16} className="text-zippy-dark" /> <span className="text-xs font-bold text-zippy-dark uppercase">{doc.label}</span>
              </button>
            ))}
          </div>
          <div className="p-6 border-t border-gray-100 bg-white grid grid-cols-2 gap-3">
            <button disabled={loading} onClick={() => onReject(app)} className="py-4 rounded-xl bg-red-50 text-red-600 font-black text-xs uppercase hover:bg-red-100 disabled:opacity-50">Rechazar</button>
            <button disabled={loading} onClick={() => onApprove(app)} className="py-4 rounded-xl bg-green-500 text-white font-black text-xs uppercase shadow-lg hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin"/> : "Aprobar"}</button>
          </div>
        </div>
        <div className="flex-1 bg-gray-900 flex flex-col relative items-center justify-center p-10">
          <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-white/10 text-white rounded-full"><X/></button>
          {activeDoc ? <img src={activeDoc} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" /> : <div className="text-white/30 text-center"><FileText className="w-16 h-16 mx-auto mb-4"/><p className="font-bold">Selecciona un documento</p></div>}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
