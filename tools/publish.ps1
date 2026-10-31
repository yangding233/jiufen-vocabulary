param([Parameter(Mandatory=$true)][string]$RepositoryUrl)
$ErrorActionPreference='Stop'
if ($RepositoryUrl -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$') { throw '请填写自己的 GitHub 私有仓库 HTTPS 地址。' }
$projectPath=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $projectPath
try {
  if (-not (Test-Path -LiteralPath '.git')) { git init -b main; if($LASTEXITCODE){throw 'git init failed'} }
  & python apps/ios/verify-resources.py
  if ($LASTEXITCODE) { throw '离线资源或个人进度校验失败，已停止上传。' }
  Write-Host '仅上传源码与内置资源；数据库、测试结果、依赖环境、安装包和个人备份均排除。'
  git add .github apps docs shared tests tools web .gitignore .gitattributes package.json README.md LICENSE THIRD_PARTY_NOTICES.txt CONTRACT.md
  if ($LASTEXITCODE) { throw '暂存失败' }
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 1) { git -c user.name='Jiufen developer' -c user.email='developer@localhost' commit -m 'Build offline vocabulary apps and USB synchronization'; if($LASTEXITCODE){throw '提交失败'} }
  $remoteUrl=git remote get-url origin 2>$null
  if ($LASTEXITCODE -eq 0) { if($remoteUrl.TrimEnd('/') -ne $RepositoryUrl.TrimEnd('/')){throw '现有origin不同，未自动改动远端。'} } else { git remote add origin $RepositoryUrl }
  git push -u origin main
  if ($LASTEXITCODE) { throw '上传未完成。请在官方 GitHub 登录授权后重试；不会自动强制推送。' }
  Write-Host '上传完成。请在GitHub Actions手动运行Build iOS。'
} finally { Pop-Location }
