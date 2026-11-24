import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { uploadsDir } from './src/server/db.ts';
import { attachWebSocketServer } from './src/server/realtime.ts';
import { createApiRouter } from './src/server/routes.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));

  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
    express.static(uploadsDir, { fallthrough: true })
  );

  app.use('/api', createApiRouter());

  const server = http.createServer(app);
  attachWebSocketServer(server);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Willow server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Willow server:', err);
  process.exit(1);
});
