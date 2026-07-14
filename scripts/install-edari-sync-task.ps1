# Install Windows scheduled task: Shorja Edari sync every minute
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $root 'scripts\run-edari-sync-once.js'
$taskName = 'ShorjaEdariSync'

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Shorja Edari account sync' -Force | Out-Null
Write-Host "Installed task: $taskName (every 1 minute)"
Write-Host "Run now: schtasks /Run /TN $taskName"
