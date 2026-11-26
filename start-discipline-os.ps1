param(
    [ValidateRange(1, 65535)]
    [int]$Port,
    [switch]$Dev,
    [switch]$Rebuild,
    [switch]$Tailscale
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path node_modules)) {
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($Dev) {
    if ($Tailscale) { throw 'Use production mode for authenticated phone access.' }
    Write-Host 'Trading Discipline OS (DEV HMR) -> http://127.0.0.1:5173 (API proxy -> 4174)'
    Start-Process 'http://127.0.0.1:5173'
    npm run dev
    exit $LASTEXITCODE
}

$clientOut = 'dist/client/index.html'
$serverOut = 'dist/server/server/index.js'
$needsBuild = $Rebuild -or (-not (Test-Path $clientOut)) -or (-not (Test-Path $serverOut))
if (-not $needsBuild) {
    $oldestOut = @((Get-Item $clientOut).LastWriteTimeUtc, (Get-Item $serverOut).LastWriteTimeUtc) | Sort-Object | Select-Object -First 1
    $newerSrc = Get-ChildItem -Path client/src, server, shared -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -gt $oldestOut } |
        Select-Object -First 1
    if ($newerSrc) {
        Write-Host "Detected source changes ($($newerSrc.Name)); rebuilding..."
        $needsBuild = $true
    }
}
if ($needsBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$bindHost = '127.0.0.1'
$mobileHost = $null
if ($Tailscale) {
    $tsStatus = & tailscale status --json | ConvertFrom-Json
    $mobileHost = ([string]$tsStatus.Self.DNSName).TrimEnd('.').ToLowerInvariant()
    if ($tsStatus.BackendState -ne 'Running' -or $mobileHost -notmatch '^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$') {
        throw 'A connected Tailscale device with a MagicDNS hostname is required.'
    }
}

function Test-LocalPortAvailable([int]$Candidate) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($bindHost), $Candidate)
    $listener.ExclusiveAddressUse = $true
    try {
        $listener.Start()
        return $true
    } catch [System.Net.Sockets.SocketException] {
        if ($_.Exception.SocketErrorCode -notin 'AddressAlreadyInUse', 'AccessDenied') { throw }
        return $false
    } finally {
        $listener.Stop()
    }
}

if (-not $PSBoundParameters.ContainsKey('Port') -and $env:PORT) {
    if (-not [int]::TryParse($env:PORT, [ref]$Port) -or $Port -lt 1 -or $Port -gt 65535) {
        throw 'PORT must be a number from 1 to 65535.'
    }
}
if ($Port) {
    if (-not (Test-LocalPortAvailable $Port)) {
        throw "Port $Port on $bindHost is unavailable. Run .\start-discipline-os.ps1 -Port 4199 to choose another port."
    }
} else {
    $Port = 4173..4199 | Where-Object { Test-LocalPortAvailable $_ } | Select-Object -First 1
    if (-not $Port) { throw 'No available port from 4173 to 4199. Specify another port with -Port.' }
    if ($Port -ne 4173) { Write-Host "Port 4173 is unavailable. Using port $Port." }
}

$previousPort = $env:PORT
$previousMobileHost = $env:TDOS_MOBILE_HOST
$previousMobilePassword = $env:TDOS_MOBILE_PASSWORD
try {
    $env:PORT = [string]$Port
    $url = "http://${bindHost}:${Port}"
    Write-Host "Trading Discipline OS -> $url"
    if ($Tailscale) {
        $bytes = New-Object byte[] 24
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $env:TDOS_MOBILE_HOST = $mobileHost
        $env:TDOS_MOBILE_PASSWORD = [Convert]::ToBase64String($bytes)
        Write-Host "In a separate Administrator terminal, run: tailscale serve $url"
        Write-Host "Phone URL: https://${mobileHost}"
        Write-Host 'Login: journal'
        Write-Host "Password for this session: $env:TDOS_MOBILE_PASSWORD"
    }
    Start-Process $url
    npm start
    $exitCode = $LASTEXITCODE
} finally {
    $env:PORT = $previousPort
    $env:TDOS_MOBILE_HOST = $previousMobileHost
    $env:TDOS_MOBILE_PASSWORD = $previousMobilePassword
}
exit $exitCode
