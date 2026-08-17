# HWP -> HWPX 변환 (한글 자동화)
#
# 왜 HWPX 로 저장하는가:
#   HWP(구형 이진 형식)는 직접 읽기 어렵습니다. 반면 HWPX 는 ZIP+XML 이라
#   우리 코드로 표 구조까지 그대로 복원할 수 있습니다.
#   PDF 로 저장하면 표가 좌표만 남아 다시 표로 만들기 어렵습니다.
#
# 사용법:
#   powershell -NoProfile -ExecutionPolicy Bypass -File hancom.ps1 -In "a.hwp" -Out "a.hwpx"
#   powershell ... -File hancom.ps1 -Register     ← 보안 팝업 끄기(최초 1회)
#
# 종료코드: 0 성공 / 2 한글 없음 / 3 변환 실패 / 4 보안모듈 미등록으로 멈춤

param(
  [string]$In,
  [string]$Out,
  [switch]$Register,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

# 한글은 외부에서 파일을 열려고 하면 보안 팝업을 띄웁니다.
# 자동으로 돌 때는 아무도 눌러주지 않아 그대로 멈춥니다.
# 아래 레지스트리 값이 있으면 팝업 없이 진행합니다.
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
  # 한글 설치 폴더에 함께 오는 예제 DLL 을 찾아 등록합니다.
  $candidates = @(
    "$env:ProgramFiles\Hnc\Office*\HOffice*\Bin\FilePathCheckerModuleExample.dll",
    "${env:ProgramFiles(x86)}\Hnc\Office*\HOffice*\Bin\FilePathCheckerModuleExample.dll",
    "$env:ProgramFiles\Hnc\*\*\FilePathCheckerModuleExample.dll",
    "${env:ProgramFiles(x86)}\Hnc\*\*\FilePathCheckerModuleExample.dll"
  )
  $dll = $null
  foreach ($c in $candidates) {
    $f = Get-ChildItem -Path $c -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { $dll = $f.FullName; break }
  }
  if (-not $dll) {
    Write-Host 'FilePathCheckerModuleExample.dll 을 찾지 못했습니다.'
    Write-Host '한글 설치 폴더(보통 C:\Program Files (x86)\Hnc\...)에서 찾아'
    Write-Host '아래 레지스트리에 FilePathCheckerModule 값으로 넣어 주세요:'
    Write-Host '  HKCU\Software\HNC\HwpAutomation\Modules'
    exit 2
  }
  $key = $ModuleKeys[0]
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -Path $key -Name 'FilePathCheckerModule' -Value $dll -PropertyType String -Force | Out-Null
  Write-Host "등록했습니다: $dll"
  exit 0
}

if (-not $In -or -not $Out) { Write-Host 'In / Out 이 필요합니다'; exit 3 }
if (-not (Test-Path -LiteralPath $In)) { Write-Host "입력 파일이 없습니다: $In"; exit 3 }

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
  Write-Host '한글(HWP)이 설치되어 있지 않거나 자동화를 쓸 수 없습니다.'
  exit 2
}

try {
  # 보안 모듈이 등록돼 있으면 팝업 없이 진행됩니다. 없으면 이 호출이 실패할 수 있는데,
  # 그때는 파일을 여는 순간 팝업이 떠서 멈추므로 미리 알려 주는 편이 낫습니다.
  try { $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule') | Out-Null } catch {}

  $null = $hwp.Open($src, '', '')
  # HWPX = 한글 표준 서식. SaveAs 의 형식 이름이 버전에 따라 다를 수 있어 차례로 시도합니다.
  $saved = $false
  foreach ($fmt in @('HWPX', 'HWPML2X', 'HWP')) {
    try {
      $null = $hwp.SaveAs($dst, $fmt, '')
      if (Test-Path -LiteralPath $dst) { $saved = $true; break }
    } catch { }
  }
  if (-not $saved) { Write-Host '변환에 실패했습니다.'; exit 3 }
  Write-Host "OK: $dst"
  exit 0
} catch {
  Write-Host "변환 중 오류: $($_.Exception.Message)"
  exit 3
} finally {
  if ($hwp) {
    try { $hwp.Clear(1) | Out-Null } catch {}
    try { $hwp.Quit() | Out-Null } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($hwp) | Out-Null } catch {}
  }
}
