[CmdletBinding()]
param(
    [string]$VideoId,
    [string]$StartSeconds,
    [string]$DurationSeconds,
    [string]$OutputDir,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

function Stop-ClipVideo([string]$Message) {
    [Console]::Error.WriteLine($Message)
    exit 1
}

function ConvertTo-InvariantFinite([string]$Value, [string]$Name, [bool]$Positive) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        Stop-ClipVideo "$Name is required."
    }
    [double]$number = 0
    $ok = [double]::TryParse(
        $Value,
        [Globalization.NumberStyles]::Float,
        [Globalization.CultureInfo]::InvariantCulture,
        [ref]$number
    )
    if (-not $ok -or [double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -lt 0 -or ($Positive -and $number -le 0)) {
        Stop-ClipVideo "$Name must be a finite $(if ($Positive) { 'positive' } else { 'nonnegative' }) number."
    }
    return $number.ToString('R', [Globalization.CultureInfo]::InvariantCulture)
}

if ($Help) {
    Write-Output 'Usage: & .\integrations\pexels_mcp\clip_video.ps1 -VideoId ID -StartSeconds SECONDS -DurationSeconds SECONDS -OutputDir ABSOLUTE_NEW_DIRECTORY'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($VideoId) -or [string]::IsNullOrWhiteSpace($StartSeconds) -or [string]::IsNullOrWhiteSpace($DurationSeconds) -or [string]::IsNullOrWhiteSpace($OutputDir)) {
    Stop-ClipVideo 'VideoId, StartSeconds, DurationSeconds, and OutputDir are required; no interactive parameter prompts are used.'
}
if ($VideoId -notmatch '^[1-9][0-9]*$') {
    Stop-ClipVideo 'VideoId must be a positive integer.'
}

$invariantStart = ConvertTo-InvariantFinite $StartSeconds 'StartSeconds' $false
$invariantDuration = ConvertTo-InvariantFinite $DurationSeconds 'DurationSeconds' $true

# Test-Path checks only whether a variable exists. It never retrieves its value.
if (Test-Path Env:PEXELS_API_KEY) {
    Stop-ClipVideo 'PEXELS_API_KEY already exists in this process. Refusing to replace or read it.'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$nodeScript = Join-Path $scriptDir 'clip_video.mjs'
try {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
} catch {
    Stop-ClipVideo 'Node.js was not found.'
}

# This is offline and intentionally happens before the hidden key prompt or MCP/native lookup.
& $node $nodeScript --video-id $VideoId --start-seconds $invariantStart --duration-seconds $invariantDuration --output-dir $OutputDir --blocked-root $projectRoot --check-only
if ($LASTEXITCODE -ne 0) {
    Stop-ClipVideo 'Offline preflight failed.'
}

$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
$mcpScript = Join-Path $scriptDir 'node_modules\@hanoak\pexels-mcp-server\dist\index.js'
if (-not (Test-Path -LiteralPath $venvPython) -or -not (Test-Path -LiteralPath $mcpScript)) {
    Stop-ClipVideo 'The installed .venv or Pexels MCP JavaScript entry was not found.'
}
try {
    $curl = (Get-Command curl.exe -ErrorAction Stop).Source
} catch {
    Stop-ClipVideo 'curl.exe must be available on PATH.'
}
$ffmpegResult = @(& $venvPython -B -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())' 2>&1)
if ($LASTEXITCODE -ne 0) {
    Stop-ClipVideo 'Unable to locate the existing imageio-ffmpeg executable.'
}
$ffmpegText = [string]::Join("`n", [string[]]$ffmpegResult)
if ($ffmpegText.Length -eq 0 -or $ffmpegText.Length -gt 4096) {
    Stop-ClipVideo 'The imageio-ffmpeg lookup returned unsafe output.'
}
$ffmpeg = $ffmpegText.Trim()
if (-not (Test-Path -LiteralPath $ffmpeg)) {
    Stop-ClipVideo 'The imageio-ffmpeg executable path is unavailable.'
}

$secureKey = Read-Host -Prompt 'Pexels API key' -AsSecureString
$keyPointer = [IntPtr]::Zero
try {
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    if ([string]::IsNullOrWhiteSpace($plainKey)) {
        Stop-ClipVideo 'A nonempty Pexels API key is required.'
    }
    $env:PEXELS_API_KEY = $plainKey
    & $node $nodeScript --video-id $VideoId --start-seconds $invariantStart --duration-seconds $invariantDuration --output-dir $OutputDir --blocked-root $projectRoot --curl-path $curl --ffmpeg-path $ffmpeg --mcp-command $node --mcp-script $mcpScript
    if ($LASTEXITCODE -ne 0) {
        Stop-ClipVideo 'Clip pipeline failed.'
    }
} finally {
    if ($keyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    Remove-Item Env:PEXELS_API_KEY -ErrorAction SilentlyContinue
    Remove-Variable plainKey -ErrorAction SilentlyContinue
    Remove-Variable secureKey -ErrorAction SilentlyContinue
}
