terraform {
  required_version = ">= 1.0"

  required_providers {
    entitle = {
      source  = "entitleio/entitle"
      version = "~> 3.0"
    }
  }

  # ---------------------------------------------------------------------------
  # Remote state — swap in your own backend if preferred.
  # Using S3 here so the apply step in CI can read the plan file.
  # ---------------------------------------------------------------------------
  # backend "s3" {
  #   bucket = "my-tf-state"
  #   key    = "entitle/policies/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "entitle" {
  api_key  = var.entitle_api_key
  endpoint = var.entitle_endpoint
}

# ---------------------------------------------------------------------------
# Look up the IdP group and role by name so we don't hard-code UUIDs.
# Replace the filter values with names that match your Entitle environment.
# ---------------------------------------------------------------------------
data "entitle_directory_groups" "new_hires" {
  # Filter resolves to the IdP group whose members receive birthright access.
  # Adjust the search string to match your IdP group name exactly.
}

data "entitle_roles" "s3_readonly" {
  # resource_id scopes the search to one integration resource.
  resource_id = var.role_resource_id

  filter {
    search = var.role_search_filter
  }
}

# ---------------------------------------------------------------------------
# Birthright policy
# Every user who joins the IdP group defined above automatically receives
# the read-only role.  On group leave, access is revoked automatically.
# ---------------------------------------------------------------------------
resource "entitle_policy" "new_hire_birthright" {
  sort_order = var.policy_sort_order

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
