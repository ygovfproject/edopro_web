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
    # Accounts and cloud decks: SQLite on the server's own disk (systemd StateDirectory),
    # never exposed to the network. Daily backups go to /var/lib/edopro-proxy/backups.
    accounts = { dbPath = "/var/lib/edopro-proxy/accounts.db" }
  })

  # Everything the proxy needs on the server (path under /opt/edopro-proxy -> contents).
  proxy_files = merge(
    { for f in fileset(local.proxy_dir, "src/*.mjs") : f => base64gzip(file("${local.proxy_dir}/${f}")) },
    {
      "package.json" = base64gzip(file("${local.proxy_dir}/package.json"))
      "config.json"  = base64gzip(local.proxy_config)
    },
  )

  # Installs / updates the proxy, its service and the maintenance timer (see deploy.sh.tftpl).
  # replace() drops Windows line endings (CR) in case the repo was checked out with them;
  # bash on the server would fail on them. (.gitattributes keeps these files LF too.)
  deploy_sh = replace(templatefile("${path.module}/deploy.sh.tftpl", { files = local.proxy_files }), "\r", "")

  cloud_init = replace(templatefile("${path.module}/cloud-init.yaml.tftpl", {
    deploy_sh = base64gzip(local.deploy_sh)
    domain    = var.domain
  }), "\r", "")
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
  # (and a new sslip.io hostname). Proxy updates go through terraform_data.proxy_deploy instead.
  lifecycle {
    ignore_changes = [metadata, source_details]
  }
}

# ---------------- proxy updates ----------------

# Cloud-init only runs on first boot (and the instance ignores metadata changes, so it is
# never replaced). This pushes the current proxy code, config, service and maintenance timer
# to the running server over SSH whenever any of them change. It creates nothing in Oracle
# Cloud: it only exists in Terraform's state.
resource "terraform_data" "proxy_deploy" {
  triggers_replace = [sha256(local.deploy_sh), oci_core_instance.proxy.id]

  connection {
    type        = "ssh"
    host        = oci_core_instance.proxy.public_ip
    user        = "ubuntu"
    private_key = file(pathexpand(var.ssh_private_key_path))
    timeout     = "2m"
  }

  provisioner "file" {
    content     = local.deploy_sh
    destination = "/tmp/edopro-deploy.sh"
  }

  provisioner "remote-exec" {
    inline = [
      # On a brand-new server, let first-boot setup (Node.js, Caddy) finish first.
      "cloud-init status --wait >/dev/null 2>&1 || true",
      "sudo bash /tmp/edopro-deploy.sh",
      "rm -f /tmp/edopro-deploy.sh",
    ]
  }
}
