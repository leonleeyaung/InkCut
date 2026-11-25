param([string]$ArchivePath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$runtime = Join-Path $PSScriptRoot 'runtime'
if (Test-Path -LiteralPath (Join-Path $runtime 'electron.exe')) { return }
$archive = 'electron-v45.3.2-win32-x64.zip'
$expected = 'cd1ab0d49c2f76838c0c9ff75afefb4d9d85ca59036691932bf35be8eceba98b'
$tempDir = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ('inkcut-runtime-' + [guid]::NewGuid()))
$zip = Join-Path $tempDir.FullName $archive
$unpack = Join-Path $tempDir.FullName 'runtime'
if (!$ArchivePath -and $env:LOCALAPPDATA) {
  $ArchivePath = (Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "electron/Cache/*/$archive") -File -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if ($ArchivePath) { Copy-Item -LiteralPath $ArchivePath -Destination $zip } else {
Write-Host 'Downloading Electron 45.3.2 for Windows x64 from GitHub...'
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/electron/electron/releases/download/v45.3.2/$archive" -OutFile $zip
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash -ne $expected) { throw 'Electron SHA256 mismatch. Archive will not be used.' }
Expand-Archive -LiteralPath $zip -DestinationPath $unpack
if (Test-Path -LiteralPath $runtime) { throw 'runtime already exists. Check its contents before retrying.' }
if ([IO.Path]::GetFullPath($runtime) -ne [IO.Path]::Combine($PSScriptRoot,'runtime') -or (Resolve-Path -LiteralPath $unpack).Path -ne [IO.Path]::Combine($tempDir.FullName,'runtime')) { throw 'Unexpected runtime path' }
Move-Item -LiteralPath $unpack -Destination $runtime
Remove-Item -LiteralPath $zip
Remove-Item -LiteralPath $tempDir.FullName
Write-Host 'Runtime ready.'
