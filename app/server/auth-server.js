// Thin auth entrypoint for the multi-user gateway deployment.
//
// Reuses CloudCLI's auth logic (routes/auth.js + middleware/auth.js + userDb)
// but loads NOTHING else — no node-pty, git, chat, websocket, or file watchers.
// It serves the login page and the /api/auth/* endpoints, owns the shared user
// database, issues the amadeus_token cookie, and answers nginx's auth_request
// verify (/api/auth/gateway-verify). See gateway/nginx.conf.
import express from 'express';

import authRoutes from './routes/auth.js';
import { initializeDatabase } from './modules/database/index.js';
import { renderLoginPage } from './auth-login-page.js';

const app = express();
app.use(express.json());

// Auth API (register/login/status/user/logout/gateway-verify).
app.use('/api/auth', authRoutes);

// Login page — served for /login and any unauthenticated route the gateway
// redirects here. A static page (no SPA) that POSTs to /api/auth/login.
app.get(['/login', '/'], (_req, res) => {
  res.type('html').send(renderLoginPage());
});

const PORT = Number.parseInt(String(process.env.SERVER_PORT || 3001), 10);

async function start() {
  await initializeDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[auth-gateway] listening on :${PORT}`);
  });
}

start().catch((err) => {
  console.error('[auth-gateway] failed to start:', err);
  process.exit(1);
});
