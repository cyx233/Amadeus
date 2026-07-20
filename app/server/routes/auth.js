import express from 'express';
import bcrypt from 'bcrypt';
import { userDb } from '../modules/database/index.js';
import { getConnection } from '../modules/database/connection.js';
import { generateToken, authenticateToken, AUTH_COOKIE_NAME } from '../middleware/auth.js';

// Multi-user gateway deployment: the auth entrypoint (used by scripts/user.sh)
// accepts registrations for more than one account. Single-instance deployments
// stay single-user.
const ALLOW_MULTI_USER = process.env.AMADEUS_MULTI_USER === 'true';

// In multi-user mode, /register is reachable through the public gateway, so it
// must NOT be open self-registration. Require an admin token that only
// scripts/user.sh (running on the host with .env) knows.
const ADMIN_TOKEN = process.env.AMADEUS_ADMIN_TOKEN || '';

// Sets the gateway auth cookie so the nginx gateway can route by identity.
// 7d matches the JWT lifetime; HttpOnly keeps it out of JS/XSS reach.
function setAuthCookie(res, token) {
  res.cookie?.(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

const router = express.Router();
const db = getConnection();

// Check auth status and setup requirements
router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    res.json({ 
      needsSetup: !hasUsers,
      isAuthenticated: false // Will be overridden by frontend if token exists
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User registration (setup) - only allowed if no users exist
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Multi-user registration is admin-only (scripts/user.sh). The public
    // login page never registers, and /register is reachable via the gateway,
    // so require the admin token here to prevent open self-registration.
    if (ALLOW_MULTI_USER) {
      if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) {
        return res.status(403).json({ error: 'Registration is managed by an administrator.' });
      }
    }

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }

    // Use a transaction to prevent race conditions
    db.prepare('BEGIN').run();
    try {
      // Single-instance deployments allow only one account; the multi-user
      // gateway (AMADEUS_MULTI_USER=true) accepts additional registrations.
      const hasUsers = userDb.hasUsers();
      if (hasUsers && !ALLOW_MULTI_USER) {
        db.prepare('ROLLBACK').run();
        return res.status(403).json({ error: 'User already exists. This is a single-user system.' });
      }

      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Create user
      const user = userDb.createUser(username, passwordHash);

      // Generate token
      const token = generateToken(user);

      db.prepare('COMMIT').run();

      // Update last login (non-fatal, outside transaction)
      userDb.updateLastLogin(user.id);

      setAuthCookie(res, token);
      res.json({
        success: true,
        user: { id: user.id, username: user.username },
        token
      });
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
    
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    // Update last login
    userDb.updateLastLogin(user.id);

    setAuthCookie(res, token);
    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Gateway verify endpoint for nginx auth_request. authenticateToken reads the
// JWT from the amadeus_token cookie; on success we echo the username in a
// response header so nginx can route the request to amadeus-<username>.
router.get('/gateway-verify', authenticateToken, (req, res) => {
  res.setHeader('X-Auth-User', req.user.username);
  res.status(200).end();
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side; also clear the
  // gateway cookie so the nginx auth_request stops authorizing this browser.
  res.clearCookie?.(AUTH_COOKIE_NAME, { path: '/' });
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
