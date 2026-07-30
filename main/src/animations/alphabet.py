from .alphabets.registry import get_animation as get_alpha_anim

def get_alphabet_animation(letter: str):
    """Returns the animation sequence for a given letter by looking up individual files."""
    return get_alpha_anim(letter)
