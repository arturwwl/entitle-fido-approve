# Entitle Terraform Change Management — FIDO2 Demo

This repository demonstrates end-to-end Terraform-driven birthright policy management in Entitle, with **per-approval FIDO2 passkey verification** enforced by a custom passkey-gate service.

**Demo story:** A user opens a Terraform PR to create a new birthright policy. Before either reviewer can approve on GitHub, they must each tap their passkey on a verification page. Approvals submitted without a prior passkey challenge are automatically dismissed. Once two passkey-verified approvals land, the `passkey-gate` status check turns green, the PR merges, Terraform applies the change, and the new policy appears in the Entitle UI.

---

## How the passkey gate works

```
Reviewer opens PR
       │
       ▼
passkey-gate service sets commit status → PENDING
posts comment: "Verify with passkey first →"
       │
       ▼
Reviewer visits /verify?owner=…&repo=…&pr=…
enters GitHub username → taps passkey (WebAuthn get())
       │
       ▼
Service records reviewer as passkey-verified for this PR
       │
       ▼
Reviewer clicks Approve on GitHub
       │
  ┌────┴────────────────────────────────┐
  │ Webhook: pull_request_review        │
  │ submitted (state=approved)          │
  └────┬────────────────────────────────┘
       │
  Passkey-verified?
  ├─ NO  → review dismissed automatically
  │        comment: "Please verify first"
  └─ YES → count verified approvals
           < 2 → status stays PENDING
           ≥ 2 → status → SUCCESS ✓
                 merge button unlocked
```

---

## Repository layout

```
.
├── terraform/
│   ├── main.tf                  # Entitle provider + entitle_policy resource
│   ├── variables.tf             # All configurable inputs
│   └── outputs.tf               # Policy ID, number, direct UI link
├── passkey-service/
│   ├── src/
│   │   ├── index.js             # Express app entry point
│   │   ├── webauthn.js          # @simplewebauthn/server registration + auth
│   │   ├── github.js            # GitHub App webhook handler + commit-status posting
│   │   └── store.js             # In-memory credential + verified-approver store
│   ├── public/
│   │   └── verify.html          # Reviewer UI — drives the WebAuthn browser API
│   ├── Dockerfile
│   ├── .env.example
│   └── package.json
├── .github/
│   └── workflows/
│       ├── terraform-plan.yml   # Runs on PR — posts plan as comment
│       └── terraform-apply.yml  # Runs on merge to main — applies changes
├── branch-protection.tf         # GitHub branch protection (requires both status checks)
├── docker-compose.yml
└── README.md
```

---

## One-time setup

### 1. Push the repo to GitHub

```bash
git remote add origin https://github.com/<org>/entitle-fido-approve.git
git push -u origin main
```

### 2. Configure GitHub Secrets (for Terraform CI)

**Repo → Settings → Secrets and variables → Actions:**

| Secret | Value |
|---|---|
| `ENTITLE_API_KEY` | Entitle API key (Entitle UI → Settings → API Keys) |
| `TF_VAR_IDP_GROUP_ID` | UUID of the IdP group for new hires |
| `TF_VAR_ROLE_ID` | UUID of the role to grant |

### 3. Start the passkey-gate service

```bash
cd passkey-service
cp .env.example .env
# Edit .env — fill in SESSION_SECRET, RP_ID, ORIGIN, GITHUB_APP_TOKEN, GITHUB_WEBHOOK_SECRET
npm install
npm start
```

For a local demo, expose it with ngrok:

```bash
ngrok http 3000
# Copy the https URL (e.g. https://abc123.ngrok-free.app)
# Set RP_ID=abc123.ngrok-free.app and ORIGIN=https://abc123.ngrok-free.app in .env
```

Or with Docker:

```bash
docker compose up --build
```

### 4. Register the GitHub webhook

**Repo → Settings → Webhooks → Add webhook:**

| Field | Value |
|---|---|
| Payload URL | `https://<your-domain>/webhook` |
| Content type | `application/json` |
| Secret | same value as `GITHUB_WEBHOOK_SECRET` in `.env` |
| Events | `Pull requests`, `Pull request reviews` |

### 5. Register passkeys for both reviewers (one-time)

Each reviewer visits:
```
https://<your-domain>/verify
```
— enters their GitHub username — clicks **"Register passkey"** — follows the browser prompt.

This stores their credential in the service. They only need to do this once.

### 6. Apply branch protection

```bash
cd <repo-root>
export GITHUB_TOKEN=ghp_<admin-pat>
export TF_VAR_github_owner=<org-or-username>
terraform init && terraform apply
```

This enforces 2 required approvals, requires both `terraform plan` and `passkey-gate` status checks to pass, and dismisses stale approvals on new commits.

---

## Demo walkthrough

### Step 1 — Create the PR

```bash
git checkout -b feat/new-hire-birthright
# Edit terraform/variables.tf with your IDs, or just add a comment to trigger a diff
git add terraform/ && git commit -m "feat: add new-hire birthright policy"
git push origin feat/new-hire-birthright
```

Open a PR on GitHub. The passkey-gate service immediately posts a comment and sets the `passkey-gate` status to **pending**.

### Step 2 — CI posts the Terraform plan

The `terraform-plan` workflow runs and posts the plan diff as a PR comment. Both status checks are now visible: `terraform plan ✓` and `passkey-gate (pending)`.

### Step 3 — Reviewer 1 verifies with passkey

Reviewer 1 clicks the link in the passkey-gate comment:

```
https://<your-domain>/verify?owner=<org>&repo=entitle-fido-approve&pr=<N>
```

They enter their GitHub username and click **"Verify with passkey"**. The browser shows the OS passkey prompt — they tap their hardware key or use Face ID / Touch ID. The service records them as verified.

### Step 4 — Reviewer 1 approves on GitHub

Reviewer 1 returns to the PR and clicks **Approve**. The webhook fires: the service confirms they're passkey-verified, counts 1/2, and leaves the status pending.

### Step 5 — Reviewer 2 repeats

Reviewer 2 visits the same verify link, taps their passkey, then approves on GitHub. The webhook fires again: 2/2 verified — the service sets `passkey-gate` → **success**.

### Step 6 — Merge

Both status checks are green. The PR author merges. The `terraform-apply` workflow runs and applies the plan.

### Step 7 — Verify in Entitle UI

The apply output prints:
```
entitle_policy_url = "https://app.entitle.io/policies/<uuid>"
```

Open it — the new birthright policy is there.

---

## What happens if someone tries to skip the passkey step?

If a reviewer clicks Approve on GitHub without first visiting the verify page, the webhook handler calls `pulls.dismissReview` within seconds and posts a comment explaining what they need to do. Their approval disappears and the `passkey-gate` status reflects the dismissal. There is no way to merge without the passkey challenge.

---

## Variables reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `entitle_api_key` | Yes | — | Entitle API key |
| `entitle_endpoint` | No | `https://api.entitle.io` | API base URL |
| `idp_group_id` | Yes | — | IdP group UUID |
| `role_id` | Yes | — | Entitle role UUID |
| `policy_sort_order` | No | `10` | Policy priority |

## Outputs

| Output | Description |
|---|---|
| `policy_id` | UUID of the created policy |
| `policy_number` | Sequential number assigned by Entitle |
| `entitle_policy_url` | Direct link to the policy in the Entitle UI |
