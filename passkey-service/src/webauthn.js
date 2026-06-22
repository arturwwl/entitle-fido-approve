/**
 * WebAuthn helpers — thin wrappers around @simplewebauthn/server.
 *
 * Registration flow (first-time):
 *   GET  /webauthn/register/options  → returns PublicKeyCredentialCreationOptions
 *   POST /webauthn/register/verify   → verifies the new credential and stores it
 *
 * Authentication flow (per approval):
 *   GET  /webauthn/auth/options      → returns PublicKeyCredentialRequestOptions
 *   POST /webauthn/auth/verify       → verifies the assertion, marks the user as passkey-verified for the PR
 */

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const store = require('./store');

const RP_NAME = process.env.RP_NAME || 'Entitle Passkey Gate';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:3000';

const ALLOWED_REVIEWERS = process.env.ALLOWED_REVIEWERS
  ? process.env.ALLOWED_REVIEWERS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

function isAllowed(githubLogin) {
  if (ALLOWED_REVIEWERS.length === 0) return true;
  return ALLOWED_REVIEWERS.includes(githubLogin);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

async function getRegistrationOptions(req, res) {
  const githubLogin = req.session.githubLogin;
  if (!githubLogin) return res.status(401).json({ error: 'Not authenticated' });
  if (!isAllowed(githubLogin)) return res.status(403).json({ error: `@${githubLogin} is not in the allowed reviewers list` });

  const existingCredentials = store.getCredentialsForUser(githubLogin);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: githubLogin,
    userDisplayName: githubLogin,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.id,
      type: 'public-key',
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required', // ensures PIN / biometric is checked
    },
  });

  store.setChallenge(req.sessionID, options.challenge);
  res.json(options);
}

async function verifyRegistration(req, res) {
  const githubLogin = req.session.githubLogin;
  if (!githubLogin) return res.status(401).json({ error: 'Not authenticated' });

  const expectedChallenge = store.getChallenge(req.sessionID);
  if (!expectedChallenge) return res.status(400).json({ error: 'No challenge found' });

  console.log('Registration body received:', JSON.stringify(req.body, null, 2));

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    store.clearChallenge(req.sessionID);
    return res.status(400).json({ error: err.message });
  }

  store.clearChallenge(req.sessionID);

  if (!verification.verified) {
    return res.status(400).json({ error: 'Verification failed' });
  }

  const regInfo = verification.registrationInfo;
  const credId = regInfo.credentialID;
  const credPublicKey = regInfo.credentialPublicKey;
  const credCounter = regInfo.counter ?? 0;

  store.saveCredential(githubLogin, {
    id: credId,
    publicKey: Buffer.from(credPublicKey).toString('base64url'),
    counter: credCounter,
    transports: req.body.response?.transports ?? [],
  });

  res.json({ verified: true });
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

async function getAuthenticationOptions(req, res) {
  const githubLogin = req.session.githubLogin;
  console.log('getAuthenticationOptions: githubLogin=', githubLogin);
  if (!githubLogin) return res.status(401).json({ error: 'Not authenticated' });
  if (!isAllowed(githubLogin)) return res.status(403).json({ error: `@${githubLogin} is not in the allowed reviewers list` });

  const existingCredentials = store.getCredentialsForUser(githubLogin);

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: existingCredentials.map((c) => ({
      id: c.id,
      type: 'public-key',
      transports: c.transports,
    })),
  });

  store.setChallenge(req.sessionID, options.challenge);
  res.json(options);
}

async function verifyAuthentication(req, res) {
  const githubLogin = req.session.githubLogin;
  console.log('verifyAuthentication: githubLogin=', githubLogin, 'pendingPR=', req.session.pendingPR);
  if (!githubLogin) return res.status(401).json({ error: 'Not authenticated' });

  const { owner, repo, prNumber } = req.session.pendingPR ?? {};
  if (!owner) return res.status(400).json({ error: 'No pending PR in session' });

  const expectedChallenge = store.getChallenge(req.sessionID);
  console.log('verifyAuthentication: challenge=', !!expectedChallenge);
  if (!expectedChallenge) return res.status(400).json({ error: 'No challenge found' });

  const storedCredentials = store.getCredentialsForUser(githubLogin);
  const credentialID = req.body.id;
  console.log('verifyAuthentication: credentialID=', credentialID, 'stored=', storedCredentials.map(c => c.id));
  const storedCred = storedCredentials.find((c) => c.id === credentialID);
  if (!storedCred) return res.status(400).json({ error: 'Unknown credential' });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      authenticator: {
        credentialID: storedCred.id,
        credentialPublicKey: Buffer.from(storedCred.publicKey, 'base64url'),
        counter: storedCred.counter,
        transports: storedCred.transports,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    store.clearChallenge(req.sessionID);
    return res.status(400).json({ error: err.message });
  }

  store.clearChallenge(req.sessionID);

  console.log('authInfo:', JSON.stringify(verification.authenticationInfo, null, 2));

  if (!verification.verified) {
    return res.status(400).json({ error: 'Authentication failed' });
  }

  store.updateCredentialCounter(githubLogin, credentialID, verification.authenticationInfo.newCounter);

  // Mark this GitHub user as passkey-verified for this PR
  store.markVerified(owner, repo, prNumber, githubLogin);

  res.json({ verified: true, githubLogin, prNumber });
}

module.exports = {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
};
