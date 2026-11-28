import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { processAiRequest } from './api/ai.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer(): Promise<void> {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  app.post('/api/ai', async (req, res) => {
    const result = await processAiRequest(req.body ?? {});
    res.status(result.status).json(result.body);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zippy Taxi server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
