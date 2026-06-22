/**
 * GitHub App webhook handling and commit-status posting.
 *
 * Events handled:
 *   pull_request.opened / synchronize / reopened
 *     → set passkey-gate status to "pending", post a comment with the verify link
 *
 *   pull_request_review.submitted  (state === 'approved')
 *     → if the reviewer is NOT yet passkey-verified, dismiss their review
 *       and post a comment telling them to verify first.
 *     → if they ARE verified, check total verified count and set status
 *       to success when REQUIRED_APPROVALS threshold is reached.
 *
 *   pull_request_review.dismissed
 *     → no-op (we dismissed it ourselves)
 */

const { Webhooks } = require('@octokit/webhooks');
const { Octokit } = require('@octokit/rest');
const store = require('./store');

const REQUIRED_APPROVALS = parseInt(process.env.REQUIRED_APPROVALS ?? '2', 10);
const STATUS_CONTEXT = 'passkey-gate';

// ---------------------------------------------------------------------------
// Octokit instance (uses a PAT or GitHub App installation token)
// ---------------------------------------------------------------------------
function getOctokit() {
  return new Octokit({ auth: process.env.GITHUB_APP_TOKEN });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setCommitStatus(octokit, owner, repo, sha, state, description) {
  await octokit.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,          // 'pending' | 'success' | 'failure' | 'error'
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
    owner,
    repo,
    pull_number: pullNumber,
    review_id: reviewId,
    message,
  });
}

function verifyLink(owner, repo, prNumber) {
  return `${process.env.ORIGIN}/verify?owner=${owner}&repo=${repo}&pr=${prNumber}`;
}

// ---------------------------------------------------------------------------
// Webhook handlers
// ---------------------------------------------------------------------------

async function onPullRequest({ payload }) {
  const { action, pull_request: pr, repository } = payload;
  if (!['opened', 'synchronize', 'reopened'].includes(action)) return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const sha = pr.head.sha;
  const prNumber = pr.number;

  // Clear any previously verified approvers when new commits are pushed
  if (action === 'synchronize') {
    store.clearVerified(owner, repo, prNumber);
  }

  const octokit = getOctokit();

  await setCommitStatus(
    octokit, owner, repo, sha,
    'pending',
    `Waiting for ${REQUIRED_APPROVALS} passkey-verified approval(s)`,
  );

  if (action === 'opened') {
    await postComment(
      octokit, owner, repo, prNumber,
      `## Passkey-gate active 🔐\n\n` +
      `This repository requires **${REQUIRED_APPROVALS} passkey-verified approvals** before merging.\n\n` +
      `**Each reviewer must:**\n` +
      `1. [Verify with your passkey →](${verifyLink(owner, repo, prNumber)})\n` +
      `2. Return here and click **Approve** on this PR.\n\n` +
      `Approvals submitted without prior passkey verification will be automatically dismissed.`,
    );
  }
}

async function onPullRequestReview({ payload }) {
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
    // Not passkey-verified — dismiss the approval immediately
    await dismissReview(
      octokit, owner, repo, prNumber, reviewId,
      `@${reviewer} — your approval was dismissed because no passkey verification was recorded. ` +
      `Please [verify with your passkey](${verifyLink(owner, repo, prNumber)}) and then approve again.`,
    );

    await setCommitStatus(
      octokit, owner, repo, sha,
      'pending',
      `Approval from @${reviewer} dismissed — passkey verification required`,
    );
    return;
  }

  // Passkey-verified — count total verified approvals
  const verifiedCount = store.getVerifiedCount(owner, repo, prNumber);

  if (verifiedCount >= REQUIRED_APPROVALS) {
    await setCommitStatus(
      octokit, owner, repo, sha,
      'success',
      `${verifiedCount} passkey-verified approval(s) — ready to merge`,
    );
  } else {
    const remaining = REQUIRED_APPROVALS - verifiedCount;
    await setCommitStatus(
      octokit, owner, repo, sha,
      'pending',
      `${verifiedCount}/${REQUIRED_APPROVALS} passkey-verified approvals — ${remaining} more needed`,
    );
  }
}

// ---------------------------------------------------------------------------
// Express middleware factory
// ---------------------------------------------------------------------------

function createWebhookMiddleware() {
  const webhooks = new Webhooks({
    secret: process.env.GITHUB_WEBHOOK_SECRET,
  });

  webhooks.on('pull_request', onPullRequest);
  webhooks.on('pull_request_review', onPullRequestReview);

  webhooks.onError((error) => {
    console.error('Webhook error:', error.message);
  });

  // Return a standard Node.js request handler that Webhooks creates
  return webhooks.middleware;
}

module.exports = { createWebhookMiddleware };
