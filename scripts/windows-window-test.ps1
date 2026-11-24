$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$archive = Join-Path $env:RUNNER_TEMP 'ppm-window-archive'
pnpm seed -- --archive $archive
if ($LASTEXITCODE) { throw 'Could not prepare the synthetic archive' }
$config = Join-Path $env:APPDATA 'ppm'
New-Item -ItemType Directory -Path $config -Force | Out-Null
@{archivePath=$archive} | ConvertTo-Json | Set-Content -Encoding utf8NoBOM (Join-Path $config 'config.json')
$application = Resolve-Path 'apps/desktop/src-tauri/target/release/ppm.exe'
# A release executable resolves its bundled resources next to the executable.
$resources = Join-Path (Split-Path $application) 'runtime'
if (!(Test-Path $resources)) { Copy-Item apps/desktop/src-tauri/runtime $resources -Recurse }
$samples = @()
for ($i=0; $i -lt 3; $i++) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process $application -PassThru
    try {
        $button = $null
        $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Åbn seneste arkiv')
        while (!$button -and $timer.Elapsed.TotalSeconds -lt 45) {
            $process.Refresh()
            if ($process.HasExited) { throw 'Window exited before login' }
            if ($process.MainWindowHandle -ne 0) {
                $window = [Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
                $button = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
                if ($button -and !$button.Current.IsEnabled) { $button = $null }
            }
            if (!$button) { Start-Sleep -Milliseconds 50 }
        }
        if (!$button) { throw 'Recent archive button did not become interactive' }
        $samples += $timer.ElapsedMilliseconds
        $button.SetFocus()
        [Windows.Forms.SendKeys]::SendWait('{ENTER}')
        $lock = Join-Path $archive '.lock'
        $deadline = [datetime]::UtcNow.AddSeconds(15)
        while (!(Test-Path $lock) -and [datetime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
        if (!(Test-Path $lock)) { throw 'Opening the archive did not create a lock' }
        if (!$process.CloseMainWindow() -or !$process.WaitForExit(15000)) { throw 'Normal window close failed' }
        if (Test-Path $lock) { throw 'Archive remained locked after window close' }
    } finally {
        if (!$process.HasExited) { $process.Kill($true) }
    }
}
$median = ($samples | Sort-Object)[1]
$measurement = "Windows release startup samples (ms): $samples. Median: $median ms."
Write-Output $measurement
$measurement >> $env:GITHUB_STEP_SUMMARY
