#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# enforce-fido2.sh
#
# Configures the GitHub org so that all members must authenticate with a
# FIDO2 security key (passkey).  This is the step that makes the demo's
# PR approval genuinely passkey-gated.
#
# Prerequisites:
#   - GITHUB_TOKEN env var set to a PAT with `admin:org` scope
#   - GITHUB_ORG env var set to your organisation slug
#   - jq installed
#
# Usage:
#   export GITHUB_TOKEN=ghp_...
#   export GITHUB_ORG=my-org
#   bash scripts/enforce-fido2.sh
# ---------------------------------------------------------------------------

set -euo pipefail

: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a PAT with admin:org scope}"
: "${GITHUB_ORG:?Set GITHUB_ORG to your GitHub organisation slug}"

API="https://api.github.com"
AUTH_HEADER="Authorization: Bearer ${GITHUB_TOKEN}"
ACCEPT_HEADER="Accept: application/vnd.github+json"

echo "==> Enabling two-factor authentication requirement for org: ${GITHUB_ORG}"
curl -sS -X PATCH "${API}/orgs/${GITHUB_ORG}" \
  -H "${AUTH_HEADER}" \
  -H "${ACCEPT_HEADER}" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d '{"two_factor_requirement_enabled": true}' | jq '.two_factor_requirement_enabled'

echo ""
echo "==> Done. All org members now require 2FA."
echo ""
echo "Next step (manual — GitHub UI only):"
echo "  Org Settings → Authentication security"
echo "  → Under 'Allowed two-factor methods':"
echo "    - Uncheck 'Authenticator apps (TOTP)'"
echo "    - Uncheck 'SMS/text message'"
echo "    - Leave 'Security keys (WebAuthn/FIDO2/Passkeys)' CHECKED"
echo ""
echo "This restricts all members to passkey-only authentication."
echo "When a reviewer approves a PR they will be challenged for their passkey."
