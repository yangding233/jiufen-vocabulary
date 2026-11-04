param([Parameter(Mandatory=$true)][ValidateSet('create','extract')][string]$Mode,[Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$request=Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$maxTotal=536870912
if($Mode -eq 'create'){
  $stage=[IO.Path]::GetFullPath($request.stage)
  $output=[IO.Path]::GetFullPath($request.output)
  $temporary=$output+'.'+[guid]::NewGuid().ToString()+'.tmp'
  $zip=[IO.Compression.ZipFile]::Open($temporary,[IO.Compression.ZipArchiveMode]::Create)
  try{
    $files=@(@{Name='manifest.json';Path=(Join-Path $stage 'manifest.json')},@{Name='document.json';Path=(Join-Path $stage 'document.json')})
    $contentPath=Join-Path $stage 'content-pack.json';if(Test-Path -LiteralPath $contentPath){$files+=@{Name='content-pack.json';Path=$contentPath}}
    foreach($key in $request.keys){if($key -notmatch '^[a-f0-9]{64}$'){throw 'Invalid audio key'};$files+=@{Name=('audio/'+$key+'.m4a');Path=(Join-Path $request.audioFolder ($key+'.m4a'))}}
    $bytes=0L
    if($files.Count -gt 100003){throw 'Too many bundle entries'}
    foreach($item in $files){$file=Get-Item -LiteralPath $item.Path;if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refuse symlink'};if($file.Length -lt 1 -or $file.Length -gt 52428800 -or ($item.Name -like 'audio/*' -and $file.Length -gt 10485760)){throw 'Entry exceeds size limit'};$bytes+=$file.Length;if($bytes -gt $maxTotal){throw 'Bundle exceeds 512MiB'};[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,$item.Name,[IO.Compression.CompressionLevel]::Optimal)}
  }finally{$zip.Dispose()}
  if(Test-Path -LiteralPath $output){[IO.File]::Replace($temporary,$output,$null)}else{[IO.File]::Move($temporary,$output)}
  @{ok=$true;bytes=$bytes}|ConvertTo-Json -Compress
}else{
  $bundlePath=[IO.Path]::GetFullPath($request.input)
  if((Get-Item -LiteralPath $bundlePath).Length -gt $maxTotal){throw 'Bundle exceeds 512MiB'}
  $stage=[IO.Path]::GetFullPath($request.stage)
  if(Test-Path -LiteralPath $stage){throw 'Staging folder already exists'}
  $zip=[IO.Compression.ZipFile]::OpenRead($bundlePath)
  try{
    if($zip.Entries.Count -gt 100003){throw 'Too many entries'}
    $seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $bytes=0L
    foreach($entry in $zip.Entries){
      $name=$entry.FullName
      if($name -notmatch '^(manifest\.json|document\.json|content-pack\.json|audio/[a-f0-9]{64}\.m4a)$' -or -not $seen.Add($name)){throw 'Invalid or duplicate bundle entry'}
      if($entry.Length -lt 1 -or $entry.Length -gt 52428800 -or ($name -like 'audio/*' -and $entry.Length -gt 10485760)){throw 'Entry exceeds size limit'}
      $bytes+=$entry.Length;if($bytes -gt $maxTotal){throw 'Expanded bundle exceeds 512MiB'}
    }
    if(-not $seen.Contains('document.json') -or -not $seen.Contains('manifest.json')){throw 'Missing bundle manifest'}
    [void][IO.Directory]::CreateDirectory($stage)
    foreach($entry in $zip.Entries){
      $destination=[IO.Path]::GetFullPath((Join-Path $stage $entry.FullName))
      if(-not $destination.StartsWith($stage+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe entry path'}
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$false)
      if((Get-Item -LiteralPath $destination).Length -ne $entry.Length){throw 'Entry length mismatch'}
    }
    @{ok=$true;bytes=$bytes}|ConvertTo-Json -Compress
  }finally{$zip.Dispose()}
}
