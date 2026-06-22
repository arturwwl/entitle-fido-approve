/**
 * In-memory stores for the demo.
 *
 * In production you would replace these with a Redis or database backend.
 * Keys are scoped so a restart clears all state — fine for a demo session.
 */

// Registered passkeys: githubLogin → [ { credentialID, credentialPublicKey, counter, ... } ]
const credentials = new Map();

// Active WebAuthn challenges issued to a session: sessionId → base64url challenge
const challenges = new Map();

// Passkey-verified approvers per PR: `${owner}/${repo}#${prNumber}` → Set<githubLogin>
const verifiedApprovers = new Map();

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

function getCredentialsForUser(githubLogin) {
  return credentials.get(githubLogin) ?? [];
}

function saveCredential(githubLogin, credential) {
  const existing = credentials.get(githubLogin) ?? [];
  // Overwrite if same credentialID already stored (re-registration)
  const idx = existing.findIndex((c) => c.id === credential.id);
  if (idx >= 0) {
    existing[idx] = credential;
  } else {
    existing.push(credential);
  }
  credentials.set(githubLogin, existing);
}

function updateCredentialCounter(githubLogin, credentialID, newCounter) {
  const creds = credentials.get(githubLogin) ?? [];
  const cred = creds.find((c) => c.id === credentialID);
  if (cred) cred.counter = newCounter;
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

function setChallenge(sessionId, challenge) {
  challenges.set(sessionId, challenge);
}

function getChallenge(sessionId) {
  return challenges.get(sessionId);
}

function clearChallenge(sessionId) {
  challenges.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Verified approvers
// ---------------------------------------------------------------------------

function prKey(owner, repo, prNumber) {
  return `${owner}/${repo}#${prNumber}`;
}

function markVerified(owner, repo, prNumber, githubLogin) {
  const key = prKey(owner, repo, prNumber);
  const set = verifiedApprovers.get(key) ?? new Set();
  set.add(githubLogin);
  verifiedApprovers.set(key, set);
}

function isVerified(owner, repo, prNumber, githubLogin) {
  const key = prKey(owner, repo, prNumber);
  return (verifiedApprovers.get(key) ?? new Set()).has(githubLogin);
}

function getVerifiedCount(owner, repo, prNumber) {
  const key = prKey(owner, repo, prNumber);
  return (verifiedApprovers.get(key) ?? new Set()).size;
}

function clearVerified(owner, repo, prNumber) {
  verifiedApprovers.delete(prKey(owner, repo, prNumber));
}

module.exports = {
  getCredentialsForUser,
  saveCredential,
  updateCredentialCounter,
  setChallenge,
  getChallenge,
  clearChallenge,
  markVerified,
  isVerified,
  getVerifiedCount,
  clearVerified,
};
