variable "entitle_api_key" {
  description = "Entitle API key. Inject via the ENTITLE_API_KEY GitHub Actions secret."
  type        = string
  sensitive   = true
}

variable "entitle_endpoint" {
  description = "Entitle API endpoint."
  type        = string
  default     = "https://api.entitle.io"
}

# ---------------------------------------------------------------------------
# Policy identity
# ---------------------------------------------------------------------------
variable "idp_group_id" {
  description = <<-EOT
    UUID of the IdP group that triggers the birthright policy.
    Find it in Entitle UI → Directory → Groups, or via the Entitle API.
    Set as the TF_VAR_idp_group_id GitHub Actions secret.
  EOT
  type        = string
}

variable "role_id" {
  description = <<-EOT
    UUID of the Entitle role to grant (e.g. S3 read-only).
    Find it in Entitle UI → Integrations → <resource> → Roles.
    Set as the TF_VAR_role_id GitHub Actions secret.
  EOT
  type        = string
}

variable "role_resource_id" {
  description = "UUID of the Entitle resource that contains the target role. Used for the data source lookup."
  type        = string
  default     = ""
}

variable "role_search_filter" {
  description = "Search string used in the entitle_roles data source to find the target role by name."
  type        = string
  default     = "readonly"
}

variable "policy_sort_order" {
  description = "Priority of this policy relative to others (lower = higher priority)."
  type        = number
  default     = 10
}
