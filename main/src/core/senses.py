from typing import List, Dict, Optional, Any

# Define the dictionary of word senses with context clues, POS, and mapped gesture file/name
SENSE_DATABASE: Dict[str, List[Dict[str, Any]]] = {
    "BAT": [
        {
            "sense_id": "BAT_CRICKET",
            "meaning": "cricket bat",
            "pos": ["noun"],
            "context": ["cricket", "play", "ball", "wicket", "game", "hit", "match", "played"],
            "gesture": "BAT_CRICKET"
        },
        {
            "sense_id": "BAT_ANIMAL",
            "meaning": "animal bat",
            "pos": ["noun"],
            "context": ["fly", "night", "cave", "wings", "mammal", "animal", "saw", "dark"],
            "gesture": "BAT_ANIMAL"
        }
    ]
}

# Define sentence-level and phrase-level mappings
PHRASE_DATABASE: Dict[str, str] = {
    "HOW ARE YOU": "HELLO",  # map to HELLO gesture
    "HOW YOU": "HELLO",      # handles case when 'are' is stripped as a stopword
    "PLAY CRICKET": "PLAY",  # map to PLAY gesture
}

def disambiguate_word(token: str, sentence_context: List[str]) -> Optional[str]:
    """
    Selects the best sense/gesture name for a given token based on surrounding context.
    If no specific context matches, returns the first sense as fallback, or None.
    """
    token_upper = token.upper()
    if token_upper not in SENSE_DATABASE:
        return None
    
    senses = SENSE_DATABASE[token_upper]
    context_words = [w.lower() for w in sentence_context if w.upper() != token_upper]
    
    best_sense = None
    max_score = -1
    
    for sense in senses:
        score = 0
        for ctx_word in context_words:
            # Simple keyword matching
            if ctx_word in sense["context"]:
                score += 1
        
        if score > max_score:
            max_score = score
            best_sense = sense
            
    return best_sense["gesture"] if best_sense else None
