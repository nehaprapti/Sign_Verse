import json
import os
from typing import List, Dict, Tuple, Any

class SignValidator:
    def __init__(self, db_path: str = 'gestures.json'):
        self.db_path = db_path
        self.db = {}
        self.load_db()

    def _normalize_db(self, db: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize top-level gesture keys so legacy whitespace entries still resolve."""
        normalized = {}

        for category, gestures in (db or {}).items():
            if not isinstance(gestures, dict):
                normalized[category] = gestures
                continue

            normalized[category] = {}
            for name, poses in gestures.items():
                normalized_name = str(name).strip().upper()
                if not normalized_name:
                    continue
                normalized[category][normalized_name] = poses

        return normalized

    def load_db(self):
        """Loads or reloads the gesture database."""
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, 'r') as f:
                    self.db = self._normalize_db(json.load(f))
            except Exception as e:
                print(f"Error loading database: {e}")
                self.db = {}
        else:
            self.db = {}

    def validate_token(self, token: str) -> Dict[str, Any]:
        """
        Validates a single token (word).
        Returns a dict with:
        - 'found': bool (is it in DB as a word?)
        - 'letters_found': list of bool (which letters are in DB?)
        - 'fully_supported': bool (can it be fully signed?)
        """
        token_upper = token.strip().upper()
        
        # Check if it's a word
        is_word = token_upper in self.db.get('Word', {})
        
        # Check letters
        letters = []
        all_letters_found = True
        for char in token_upper:
            found = char in self.db.get('Letter', {})
            letters.append({'char': char, 'found': found})
            if not found:
                all_letters_found = False
        
        return {
            'token': token,
            'is_word': is_word,
            'letters': letters,
            'fully_supported': is_word or all_letters_found
        }

    def validate_text(self, tokens: List[str]) -> List[Dict[str, Any]]:
        """Validates a list of tokens."""
        return [self.validate_token(t) for t in tokens]
