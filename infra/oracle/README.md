# Proxy on Oracle Cloud (Always Free)

Creates one Always Free VM with the EDOPro web proxy behind Caddy (automatic
HTTPS, WebSockets), plus the network it needs. The proxy also hosts the accounts and
cloud-deck API, with its SQLite database on the VM's own disk. Terraform runs on your PC with
your own OCI API key; no credentials are stored here.

## One-time setup

1. **Oracle account**: sign up at https://signup.oraclecloud.com. Pick your
   *home region* carefully: Always Free Arm VMs only run there.
2. **API key**: in the console, Profile (top right) → *My profile* → *API keys* →
   *Add API key* → *Generate API key pair* → download the private key → *Add*.
   Copy the "Configuration file preview" into `%USERPROFILE%\.oci\config` and set
   `key_file` to where you saved the private key, e.g.
   `key_file=C:\Users\you\.oci\oci_api_key.pem`.
3. **Terraform**: `winget install Hashicorp.Terraform`
4. **SSH key** (if you don't have one): `ssh-keygen -t ed25519`
5. `copy terraform.tfvars.example terraform.tfvars` and fill in `region`,
   `compartment_ocid` (your tenancy OCID, shown in the config preview) and
   `allowed_origins` (your web app's address).

## Deploy

```bat
cd infra\oracle
terraform init
terraform apply
```

Terraform prints `proxy_url`. The server needs 3–5 minutes after creation to
install Node.js and Caddy and get a certificate. Then open `health_check` in a
browser; it should show `{"ok":true,...}`.

Put the URL in `web/.env` and rebuild the site:

```
NEXT_PUBLIC_PROXY_URL=https://1-2-3-4.sslip.io
```

## Notes

- **Hostname**: by default `<ip>.sslip.io`, a free wildcard DNS that maps to the
  IP, so Let's Encrypt can issue a certificate without owning a domain. To use
  your own domain, point an A record at the IP and set `domain` before `apply`.
- **"Out of host capacity"**: Arm capacity is often short. Try
  `availability_domain_index = 1` or `2`, retry later, or use
  `shape = "VM.Standard.E2.1.Micro"` (x86, 1 GB RAM, still plenty for the proxy).
- **Updating the proxy**: `terraform apply`. The `proxy_deploy` step uploads the current
  proxy code, config (built from `terraform.tfvars`), the systemd service and the
  maintenance timer over SSH and restarts the proxy, whenever any of them changed. It uses
  `ssh_private_key_path` (default `~/.ssh/id_ed25519`). It changes nothing in Oracle Cloud and
  never replaces the VM. `.\update-proxy.ps1 -Ip <public_ip>` still copies just the code.
  Don't edit `/opt/edopro-proxy/config.json` by hand: the next apply overwrites it.
- **Accounts database**: `/var/lib/edopro-proxy/accounts.db` (owned by the service user,
  not reachable over the network; no extra ports are opened).
- **Daily maintenance** (`edopro-maintenance.timer`, around 03:30 server time): deletes
  accounts inactive for 90 days with their decks and sessions, deletes expired sessions,
  and backs up the database to `/var/lib/edopro-proxy/backups/` (newest 7 kept). Check it
  with `systemctl list-timers edopro-maintenance.timer` and
  `journalctl -u edopro-maintenance`; run it now with
  `sudo systemctl start edopro-maintenance`.
- **Backups** stay on the VM's disk, so they protect against mistakes and corruption, not
  against losing the VM. To keep a copy elsewhere:
  `scp ubuntu@<ip>:/var/lib/edopro-proxy/backups/<newest>.db .` (needs `sudo cp` to a
  readable place first, the folder is private). To restore: stop the service, replace
  `accounts.db` with the backup (and delete `accounts.db-wal` / `-shm`), start it again.
  Deleted accounts remain in the backups for up to 7 days; copies you keep elsewhere hold
  them for as long as you keep those copies.
- **Node.js**: the deploy step upgrades Node to 22.13+ (needed for `node:sqlite`) if the VM
  has an older version.
- **Logs**: `ssh ubuntu@<ip>` then `journalctl -u edopro-proxy -f`, setup log in
  `/var/log/cloud-init-output.log`.
- **Remove everything**: `terraform destroy`.
- Keep `terraform.tfstate` (it's how Terraform knows what it created); it's in
  `.gitignore`.
