import math

def get_animation():
    return [
        [
            ('mixamorigRightHandThumb1', 'x', -math.pi/6),
            ('mixamorigRightHandThumb1', 'z', -math.pi/15),
            ('mixamorigRightForeArm', 'z', math.pi/6),
            ('mixamorigRightForeArm', 'x', math.pi/18),
            ('mixamorigRightArm', 'x', -math.pi/60),
            ('mixamorigLeftHandThumb1', 'z', math.pi/12),
            ('mixamorigLeftHand', 'x', -math.pi/1.5),
            ('mixamorigLeftHand', 'z', math.pi/4),
            ('mixamorigLeftForeArm', 'z', -math.pi/6),
            ('mixamorigLeftForeArm', 'y', -math.pi/1.5),
            ('mixamorigLeftArm', 'x', -math.pi/30),
            ('mixamorigLeftArm', 'z', -math.pi/2.6),
        ],
        [
            ('mixamorigRightHandThumb1', 'x', 0),
            ('mixamorigRightHandThumb1', 'z', 0),
            ('mixamorigRightForeArm', 'z', 0),
            ('mixamorigRightForeArm', 'x', 0),
            ('mixamorigRightArm', 'x', 0),
            ('mixamorigLeftHandThumb1', 'z', 0),
            ('mixamorigLeftHand', 'x', 0),
            ('mixamorigLeftHand', 'z', 0),
            ('mixamorigLeftForeArm', 'z', 0),
            ('mixamorigLeftForeArm', 'y', -2.0943951023931953),
            ('mixamorigLeftArm', 'x', 0),
            ('mixamorigLeftArm', 'z', -1.0471975511965976),
        ],
    ]
