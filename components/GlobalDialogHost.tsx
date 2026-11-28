import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, HelpCircle, X } from 'lucide-react';
import { DialogRequest, subscribeToDialogs } from '../services/uiDialogs';

const GlobalDialogHost: React.FC = () => {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    return subscribeToDialogs((req) => {
      setQueue((prev) => [...prev, req]);
    });
  }, []);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (current?.mode === 'prompt') {
      setInputValue(current.defaultValue ?? '');
    }
  }, [current?.id]);

  if (!current) return null;

  const closeCurrent = (result: boolean | string | null | void): void => {
    const active = current;
    setQueue((prev) => prev.slice(1));
    active.resolve(result);
  };

  const handleConfirm = (): void => {
    if (current.mode === 'confirm') closeCurrent(true);
    else if (current.mode === 'prompt') closeCurrent(inputValue);
    else closeCurrent(undefined);
  };

  const handleCancel = (): void => {
    if (current.mode === 'confirm') closeCurrent(false);
    else if (current.mode === 'prompt') closeCurrent(null);
    else closeCurrent(undefined);
  };

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full max-w-sm rounded-[28px] shadow-2xl border-t-4 border-[#F5B901] p-6 relative">
        <button
          type="button"
          onClick={handleCancel}
          className="absolute top-4 right-4 p-1.5 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-3 pr-6">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              current.mode === 'confirm'
                ? 'bg-[#F5B901]/20 text-black'
                : current.mode === 'prompt'
                ? 'bg-[#005EDD]/15 text-[#005EDD]'
                : 'bg-black text-[#F5B901]'
            }`}
          >
            {current.mode === 'confirm' ? (
              <HelpCircle size={20} />
            ) : current.mode === 'prompt' ? (
              <CheckCircle2 size={20} />
            ) : (
              <AlertCircle size={20} />
            )}
          </div>
          <h3 className="font-black text-black text-base uppercase tracking-tight">
            {current.title || 'Zippy Taxi'}
          </h3>
        </div>

        <p className="text-sm text-gray-700 font-medium leading-relaxed mb-5 whitespace-pre-line">
          {current.message}
        </p>

        {current.mode === 'prompt' && (
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm();
            }}
            autoFocus
            className="w-full mb-5 px-4 py-3 rounded-xl bg-gray-100 border border-gray-200 font-bold text-sm text-black outline-none focus:border-[#005EDD] focus:bg-white"
          />
        )}

        <div className={`flex gap-3 ${current.mode === 'alert' ? 'justify-end' : ''}`}>
          {current.mode !== 'alert' && (
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-black text-xs uppercase tracking-wider hover:bg-gray-200 transition-colors"
            >
              {current.cancelLabel || 'Cancelar'}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className={`${
              current.mode === 'alert' ? 'w-full' : 'flex-1'
            } py-3 rounded-xl bg-[#005EDD] text-white font-black text-xs uppercase tracking-wider shadow-lg hover:bg-black transition-colors`}
          >
            {current.confirmLabel || 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GlobalDialogHost;
