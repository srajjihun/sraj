# HWP -> HWPX converter via Hancom Office (Hangul) COM automation.
#
# ASCII ONLY. Do not put Korean text in this file.
#   Windows PowerShell 5.1 reads .ps1 as the system ANSI code page (CP949 on
#   Korean Windows) unless the file has a UTF-8 BOM. This repo stores files as
#   UTF-8 without BOM, so Korean text here turned into mojibake and broke the
#   single-quoted strings, producing "The string is missing the terminator".
#   Keeping this file ASCII removes the whole problem. All Korean messages the
#   user sees are printed by the .bat wrapper, which maps the exit codes below.
#
# Why HWPX (not PDF):
#   HWPX is ZIP+XML, so our own parser can rebuild table structure (the scoring
#   table is what we need). PDF loses the table grid.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File hancom.ps1 -In a.hwp -Out a.hwpx
#   powershell ... -File hancom.ps1 -Register    # one-time: silence security popup
#   powershell ... -File hancom.ps1 -Check       # is the security module registered?
#
# Exit codes: 0 ok / 2 Hangul not available / 3 conversion failed / 4 module missing

param(
  [string]$In,
  [string]$Out,
  [switch]$Register,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

# Hangul shows a security prompt when an external program opens a file.
# Nobody is there to click it during automation, so it would hang forever.
# Registering FilePathCheckerModule suppresses that prompt.
$ModuleKeys = @(
  'HKCU:\Software\HNC\HwpAutomation\Modules',
  'HKCU:\Software\Hnc\HwpAutomation\Modules',
  'HKCU:\Software\HNC\HwpUserAction\Modules'
)

function Test-SecurityModule {
  foreach ($k in $ModuleKeys) {
    if (Test-Path $k) {
      $p = (Get-ItemProperty -Path $k -ErrorAction SilentlyContinue).FilePathCheckerModule
      if ($p -and (Test-Path $p)) { return $true }
    }
  }
  return $false
}

if ($Check) {
  if (Test-SecurityModule) { Write-Host 'OK: security module registered'; exit 0 }
  Write-Host 'MISSING: security module not registered'
  exit 4
}

if ($Register) {
  # The example DLL ships with Hangul. Search the usual install locations.
  $candidates = @(
    "$env:ProgramFiles\Hnc\Office*\HOffice*\Bin\FilePathCheckerModuleExample.dll",
    "${env:ProgramFiles(x86)}\Hnc\Office*\HOffice*\Bin\FilePathCheckerModuleExample.dll",
    "$env:ProgramFiles\Hnc\*\*\FilePathCheckerModuleExample.dll",
    "${env:ProgramFiles(x86)}\Hnc\*\*\FilePathCheckerModuleExample.dll",
    "$env:ProgramFiles\Hnc\*\*\*\FilePathCheckerModuleExample.dll",
    "${env:ProgramFiles(x86)}\Hnc\*\*\*\FilePathCheckerModuleExample.dll"
  )
  $dll = $null
  foreach ($c in $candidates) {
    $f = Get-ChildItem -Path $c -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { $dll = $f.FullName; break }
  }
  if (-not $dll) {
    Write-Host 'DLL_NOT_FOUND: FilePathCheckerModuleExample.dll'
    Write-Host 'Searched under Program Files\Hnc and Program Files (x86)\Hnc'
    exit 2
  }
  $key = $ModuleKeys[0]
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -Path $key -Name 'FilePathCheckerModule' -Value $dll -PropertyType String -Force | Out-Null
  Write-Host "REGISTERED: $dll"
  exit 0
}

if (-not $In -or -not $Out) { Write-Host 'ARGS_MISSING: need -In and -Out'; exit 3 }
if (-not (Test-Path -LiteralPath $In)) { Write-Host "INPUT_NOT_FOUND: $In"; exit 3 }

$src = (Resolve-Path -LiteralPath $In).Path
$dstDir = Split-Path -Parent $Out
if ($dstDir -and -not (Test-Path -LiteralPath $dstDir)) {
  New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
}
$dst = [System.IO.Path]::GetFullPath($Out)

$hwp = $null
try {
  $hwp = New-Object -ComObject HWPFrame.HwpObject
} catch {
  Write-Host 'HANGUL_UNAVAILABLE: cannot create HWPFrame.HwpObject'
  exit 2
}

try {
  # With the module registered this passes silently. Without it, Open() below
  # may block on a popup, which is why -Register is worth running first.
  try { $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule') | Out-Null } catch {}

  $null = $hwp.Open($src, '', '')
  # SaveAs format name differs between Hangul versions, so try in order.
  $saved = $false
  foreach ($fmt in @('HWPX', 'HWPML2X', 'HWP')) {
    try {
      $null = $hwp.SaveAs($dst, $fmt, '')
      if (Test-Path -LiteralPath $dst) { $saved = $true; break }
    } catch { }
  }
  if (-not $saved) { Write-Host 'SAVE_FAILED'; exit 3 }
  Write-Host "OK: $dst"
  exit 0
} catch {
  Write-Host "CONVERT_ERROR: $($_.Exception.Message)"
  exit 3
} finally {
  if ($hwp) {
    try { $hwp.Clear(1) | Out-Null } catch {}
    try { $hwp.Quit() | Out-Null } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($hwp) | Out-Null } catch {}
  }
}
