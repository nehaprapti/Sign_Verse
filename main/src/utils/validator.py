from typing import List, Dict, Tuple, Any

from src.utils.gesture_store import load_gesture_db
from src.core.senses import SENSE_DATABASE, PHRASE_DATABASE, disambiguate_word

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

    def resolve_sequence(self, tokens: List[str]) -> List[Dict[str, Any]]:
        """
        Resolves a sequence of tokens using the hierarchy:
        1. Phrase patterns (e.g. "HOW ARE YOU")
        2. Word sense disambiguation (e.g. "BAT" -> "BAT_CRICKET" or "BAT_ANIMAL")
        3. Simple word database lookup
        4. Fingerspelling fallback
        """
        resolved_sequence = []
        i = 0
        n = len(tokens)
        
        while i < n:
            # 1. Try phrase matching (up to 3 words)
            phrase_matched = False
            for length in [3, 2]:
                if i + length <= n:
                    phrase_tokens = tokens[i:i+length]
                    phrase_str = " ".join(phrase_tokens).upper()
                    if phrase_str in PHRASE_DATABASE:
                        gesture = PHRASE_DATABASE[phrase_str]
                        resolved_sequence.append({
                            'original_tokens': phrase_tokens,
                            'resolved_token': gesture,
                            'type': 'phrase',
                            'is_word': gesture in self.db.get('Word', {}),
                            'fully_supported': gesture in self.db.get('Word', {})
                        })
                        i += length
                        phrase_matched = True
                        break
            
            if phrase_matched:
                continue
                
            # 2. Try sense disambiguation
            token = tokens[i]
            token_upper = token.upper()
            
            if token_upper in SENSE_DATABASE:
                resolved_gesture = disambiguate_word(token_upper, tokens)
                if resolved_gesture:
                    is_word = resolved_gesture in self.db.get('Word', {})
                    resolved_sequence.append({
                        'original_tokens': [token],
                        'resolved_token': resolved_gesture,
                        'type': 'sense',
                        'is_word': is_word,
                        'fully_supported': is_word
                    })
                    i += 1
                    continue
            
            # 3. Simple word database lookup
            is_word = token_upper in self.db.get('Word', {})
            
            # Check letters (for fingerspelling fallback)
            letters = []
            all_letters_found = True
            for char in token_upper:
                found = char in self.db.get('Letter', {})
                letters.append({'char': char, 'found': found})
                if not found:
                    all_letters_found = False
            
            resolved_sequence.append({
                'original_tokens': [token],
                'resolved_token': token_upper,
                'type': 'word' if is_word else 'fingerspelling',
                'is_word': is_word,
                'letters': letters,
                'fully_supported': is_word or all_letters_found
            })
            i += 1
            
        return resolved_sequence

    def validate_token(self, token: str) -> Dict[str, Any]:
        """
        Legacy validation for single token.
        """
        token_upper = token.upper()
        is_word = token_upper in self.db.get('Word', {})
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
        """Validates a list of tokens using legacy validate_token."""
        return [self.validate_token(t) for t in tokens]

