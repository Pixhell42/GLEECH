param(
    [Parameter(Mandatory = $true)][string]$Context,
    [int]$ExistingBaseProcessId = 0
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$buildDir = [IO.Path]::GetFullPath($Context)
$allowed = @('test-results', 'public-release') | ForEach-Object {
    [IO.Path]::GetFullPath((Join-Path $repo $_)) + [IO.Path]::DirectorySeparatorChar
}
if (-not ($allowed | Where-Object { $buildDir.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) {
    throw 'Build context must be an isolated directory under test-results or public-release.'
}
$inputs = Get-Content -LiteralPath (Join-Path $buildDir 'build-inputs.json') -Raw | ConvertFrom-Json
if ($inputs.target -ne 'x86_64-w64-mingw32.static' -or $inputs.componentArchives.Count -ne 28) {
    throw 'Unexpected build inputs; review before running.'
}
$docker = (Get-Command docker.exe -ErrorAction Stop).Source
$statePath = Join-Path $buildDir 'result.json'
if (Test-Path -LiteralPath $statePath) {
    $previousRun = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($previousRun.status -eq 'running' -and $previousRun.controllerPid -and
        (Get-Process -Id $previousRun.controllerPid -ErrorAction SilentlyContinue)) {
        throw 'This context already has an active rebuild controller.'
    }
}
# Hold an OS-level exclusive lease for the whole run. Another launch must fail
# before writing shared status/logs or invoking Docker; the OS releases it on exit.
$lease = [IO.File]::Open((Join-Path $buildDir 'controller.lock'), [IO.FileMode]::OpenOrCreate,
    [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$result = [ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    status = 'running'
    phase = 'base-toolchain'
    controllerPid = $PID
    independentSourceRebuild = $false
    inputsSHA256 = (Get-FileHash -LiteralPath (Join-Path $buildDir 'build-inputs.json') -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Write-State {
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $buildDir 'result.json') -Encoding utf8
}
function Run-Step([string]$phase, [scriptblock]$operation) {
    $result.phase = $phase
    Write-State
    & $operation *> (Join-Path $buildDir ($phase + '.log'))
    if ($LASTEXITCODE -ne 0) { throw "$phase failed with exit code $LASTEXITCODE" }
}

Set-Location -LiteralPath $repo
Write-State
try {
    if ($ExistingBaseProcessId) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ExistingBaseProcessId"
        if (-not $process -or $process.Name -ne 'docker.exe' -or $process.CommandLine -notlike '*-t gleech-native-base:review*') {
            throw 'The supplied process is not the expected isolated Docker base build.'
        }
        $deadline = (Get-Date).AddHours(6)
        while (Get-Process -Id $ExistingBaseProcessId -ErrorAction SilentlyContinue) {
            if ((Get-Date) -gt $deadline) { throw 'Base build wait exceeded six hours; inspect its log.' }
            Start-Sleep -Seconds 10
        }
    } else {
        Run-Step 'base-toolchain' {
            & $docker build --progress=plain -t gleech-native-base:review -f (Join-Path $buildDir 'base.Dockerfile') $buildDir
        }
    }
    $image = & $docker image inspect gleech-native-base:review --format '{{.Id}}'
    if ($LASTEXITCODE -ne 0) { throw 'The base build did not produce its image.' }
    $result.baseImage = $image
    Run-Step 'native-libraries' {
        & $docker build --progress=plain -t gleech-native:review -f (Join-Path $buildDir 'native.Dockerfile') $buildDir
    }
    $result.nativeImage = & $docker image inspect gleech-native:review --format '{{.Id}}'
    $packaging = Join-Path $buildDir 'packaging-output'
    if (Test-Path -LiteralPath $packaging) { throw 'Packaging output already exists; use a new context.' }
    Copy-Item -LiteralPath (Join-Path $buildDir 'upstream\packaging') -Destination $packaging -Recurse
    Run-Step 'package-native' {
        & $docker run --rm --network=none --mount "type=bind,source=$packaging,target=/data/packaging" `
            -e PKGS=vips-web -e MXE_TARGETS=x86_64-w64-mingw32.static -e FFI_COMPAT=false `
            -e JPEG_IMPL=mozjpeg -e HEVC=false -e DEBUG=false -e ZLIB_NG=true gleech-native:review
    }
    $zip = Join-Path $packaging 'vips-dev-x64-web-8.18.7-static.zip'
    $sdk = Join-Path $buildDir 'rebuilt-sdk'
    Expand-Archive -LiteralPath $zip -DestinationPath $sdk
    $dlls = @(Get-ChildItem -LiteralPath $sdk -Recurse -File -Filter libvips-42.dll)
    if ($dlls.Count -ne 1) { throw 'Expected exactly one rebuilt libvips DLL.' }
    $result.sdkSHA256 = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    $result.rebuiltDLLSHA256 = (Get-FileHash -LiteralPath $dlls[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $app = Join-Path $buildDir 'replacement-app'
    if (Test-Path -LiteralPath $app) { throw 'Replacement app already exists; use a new context.' }
    Copy-Item -LiteralPath (Join-Path $repo 'apps\desktop\release\win-unpacked') -Destination $app -Recurse
    $library = Join-Path $app 'resources\app.asar.unpacked\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll'
    $result.originalDLLSHA256 = (Get-FileHash -LiteralPath $library -Algorithm SHA256).Hash.ToLowerInvariant()
    Copy-Item -LiteralPath $dlls[0].FullName -Destination $library -Force
    $exe = Join-Path $app 'GLEECH.exe'
    Run-Step 'rebuilt-startup' { & node tooling/smoke.mjs $exe }
    Run-Step 'rebuilt-image' { & node tooling/image-check.mjs $exe --cpu }
    Run-Step 'rebuilt-exports' { & node tooling/file-metadata-check.mjs $exe --cpu }
    $result.independentSourceRebuild = $true
    $result.status = 'passed'
    $result.phase = 'complete'
} catch {
    $result.status = 'failed'
    $result.error = $_.Exception.Message
} finally {
    $result.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    Write-State
    $lease.Dispose()
}
if ($result.status -ne 'passed') { exit 1 }
