locals {
  public_ip = oci_core_instance.proxy.public_ip
  hostname  = var.domain != "" ? var.domain : "${replace(local.public_ip, ".", "-")}.sslip.io"
}

output "public_ip" {
  value = local.public_ip
}

output "proxy_url" {
  description = "Put this in web/.env as NEXT_PUBLIC_PROXY_URL"
  value       = "https://${local.hostname}"
}

output "health_check" {
  value = "https://${local.hostname}/healthz"
}

output "ssh" {
  value = "ssh ubuntu@${local.public_ip}"
}
