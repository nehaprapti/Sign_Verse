import sys
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from src.core.grammar import GrammarEngine
from src.utils.validator import SignValidator

def run_tests():
    grammar = GrammarEngine()
    validator = SignValidator(db_path='gestures.json')
    
    print("==================================================")
    print("Testing Sign Intelligence Local Pipeline (Path 1)")
    print("==================================================")
    
    # Test 1: Phrase & Sentence Mapping
    print("\n--- Test 1: Phrase Mapping ---")
    input_text1 = "How are you"
    tokens1 = grammar.preprocess(input_text1)
    reordered1 = grammar.reorder(tokens1)
    resolved1 = validator.resolve_sequence(reordered1)
    print(f"Input: '{input_text1}'")
    print(f"Tokens: {tokens1}")
    print(f"Resolved Sequence:")
    for item in resolved_sequence_format(resolved1):
        print(f"  - {item}")
    
    # Test 2: Word Sense Disambiguation (Cricket)
    print("\n--- Test 2: Sense Disambiguation (Cricket Bat) ---")
    input_text2 = "I played cricket with a bat"
    tokens2 = grammar.preprocess(input_text2)
    normalized2, tenses2 = grammar.parse_verbs_and_tenses(tokens2)
    reordered2 = grammar.reorder(normalized2)
    resolved2 = validator.resolve_sequence(reordered2)
    print(f"Input: '{input_text2}'")
    print(f"Normalized Tokens: {normalized2}")
    print(f"Detected Tenses: {tenses2}")
    print(f"Resolved Sequence:")
    for item in resolved_sequence_format(resolved2):
        print(f"  - {item}")
        
    # Test 3: Word Sense Disambiguation (Animal)
    print("\n--- Test 3: Sense Disambiguation (Animal Bat) ---")
    input_text3 = "saw a bat at night"
    tokens3 = grammar.preprocess(input_text3)
    normalized3, tenses3 = grammar.parse_verbs_and_tenses(tokens3)
    reordered3 = grammar.reorder(normalized3)
    resolved3 = validator.resolve_sequence(reordered3)
    print(f"Input: '{input_text3}'")
    print(f"Normalized Tokens: {normalized3}")
    print(f"Detected Tenses: {tenses3}")
    print(f"Resolved Sequence:")
    for item in resolved_sequence_format(resolved3):
        print(f"  - {item}")

def resolved_sequence_format(sequence):
    return [
        f"{' '.join(item['original_tokens'])} -> {item['resolved_token']} ({item['type'].upper()}) [Supported: {item['fully_supported']}]"
        for item in sequence
    ]

if __name__ == '__main__':
    run_tests()
