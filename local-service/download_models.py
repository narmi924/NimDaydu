"""Download verified Moonshine weights into this project, never a global cache."""
import argparse
import json
import time
from pathlib import Path

from moonshine_voice import ModelArch, get_model_for_language

ROOT = Path(__file__).resolve().parent.parent
ARCHES = {"small": ModelArch.SMALL_STREAMING, "medium": ModelArch.MEDIUM_STREAMING}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="+", choices=ARCHES, default=["small"])
    args = parser.parse_args()
    directory = ROOT / "models"
    directory.mkdir(exist_ok=True)
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for name in args.models:
        last = [0.0]

        def progress(fraction, filename):
            if time.monotonic() - last[0] >= 5 or fraction == 1:
                print(f"{name}: {fraction:.0%} ({filename})", flush=True)
                last[0] = time.monotonic()

        path, arch = get_model_for_language("en", ARCHES[name], cache_root=directory, on_progress=progress)
        manifest[name] = {"path": Path(path).relative_to(ROOT).as_posix(), "arch": int(arch)}
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"{name}: ready", flush=True)


if __name__ == "__main__":
    main()
