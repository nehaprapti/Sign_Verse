from typing import List

class GrammarEngine:
    """
    Implements Indian Sign Language (ISL) grammar rules.
    Standard English: Subject-Verb-Object (SVO)
    ISL: Time-Topic-Object-Action (TASO/SOV)
    """
    
    STOP_WORDS = {'a', 'an', 'the', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being'}
    
    @staticmethod
    def preprocess(text: str) -> List[str]:
        """Tokenize and clean text."""
        # Simple tokenization for now
        tokens = text.upper().replace(',', '').replace('.', '').replace('?', '').split()
        # Remove stop words
        return [t for t in tokens if t.lower() not in GrammarEngine.STOP_WORDS]

    @staticmethod
    def reorder(tokens: List[str]) -> List[str]:
        """
        Apply basic ISL reordering rules.
        For a simple prototype, we'll implement SOV (Subject-Object-Verb).
        """
        if len(tokens) <= 2:
            return tokens
        
        # This is a very simplified rule-based engine.
        # In a real system, we'd use POS tagging.
        # For now, let's just move common Wh-words to the end.
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
