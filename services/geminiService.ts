interface ChatHistoryItem {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface AiErrorResponse {
  error?: string;
}

async function callAiEndpoint<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as T & AiErrorResponse;
  if (!response.ok) {
    throw new Error(data.error || `Error del servicio inteligente (${response.status}).`);
  }
  return data;
}

/**
 * Gets smart price advice for a ride request via server-side /api/ai.
 */
export const getSmartPriceAdvice = async (
  pickup: string,
  destination: string,
  userTarifa: number
): Promise<{ advice: string; successProbability: number }> => {
  try {
    return await callAiEndpoint<{ advice: string; successProbability: number }>({
      action: 'price_advice',
      pickup,
      destination,
      userTarifa,
    });
  } catch (error: unknown) {
    console.error('AI Price Advice Error:', error);
    const message = error instanceof Error ? error.message : 'No se pudo consultar el consejo de tarifa.';
    return { advice: message, successProbability: 50 };
  }
};

/**
 * Handles chat interactions with the Zippy AI assistant via server-side /api/ai.
 */
export const chatWithZippy = async (message: string, history: ChatHistoryItem[]): Promise<string> => {
  try {
    const data = await callAiEndpoint<{ reply: string }>({
      action: 'chat',
      message,
      history,
    });
    return data.reply || 'Lo siento, no pude obtener una respuesta.';
  } catch (error: unknown) {
    console.error('AI Chat Error:', error);
    return error instanceof Error ? error.message : 'Error de conexión con el asistente Zippy.';
  }
};

/**
 * Generates an executive summary report for the admin dashboard via server-side /api/ai.
 */
export const generateAdminReport = async (): Promise<string> => {
  try {
    const data = await callAiEndpoint<{ report: string }>({
      action: 'admin_report',
    });
    return data.report || 'Reporte inteligente no disponible actualmente.';
  } catch (error: unknown) {
    console.error('AI Report Error:', error);
    return error instanceof Error
      ? error.message
      : 'Ocurrió un error al procesar el reporte ejecutivo inteligente.';
  }
};