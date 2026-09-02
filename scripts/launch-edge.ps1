param(
    [int]$Port = 9229
)

$browserRoot = Split-Path -Parent $PSScriptRoot
$edgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$profilePath = Join-Path $browserRoot ('.qa\edge-profile-{0}' -f $Port)

if (-not (Test-Path -LiteralPath $edgePath)) {
    throw "Edge executable not found: $edgePath"
}
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
Start-Process -FilePath $edgePath -ArgumentList @(
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    "--disable-extensions-except=$browserRoot\extension",
    "--load-extension=$browserRoot\extension",
    "--user-data-dir=$profilePath",
    "--remote-debugging-port=$Port",
    '--window-position=-32000,-32000',
    'about:blank'
) -WindowStyle Hidden

Write-Output "Edge QA started on CDP port $Port with profile $profilePath"
