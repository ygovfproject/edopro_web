# Uploads the current proxy code (and optionally config) to the server and restarts it.
# Usage:  .\update-proxy.ps1 -Ip 1.2.3.4
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$User = "ubuntu"
)
$ErrorActionPreference = "Stop"
$proxy = Join-Path $PSScriptRoot "..\..\proxy"
$target = "$User@$Ip"

scp "$proxy\src\server.mjs" "$proxy\src\websocket.mjs" "${target}:/tmp/"
ssh $target "sudo install -o edoproxy -g edoproxy -m 0644 /tmp/server.mjs /tmp/websocket.mjs /opt/edopro-proxy/src/ && sudo systemctl restart edopro-proxy && systemctl --no-pager status edopro-proxy | head -5"
Write-Host "Proxy updated on $Ip"
