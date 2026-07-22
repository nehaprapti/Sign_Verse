import math
from typing import List, Tuple

def get_word_animation(word: str) -> List[List[Tuple[str, str, float]]]:
    word = word.upper()
    if word == 'YOU':
        return [
            [
                ("mixamorigRightHandMiddle1", "z", math.pi/2),
                ("mixamorigRightHandMiddle2", "z", math.pi/2),
                ("mixamorigRightHandMiddle3", "z", math.pi/2),
                ("mixamorigRightHandRing1", "z", math.pi/2),
                ("mixamorigRightHandRing2", "z", math.pi/2),
                ("mixamorigRightHandRing3", "z", math.pi/2),
                ("mixamorigRightHandPinky1", "z", math.pi/2),
                ("mixamorigRightHandPinky2", "z", math.pi/2),
                ("mixamorigRightHandPinky3", "z", math.pi/2),
                ("mixamorigRightHandThumb2", "y", -math.pi/2),
                ("mixamorigRightArm", "x", -math.pi/6),
                ("mixamorigRightHand", "x", math.pi/6),
                ("mixamorigRightHand", "z", math.pi/3),
                ("mixamorigRightHand", "y", -math.pi/6),
            ],
            [
                ("mixamorigRightHandMiddle1", "z", 0),
                ("mixamorigRightHandMiddle2", "z", 0),
                ("mixamorigRightHandMiddle3", "z", 0),
                ("mixamorigRightHandRing1", "z", 0),
                ("mixamorigRightHandRing2", "z", 0),
                ("mixamorigRightHandRing3", "z", 0),
                ("mixamorigRightHandPinky1", "z", 0),
                ("mixamorigRightHandPinky2", "z", 0),
                ("mixamorigRightHandPinky3", "z", 0),
                ("mixamorigRightHandThumb2", "y", 0),
                ("mixamorigRightArm", "x", 0),
                ("mixamorigRightHand", "x", 0),
                ("mixamorigRightHand", "z", 0),
                ("mixamorigRightHand", "y", 0),
            ]
        ]
    elif word == 'HOME':
        return [
            [
                ("mixamorigLeftHandThumb1", "x", -math.pi/3),
                ("mixamorigLeftForeArm", "x", math.pi/70),
                ("mixamorigLeftForeArm", "z", -math.pi/7),
                ("mixamorigLeftArm", "x", -math.pi/6),
                ("mixamorigRightHandThumb1", "x", -math.pi/3),
                ("mixamorigRightForeArm", "x", math.pi/70),
                ("mixamorigRightForeArm", "z", math.pi/7),
                ("mixamorigRightArm", "x", -math.pi/6),
            ],
            [
                ("mixamorigLeftForeArm", "y", -math.pi/2.5),
                ("mixamorigRightForeArm", "y", math.pi/2.5),
            ],
            [
                ("mixamorigLeftHandThumb1", "x", 0),
                ("mixamorigLeftForeArm", "x", 0),
                ("mixamorigLeftForeArm", "z", 0),
                ("mixamorigLeftArm", "x", 0),
                ("mixamorigRightHandThumb1", "x", 0),
                ("mixamorigRightForeArm", "x", 0),
                ("mixamorigRightForeArm", "z", 0),
                ("mixamorigRightArm", "x", 0),
                ("mixamorigLeftForeArm", "y", -math.pi/1.5),
                ("mixamorigRightForeArm", "y", math.pi/1.5),
            ]
        ]
    elif word == 'PERSON':
        return [
            [
                ("mixamorigRightArm", "x", -math.pi/6),
                ("mixamorigRightForeArm", "y", math.pi/4),
                ("mixamorigRightHand", "z", math.pi/6),
            ],
            [
                ("mixamorigRightArm", "x", 0),
                ("mixamorigRightForeArm", "y", math.pi/1.5),
                ("mixamorigRightHand", "z", 0),
            ]
        ]
    elif word == 'TIME':
        return [
            [
                ("mixamorigLeftArm", "x", -math.pi/6),
                ("mixamorigLeftForeArm", "y", -math.pi/3),
                ("mixamorigRightArm", "x", -math.pi/6),
                ("mixamorigRightForeArm", "y", math.pi/4),
                ("mixamorigRightHand", "x", math.pi/4),
            ],
            [
                ("mixamorigLeftArm", "x", 0),
                ("mixamorigLeftForeArm", "y", -math.pi/1.5),
                ("mixamorigRightArm", "x", 0),
                ("mixamorigRightForeArm", "y", math.pi/1.5),
                ("mixamorigRightHand", "x", 0),
            ]
        ]
    return None

WORD_LIST = ['YOU', 'HOME', 'PERSON', 'TIME']
