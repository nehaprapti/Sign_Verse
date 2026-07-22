from typing import List, Dict, Tuple, Any

class GrammarEngine:
    """
    Implements Indian Sign Language (ISL) grammar rules.
    Standard English: Subject-Verb-Object (SVO)
    ISL: Time-Topic-Object-Action (TASO/SOV)
    """
    
    # Pure noise/grammatical filler words that can be ignored in ISL
    STOP_WORDS = {'A', 'AN', 'THE', 'IS', 'AM', 'ARE', 'WAS', 'WERE', 'BE', 'BEEN', 'BEING', 'TO', 'OF', 'IN', 'ON', 'AT', 'FOR'}
    
    # Semantic connectors that we might map to specific pause or transition flags
    CONNECTING_WORDS = {'AND', 'BUT', 'BECAUSE', 'OR', 'WITH'}
    
    # Common verb conjugations mapped back to root verbs and their tenses/aspects
    VERB_MAPPING = {
        'PLAYED': ('PLAY', 'PAST'),
        'PLAYING': ('PLAY', 'CONTINUOUS'),
        'ATE': ('EAT', 'PAST'),
        'EATING': ('EAT', 'CONTINUOUS'),
        'DRANK': ('DRINK', 'PAST'),
        'DRINKING': ('DRINK', 'CONTINUOUS'),
        'WENT': ('GO', 'PAST'),
        'GOING': ('GO', 'CONTINUOUS'),
        'SAW': ('SEE', 'PAST'),
        'SEEING': ('SEE', 'CONTINUOUS'),
        'WALKED': ('WALK', 'PAST'),
        'WALKING': ('WALK', 'CONTINUOUS'),
        'WORKED': ('WORK', 'PAST'),
        'WORKING': ('WORK', 'CONTINUOUS'),
        'LEARNED': ('LEARN', 'PAST'),
        'LEARNING': ('LEARN', 'CONTINUOUS')
    }
    
    @staticmethod
    def preprocess(text: str) -> List[str]:
        """Tokenize and clean text."""
        # Simple tokenization and normalization
        tokens = text.upper().replace(',', '').replace('.', '').replace('?', '').split()
        
        # Filter stop words but keep connectors and letters for fingerspelling
        processed = []
        for t in tokens:
            if t in GrammarEngine.STOP_WORDS:
                continue
            processed.append(t)
        return processed

    @staticmethod
    def parse_verbs_and_tenses(tokens: List[str]) -> Tuple[List[str], List[Dict[str, str]]]:
        """
        Parses tokens to detect verb tenses/aspects and updates tokens to use base verb forms.
        Returns (normalized_tokens, tense_metadata)
        """
        normalized = []
        tenses = []
        
        for t in tokens:
            if t in GrammarEngine.VERB_MAPPING:
                root_verb, tense = GrammarEngine.VERB_MAPPING[t]
                normalized.append(root_verb)
                tenses.append({'verb': root_verb, 'original': t, 'tense': tense})
            else:
                normalized.append(t)
                
        return normalized, tenses

    @staticmethod
    def reorder(tokens: List[str]) -> List[str]:
        """
        Apply basic ISL reordering rules.
        For a simple prototype, we'll implement SOV (Subject-Object-Verb).
        """
        if len(tokens) <= 2:
            return tokens
        
        # Move common Wh-words to the end.
        WH_WORDS = {'WHAT', 'WHERE', 'WHEN', 'WHO', 'WHOM', 'WHICH', 'WHY', 'HOW'}
        
        reordered = []
        wh_found = None
        
        for t in tokens:
            if t in WH_WORDS:
                wh_found = t
            else:
                reordered.append(t)
        
        if wh_found:
            reordered.append(wh_found)
            
        return reordered

