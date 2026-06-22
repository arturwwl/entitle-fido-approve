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
  Webhook: pull_request_review submitted (state=approved)
       │
  Passkey-verified?
  ├─ NO  → review dismissed automatically
  │        comment: "Please verify first"
  └─ YES → count verified approvals
           < REQUIRED_APPROVALS → status stays PENDING
           ≥ REQUIRED_APPROVALS → status → SUCCESS ✓
                                  merge button unlocked
```

---

## Repository layout

```
.
├── terraform/
│   ├── main.tf                  # Entitle provider + entitle_policy resource
│   ├── variables.tf             # All configurable inputs
│   ├── outputs.tf               # Policy ID, number, direct UI link
│   └── terraform.tfvars         # IDP group UUID + role UUID (fill these in)
├── passkey-service/
│   ├── src/
│   │   ├── index.js             # Express app entry point
│   │   ├── webauthn.js          # @simplewebauthn/server registration + auth
│   │   ├── github.js            # Webhook handler + commit-status posting
│   │   └── store.js             # In-memory credential + verified-approver store
│   ├── public/
│   │   └── verify.html          # Reviewer UI — drives the WebAuthn browser API
│   ├── Dockerfile
│   ├── .env.example             # Copy to .env and fill in
│   └── package.json
├── .github/
│   └── workflows/
│       ├── terraform-plan.yml   # Runs on PR — posts plan as comment
│       └── terraform-apply.yml  # Runs on merge to main — applies changes
├── branch-protection.tf         # GitHub branch protection (optional, requires admin PAT)
├── docker-compose.yml           # Use with podman-compose
└── README.md
```

---

## One-time setup

### 1. Push the repo to GitHub

```bash
git add .
git commit -m "Initial demo setup"
git remote add origin https://github.com/<org>/entitle-fido-approve.git
git push -u origin main
```

### 2. Add GitHub Actions secret

**Repo → Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value |
|---|---|
| `ENTITLE_API_KEY` | Entitle UI → Settings → API Keys |
| `TF_VAR_ENTITLE_ENDPOINT` | Your Entitle API endpoint (only if not using the default `https://api.entitle.io`) |

### 3. Fill in Terraform variables

Edit `terraform/terraform.tfvars`:

```hcl
idp_group_id = "<UUID of your IdP group>"   # Entitle UI → Directory → Groups
role_id      = "<UUID of the role to grant>" # Entitle UI → Integrations → <resource> → Roles
```

### 4. Configure the passkey-gate service

```bash
cd passkey-service
cp .env.example .env
```

Edit `.env` — the key values:

| Variable | What to set |
|---|---|
| `SESSION_SECRET` | Any random string |
| `RP_ID` | Bare hostname of your tunnel (e.g. `abc123.trycloudflare.com`) |
| `ORIGIN` | Full URL with scheme (e.g. `https://abc123.trycloudflare.com`) |
| `GITHUB_APP_TOKEN` | GitHub fine-grained PAT with *Commit statuses: Read/write* and *Pull requests: Read/write* |
| `GITHUB_WEBHOOK_SECRET` | Any string — must match what you set in the GitHub webhook |
| `REQUIRED_APPROVALS` | Number of passkey-verified approvals needed (default: `2`) |
| `ALLOWED_REVIEWERS` | Comma-separated GitHub usernames allowed to approve (e.g. `alice,bob`) |

### 5. Start the tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://xxx.trycloudflare.com` URL. Update `RP_ID` and `ORIGIN` in `.env` to match, then rebuild.

> **Note:** The Cloudflare tunnel URL changes every time you restart `cloudflared`. When it changes you must update `.env` and rebuild the container.

### 6. Start the service

```bash
cd <repo-root>
podman-compose down --rmi all && podman-compose up --build
```

The logs should confirm the correct domain:
```
RP_ID:  xxx.trycloudflare.com
ORIGIN: https://xxx.trycloudflare.com
```

### 7. Register the GitHub webhook

**Repo → Settings → Webhooks → Add webhook:**

| Field | Value |
|---|---|
| Payload URL | `https://xxx.trycloudflare.com/webhook` |
| Content type | `application/json` |
| Secret | Same value as `GITHUB_WEBHOOK_SECRET` in `.env` |
| Events | *Pull requests* and *Pull request reviews* |

### 8. Register passkeys for reviewers (one-time per person)

Each reviewer visits:
```
https://xxx.trycloudflare.com/verify
```
Enters their GitHub username → clicks **Register passkey** → follows the browser prompt.

> Registered passkeys are stored in memory. They are lost when the container restarts — reviewers need to re-register after each restart.

---

## Demo walkthrough

### Step 1 — Create the PR

```bash
git checkout -b feat/new-hire-birthright
# terraform/terraform.tfvars is already filled in
git add terraform/
git commit -m "feat: add new-hire birthright policy"
git push origin feat/new-hire-birthright
```

Open a PR on GitHub. Within seconds the passkey-gate service posts a comment and sets the status to **pending**.

### Step 2 — CI posts the Terraform plan

The `terraform-plan` workflow runs and posts the plan diff as a PR comment.

### Step 3 — Reviewer 1 verifies with passkey

Reviewer 1 clicks the link in the passkey-gate comment, enters their GitHub username, clicks **Verify with passkey**, and taps their key. The service records them as verified.

### Step 4 — Reviewer 1 approves on GitHub

Reviewer 1 returns to the PR and clicks **Approve**. The webhook confirms they're passkey-verified (1 of `REQUIRED_APPROVALS`).

### Step 5 — Reviewer 2 repeats

Reviewer 2 verifies with their passkey, then approves. The webhook counts 2 verified approvals — `passkey-gate` turns **green**.

### Step 6 — Merge

Both status checks pass. The PR author merges.

### Step 7 — Terraform applies

The `terraform-apply` workflow runs. The output includes:
```
entitle_policy_url = "https://app.entitle.io/policies/<uuid>"
```

### Step 8 — Verify in Entitle UI

Open the URL — the new birthright policy is visible.

---

## What if someone skips the passkey step?

If a reviewer clicks Approve without first visiting the verify page, the webhook dismisses their review within seconds and posts a comment with the verification link. There is no way to merge without completing the passkey challenge.

---

## Configuration reference

### `terraform/terraform.tfvars`

| Variable | Description |
|---|---|
| `idp_group_id` | UUID of the IdP group that triggers the policy |
| `role_id` | UUID of the Entitle role to grant |

### `passkey-service/.env`

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the service listens on |
| `SESSION_SECRET` | — | Random string for session signing |
| `RP_NAME` | `Entitle Passkey Gate` | Name shown in the passkey prompt |
| `RP_ID` | `localhost` | Bare hostname (no scheme/port) |
| `ORIGIN` | `http://localhost:3000` | Full origin URL |
| `GITHUB_APP_TOKEN` | — | GitHub PAT for posting statuses and dismissing reviews |
| `GITHUB_WEBHOOK_SECRET` | — | Webhook HMAC secret |
| `REQUIRED_APPROVALS` | `2` | Passkey-verified approvals needed to unlock merge |
| `ALLOWED_REVIEWERS` | _(empty = anyone)_ | Comma-separated GitHub usernames allowed to register and approve |

### GitHub Actions secrets

| Secret | Description |
|---|---|
| `ENTITLE_API_KEY` | Entitle API key — passed to Terraform as `entitle_api_key` |
| `TF_VAR_ENTITLE_ENDPOINT` | Custom Entitle endpoint (optional) |
