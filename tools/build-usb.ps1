$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskPython = Join-Path $projectPath '.venv-usb\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw '请先用 Python 3.12 创建 .venv-usb，并安装 tools/usb-requirements.txt。' }
$runtimeSslDirectory = (& $taskPython -c 'import ssl; from pathlib import Path; print(Path(ssl.__file__).parent)').Trim()
$runtimeCA = Join-Path $runtimeSslDirectory 'codex-rejected-cas.pem'
$buildArguments = @('-m','PyInstaller','--noconfirm','--clean','--onedir','--console','--name','usb_transport','--distpath',(Join-Path $PSScriptRoot 'dist'),'--workpath',(Join-Path $projectPath 'build\usb'),'--specpath',(Join-Path $projectPath 'build\usb'))
# Preserve additional CA resources required by this Python runtime's ssl.py.
if (Test-Path -LiteralPath $runtimeCA) { $buildArguments += @('--add-data',($runtimeCA + ';.')) }
$buildArguments += (Join-Path $PSScriptRoot 'usb_transport.py')
& $taskPython @buildArguments
if ($LASTEXITCODE -ne 0) { throw 'USB 组件打包失败。' }
& (Join-Path $PSScriptRoot 'dist\usb_transport\usb_transport.exe') self-test
if ($LASTEXITCODE -ne 0) { throw 'USB 加密运行组件自检失败，未发布。' }
Write-Output (Join-Path $PSScriptRoot 'dist\usb_transport\usb_transport.exe')
