import importlib

def get_animation(char):
    try:
        module = importlib.import_module(f'src.animations.alphabets.{char.upper()}')
        return module.get_animation()
    except ImportError:
        return []
