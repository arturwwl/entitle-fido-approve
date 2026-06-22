output "policy_id" {
  description = "UUID of the created Entitle birthright policy. Use this to navigate directly to the policy in the Entitle UI."
  value       = entitle_policy.new_hire_birthright.id
}

output "policy_number" {
  description = "Sequential policy number assigned by Entitle."
  value       = entitle_policy.new_hire_birthright.number
}

output "entitle_policy_url" {
  description = "Direct link to the policy in the Entitle UI."
  value       = "https://app.entitle.io/policies/${entitle_policy.new_hire_birthright.id}"
}
