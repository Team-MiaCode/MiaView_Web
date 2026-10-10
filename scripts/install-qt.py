"""Install the preview toolchain from Qt's official, checksummed archives.

Requires requests and py7zr; supports Windows x64 and Linux x64.
"""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import xml.etree.ElementTree as ET
import requests
import py7zr

root = Path(__file__).resolve().parents[1]
toolchain = json.loads((root / "native/toolchain.json").read_text())
version = toolchain["qtVersion"]
compact = version.replace(".", "")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--target", choices=["wasm", "host", "all"], default="all")
parser.add_argument("--host", choices=["windows", "linux"],
                    default="windows" if platform.system() == "Windows" else "linux")
parser.add_argument("--metadata-only", action="store_true")
args = parser.parse_args()
current_host = "windows" if platform.system() == "Windows" else "linux"
if args.target in ["host", "all"] and args.host != current_host and not args.metadata_only:
    parser.error("Install host tools on their matching OS; use --metadata-only for cross-OS checks")
cache = root / ".deps/downloads"
cache.mkdir(parents=True, exist_ok=True)

def get(url):
    response = requests.get(url, timeout=90)
    response.raise_for_status()
    return response.content

def install(base, architecture, destination):
    metadata = get(base + "Updates.xml")
    expected = get(base + "Updates.xml.sha256").decode().split()[0]
    if hashlib.sha256(metadata).hexdigest() != expected:
        raise RuntimeError("Qt metadata checksum mismatch")
    names = {f"qt.qt6.{compact}.{architecture}",
             f"qt.qt6.{compact}.addons.qtshadertools.{architecture}"}
    selected = []
    for package in ET.fromstring(metadata).findall("PackageUpdate"):
        if package.findtext("Name") not in names:
            continue
        for archive in package.findtext("DownloadableArchives", "").split(","):
            archive = archive.strip()
            if not archive.startswith(("qtbase-", "qtdeclarative-", "qtsvg-", "qtshadertools-")):
                continue
            selected.append((archive, base + package.findtext("Name") + "/" +
                             package.findtext("Version") + archive))
    if not all(any(name.startswith(module + "-") for name, _ in selected)
               for module in ["qtbase", "qtdeclarative", "qtsvg", "qtshadertools"]):
        raise RuntimeError(f"Qt {architecture} package layout changed; review the installer")
    for archive, url in selected:
        print(f"Qt {architecture}: {archive}", flush=True)
        if args.metadata_only:
            continue
        path = cache / archive
        checksum = get(url + ".sha1").decode().split()[0]
        if not path.exists() or hashlib.sha1(path.read_bytes()).hexdigest() != checksum:
            with requests.get(url, stream=True, timeout=90) as response:
                response.raise_for_status()
                with path.open("wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        output.write(chunk)
        if hashlib.sha1(path.read_bytes()).hexdigest() != checksum:
            raise RuntimeError(f"Qt archive checksum mismatch: {archive}")
        destination.mkdir(parents=True, exist_ok=True)
        with py7zr.SevenZipFile(path) as source:
            if any(not (destination / name).resolve().is_relative_to(destination.resolve())
                   for name in source.getnames()):
                raise RuntimeError("Qt archive contains a path outside its installation")
            source.extractall(destination)

prefix = "https://download.qt.io/online/qtsdkrepository/"
if args.target in ["wasm", "all"]:
    arch = toolchain["wasmArch"]
    install(f"{prefix}all_os/wasm/qt6_{compact}/qt6_{compact}_{arch}/", arch,
            root / ".deps/qt" / version / arch)
if args.target in ["host", "all"]:
    os_arch = "windows_x86" if args.host == "windows" else "linux_x64"
    arch = "win64_msvc2022_64" if args.host == "windows" else "linux_gcc_64"
    folder = f"qt6_{compact}_msvc2022_64" if args.host == "windows" else f"qt6_{compact}"
    install(f"{prefix}{os_arch}/desktop/qt6_{compact}/{folder}/", arch,
            root / ".deps/qt" / version / ("msvc2022_64" if args.host == "windows" else "gcc_64"))
