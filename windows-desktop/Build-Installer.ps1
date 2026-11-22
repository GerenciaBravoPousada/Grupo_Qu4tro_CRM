param([Parameter(Mandatory)][string]$WebViewSdk,[Parameter(Mandatory)][string]$Output)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$csc="$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$build=Join-Path $env:TEMP ('qu4tro-desktop-build-'+[guid]::NewGuid().ToString('N'))
$payload=Join-Path $build 'payload'
$web=Join-Path $payload 'web'
New-Item -ItemType Directory -Path $web -Force | Out-Null
$references=@('System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Security.dll','System.Web.Extensions.dll','Microsoft.CSharp.dll','System.IO.Compression.dll')
$refs=@($references | ForEach-Object {"/reference:$_"})
foreach($name in 'Core','WinForms'){
    $dll=Join-Path $WebViewSdk "lib/net462/Microsoft.Web.WebView2.$name.dll"
    Copy-Item -LiteralPath $dll -Destination $payload
    $refs+="/reference:$dll"
}
Copy-Item -LiteralPath (Join-Path $WebViewSdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $payload
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bootstrap.js') -Destination $payload
foreach($name in 'index.html','crm-sync.js','crm-journal.js','reservation-attendance.js','qrcode.min.js'){
    Copy-Item -LiteralPath (Join-Path $repo $name) -Destination $web
}
& $csc /nologo /platform:x64 /target:winexe /main:Desktop "/out:$payload/GrupoQu4tro.Desktop.exe" @refs (Join-Path $PSScriptRoot 'Desktop.cs') (Join-Path $repo 'windows-journal/JournalHost.cs')
if($LASTEXITCODE){throw 'Falha ao compilar o CRM Desktop.'}
$archive=Join-Path $build 'payload.zip'
Compress-Archive -Path "$payload/*" -DestinationPath $archive
& $csc /nologo /platform:x64 /target:winexe /main:Installer "/out:$Output" "/resource:$archive,Qu4troPackage" @refs (Join-Path $PSScriptRoot 'Installer.cs')
if($LASTEXITCODE){throw 'Falha ao compilar o instalador.'}
Get-Item -LiteralPath $Output
