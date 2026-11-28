import { GoogleGenAI, Type } from '@google/genai';

const MODEL_NAME = 'gemini-4-hydrogen';

export interface AiRequestPayload {
  action?: 'price_advice' | 'chat' | 'admin_report';
  pickup?: string;
  destination?: string;
  userTarifa?: number;
  message?: string;
  history?: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
}

export interface AiHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

function createAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function processAiRequest(payload: AiRequestPayload): Promise<AiHandlerResult> {
  const ai = createAiClient();
  if (!ai) {
    return {
      status: 503,
      body: {
        error: 'El motor inteligente no está configurado en el servidor (falta GEMINI_API_KEY).',
      },
    };
  }

  const action = payload?.action;

  try {
    if (action === 'price_advice') {
      const pickup = String(payload.pickup ?? '').trim().slice(0, 200);
      const destination = String(payload.destination ?? '').trim().slice(0, 200);
      const userTarifa = Number(payload.userTarifa);

      if (!pickup || !destination || !Number.isFinite(userTarifa) || userTarifa <= 0) {
        return { status: 400, body: { error: 'Parámetros inválidos para evaluar tarifa.' } };
      }

      const prompt = [
        'Eres el algoritmo de precios de "Zippy Taxi".',
        `Origen: ${pickup}. Destino: ${destination}. Tarifa propuesta por el usuario: $${userTarifa} MXN.`,
        'Calcula:',
        '1. Un consejo breve (máximo 12 palabras) en español sobre si la tarifa es justa.',
        '2. Una probabilidad de aceptación numérica entre 0 y 100.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              advice: {
                type: Type.STRING,
                description: 'Breve consejo sobre la tarifa en español.',
              },
              prob: {
                type: Type.NUMBER,
                description: 'Probabilidad de aceptación del 0 al 100.',
              },
            },
            required: ['advice', 'prob'],
          },
        },
      });

      const text = response.text?.trim();
      if (!text) {
        return { status: 502, body: { error: 'Respuesta vacía del motor inteligente.' } };
      }

      const parsed = JSON.parse(text) as { advice?: string; prob?: number };
      const successProbability = Math.max(0, Math.min(100, Math.round(Number(parsed.prob) || 50)));
      return {
        status: 200,
        body: {
          advice: parsed.advice || 'Tarifa analizada.',
          successProbability,
        },
      };
    }

    if (action === 'chat') {
      const message = String(payload.message ?? '').trim().slice(0, 1000);
      if (!message) {
        return { status: 400, body: { error: 'Escribe un mensaje para el asistente.' } };
      }

      const safeHistory = Array.isArray(payload.history)
        ? payload.history
            .slice(-20)
            .filter(
              (item) =>
                (item?.role === 'user' || item?.role === 'model') &&
                Array.isArray(item.parts) &&
                item.parts.length > 0
            )
            .map((item) => ({
              role: item.role,
              parts: item.parts
                .slice(0, 4)
                .map((p) => ({ text: String(p?.text ?? '').slice(0, 1000) })),
            }))
        : [];

      const chat = ai.chats.create({
        model: MODEL_NAME,
        history: safeHistory,
        config: {
          systemInstruction:
            'Eres Zippy, el asistente inteligente de Zippy Taxi. Eres amable, claro, conciso y experto en movilidad urbana. Siempre usa el término "Tarifa" en lugar de "Oferta" al hablar de precios. Responde en español.',
        },
      });

      const result = await chat.sendMessage({ message });
      return {
        status: 200,
        body: {
          reply: result.text || 'Lo siento, no pude obtener una respuesta en este momento.',
        },
      };
    }

    if (action === 'admin_report') {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents:
          'Genera un reporte ejecutivo breve (máximo 60 palabras) en español sobre el estado operativo de una flota de taxis urbanos hoy, destacando seguridad, eficiencia y satisfacción del conductor.',
      });

      return {
        status: 200,
        body: {
          report: response.text || 'Reporte inteligente no disponible actualmente.',
        },
      };
    }

    return { status: 400, body: { error: 'Acción de IA no soportada.' } };
  } catch (err: unknown) {
    console.error('Server Gemini API Error:', err);
    const statusCode =
      typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status?: number }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    return {
      status: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
      body: {
        error: 'No se pudo completar la consulta inteligente en este momento.',
      },
    };
  }
}

interface ServerlessRequest {
  method?: string;
  body?: unknown;
}

interface ServerlessResponse {
  status: (code: number) => ServerlessResponse;
  json: (data: unknown) => void;
  setHeader?: (name: string, value: string) => void;
}

// Vercel Serverless Function handler (/api/ai)
export default async function handler(req: ServerlessRequest, res: ServerlessResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST');
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  let parsedBody: AiRequestPayload = {};
  if (typeof req.body === 'string') {
    try {
      parsedBody = JSON.parse(req.body) as AiRequestPayload;
    } catch {
      res.status(400).json({ error: 'Cuerpo JSON inválido.' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    parsedBody = req.body as AiRequestPayload;
  }

  const result = await processAiRequest(parsedBody);
  res.status(result.status).json(result.body);
}
