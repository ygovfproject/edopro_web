# Checks why the proxy isn't reachable: open ports from your PC, then the
# server's setup log, services and firewall over SSH.
# Usage:  .\diagnose.ps1 -Ip 1.2.3.4
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$User = "ubuntu"
)

Write-Host "== Ports from this PC" -ForegroundColor Yellow
foreach ($port in 22, 80, 443) {
  $ok = (Test-NetConnection $Ip -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded
  Write-Host ("  {0,-4} {1}" -f $port, $(if ($ok) { "open" } else { "CLOSED / no answer" }))
}

Write-Host "`n== Server (over SSH)" -ForegroundColor Yellow
$script = @'
echo "--- cloud-init"; cloud-init status --long 2>/dev/null
echo "--- setup log (last 40 lines)"; sudo tail -n 40 /var/log/cloud-init-output.log
echo "--- setup errors"; sudo grep -nE "WARNING|ERROR|Failed|failed|E: " /var/log/cloud-init.log /var/log/cloud-init-output.log | tail -n 20
echo "--- services"; systemctl is-active edopro-proxy caddy
echo "--- listening"; sudo ss -ltnp | grep -E ':(80|443|7000) ' || echo "nothing on 80/443/7000"
echo "--- firewall (INPUT)"; sudo iptables -L INPUT -n --line-numbers | head -12
echo "--- proxy health (local)"; curl -sS -m 5 http://127.0.0.1:7000/healthz 2>&1; echo
echo "--- caddy log"; sudo journalctl -u caddy --no-pager -n 15 2>&1
# end (PowerShell appends a CR to the last line; keep this comment last)
'@
# Sent on stdin: passing it as an argument lets PowerShell mangle the quotes.
$script = $script -replace "`r", ""
$script | ssh -o StrictHostKeyChecking=accept-new "$User@$Ip" "bash -s"
