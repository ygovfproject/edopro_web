variable "oci_profile" {
  description = "Profile name in ~/.oci/config"
  type        = string
  default     = "DEFAULT"
}

variable "region" {
  description = "Your OCI home region, e.g. eu-stockholm-1 or eu-frankfurt-1. Always Free Ampere instances only run in the home region."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment for all resources. Use your tenancy OCID (the root compartment) if unsure."
  type        = string
}

variable "ssh_public_key_path" {
  description = "Public key that can SSH into the server (as user 'ubuntu')."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"

  validation {
    condition     = fileexists(pathexpand(var.ssh_public_key_path))
    error_message = "SSH public key not found. Create one with: ssh-keygen -t ed25519 (press Enter for the defaults), or set ssh_public_key_path to an existing .pub file."
  }
}

variable "ssh_private_key_path" {
  description = "Private key matching ssh_public_key_path; used by `terraform apply` to update the proxy on the server."
  type        = string
  default     = "~/.ssh/id_ed25519"
}

variable "ssh_allowed_cidr" {
  description = "Who may reach SSH (port 22). Narrow it to your own IP/32 if you like."
  type        = string
  default     = "0.0.0.0/0"
}

variable "shape" {
  description = "Always Free shapes: VM.Standard.A1.Flex (Arm, preferred) or VM.Standard.E2.1.Micro (x86, 1 GB RAM)."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  description = "OCPUs for VM.Standard.A1.Flex (Always Free allows 4 in total)."
  type        = number
  default     = 1
}

variable "memory_gbs" {
  description = "Memory for VM.Standard.A1.Flex (Always Free allows 24 GB in total)."
  type        = number
  default     = 6
}

variable "availability_domain_index" {
  description = "Which availability domain to use (0, 1, 2). Try another one if you get 'Out of host capacity'."
  type        = number
  default     = 0
}

variable "domain" {
  description = "Hostname for HTTPS (must point to the server's IP). Leave empty to use <ip>.sslip.io automatically."
  type        = string
  default     = ""
}

variable "allowed_origins" {
  description = "Web origins allowed to use the proxy, e.g. [\"https://edopro.example.com\", \"http://localhost:*\"]."
  type        = list(string)
}
