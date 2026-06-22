# ---------------------------------------------------------------------------
# Branch protection for the demo repository
#
# Apply this ONCE with your own GitHub token that has admin rights on the repo:
#
#   export GITHUB_TOKEN=<your_pat>
#   export TF_VAR_github_repo=entitle-fido-approve
#   export TF_VAR_github_owner=<your-org-or-username>
#   terraform apply
#
# This file lives at the repo root (not in /terraform/) so it is managed
# separately from the Entitle policy Terraform.
# ---------------------------------------------------------------------------

terraform {
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

provider "github" {
  owner = var.github_owner
}

variable "github_owner" {
  description = "GitHub organisation or username that owns the repository."
  type        = string
}

variable "github_repo" {
  description = "Repository name (without the owner prefix)."
  type        = string
  default     = "entitle-fido-approve"
}

variable "required_reviewer_teams" {
  description = "List of GitHub team slugs whose members are allowed to approve PRs."
  type        = list(string)
  default     = []
}

variable "required_reviewer_users" {
  description = "List of GitHub usernames of the two demo approvers."
  type        = list(string)
  default     = []
}

resource "github_branch_protection" "main" {
  repository_id = var.github_repo
  pattern       = "main"

  # -------------------------------------------------------------------------
  # Core rules
  # -------------------------------------------------------------------------
  enforce_admins                  = true
  require_signed_commits          = false  # signing is separate from FIDO2 auth
  required_linear_history         = true
  require_conversation_resolution = true

  # -------------------------------------------------------------------------
  # Pull request reviews
  # Two humans must approve; stale approvals are dismissed on new commits.
  # -------------------------------------------------------------------------
  required_pull_request_reviews {
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = false
    required_approving_review_count = 2

    # Restrict who can approve to the named teams / users.
    # If left empty, any repo collaborator can approve.
    restrict_dismissals = length(var.required_reviewer_teams) > 0 || length(var.required_reviewer_users) > 0

    dismissal_restrictions = concat(
      [for t in var.required_reviewer_teams : "/${t}"],
      var.required_reviewer_users
    )
  }

  # -------------------------------------------------------------------------
  # Required status checks
  # Both the Terraform plan CI job AND the passkey-gate service must report
  # success before merge is allowed.
  # -------------------------------------------------------------------------
  required_status_checks {
    strict   = true   # branch must be up-to-date with main
    contexts = [
      "terraform plan",   # posted by .github/workflows/terraform-plan.yml
      "passkey-gate",     # posted by the passkey-gate service (see passkey-service/)
    ]
  }
}
