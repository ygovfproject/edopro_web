# Quick update of the proxy code on the server, without Terraform. Normally use
# `terraform apply` instead: it also updates the config, the systemd service and the
# accounts maintenance timer (see main.tf, "proxy_deploy").
# Usage:  .\update-proxy.ps1 -Ip 1.2.3.4
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [string]$User = "ubuntu"
)
$ErrorActionPreference = "Stop"
$proxy = Join-Path $PSScriptRoot "..\..\proxy"
$target = "$User@$Ip"

$files = Get-ChildItem "$proxy\src\*.mjs" | ForEach-Object { $_.FullName }
scp @files "${target}:/tmp/"
$names = (Get-ChildItem "$proxy\src\*.mjs" | ForEach-Object { "/tmp/" + $_.Name }) -join " "
ssh $target "sudo install -o edoproxy -g edoproxy -m 0644 $names /opt/edopro-proxy/src/ && sudo systemctl restart edopro-proxy && systemctl --no-pager status edopro-proxy | head -5"
Write-Host "Proxy updated on $Ip"
