export type DialogMode = 'alert' | 'confirm' | 'prompt';

export interface DialogRequest {
  id: number;
  mode: DialogMode;
  message: string;
  title?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: boolean | string | null | void) => void;
}

type DialogListener = (request: DialogRequest) => void;

const listeners = new Set<DialogListener>();
let nextDialogId = 1;

export function subscribeToDialogs(listener: DialogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function enqueueDialog<T>(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<T> {
  return new Promise<T>((resolve) => {
    if (listeners.size === 0) {
      if (req.mode === 'confirm') resolve(false as T);
      else if (req.mode === 'prompt') resolve(null as T);
      else resolve(undefined as T);
      return;
    }
    const request: DialogRequest = {
      ...req,
      id: nextDialogId++,
      resolve: (value) => resolve(value as T),
    };
    listeners.forEach((listener) => listener(request));
  });
}

export function appAlert(message: string, title = 'Aviso'): Promise<void> {
  return enqueueDialog<void>({
    mode: 'alert',
    title,
    message,
    confirmLabel: 'Entendido',
  });
}

export function appConfirm(message: string, title = 'Confirmar acción'): Promise<boolean> {
  return enqueueDialog<boolean>({
    mode: 'confirm',
    title,
    message,
    confirmLabel: 'Confirmar',
    cancelLabel: 'Cancelar',
  });
}

export function appPrompt(
  message: string,
  defaultValue = '',
  title = 'Ingresa un dato'
): Promise<string | null> {
  return enqueueDialog<string | null>({
    mode: 'prompt',
    title,
    message,
    defaultValue,
    confirmLabel: 'Aceptar',
    cancelLabel: 'Cancelar',
  });
}
