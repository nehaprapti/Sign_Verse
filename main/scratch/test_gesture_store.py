import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.utils.gesture_store import load_gesture_db, save_word_metadata
import json

def test():
    # 1. Test load db
    db = load_gesture_db()
    print("Database loaded. Word count:", len(db.get('Word', {})))
    
    # 2. Save metadata for BAD
    print("Saving metadata for BAD...")
    save_word_metadata('BAD', {
        'sense_id': 'bad_test',
        'meaning': 'unfavorable',
        'pos': ['adjective'],
        'context': ['bad', 'poor', 'awful']
    })
    
    # 3. Read back BAD.json
    bad_json = Path(__file__).resolve().parent.parent / 'words' / 'BAD.json'
    with open(bad_json, 'r', encoding='utf-8') as f:
        data = json.load(f)
    print("Updated BAD.json:")
    print(f"  Sense ID: {data.get('sense_id')}")
    print(f"  Meaning: {data.get('meaning')}")
    print(f"  POS: {data.get('pos')}")
    print(f"  Context: {data.get('context')}")
    print(f"  Poses count: {len(data.get('poses', []))}")

if __name__ == '__main__':
    test()
