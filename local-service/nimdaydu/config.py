import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    token: str
    model: str
    deepseek_key: str
    deepseek_model: str


def load_settings(state_dir: Path | None = None) -> Settings:
    load_dotenv(ROOT / ".env", override=False)
    state_dir = state_dir or ROOT / ".nimdaydu"
    state_dir.mkdir(parents=True, exist_ok=True)
    config_file = state_dir / "config.json"
    if not config_file.exists():
        # Atomic create prevents two launches from giving the browser different tokens.
        try:
            with config_file.open("x", encoding="utf-8") as output:
                json.dump({"token": secrets.token_urlsafe(32)}, output)
        except FileExistsError:
            pass
    config = json.loads(config_file.read_text(encoding="utf-8"))
    providers_file = state_dir / 'providers.json'
    providers = json.loads(providers_file.read_text(encoding='utf-8')) if providers_file.exists() else {}
    return Settings(config["token"], os.getenv("NIMDAYDU_MODEL", "small"),
                    providers.get('deepseek_key', os.getenv("DEEPSEEK_API_KEY", "")),
                    providers.get('deepseek_model', os.getenv("DEEPSEEK_MODEL", "deepseek-flash")))
