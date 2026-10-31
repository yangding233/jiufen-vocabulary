$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskPython = Join-Path $projectPath '.venv-usb\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw '请先用 Python 3.12 创建 .venv-usb，并安装 tools/usb-requirements.txt。' }
& $taskPython -m PyInstaller --noconfirm --clean --onefile --console --name usb_transport --distpath (Join-Path $PSScriptRoot 'dist') --workpath (Join-Path $projectPath 'build\usb') --specpath (Join-Path $projectPath 'build\usb') (Join-Path $PSScriptRoot 'usb_transport.py')
if ($LASTEXITCODE -ne 0) { throw 'USB 组件打包失败。' }
Write-Output (Join-Path $PSScriptRoot 'dist\usb_transport.exe')
