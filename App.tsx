
import React, { useState, useEffect } from 'react';
import { User, Car, ShieldCheck, Briefcase, Eye, EyeOff, Loader2 } from 'lucide-react';
import { UserRole } from './types';
import PassengerApp from './components/PassengerApp';
import DriverApp from './components/DriverApp';
import AdminDashboard from './components/AdminDashboard';
import ProviderApp from './components/ProviderApp';
import InstallPwaPopup from './components/InstallPwaPopup';
import { supabase } from './services/supabase';

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  
  // Admin credentials state
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 1. Splash screen timer
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);

    // 2. Load Saved Theme (v2 palette: #000000, #F5B901, #005EDD)
    localStorage.removeItem('zippy-theme');
    const savedTheme = localStorage.getItem('zippy-theme-v2');
    if (savedTheme) {
      try {
        const theme = JSON.parse(savedTheme);
        const root = document.documentElement;
        root.style.setProperty('--zippy-main', theme.main);
        root.style.setProperty('--zippy-dark', theme.dark);
        root.style.setProperty('--zippy-light', theme.light);
        root.style.setProperty('--zippy-accent', theme.accent);
      } catch (e) {
        console.error("Error loading theme", e);
      }
    }

    // 3. Request Notification Permission globally
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        console.log("Estado de notificaciones:", permission);
      });
    }

    // 4. Check API Key
    const checkApiKey = async () => {
      if (window.aistudio) {
        const has = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(has);
      } else {
        // If aistudio is not available (e.g. standard dev env), allow access.
        setHasApiKey(true);
      }
    };
    checkApiKey();

    // 5. SESSION PERSISTENCE (RESTORE SESSION ON REFRESH)
    const restoreSession = async () => {
        // Limpiar bandera heredada insegura si existiera
        localStorage.removeItem('zippy-admin-logged');

        // Verificar sesión real de Supabase (incluye ADMIN, PASSENGER, DRIVER, PROVIDER)
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            // Fetch profile to determine role
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
            if (profile && profile.role) {
                // Map DB role to App Role Enum
                if (profile.role === 'PASSENGER') setRole(UserRole.PASSENGER);
                else if (profile.role === 'DRIVER') setRole(UserRole.DRIVER);
                else if (profile.role === 'PROVIDER') setRole(UserRole.PROVIDER);
                else if (profile.role === 'ADMIN') setRole(UserRole.ADMIN);
            }
        }
    };
    restoreSession();

    return () => clearTimeout(timer);
  }, []);

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-8 overflow-hidden">
        <img
          src="https://daloocomercializadora.com.mx/zippylogo.png"
          alt="Zippy Taxi"
          className="w-72 max-w-[80vw] h-auto object-contain animate-fade-in"
        />
      </div>
    );
  }

  // API Key Gate
  if (!hasApiKey && window.aistudio) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6 animate-fade-in">
          <img src="https://daloocomercializadora.com.mx/zippylogo.png" className="h-24 mb-6 object-contain" alt="Zippy Taxi Logo" />
          <div className="bg-white p-8 rounded-[32px] shadow-2xl max-w-sm w-full text-center border-t-4 border-[#F5B901]">
              <h2 className="text-xl font-black text-black mb-4">Acceso a Gemini API</h2>
              <p className="text-gray-500 font-bold text-sm mb-6">Para habilitar la inteligencia de Zippy Taxi, selecciona tu API Key de Google Cloud.</p>
              
              <button 
                onClick={async () => {
                    if(window.aistudio) {
                        await window.aistudio.openSelectKey();
                        setHasApiKey(true); 
                    }
                }}
                className="w-full bg-[#005EDD] hover:bg-black text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all mb-4"
              >
                SELECCIONAR API KEY
              </button>
              
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-[10px] font-black text-black/40 uppercase tracking-widest underline">
                Información de Facturación
              </a>
          </div>
      </div>
    );
  }

  const handleAdminLogin = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setAdminError(null);
    const trimmedUser = adminUser.trim();

    if (!trimmedUser || !adminPass) {
      setAdminError('Ingresa usuario y contraseña.');
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = trimmedUser.includes('@')
        ? trimmedUser.toLowerCase()
        : `${trimmedUser.toLowerCase()}@zippy.admin`;

      // 1. Autenticación primaria contra Supabase Auth (JWT real para RLS)
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: adminPass,
      });

      if (!authError && authData.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', authData.user.id)
          .single();

        if (profile?.role === 'ADMIN') {
          setRole(UserRole.ADMIN);
          setShowAdminLogin(false);
          setAdminPass('');
          return;
        }

        await supabase.auth.signOut();
        setAdminError('Esta cuenta no tiene permisos de administrador.');
        return;
      }

      // 2. Respaldo validado en servidor vía RPC segura (pgcrypto)
      const { data: rpcAdmin, error: rpcError } = await supabase.rpc('verify_admin_login', {
        p_username: trimmedUser,
        p_password: adminPass,
      });

      if (!rpcError && Array.isArray(rpcAdmin) && rpcAdmin.length > 0 && rpcAdmin[0]?.role === 'ADMIN') {
        setRole(UserRole.ADMIN);
        setShowAdminLogin(false);
        setAdminPass('');
        return;
      }

      setAdminError('Credenciales de Administrador Incorrectas.');
    } catch (err: unknown) {
      console.error('Error en inicio de sesión admin:', err);
      setAdminError('Error al validar credenciales. Verifica que el SQL esté actualizado.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToHome = async (): Promise<void> => {
    // Clear all persistence on explicit logout
    localStorage.removeItem('zippy-admin-logged');
    try {
      await supabase.auth.signOut();
    } catch (err: unknown) {
      console.error('Error al cerrar sesión:', err);
    }
    setAdminUser('');
    setAdminPass('');
    setAdminError(null);
    setShowAdminLogin(false);
    setRole(null);
  };

  const renderContent = () => {
    if (role === UserRole.PASSENGER) return <PassengerApp onBack={handleBackToHome} />;
    if (role === UserRole.DRIVER) return <DriverApp onBack={handleBackToHome} />;
    if (role === UserRole.ADMIN) return <AdminDashboard onBack={handleBackToHome} />;
    if (role === UserRole.PROVIDER) return <ProviderApp onBack={handleBackToHome} />;

    return (
      <div className="w-full h-screen h-[100dvh] bg-black flex flex-col items-center justify-center p-6 relative overflow-y-auto animate-fade-in transition-colors duration-500">
        {/* Background Decor */}
        <div className="absolute top-0 left-0 w-full h-full opacity-25 pointer-events-none overflow-hidden">
           <div className="absolute top-[-20%] left-[-20%] w-[55%] h-[55%] bg-[#F5B901] rounded-full filter blur-[130px]"></div>
           <div className="absolute bottom-[-20%] right-[-20%] w-[55%] h-[55%] bg-[#005EDD] rounded-full filter blur-[130px]"></div>
        </div>

        <div className="z-10 text-center mb-8 flex flex-col items-center">
          <img
            src="https://daloocomercializadora.com.mx/zippylogo.png"
            alt="Zippy Taxi"
            className="h-24 md:h-28 w-auto object-contain mb-4"
          />
          <h1 className="text-2xl md:text-3xl font-black text-white mb-1">
            Bienvenido a <span className="text-[#F5B901]">Zippy Taxi</span>
          </h1>
          <p className="text-white/60 font-black uppercase text-[10px] tracking-[4px]">El Taxi que va contigo</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl z-10 animate-slide-up" style={{ animationDelay: '0.2s' }}>
          
          <button 
              onClick={() => setRole(UserRole.PASSENGER)}
              className="group flex items-center p-4 bg-[#111111] hover:bg-[#F5B901] border border-[#F5B901]/40 rounded-2xl transition-all hover:scale-[1.02] shadow-xl"
          >
              <div className="w-12 h-12 bg-[#F5B901] text-black group-hover:bg-black group-hover:text-[#F5B901] rounded-full flex items-center justify-center mr-4 shadow-lg group-hover:rotate-12 transition-all">
                  <User size={24} />
              </div>
              <div className="text-left">
                  <h3 className="font-bold text-white group-hover:text-black text-lg transition-colors">Soy Pasajero</h3>
                  <p className="text-xs text-gray-400 group-hover:text-black/70 transition-colors">Solicita viajes rápidos</p>
              </div>
          </button>

          <button 
              onClick={() => setRole(UserRole.DRIVER)}
              className="group flex items-center p-4 bg-[#111111] hover:bg-[#005EDD] border border-[#005EDD]/50 rounded-2xl transition-all hover:scale-[1.02] shadow-xl"
          >
              <div className="w-12 h-12 bg-[#005EDD] text-white group-hover:bg-white group-hover:text-[#005EDD] rounded-full flex items-center justify-center mr-4 shadow-lg group-hover:rotate-12 transition-all">
                  <Car size={24} />
              </div>
              <div className="text-left">
                  <h3 className="font-bold text-white text-lg">Soy Conductor</h3>
                  <p className="text-xs text-gray-400 group-hover:text-white/80 transition-colors">Gana dinero manejando</p>
              </div>
          </button>

          <button 
              onClick={() => setRole(UserRole.PROVIDER)}
              className="group flex items-center p-4 bg-white hover:bg-[#F5B901] border border-white/20 rounded-2xl transition-all hover:scale-[1.02] shadow-xl"
          >
              <div className="w-12 h-12 bg-black text-[#F5B901] rounded-full flex items-center justify-center mr-4 shadow-lg group-hover:rotate-12 transition-transform">
                  <Briefcase size={24} />
              </div>
              <div className="text-left">
                  <h3 className="font-bold text-black text-lg">Soy Proveedor</h3>
                  <p className="text-xs text-gray-600 group-hover:text-black/75 transition-colors">Grúas, Mecánicos, Seguros...</p>
              </div>
          </button>

          <button 
              onClick={() => setShowAdminLogin(true)}
              className="group flex items-center p-4 bg-[#141414] hover:bg-[#005EDD] border border-white/15 rounded-2xl transition-all hover:scale-[1.02] shadow-xl"
          >
              <div className="w-12 h-12 bg-white/10 text-[#F5B901] group-hover:bg-black group-hover:text-[#F5B901] rounded-full flex items-center justify-center mr-4 shadow-lg group-hover:rotate-12 transition-all">
                  <ShieldCheck size={24} />
              </div>
              <div className="text-left">
                  <h3 className="font-bold text-white text-lg">Administrador</h3>
                  <p className="text-xs text-gray-400 group-hover:text-white/80 transition-colors">Gestión y control</p>
              </div>
          </button>
        </div>
        
        <p className="mt-8 text-[10px] font-black text-white/40 uppercase tracking-widest z-10">© 2026 Zippy Taxi</p>

        {/* ADMIN LOGIN MODAL */}
        {showAdminLogin && (
            <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 animate-fade-in">
                <div className="bg-white w-full max-w-sm rounded-[40px] p-10 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-2 bg-[#F5B901]"></div>
                    <button onClick={()=>setShowAdminLogin(false)} className="absolute top-6 right-6 text-gray-400 hover:text-black"><ShieldCheck /></button>
                    
                    <h2 className="text-2xl font-black text-black mb-8 text-center uppercase tracking-widest">Admin Control</h2>
                    
                    <form onSubmit={handleAdminLogin} className="space-y-4">
                        <input required placeholder="Usuario Admin" className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-[#005EDD] font-bold text-black" value={adminUser} onChange={e=>{ setAdminUser(e.target.value); if (adminError) setAdminError(null); }} />
                        <div className="relative">
                            <input required type={showPass ? "text" : "password"} placeholder="Contraseña" className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-[#005EDD] font-bold text-black" value={adminPass} onChange={e=>{ setAdminPass(e.target.value); if (adminError) setAdminError(null); }} />
                            <button type="button" onClick={()=>setShowPass(!showPass)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                                {showPass ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                        {adminError && (
                          <p className="text-xs font-bold text-red-600 text-center bg-red-50 border border-red-100 rounded-xl py-2 px-3">
                            {adminError}
                          </p>
                        )}
                        <button disabled={loading} className="w-full bg-black text-[#F5B901] font-black py-4 rounded-2xl shadow-xl hover:bg-[#005EDD] hover:text-white transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                            {loading ? <Loader2 className="animate-spin" /> : 'ACCEDER AL PANEL'}
                        </button>
                    </form>
                </div>
            </div>
        )}
      </div>
    );
  };

  return (
    <>
      {renderContent()}
      <InstallPwaPopup />
    </>
  );
}

export default App;
