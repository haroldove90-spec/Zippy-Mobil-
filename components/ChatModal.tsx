
import React, { useState, useEffect, useRef } from 'react';
import { Send, X, Phone, User, CheckCheck, Minus, MessageSquareOff, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { appAlert } from '../services/uiDialogs';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  rideId: string;
  currentUserRole: 'DRIVER' | 'PASSENGER';
  currentUserId: string;
  counterpartName: string;
  counterpartPhone?: string;
  onEndChat?: () => void; 
}

interface Message {
  id: string;
  ride_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  role: 'DRIVER' | 'PASSENGER';
  isPending?: boolean; // For optimistic UI
}

const MESSAGE_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3'; 

const ChatModal: React.FC<ChatModalProps> = ({ 
  isOpen, onClose, rideId, currentUserRole, currentUserId, counterpartName, counterpartPhone, onEndChat 
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const getFormattedTime = (dateStr: string) => {
      return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  useEffect(() => {
      if (isOpen) {
          scrollToBottom();
      }
  }, [isOpen]);

  useEffect(() => {
    if (!rideId) return;

    setLoadingHistory(true);
    // 1. Fetch initial messages
    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });
      
      if (data) {
        setMessages(data as Message[]);
        if (isOpen) scrollToBottom();
      }
      setLoadingHistory(false);
    };

    fetchMessages();

    // 2. Subscribe to new messages
    const channel = supabase.channel(`chat_room:${rideId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages',
        filter: `ride_id=eq.${rideId}`
      }, (payload) => {
        const newMsg = payload.new as Message;
        
        setMessages(prev => {
            // Avoid duplicates from optimistic updates
            if (prev.some(m => m.id === newMsg.id)) return prev;
            // Remove optimistic pending message if it matches text/sender
            const filtered = prev.filter(m => !(m.isPending && m.text === newMsg.text && m.sender_id === newMsg.sender_id));
            return [...filtered, newMsg];
        });
        
        // Success: Clear error if any
        setSyncError(false);
        
        if (isOpen) scrollToBottom();
        
        // Play sound ONLY if the message is from the other person
        if (newMsg.sender_id !== currentUserId) {
            const audio = new Audio(MESSAGE_SOUND);
            audio.play().catch(e => console.log('Audio blocked', e));
            if ("vibrate" in navigator) navigator.vibrate(50);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [rideId, currentUserId]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    
    if (!rideId) {
        void appAlert("Error: No hay un viaje activo asociado.", "Chat");
        return;
    }

    setSyncError(false);
    setSending(true);
    const msgText = input.trim();
    setInput(''); 

    // Optimistic UI Update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
        id: tempId,
        ride_id: rideId,
        sender_id: currentUserId,
        text: msgText,
        created_at: new Date().toISOString(),
        role: currentUserRole,
        isPending: true
    };
    setMessages(prev => [...prev, optimisticMsg]);
    scrollToBottom();

    try {
        // STRICT Payload: Sending to 'text' column explicitly
        const payload = {
            ride_id: rideId,
            sender_id: currentUserId,
            text: msgText, // Correct column name
            role: currentUserRole
        };

        const { error } = await supabase.from('messages').insert(payload);

        if (error) {
            console.error("Chat Send Error:", error);
            setSyncError(true);
            setMessages(prev => prev.filter(m => m.id !== tempId));
            setInput(msgText); // Restore input on error
        } else {
            setSyncError(false); // Clear error on success
        }
    } catch (err: any) {
        console.error("Unexpected error:", err);
        setMessages(prev => prev.filter(m => m.id !== tempId));
        setInput(msgText);
    } finally {
        setSending(false);
        scrollToBottom();
    }
  };

  const handleCall = () => {
      if (counterpartPhone) {
          window.location.href = `tel:${counterpartPhone}`;
      } else {
          void appAlert("Número telefónico no disponible.", "Llamada");
      }
  };

  const handleEndChat = () => {
      if(onEndChat) onEndChat();
      else onClose();
  };
  
  return (
    <div className={`fixed inset-0 z-[200] items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in ${isOpen ? 'flex' : 'hidden'}`}>
        <div className="bg-white w-full max-w-md h-[75vh] max-h-[600px] rounded-[32px] overflow-hidden shadow-2xl flex flex-col relative animate-slide-up border border-gray-200">
            
            {/* Header */}
            <div className="bg-zippy-main p-4 flex justify-between items-center shadow-md z-10">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-black/10 transition-colors" title="Minimizar">
                        <Minus size={24} className="text-zippy-dark" />
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-zippy-dark rounded-full flex items-center justify-center text-white relative shadow-inner">
                            <User size={20} />
                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-zippy-main"></div>
                        </div>
                        <div>
                            <h3 className="font-black text-zippy-dark text-base leading-none">{counterpartName}</h3>
                            <p className="text-[10px] font-bold text-zippy-dark/70 uppercase tracking-wide mt-0.5">En línea</p>
                        </div>
                    </div>
                </div>
                <div className="flex gap-1">
                    <button onClick={handleCall} className="p-2.5 bg-white rounded-full text-zippy-dark shadow-sm active:scale-95 transition-transform hover:bg-gray-50" title="Llamar">
                        <Phone size={18} />
                    </button>
                    <button onClick={handleEndChat} className="p-2.5 bg-red-100 rounded-full text-red-600 shadow-sm active:scale-95 transition-transform hover:bg-red-200" title="Cerrar Chat">
                        <MessageSquareOff size={18} />
                    </button>
                </div>
            </div>

            {/* Sync Error Banner */}
            {syncError && (
                <div className="bg-red-50 p-2 text-center text-xs font-bold text-red-600 flex items-center justify-center gap-2 animate-pulse">
                    <AlertCircle size={14} /> Error de red. Reintentando...
                </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 bg-[#f5f5f5] overflow-y-auto p-4 flex flex-col gap-3 relative">
                <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                
                {loadingHistory && (
                    <div className="flex justify-center p-4">
                        <Loader2 className="animate-spin text-gray-400" />
                    </div>
                )}

                {!loadingHistory && messages.length === 0 && (
                    <div className="text-center mt-10 flex flex-col items-center opacity-60">
                        <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-3">
                            <Send size={24} className="text-gray-400 ml-1" />
                        </div>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide max-w-[200px]">
                            Envía un mensaje a {counterpartName} para coordinar el viaje.
                        </p>
                    </div>
                )}

                {messages.map((msg) => {
                    const isMe = msg.sender_id === currentUserId;
                    return (
                        <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} relative z-10 animate-fade-in`}>
                            <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm shadow-sm ${
                                isMe 
                                ? 'bg-[#005EDD] text-white rounded-tr-none' 
                                : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
                            }`}>
                                <p className="leading-snug font-medium">{msg.text}</p>
                                <div className={`flex items-center justify-end gap-1 mt-1 text-[9px] font-bold ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                                    {msg.isPending && <Loader2 size={8} className="animate-spin" />}
                                    <span>{getFormattedTime(msg.created_at)}</span>
                                    {isMe && !msg.isPending && <CheckCheck size={12} className="opacity-80" />}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="bg-white p-3 border-t border-gray-200 flex gap-2 items-center z-10 pb-4 md:pb-3">
                <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    disabled={!rideId || sending}
                    placeholder={!rideId ? "Chat no disponible" : "Escribe un mensaje..."}
                    className="flex-1 bg-gray-100 rounded-full px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-zippy-main text-gray-700 font-bold text-sm disabled:opacity-50 disabled:bg-gray-200 transition-all placeholder-gray-400"
                />
                <button 
                    onClick={handleSend}
                    disabled={!input.trim() || sending || !rideId}
                    className={`p-3.5 rounded-full bg-zippy-dark text-white shadow-lg transition-all active:scale-95 flex items-center justify-center ${(!input.trim() || sending || !rideId) ? 'opacity-50 cursor-not-allowed bg-gray-400' : 'hover:bg-zippy-light hover:shadow-xl'}`}
                >
                    {sending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
            </div>
        </div>
    </div>
  );
};

export default ChatModal;
