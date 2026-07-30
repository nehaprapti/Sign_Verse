import json
from pathlib import Path
from typing import Any, Dict, List, Optional


ROOT_DIR = Path(__file__).resolve().parents[2]


def _resolve_path(path: Optional[str | Path], fallback: Path) -> Path:
    return Path(path) if path else fallback


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with open(path, 'r', encoding='utf-8-sig') as file:
            return json.load(file)
    except Exception:
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as file:
        json.dump(data, file, indent=4, ensure_ascii=False)


def load_gesture_db(db_path: str | Path = ROOT_DIR / 'gestures.json') -> Dict[str, Dict[str, List[dict]]]:
    root_path = _resolve_path(db_path, ROOT_DIR / 'gestures.json')
    words_dir = root_path.with_name('words')

    db: Dict[str, Dict[str, List[dict]]] = {
        'Word': {},
        'Letter': {},
    }

    root_data = _read_json(root_path, {})
    if isinstance(root_data, dict):
        if isinstance(root_data.get('Letter'), dict):
            db['Letter'] = root_data['Letter']
        if isinstance(root_data.get('Word'), dict):
            for word, poses in root_data['Word'].items():
                if isinstance(poses, list):
                    db['Word'][str(word).upper()] = poses

    if words_dir.exists():
        for file_path in sorted(words_dir.glob('*.json')):
            word = file_path.stem.upper()
            poses = _read_json(file_path, None)
            if isinstance(poses, list):
                db['Word'][word] = poses
            elif isinstance(poses, dict):
                if isinstance(poses.get('poses'), list):
                    db['Word'][word] = poses['poses']
                elif isinstance(poses.get(word), list):
                    db['Word'][word] = poses[word]

    return db


def load_word_gesture(name: str, db_path: str | Path = ROOT_DIR / 'gestures.json') -> Optional[List[dict]]:
    root_path = _resolve_path(db_path, ROOT_DIR / 'gestures.json')
    word_file = root_path.with_name('words') / f'{name.upper()}.json'
    poses = _read_json(word_file, None)
    if isinstance(poses, list):
        return poses
    if isinstance(poses, dict) and isinstance(poses.get('poses'), list):
        return poses['poses']
    if isinstance(poses, dict) and isinstance(poses.get(name.upper()), list):
        return poses[name.upper()]
    return None


def save_word_gesture(name: str, poses: List[dict], db_path: str | Path = ROOT_DIR / 'gestures.json') -> Path:
    root_path = _resolve_path(db_path, ROOT_DIR / 'gestures.json')
    word_dir = root_path.with_name('words')
    word_dir.mkdir(parents=True, exist_ok=True)
    word_file = word_dir / f'{name.upper()}.json'
    
    existing = _read_json(word_file, None)
    if isinstance(existing, dict):
        existing['poses'] = poses
        _write_json(word_file, existing)
    else:
        new_data = {
            "sense_id": name.lower(),
            "meaning": name.lower(),
            "pos": ["noun"],
            "context": [name.lower()],
            "poses": poses
        }
        _write_json(word_file, new_data)
    return word_file


def save_word_metadata(name: str, metadata: dict, db_path: str | Path = ROOT_DIR / 'gestures.json') -> Path:
    root_path = _resolve_path(db_path, ROOT_DIR / 'gestures.json')
    word_file = root_path.with_name('words') / f'{name.upper()}.json'
    
    existing = _read_json(word_file, None)
    if not isinstance(existing, dict):
        existing = {
            "sense_id": name.lower(),
            "meaning": name.lower(),
            "pos": ["noun"],
            "context": [name.lower()],
            "poses": existing if isinstance(existing, list) else []
        }
    
    existing["sense_id"] = metadata.get("sense_id", existing.get("sense_id", name.lower()))
    existing["meaning"] = metadata.get("meaning", existing.get("meaning", name.lower()))
    existing["pos"] = metadata.get("pos", existing.get("pos", ["noun"]))
    existing["context"] = metadata.get("context", existing.get("context", [name.lower()]))
    
    _write_json(word_file, existing)
    return word_file




def save_letter_gesture(name: str, poses: List[dict], db_path: str | Path = ROOT_DIR / 'gestures.json') -> Path:
    root_path = _resolve_path(db_path, ROOT_DIR / 'gestures.json')
    db = _read_json(root_path, {})
    if not isinstance(db, dict):
        db = {}
    if not isinstance(db.get('Word'), dict):
        db['Word'] = {}
    if not isinstance(db.get('Letter'), dict):
        db['Letter'] = {}

    db['Letter'][name.upper()] = poses
    _write_json(root_path, db)
    return root_path


def save_gesture(category: str, name: str, poses: List[dict], db_path: str | Path = ROOT_DIR / 'gestures.json') -> Path:
    if category.upper() == 'WORD':
        return save_word_gesture(name, poses, db_path=db_path)
    return save_letter_gesture(name, poses, db_path=db_path)