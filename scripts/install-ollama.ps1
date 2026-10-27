# scripts/install-ollama.ps1
# Automated Windows Ollama Installer and Service Starter for Prism
[CmdletBinding()]
param(
    [switch]$StartOnly
)

$ErrorActionPreference = "Stop"
$OllamaHost = "http://localhost:11434"

function Write-Status($msg, $type="INFO") {
    $colors = @{ "INFO"="Cyan"; "OK"="Green"; "WARN"="Yellow"; "ERR"="Red" }
    $c = "White"
    if ($colors.ContainsKey($type)) { $c = $colors[$type] }
    Write-Host "[$type] $msg" -ForegroundColor $c
}

# 1. Health check function
function Test-OllamaService {
    try {
        $res = Invoke-RestMethod -Uri "$OllamaHost/api/tags" -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

Write-Status "Verifying Ollama local status..." "INFO"

if (Test-OllamaService) {
    Write-Status "Ollama service is already active and healthy on port 11434." "OK"
    exit 0
}

# 2. Check if Ollama executable exists on disk
$OllamaExe = Get-Command "ollama" -ErrorAction SilentlyContinue

if (-not $OllamaExe) {
    $CommonPaths = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe"
    )
    foreach ($p in $CommonPaths) {
        if (Test-Path $p) {
            $OllamaExe = $p
            break
        }
    }
}

# 3. Install if missing and not in -StartOnly mode
if (-not $OllamaExe -and -not $StartOnly) {
    Write-Status "Ollama is not installed. Commencing automatic installation..." "WARN"
    
    # Try winget first if available
    $Winget = Get-Command "winget" -ErrorAction SilentlyContinue
    $Installed = $false
    if ($Winget) {
        Write-Status "Attempting installation via Windows Package Manager (winget)..." "INFO"
        try {
            & winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements --silent
            if ($LASTEXITCODE -eq 0) {
                $Installed = $true
                Write-Status "Winget installation completed successfully." "OK"
            }
        } catch {
            Write-Status "Winget install encountered an issue, falling back to direct installer..." "WARN"
        }
    }

    # Fallback to direct download
    if (-not $Installed) {
        $InstallerUrl = "https://ollama.com/download/OllamaSetup.exe"
        $TempInstaller = Join-Path $env:TEMP "OllamaSetup.exe"
        Write-Status "Downloading official Ollama setup package from $InstallerUrl..." "INFO"
        Invoke-WebRequest -Uri $InstallerUrl -OutFile $TempInstaller -UseBasicParsing
        
        Write-Status "Running Ollama installer silently..." "INFO"
        $process = Start-Process -FilePath $TempInstaller -ArgumentList "/silent" -Wait -PassThru
        if ($process.ExitCode -eq 0) {
            Write-Status "Ollama installer finished successfully." "OK"
        } else {
            Write-Status "Installer exited with code: $($process.ExitCode)" "WARN"
        }
    }

    # Re-check path
    $CommonPaths = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe"
    )
    foreach ($p in $CommonPaths) {
        if (Test-Path $p) {
            $OllamaExe = $p
            break
        }
    }
}

# 4. Start background service if installed
Write-Status "Starting Ollama background instance (`"ollama serve`")..." "INFO"
if ($OllamaExe) {
    Start-Process -FilePath "$OllamaExe" -ArgumentList "serve" -WindowStyle Hidden
} else {
    try {
        Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    } catch {
        Write-Status "Could not spawn 'ollama serve'. Please verify installation." "ERR"
        exit 1
    }
}

# 5. Poll for readiness
Write-Status "Waiting for Ollama API to initialize on localhost:11434..." "INFO"
$retries = 15
while ($retries -gt 0) {
    Start-Sleep -Seconds 1
    if (Test-OllamaService) {
        Write-Status "Ollama is now ONLINE and ready for inference!" "OK"
        exit 0
    }
    $retries--
}

Write-Status "Timeout waiting for Ollama to become available." "ERR"
exit 1
