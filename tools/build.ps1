# Builds the Dumper and Extractor tools.
# The C# compiler cannot open paths over 260 characters, so sources are mirrored to a
# short build folder and the finished binaries copied back into tools\<name>\bin\out.
param([string[]]$Projects = @('Dumper', 'Extractor'))
$ErrorActionPreference = 'Stop'
$tools = $PSScriptRoot
$build = Join-Path $env:LOCALAPPDATA 'dwal'
$dotnet = Join-Path $build 'dotnet\dotnet.exe'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'; $env:DOTNET_NOLOGO = '1'

if (-not (Test-Path $dotnet)) {
    New-Item -ItemType Directory -Force (Split-Path $dotnet) | Out-Null
    Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile "$build\dotnet-install.ps1"
    & "$build\dotnet-install.ps1" -Channel 10.0 -InstallDir (Split-Path $dotnet) -NoPath
}

robocopy "$tools\ext\c4p" "$build\src\ext\c4p" /MIR /XD bin obj .git /NFL /NDL /NJH /NJS /NP | Out-Null
foreach ($p in $Projects) {
    robocopy "$tools\$p" "$build\src\$p" /MIR /XD bin obj out /NFL /NDL /NJH /NJS /NP | Out-Null
    # The Dumper ships to players as one self-contained exe (see its project file); the Extractor runs only here.
    $verb = if ($p -eq 'Dumper') { 'publish' } else { 'build' }
    # Files of an earlier kind of build must not be copied back with the new ones.
    Remove-Item -Recurse -Force "$build\out\$p" -ErrorAction SilentlyContinue
    & $dotnet $verb "$build\src\$p" -c Release -o "$build\out\$p" --disable-build-servers -v q -p:NuGetAudit=false
    if ($LASTEXITCODE -ne 0) { throw "$p build failed" }
    robocopy "$build\out\$p" "$tools\$p\bin\out" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    Write-Host "$p -> $tools\$p\bin\out"
}
