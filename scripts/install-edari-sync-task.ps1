# Install Windows scheduled task: Shorja Edari sync every minute
# يتطلب تفعيل الكتابة صراحة — الافتراضي قراءة فقط لحماية الإداري الأصلي
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $name = $matches[1].Trim()
      $value = $matches[2].Trim()
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}
if ($env:EDARI_WRITE_ENABLED -ne '1') {
  Write-Host 'تخطي تثبيت المهمة: EDARI_WRITE_ENABLED ليس 1 — الإداري الأصلي محمي (قراءة فقط).'
  Write-Host 'لتعطيل مهمة موجودة: schtasks /Change /TN ShorjaEdariSync /DISABLE'
  exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $root 'scripts\run-edari-sync-once.js'
$taskName = 'ShorjaEdariSync'

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Shorja Edari sync (writes must be enabled in .env)' -Force | Out-Null
Write-Host "Installed task: $taskName (every 1 minute)"
Write-Host "Run now: schtasks /Run /TN $taskName"
