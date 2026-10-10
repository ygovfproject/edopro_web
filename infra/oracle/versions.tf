terraform {
  required_version = ">= 1.5.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 6.0.0"
    }
  }
}

# Credentials come from your own OCI config file (%USERPROFILE%\.oci\config),
# created when you add an API key in the Oracle Cloud console. Nothing secret
# is stored in this folder.
provider "oci" {
  region              = var.region
  config_file_profile = var.oci_profile
}
