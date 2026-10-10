data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

# Latest Ubuntu 24.04 image that runs on the chosen shape (Arm or x86).
data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  proxy_dir = "${path.module}/../../proxy"

  # Proxy config deployed to the server: the same EDOPro servers as config.example.json,
  # listening on localhost only (Caddy terminates HTTPS in front of it).
  proxy_config = jsonencode({
    host                = "127.0.0.1"
    port                = 7000
    allowedOrigins      = var.allowed_origins
    trustProxy          = true
    maxConnectionsPerIp = 8
    maxConnections      = 1000
    servers             = jsondecode(file("${local.proxy_dir}/config.example.json")).servers
  })

  cloud_init = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    server_mjs    = base64gzip(file("${local.proxy_dir}/src/server.mjs"))
    websocket_mjs = base64gzip(file("${local.proxy_dir}/src/websocket.mjs"))
    package_json  = base64gzip(file("${local.proxy_dir}/package.json"))
    config_json   = base64gzip(local.proxy_config)
    domain        = var.domain
  })
}

# ---------------- network ----------------

resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_ocid
  display_name   = "edopro-proxy-vcn"
  cidr_blocks    = ["10.0.0.0/16"]
  dns_label      = "edoproxy"
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "edopro-proxy-igw"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "edopro-proxy-public-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "edopro-proxy-public-sl"

  # Outbound: everything (EDOPro servers on 7911/7912/44444, package mirrors, Let's Encrypt).
  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  ingress_security_rules {
    description = "SSH"
    source      = var.ssh_allowed_cidr
    protocol    = "6"
    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    description = "HTTP (Let's Encrypt challenge, redirects to HTTPS)"
    source      = "0.0.0.0/0"
    protocol    = "6"
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    description = "HTTPS (proxy API and WebSockets)"
    source      = "0.0.0.0/0"
    protocol    = "6"
    tcp_options {
      min = 443
      max = 443
    }
  }

  ingress_security_rules {
    description = "ICMP path MTU discovery"
    source      = "0.0.0.0/0"
    protocol    = "1"
    icmp_options {
      type = 3
      code = 4
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.main.id
  display_name      = "edopro-proxy-public"
  cidr_block        = "10.0.0.0/24"
  dns_label         = "pub"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.public.id]
}

# ---------------- server ----------------

resource "oci_core_instance" "proxy" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name
  display_name        = "edopro-proxy"
  shape               = var.shape

  dynamic "shape_config" {
    for_each = endswith(var.shape, ".Flex") ? [1] : []
    content {
      ocpus         = var.ocpus
      memory_in_gbs = var.memory_gbs
    }
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "proxy"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = 50
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(pathexpand(var.ssh_public_key_path)))
    user_data           = base64encode(local.cloud_init)
  }

  # Cloud-init only runs on first boot, and a new instance would get a new IP
  # (and a new sslip.io hostname). Update the proxy code with update-proxy.ps1 instead.
  lifecycle {
    ignore_changes = [metadata, source_details]
  }
}
