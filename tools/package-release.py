"""Create reproducible-scope release archives without local learning data."""
from pathlib import Path
import fnmatch
import hashlib
import json
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
OUTPUT = ROOT / "dist" / "releases" / VERSION
WINDOWS = ROOT / "dist" / "windows" / f"九分词汇离线学习-{VERSION}"
SOURCE_DIRS = (".github", "apps", "docs", "shared", "tests", "tools", "web")
SOURCE_FILES = (".gitignore", ".gitattributes", "package.json", "package-lock.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.txt", "CONTRACT.md")
SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".venv", ".venv-usb", "dist", "build", "test-results", "private-fixtures", "data"}
PRIVATE_FILES = ("*.sqlite*", "*.db*", "*.ipa", "*.p12", "*.mobileprovision", "*.cer", "*.key", "*.log", ".env*", "source.html", "source-app.js")


def source_paths():
    result = [ROOT / name for name in SOURCE_FILES]
    for directory in SOURCE_DIRS:
        for path in (ROOT / directory).rglob("*"):
            relative = path.relative_to(ROOT)
            if any(part in SKIP_DIRS for part in relative.parts):
                continue
            if path.is_file() and not any(fnmatch.fnmatch(path.name, pattern) for pattern in PRIVATE_FILES):
                if path.is_symlink():
                    raise ValueError(f"Do not package symlink: {relative}")
                result.append(path)
    return sorted(result)


def assert_no_progress(html_path):
    html = html_path.read_text(encoding="utf-8")
    match = re.search(r'<script\s+id="portable-state"\s+type="application/json">([\s\S]*?)</script>', html)
    assert match and json.loads(match.group(1)) is None, "Embedded personal progress found"


def write_archive(output, base, files, prefix):
    if output.exists():
        raise FileExistsError(f"Keep the previous archive; choose a new version before replacing: {output}")
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for file in files:
            archive.write(file, str(Path(prefix) / file.relative_to(base)))


subprocess.run([sys.executable, str(ROOT / "apps" / "ios" / "verify-resources.py")], check=True)
assert (WINDOWS / "九分词汇离线学习.exe").is_file(), "Package Windows first"
assert_no_progress(WINDOWS / "resources" / "app" / "web" / "index.html")
windows_files = sorted(path for path in WINDOWS.rglob("*") if path.is_file() and not fnmatch.fnmatch(path.name, "*.log"))
assert not any(any(fnmatch.fnmatch(path.name, pattern) for pattern in PRIVATE_FILES) for path in windows_files), "Private file in Windows package"
OUTPUT.mkdir(parents=True, exist_ok=True)
source_archive = OUTPUT / f"JiufenVocabulary-source-{VERSION}.zip"
windows_archive = OUTPUT / f"九分词汇离线学习-Windows-{VERSION}.zip"
write_archive(source_archive, ROOT, source_paths(), "JiufenVocabulary-source")
write_archive(windows_archive, WINDOWS, windows_files, WINDOWS.name)
hashes = []
for archive in (source_archive, windows_archive):
    digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
    hashes.append(f"{digest}  {archive.name}")
(OUTPUT / "SHA256SUMS.txt").write_text("\n".join(hashes) + "\n", encoding="utf-8")
(OUTPUT / "发布说明.txt").write_text(
    f"九分离线学习 Windows {VERSION} 开发测试版\n\n"
    "Windows：解压 Windows ZIP，保留整个目录，双击九分词汇离线学习.exe。\n"
    "先在原 HTML 的备份与设置导出完整 JSON；新程序还未学习时导入，核对后再使用。\n"
    "日常备份使用新程序顶部的完整同步档案。原 HTML 文件没有被替换。\n\n"
    "源码：解压 source ZIP，或在 GitHub 仓库下载与克隆对应版本。\n"
    "源码不含学习进度、测试数据库、Apple 签名资料或已安装依赖。\n"
    "iOS：已通过 GitHub macOS 编译，未签名 IPA 在 dist/ios/run-2；需要 Windows 签名安装，再做真机同步验收。\n"
    "USB 设备枚举已实测；端到端真机学习进度同步尚未验收。\n",
    encoding="utf-8",
)
print(json.dumps({"directory": str(OUTPUT), "archives": [path.name for path in (source_archive, windows_archive)]}, ensure_ascii=False))
