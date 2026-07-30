import os
import re

source_dir = r"d:\IMPORTANT_FILES\PROJECT_FILES\Sign_Verse\client\src\Animations\Alphabets"
target_dir = r"d:\IMPORTANT_FILES\PROJECT_FILES\Sign_Verse\thiga\src\animations\alphabets"

if not os.path.exists(target_dir):
    os.makedirs(target_dir)

# Regex to find animation lines
line_re = re.compile(r'animations\.push\(\["([^"]+)", "([^"]+)", "([^"]+)", ([^,]+), "([^"]+)"\]\);')

def parse_value(val_str):
    return val_str.strip().replace("Math.PI", "math.pi")

# Create __init__.py for the package
with open(os.path.join(target_dir, "__init__.py"), 'w') as f:
    f.write("from .registry import get_animation\n")

all_chars = []

for filename in os.listdir(source_dir):
    if filename.endswith(".js"):
        char = filename.replace(".js", "").upper()
        if len(char) != 1: continue
        
        all_chars.append(char)
        with open(os.path.join(source_dir, filename), 'r') as f:
            content = f.read()
            
        blocks = content.split("animations = []")
        
        with open(os.path.join(target_dir, f"{char}.py"), 'w') as f_out:
            f_out.write("import math\n\n")
            f_out.write(f"def get_animation():\n")
            f_out.write(f"    return [\n")
            for block in blocks:
                matches = line_re.findall(block)
                if not matches: continue
                f_out.write("        [\n")
                for bone, prop, axis, val, direction in matches:
                    py_val = parse_value(val)
                    f_out.write(f"            ('{bone}', '{axis}', {py_val}),\n")
                f_out.write("        ],\n")
            f_out.write(f"    ]\n")

# Create a registry file to easily access them
with open(os.path.join(target_dir, "registry.py"), 'w') as f:
    f.write("import importlib\n\n")
    f.write("def get_animation(char):\n")
    f.write("    try:\n")
    f.write("        module = importlib.import_module(f'src.animations.alphabets.{char.upper()}')\n")
    f.write("        return module.get_animation()\n")
    f.write("    except ImportError:\n")
    f.write("        return []\n")

print(f"Ported {len(all_chars)} individual alphabet files to {target_dir}")
