param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$PayloadJson
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

function Write-JsonResult($Object) {
    $json = $Object | ConvertTo-Json -Depth 8 -Compress
    [Console]::Out.WriteLine($json)
}

function Get-InstalledOdbcDrivers {
    param([string[]]$Candidates)
    $installed = @()
    $allNexus = @()
    $roots = @(
        'HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers',
        'HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBCINST.INI\ODBC Drivers'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $props = Get-ItemProperty $root
        foreach ($prop in $props.PSObject.Properties) {
            if ($prop.Name -in @('PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider')) { continue }
            if ($prop.Name -match 'Nexus') {
                if ($allNexus -notcontains $prop.Name) { $allNexus += $prop.Name }
            }
            if ($Candidates -contains $prop.Name) {
                if ($installed -notcontains $prop.Name) { $installed += $prop.Name }
            }
        }
    }
    foreach ($driver in $allNexus) {
        if ($installed -notcontains $driver) { $installed += $driver }
    }
    return ,$installed
}

function Resolve-OdbcDriver {
    param([string[]]$Candidates, [string]$Requested)
    if ($Requested) { return $Requested }
    $installed = Get-InstalledOdbcDrivers -Candidates $Candidates
    if ($installed.Count -gt 0) { return $installed[0] }
    return $null
}

function Build-ConnectionString {
    param(
        [string]$Driver, [string]$Mode, [string]$Server, [int]$Port,
        [string]$Alias, [string]$DatabasePath
    )
    $isDevart = $Driver -match 'Devart'
    if ($Mode -eq 'internal') {
        $folder = $DatabasePath
        if (-not $folder.EndsWith('\')) { $folder += '\' }
        if ($isDevart) { return "Driver={$Driver};Database=$folder" }
        return "Driver={$Driver};Transport=Internal;Database=$folder"
    }
    if ($isDevart) {
        return "Driver={$Driver};Server=$Server;Port=$Port;Database=$Alias;String=Unicode"
    }
    return "Driver={$Driver};Server=nexusdb@$Server;Transport=TCP;Port=$Port;Database=$Alias"
}

function Open-OdbcConnection {
    param([string]$ConnectionString)
    Add-Type -AssemblyName System.Data
    $connection = New-Object System.Data.Odbc.OdbcConnection($ConnectionString)
    $connection.Open()
    return $connection
}

function Invoke-OdbcExecute {
    param([string]$ConnectionString, [string]$Sql)
    $connection = Open-OdbcConnection -ConnectionString $ConnectionString
    try {
        $command = $connection.CreateCommand()
        $command.CommandText = $Sql
        $affected = $command.ExecuteNonQuery()
        $command.Dispose()
        return @{ affected = $affected }
    }
    finally {
        $connection.Close()
    }
}

try {
    if ($PayloadJson -like '@*') {
        $filePath = $PayloadJson.Substring(1)
        $PayloadJson = Get-Content -LiteralPath $filePath -Raw -Encoding UTF8
    }

    $payload = $PayloadJson | ConvertFrom-Json
    $candidates = @($payload.candidates)
    if ($candidates.Count -eq 0) {
        $candidates = @(
            'NexusDB V4 ODBC Driver',
            'NexusDB V3 ODBC Driver',
            'NexusDB V1 ODBC Driver',
            'NexusDB ODBC Driver'
        )
    }

    $driver = Resolve-OdbcDriver -Candidates $candidates -Requested $payload.driver
    if (-not $driver) {
        Write-JsonResult @{
            ok = $false
            error = 'NexusDB ODBC driver is not installed on this machine.'
            needsDriver = $true
        }
        exit 0
    }

    $connectionString = Build-ConnectionString `
        -Driver $driver `
        -Mode $payload.mode `
        -Server $payload.server `
        -Port ([int]$payload.port) `
        -Alias $payload.alias `
        -DatabasePath $payload.databasePath

    $sql = [string]$payload.sql
    if (-not $sql.Trim()) {
        Write-JsonResult @{ ok = $false; error = 'SQL is required' }
        exit 0
    }

    $upper = $sql.Trim().ToUpperInvariant()
    if ($upper.StartsWith('SELECT') -or $upper.StartsWith('WITH')) {
        Write-JsonResult @{ ok = $false; error = 'Use edari-reader for SELECT; execute is for INSERT/UPDATE only' }
        exit 0
    }

    $result = Invoke-OdbcExecute -ConnectionString $connectionString -Sql $sql
    Write-JsonResult @{
        ok = $true
        driver = $driver
        affected = $result.affected
    }
}
catch {
    Write-JsonResult @{
        ok = $false
        error = $_.Exception.Message
    }
}
