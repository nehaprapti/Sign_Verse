import time
import math
from typing import List, Dict, Any, Tuple

class AnimationEngine:
    def __init__(self):
        self.animations = []
        self.pending = False
        self.current_word_index = 0
        self.speed = 0.1
        self.pause_ms = 800
        
        # Current state of all bones
        self.bone_state = {}

    def queue_animation(self, steps: List[List[Tuple[str, str, float]]]):
        """Queue a new sequence of animation steps."""
        for step in steps:
            self.animations.append(step)

    def update_bone(self, bone_name: str, axis: str, target: float) -> bool:
        key = (bone_name, axis)
        current = self.bone_state.get(key, 0.0)
        
        diff = target - current
        if abs(diff) < 0.005:
            self.bone_state[key] = target
            return True
            
        # Proportional move for smooth easing (Ease-out)
        # Move 20% of the remaining distance each frame
        step = diff * 0.2
        
        # Ensure a minimum movement so it doesn't take forever to reach tiny differences
        min_step = 0.01
        if abs(step) < min_step:
            step = min_step if diff > 0 else -min_step
            
        new_val = current + step
        
        # Clip to target to prevent overshoot
        if (diff > 0 and new_val > target) or (diff < 0 and new_val < target):
            new_val = target
            
        self.bone_state[key] = new_val
        return abs(new_val - target) < 0.001

    def step(self) -> Dict[str, float]:
        """
        Processes one frame of animation.
        Returns the delta changes to be applied to the 3D model.
        """
        if not self.animations:
            self.pending = False
            return {}

        # Handle pause state
        if hasattr(self, 'pause_until') and time.time() < self.pause_until:
            return {}

        current_step = self.animations[0]
        
        # An empty step list acts as a pause marker
        if not current_step:
            self.animations.pop(0)
            self.pause_until = time.time() + (self.pause_ms / 1000.0)
            return {}

        all_reached = True
        updates = {}
        
        for bone, axis, target in current_step:
            reached = self.update_bone(bone, axis, target)
            if not reached:
                all_reached = False
            updates[f"{bone}.rotation.{axis}"] = self.bone_state[(bone, axis)]

        if all_reached:
            self.animations.pop(0)
            
        return updates
