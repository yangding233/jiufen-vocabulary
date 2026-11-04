"""Create Windows/source release archives without local learning data."""
from pathlib import Path
import fnmatch
import hashlib
import json
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8-sig"))["version"]
OUTPUT = ROOT / "dist" / "releases" / VERSION
WINDOWS = ROOT / "dist" / "windows" / f"九分词汇离线学习-{VERSION}"
SOURCE_DIRS = (".github", "apps", "docs", "shared", "tests", "tools", "web")
SOURCE_FILES = (".gitignore", ".gitattributes", "package.json", "package-lock.json", "README.md", "AI补全指南.md", "LICENSE", "THIRD_PARTY_NOTICES.txt", "CONTRACT.md")
SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".venv", ".venv-usb", ".venv-audio", "dist", "build", "test-results", "private-fixtures", "data"}
PRIVATE_FILES = ("*.sqlite*", "*.db*", "*.ipa", "*.p12", "*.mobileprovision", "*.cer", "*.key", "*.log", ".env*", "*.onnx", "*.pt", "*.pcm", "source.html", "source-app.js", "NEXT_STEPS.md")


def source_paths():
    result = [ROOT / name for name in SOURCE_FILES if (ROOT / name).is_file()]
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


def write_archive(output, base, files, prefix):
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for file in files:
            archive.write(file, str(Path(prefix) / file.relative_to(base)))


def main():
    subprocess.run([sys.executable, str(ROOT / "tools" / "verify_resources.py")], check=True)
    assert (WINDOWS / "九分词汇离线学习.exe").is_file(), "Package Windows first"
    app = WINDOWS / "resources" / "app"
    subprocess.run([sys.executable, str(ROOT / "tools" / "verify_resources.py"), "--root", str(app)], check=True)
    windows_files = sorted(path for path in WINDOWS.rglob("*") if path.is_file() and not fnmatch.fnmatch(path.name, "*.log"))
    assert not any(any(fnmatch.fnmatch(path.name, pattern) for pattern in PRIVATE_FILES) for path in windows_files), "Private file in Windows package"
    assert not (WINDOWS / "resources" / "usb").exists(), "Obsolete USB runtime in package"
    source_files = source_paths()
    assert not any(path.is_symlink() for path in windows_files), "Symlink in Windows package"
    source_archive = OUTPUT / f"JiufenVocabulary-source-{VERSION}.zip"
    windows_archive = OUTPUT / f"JiufenVocabulary-Windows-{VERSION}.zip"
    for target in (source_archive, windows_archive, OUTPUT / "SHA256SUMS.txt", OUTPUT / "发布说明.txt"):
        if target.exists():
            raise FileExistsError(f"Keep the existing release; choose a new version or reviewed output directory: {target}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_archive(source_archive, ROOT, source_files, "JiufenVocabulary-source")
    write_archive(windows_archive, WINDOWS, windows_files, WINDOWS.name)
    hashes = []
    for archive in (source_archive, windows_archive):
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        with zipfile.ZipFile(archive) as packaged:
            assert packaged.testzip() is None, f"Corrupt archive: {archive}"
        hashes.append(f"{digest}  {archive.name}")
    (OUTPUT / "SHA256SUMS.txt").write_text("\n".join(hashes) + "\n", encoding="utf-8")
    (OUTPUT / "发布说明.txt").write_text(
        f"九分词汇 Windows 离线学习 {VERSION}\n\n"
        "解压 Windows ZIP，保留整个目录，双击九分词汇离线学习.exe。\n"
        "本版只维护 Windows，已移除 iPhone 应用、USB 同步与签名构建。运行成品不需要 Node、Python 或 Apple 驱动。\n\n"
        "升级前：旧版导出完整备份并退出。新版沿用本机数据目录，旧档案先独立备份后迁移；新格式不供旧程序读取。\n"
        "日常流程：今日学习 → 回忆与巧记 → 反馈 → 自动保存。外部 JSON 备份和恢复见备份与设置。\n"
        "源码、测试与离线资源随 source ZIP 提供；归档不包含学习进度、测试数据库、凭据、开发模型或已安装依赖。\n"
        "说明：docs/简单使用说明.html。本版提供资料编辑、外部AI任务与导回、整句朗读、词书整理及资料包。自加读音生成使用单独准备的可选本地组件，已有音频播放不需要它。\n",
        encoding="utf-8",
    )
    print(json.dumps({"directory": str(OUTPUT), "archives": [source_archive.name, windows_archive.name]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
