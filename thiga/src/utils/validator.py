from typing import List, Dict, Tuple, Any

from src.utils.gesture_store import load_gesture_db

class SignValidator:
    def __init__(self, db_path: str = 'gestures.json'):
        self.db_path = db_path
        self.db = {}
        self.load_db()

    def load_db(self):
        """Loads or reloads the gesture database."""
        try:
            self.db = load_gesture_db(self.db_path)
        except Exception as e:
            print(f"Error loading database: {e}")
            self.db = {'Word': {}, 'Letter': {}}

    def validate_token(self, token: str) -> Dict[str, Any]:
        """
        Validates a single token (word).
        Returns a dict with:
        - 'found': bool (is it in DB as a word?)
        - 'letters_found': list of bool (which letters are in DB?)
        - 'fully_supported': bool (can it be fully signed?)
        """
        token_upper = token.upper()
        
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
