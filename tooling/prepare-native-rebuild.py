"""Prepare an isolated MXE build from checksum-verified retained source archives.

Requires Python 3.12+ (tarfile's data extraction filter). Does not run Docker,
download sources, change installed DLLs, or publish artifacts.
"""

import hashlib
import json
import pathlib
import shutil
import sys
import tarfile


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive) as source:
        members = source.getmembers()
        roots = set()
        for member in members:
            parts = pathlib.PurePosixPath(member.name).parts
            if not parts or member.name.startswith("/") or ".." in parts or "\\" in member.name or ":" in parts[0]:
                raise ValueError(f"Unsafe archive path: {member.name}")
            roots.add(parts[0])
        if len(roots) != 1:
            raise ValueError(f"Expected one source root in {archive.name}")

        def strip_root(member, target):
            parts = pathlib.PurePosixPath(member.name).parts
            if len(parts) == 1:
                if not member.isdir():
                    raise ValueError("Archive root must be a directory")
                return None
            link = member.linkname
            if member.islnk():
                link_parts = pathlib.PurePosixPath(link).parts
                if not link_parts or link_parts[0] not in roots:
                    raise ValueError("Hard link outside archive root")
                link = pathlib.PurePosixPath(*link_parts[1:]).as_posix()
            adjusted = member.replace(name=pathlib.PurePosixPath(*parts[1:]).as_posix(), linkname=link)
            return tarfile.data_filter(adjusted, target)

        source.extractall(destination, members=members, filter=strip_root)


def prepare(bundle, output):
    manifest = load(bundle / "manifest.json")
    rust = load(bundle / "rust-source-manifest.json")
    toolchain = load(bundle / "toolchain-source-manifest.json")
    if not manifest.get("complete") or not rust.get("complete") or not toolchain.get("complete"):
        raise ValueError("Incomplete source bundle")
    if len(manifest["components"]) != 28 or len(rust["crates"]) != 357:
        raise ValueError("Unexpected native source set; review before rebuilding")
    if len(toolchain["archives"]) != 14:
        raise ValueError("Unexpected compiler source set; review before rebuilding")
    records = [(bundle / "archives", x) for x in manifest["repositoryArchives"]]
    records += [(bundle / "archives", x) for x in manifest["components"]]
    records += [(bundle / "rust-crates", x) for x in rust["crates"]]
    records += [(bundle / "toolchain-archives", x) for x in toolchain["archives"]]
    for directory, record in records:
        name = record["file"]
        if pathlib.Path(name).name != name or digest(directory / name) != record["sha256"]:
            raise ValueError(f"Unsafe name or checksum mismatch: {name}")
    output.mkdir(parents=True, exist_ok=False)
    for repo, folder in [("kleisauke/mxe", "mxe"), ("libvips/build-win64-mxe", "upstream")]:
        record = next(x for x in manifest["repositoryArchives"] if x["repo"] == repo)
        extract(bundle / "archives" / record["file"], output / folder)
    (output / "pkg").mkdir()
    for directory, entries in [("archives", manifest["components"]), ("toolchain-archives", toolchain["archives"])]:
        for record in entries:
            shutil.copyfile(bundle / directory / record["file"], output / "pkg" / record["file"])
    vendor = output / "vendor"
    vendor.mkdir()
    for crate in rust["crates"]:
        name = crate["name"] + "-" + crate["version"]
        extract(bundle / "rust-crates" / crate["file"], vendor / name)
        files = {
            path.relative_to(vendor / name).as_posix(): digest(path)
            for path in sorted((vendor / name).rglob("*"))
            if path.is_file() and path.name != ".cargo-checksum.json"
        }
        (vendor / name / ".cargo-checksum.json").write_text(
            json.dumps({"package": crate["sha256"], "files": files}) + "\n", encoding="utf-8"
        )
    record = next(x for x in manifest["components"] if x["component"] == "rsvg")
    extract(bundle / "archives" / record["file"], output / "librsvg")
    config = '[source.crates-io]\nreplace-with = "retained-sources"\n[source.retained-sources]\ndirectory = "/review/vendor"\n'
    (output / "librsvg" / ".cargo").mkdir(exist_ok=True)
    (output / "librsvg" / ".cargo" / "config.toml").write_text(config, encoding="utf-8")
    # The build uses the same retained vendor set; MXE's target config is left intact.
    (output / "vendor-config.toml").write_text(config.replace("/review/vendor", "/opt/rust-vendor"), encoding="utf-8")
    overrides = output / "upstream" / "build" / "overrides.mk"
    content = overrides.read_text(encoding="utf-8")
    marker = "define librsvg_BUILD\n"
    if content.count(marker) != 1:
        raise ValueError("Upstream librsvg recipe changed")
    content = content.replace(marker, marker + "    mkdir -p '$(SOURCE_DIR)/.cargo'\n    cp /opt/vendor-config.toml '$(SOURCE_DIR)/.cargo/config.toml'\n", 1)
    overrides.write_text(content, encoding="utf-8")
    tooling = pathlib.Path(__file__).resolve().parent / "native-rebuild"
    for file in tooling.iterdir():
        if file.is_file():
            shutil.copyfile(file, output / file.name)
    evidence = {
        "repositoryArchives": manifest["repositoryArchives"],
        "componentArchives": manifest["components"],
        "rustArchives": rust["crates"],
        "toolchainArchives": toolchain["archives"],
        "target": "x86_64-w64-mingw32.static",
        "rustTarget": "x86_64-pc-windows-gnullvm",
        "variant": "web / mozjpeg / zlib-ng / no HEVC / no FFI",
        "jobs": 4,
        "changes": ["Use retained MXE archive instead of cloning a moving branch", "Seed native archives and vendor locked Rust sources", "Use SOURCE_DATE_EPOCH=0 and limit parallel jobs to four"],
        "independentRebuildComplete": False,
    }
    (output / "build-inputs.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(records)} verified archives in {output}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: prepare-native-rebuild.py <source-bundle> <new-output-directory>")
    root = pathlib.Path(__file__).resolve().parent.parent
    destination = pathlib.Path(sys.argv[2]).resolve()
    if not any(destination.is_relative_to(root / folder) for folder in ("test-results", "public-release")):
        sys.exit("Output must be a new directory under test-results or public-release")
    prepare(pathlib.Path(sys.argv[1]).resolve(), destination)
