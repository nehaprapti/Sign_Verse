import json
from pathlib import Path

def migrate():
    words_dir = Path(__file__).resolve().parent.parent / 'words'
    if not words_dir.exists():
        print(f"words directory not found at {words_dir}")
        return

    print(f"Migrating files in {words_dir}...")
    for file_path in words_dir.glob('*.json'):
        try:
            with open(file_path, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            
            # Check if it needs migration
            if isinstance(data, list):
                word_lower = file_path.stem.lower()
                
                # Special cases if any
                sense_id = word_lower
                meaning = word_lower
                context = [word_lower]
                pos = ["noun"]
                
                # If it matches BAT_CRICKET or BAT_ANIMAL, we can give it better context
                if word_lower == 'bat_cricket':
                    sense_id = 'bat_cricket'
                    meaning = 'cricket bat'
                    context = ["cricket", "ball", "wicket", "game", "hit"]
                elif word_lower == 'bat_animal':
                    sense_id = 'bat_animal'
                    meaning = 'animal bat'
                    context = ["fly", "night", "cave", "wings", "mammal", "animal", "saw", "dark"]
                
                new_data = {
                    "sense_id": sense_id,
                    "meaning": meaning,
                    "pos": pos,
                    "context": context,
                    "poses": data
                }
                
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(new_data, f, indent=4, ensure_ascii=False)
                print(f"Migrated: {file_path.name}")
            else:
                print(f"Skipped (already dict): {file_path.name}")
        except Exception as e:
            print(f"Error migrating {file_path.name}: {e}")

if __name__ == '__main__':
    migrate()
