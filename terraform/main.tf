terraform {
  required_version = ">= 1.0"

  required_providers {
    entitle = {
      source  = "entitleio/entitle"
      version = "~> 3.0"
    }
  }
}

provider "entitle" {
  api_key  = var.entitle_api_key
  endpoint = var.entitle_endpoint
}

# ---------------------------------------------------------------------------
# Birthright policy
# Every user who joins the IdP group defined above automatically receives
# the read-only role.  On group leave, access is revoked automatically.
# ---------------------------------------------------------------------------
resource "entitle_policy" "new_hire_birthright" {
  in_groups = [
    {
      id   = var.idp_group_id
      type = "group"
    }
  ]

  roles = [
    {
      id = var.role_id
    }
  ]
}
