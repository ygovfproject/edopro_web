# Finishes first-boot setup on a server where it failed at the Caddy step
# (Caddy's own apt repo started answering "402 Payment Required").
# Safe to run more than once.
# Usage:  .\finish-setup.ps1 -Ip 1.2.3.4
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$User = "ubuntu"
)

$script = @'
set -euxo pipefail
sudo rm -f /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo sed -i '/cloudsmith/d' /opt/edopro-proxy/setup.sh
sudo sed -i 's|^\( *\)iptables -I INPUT -p tcp -m multiport --dports 80,443|\1iptables -C INPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null \|\| iptables -I INPUT -p tcp -m multiport --dports 80,443|' /opt/edopro-proxy/setup.sh
sudo bash /opt/edopro-proxy/setup.sh
sleep 5
curl -sS -m 5 http://127.0.0.1:7000/healthz; echo
echo "Proxy URL: https://$(cat /opt/edopro-proxy/domain)"
# end (PowerShell appends a CR to the last line; keep this comment last)
'@
$script = $script -replace "`r", ""
$script | ssh -o StrictHostKeyChecking=accept-new "$User@$Ip" "bash -s"
