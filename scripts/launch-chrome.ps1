param(
    [int]$Port = 9230
)

$browserRoot = Split-Path -Parent $PSScriptRoot
$candidates = @(
    (Get-Command chrome.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($null -eq $chromePath) {
    throw 'Chrome executable not found; install Chrome before running Chrome QA.'
}
$profilePath = Join-Path $browserRoot ('.qa\chrome-profile-{0}' -f $Port)
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
Start-Process -FilePath $chromePath -ArgumentList @(
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

Write-Output "Chrome QA started on CDP port $Port with profile $profilePath"
