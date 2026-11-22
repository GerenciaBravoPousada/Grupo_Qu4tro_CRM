param([Parameter(Mandatory)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
$root = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Grupo Qu4tro\Diario CRM'
New-Item -ItemType Directory -Path $root -Force | Out-Null
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'A pasta do diário não pode ser um redirecionamento.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($identity.User, [Security.Principal.SecurityIdentifier]'S-1-5-18')) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $root -AclObject $acl
$name = 'br.com.grupoqu4tro.diario'
$exe = Join-Path $root "JournalHost-$([guid]::NewGuid().ToString('N')).exe"
Add-Type -Path (Join-Path $PSScriptRoot 'JournalHost.cs') -OutputAssembly $exe -OutputType ConsoleApplication -ReferencedAssemblies 'System.dll','System.Core.dll','System.Security.dll','System.Web.Extensions.dll'
$manifest = Join-Path $root "$name.json"
@{name=$name;description='Diario local Grupo Qu4tro';path=$exe;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")} |
    ConvertTo-Json -Compress | ForEach-Object { [IO.File]::WriteAllText($manifest, $_) }
$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$name"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifest
$action = New-ScheduledTaskAction -Execute $exe -Argument '--maintenance'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Grupo Qu4tro Diario CRM' -Action $action -Trigger @($trigger,$logon) -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "Diário instalado em $root. Reabra o CRM no Chrome."
