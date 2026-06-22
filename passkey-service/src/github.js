/**
 * GitHub webhook handling and commit-status posting.
 *
 * Exposes a plain Express router — no @octokit/webhooks middleware needed.
 * HMAC-SHA256 signature verification is done manually.
 */

const crypto = require('crypto');
const { Router } = require('express');
const { Octokit } = require('@octokit/rest');
const store = require('./store');

const REQUIRED_APPROVALS = parseInt(process.env.REQUIRED_APPROVALS ?? '2', 10);
const STATUS_CONTEXT = 'passkey-gate';

// ---------------------------------------------------------------------------
// Octokit
// ---------------------------------------------------------------------------
function getOctokit() {
  return new Octokit({ auth: process.env.GITHUB_APP_TOKEN });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setCommitStatus(octokit, owner, repo, sha, state, description) {
  await octokit.repos.createCommitStatus({
    owner, repo, sha,
    state,
    context: STATUS_CONTEXT,
    description,
    target_url: `${process.env.ORIGIN}/verify`,
  });
}

async function postComment(octokit, owner, repo, issueNumber, body) {
  await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
}

async function dismissReview(octokit, owner, repo, pullNumber, reviewId, message) {
  await octokit.pulls.dismissReview({
    owner, repo,
    pull_number: pullNumber,
    review_id: reviewId,
    message,
  });
}

function verifyLink(owner, repo, prNumber) {
  return `${process.env.ORIGIN}/verify?owner=${owner}&repo=${repo}&pr=${prNumber}`;
}

// ---------------------------------------------------------------------------
// HMAC signature verification
// ---------------------------------------------------------------------------
function verifySignature(secret, rawBody, sigHeader) {
  if (!sigHeader) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handlePullRequest(payload) {
  const { action, pull_request: pr, repository } = payload;
  if (!['opened', 'synchronize', 'reopened'].includes(action)) return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const sha = pr.head.sha;
  const prNumber = pr.number;

  if (action === 'synchronize') {
    store.clearVerified(owner, repo, prNumber);
  }

  const octokit = getOctokit();

  await setCommitStatus(octokit, owner, repo, sha, 'pending',
    `Waiting for ${REQUIRED_APPROVALS} passkey-verified approval(s)`);

  if (action === 'opened') {
    await postComment(octokit, owner, repo, prNumber,
      `## Passkey-gate active 🔐\n\n` +
      `This repository requires **${REQUIRED_APPROVALS} passkey-verified approvals** before merging.\n\n` +
      `**Each reviewer must:**\n` +
      `1. [Verify with your passkey →](${verifyLink(owner, repo, prNumber)})\n` +
      `2. Return here and click **Approve** on this PR.\n\n` +
      `Approvals submitted without prior passkey verification will be automatically dismissed.`
    );
  }
}

async function handlePullRequestReview(payload) {
  const { action, review, pull_request: pr, repository } = payload;
  if (action !== 'submitted' || review.state !== 'approved') return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const sha = pr.head.sha;
  const prNumber = pr.number;
  const reviewer = review.user.login;
  const reviewId = review.id;

  const octokit = getOctokit();

  if (!store.isVerified(owner, repo, prNumber, reviewer)) {
    await dismissReview(octokit, owner, repo, prNumber, reviewId,
      `@${reviewer} — your approval was dismissed because no passkey verification was recorded. ` +
      `Please [verify with your passkey](${verifyLink(owner, repo, prNumber)}) and then approve again.`
    );
    await setCommitStatus(octokit, owner, repo, sha, 'pending',
      `Approval from @${reviewer} dismissed — passkey verification required`);
    return;
  }

  const verifiedCount = store.getVerifiedCount(owner, repo, prNumber);

  if (verifiedCount >= REQUIRED_APPROVALS) {
    await setCommitStatus(octokit, owner, repo, sha, 'success',
      `${verifiedCount} passkey-verified approval(s) — ready to merge`);
  } else {
    const remaining = REQUIRED_APPROVALS - verifiedCount;
    await setCommitStatus(octokit, owner, repo, sha, 'pending',
      `${verifiedCount}/${REQUIRED_APPROVALS} passkey-verified approvals — ${remaining} more needed`);
  }
}

// ---------------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------------

function createWebhookRouter() {
  const router = Router();

  // Capture raw body for HMAC verification
  router.post('/webhook', express_rawBody, async (req, res) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-hub-signature-256'];
      if (!verifySignature(secret, req.rawBody, sig)) {
        console.warn('Webhook signature mismatch');
        return res.status(401).send('Invalid signature');
      }
    }

    const event = req.headers['x-github-event'];
    const payload = req.body;

    try {
      if (event === 'pull_request') await handlePullRequest(payload);
      else if (event === 'pull_request_review') await handlePullRequestReview(payload);
    } catch (err) {
      console.error(`Error handling ${event}:`, err.message);
      return res.status(500).send('Internal error');
    }

    res.status(200).send('ok');
  });

  return router;
}

// Middleware to capture raw body before JSON parsing
function express_rawBody(req, res, next) {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    try { req.body = JSON.parse(data); } catch { req.body = {}; }
    next();
  });
}

module.exports = { createWebhookRouter };
