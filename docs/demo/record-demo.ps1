<#
  record-demo.ps1 — record the NeoLeadge workflow and auto-speed it to ~1 min.

  Captures real mouse movement (gdigrab -draw_mouse 1), then time-lapses the
  footage down to a target length (default 60s) into a clean H.264 MP4.

  Requires: ffmpeg + ffprobe on PATH (you have ffmpeg 8.x).

  USAGE (run in a normal PowerShell window — NOT inside the agent):

    # Record the whole screen, then compress to ~60s:
    .\record-demo.ps1

    # Record only the browser window (recommended — cleaner framing):
    .\record-demo.ps1 -WindowTitle "Rapido - Google Chrome"

    # Target a different final length / input framerate:
    .\record-demo.ps1 -TargetSeconds 60 -Framerate 30

  HOW IT WORKS
    1. Press ENTER to START recording.
    2. Do the workflow in the browser (login as PM -> questionnaire -> meeting
       -> cahier -> backlog -> board). Take your time; speed-up handles pacing.
    3. Switch back to this window and press  q  to STOP recording.
    4. The script measures the raw clip and time-lapses it to ~TargetSeconds.

  OUTPUT (in .\out\):
    raw-<timestamp>.mkv         the full-speed capture (kept, in case you re-cut)
    demo-1min-<timestamp>.mp4   the sped-up ~60s video to use
#>

[CmdletBinding()]
param(
  [int]$TargetSeconds = 60,
  [int]$Framerate     = 30,
  [int]$OutputFps     = 30,
  [int]$Crf           = 20,
  # Record a single window by its EXACT title bar text (gdigrab title=...).
  # Leave empty to record the whole desktop.
  [string]$WindowTitle = "",
  [string]$OutDir = (Join-Path $PSScriptRoot "out")
)

$ErrorActionPreference = "Stop"

function Require-Tool($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name not found on PATH. Install ffmpeg (it bundles ffprobe) and retry."
  }
}
Require-Tool ffmpeg
Require-Tool ffprobe

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$raw   = Join-Path $OutDir "raw-$stamp.mkv"
$final = Join-Path $OutDir "demo-1min-$stamp.mp4"

# Build the gdigrab input (whole desktop, or a named window).
if ([string]::IsNullOrWhiteSpace($WindowTitle)) {
  $inputSpec = @("-f","gdigrab","-framerate","$Framerate","-draw_mouse","1","-i","desktop")
  $what = "the entire desktop"
} else {
  $inputSpec = @("-f","gdigrab","-framerate","$Framerate","-draw_mouse","1","-i","title=$WindowTitle")
  $what = "window titled `"$WindowTitle`""
}

Write-Host ""
Write-Host "=== NeoLeadge demo recorder ===" -ForegroundColor Cyan
Write-Host "Will record $what at $Framerate fps, then time-lapse to ~$TargetSeconds s." -ForegroundColor Gray
Write-Host ""
Read-Host "Press ENTER to START recording (then do the workflow in the browser)"

Write-Host ""
Write-Host ">> RECORDING. Switch to the browser and run the workflow." -ForegroundColor Green
Write-Host ">> When finished, come back here and press  q  to STOP." -ForegroundColor Yellow
Write-Host ""

# -y overwrite; even-dimension scale guard is applied at the speed-up stage.
& ffmpeg -y @inputSpec -c:v libx264 -preset ultrafast -qp 0 -pix_fmt yuv420p $raw

if (-not (Test-Path $raw)) { throw "Recording produced no file. Did you stop with 'q'?" }

# Measure the raw clip length.
$dur = [double](& ffprobe -v error -show_entries format=duration -of csv=p=0 $raw)
if (-not $dur -or $dur -le 0) { throw "Could not read duration of $raw" }

# Speed factor so the result lands near TargetSeconds. Never slow down (>=1).
$speed = [math]::Max(1.0, $dur / $TargetSeconds)
$pts   = [math]::Round(1.0 / $speed, 6)   # setpts multiplier = 1/speed
$finalLen = [math]::Round($dur / $speed, 1)

Write-Host ""
Write-Host ("Raw length: {0:N1}s  ->  speed x{1:N2}  ->  final ~{2:N1}s" -f $dur,$speed,$finalLen) -ForegroundColor Cyan

# Time-lapse: drop frames (setpts), re-target fps, scale to even dims, no audio.
$vf = "setpts=$pts*PTS,fps=$OutputFps,scale=trunc(iw/2)*2:trunc(ih/2)*2"
& ffmpeg -y -i $raw -an -vf $vf -c:v libx264 -preset medium -crf $Crf -pix_fmt yuv420p -movflags +faststart $final

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Raw  : $raw"
Write-Host "  Final: $final  (~$finalLen s)" -ForegroundColor Green
Write-Host ""
Write-Host "Tip: re-run with -TargetSeconds 45 for a punchier cut, or -WindowTitle to crop to the browser." -ForegroundColor Gray
