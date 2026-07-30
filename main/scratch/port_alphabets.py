import os
import re
import math

source_dir = r"d:\IMPORTANT_FILES\PROJECT_FILES\Sign_Verse\client\src\Animations\Alphabets"
target_file = r"d:\IMPORTANT_FILES\PROJECT_FILES\Sign_Verse\thiga\src\animations\alphabet.py"

alphabet_data = {}

# Regex to find animation blocks and lines
# This matches the content of the function
line_re = re.compile(r'animations\.push\(\["([^"]+)", "([^"]+)", "([^"]+)", ([^,]+), "([^"]+)"\]\);')

def parse_value(val_str):
    val_str = val_str.strip()
    val_str = val_str.replace("Math.PI", "PI")
    # We'll evaluate it later or keep it as a string to be executed in Python
    # Actually, let's just keep the formula as a string and replace Math.PI with math.pi later
    return val_str

for filename in os.listdir(source_dir):
    if filename.endswith(".js"):
        char = filename.replace(".js", "").upper()
        if len(char) != 1: continue # Skip non-alphabet files if any
        
        with open(os.path.join(source_dir, filename), 'r') as f:
            content = f.read()
            
        # Split into blocks by "animations = []" reset
        blocks = content.split("animations = []")
        char_animations = []
        
        for block in blocks:
            steps = []
            matches = line_re.findall(block)
            for bone, prop, axis, val, direction in matches:
                py_val = parse_value(val)
                steps.append((bone, axis, py_val))
            if steps:
                char_animations.append(steps)
        
        alphabet_data[char] = char_animations

# Generate the Python file
with open(target_file, 'w') as f:
    f.write("import math\n\nPI = math.pi\n\n")
    f.write("ALPHABET_DATA = {\n")
    for char, anims in sorted(alphabet_data.items()):
        f.write(f"    '{char}': [\n")
        for step in anims:
            f.write("        [\n")
            for bone, axis, val in step:
                # Handle the evaluation of the value string safely
                # Replace PI with math.pi for eval if it's a simple formula
                # For safety, we can just keep them as formulas
                f.write(f"            ('{bone}', '{axis}', {val}),\n")
            f.write("        ],\n")
        f.write("    ],\n")
    f.write("}\n\n")
    f.write("""
def get_alphabet_animation(letter: str):
    \"\"\"Returns the animation sequence for a given letter.\"\"\"
    return ALPHABET_DATA.get(letter.upper(), [])
""")

print(f"Successfully ported {len(alphabet_data)} alphabets to {target_file}")
