require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const webauthn = require('./webauthn');
const { createWebhookRouter } = require('./github');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Webhook route (handles its own body parsing for HMAC verification)
app.use(createWebhookRouter());

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 60 * 60 * 1000, // 1 hour
    },
  }),
);

// Serve the reviewer UI
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// Auth session: GitHub OAuth lite
// The service needs to know which GitHub user is sitting at the browser.
// For the demo we accept a simple ?login=<username> query param and store
// it in the session.  In production, replace with real GitHub OAuth.
// ---------------------------------------------------------------------------
app.get('/session/set', (req, res) => {
  const { login, owner, repo, pr } = req.query;
  if (!login) return res.status(400).json({ error: 'login required' });
  req.session.githubLogin = login;
  if (owner && repo && pr) {
    req.session.pendingPR = { owner, repo, prNumber: parseInt(pr, 10) };
  }
  res.json({ ok: true, githubLogin: login });
});

app.get('/session/me', (req, res) => {
  res.json({ githubLogin: req.session.githubLogin ?? null });
});

// ---------------------------------------------------------------------------
// WebAuthn — Registration (one-time per reviewer)
// ---------------------------------------------------------------------------
app.get('/webauthn/register/options', webauthn.getRegistrationOptions);
app.post('/webauthn/register/verify', webauthn.verifyRegistration);

// ---------------------------------------------------------------------------
// WebAuthn — Authentication (per PR approval)
// ---------------------------------------------------------------------------
app.get('/webauthn/auth/options', webauthn.getAuthenticationOptions);
app.post('/webauthn/auth/verify', webauthn.verifyAuthentication);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Passkey-gate service listening on port ${PORT}`);
  console.log(`  RP_ID:  ${process.env.RP_ID || 'localhost'}`);
  console.log(`  ORIGIN: ${process.env.ORIGIN || 'http://localhost:3000'}`);
});
