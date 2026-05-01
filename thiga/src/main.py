import sys
import os
from pathlib import Path

# Add the project root (thiga) to path to allow 'from src...' imports
sys.path.append(str(Path(__file__).parent.parent))

from nicegui import ui, app
import numpy as np

from src.utils.language_utils import detect_and_translate
from src.core.grammar import GrammarEngine
from src.core.engine import AnimationEngine
from src.animations.alphabet import get_alphabet_animation
from src.animations.word import get_word_animation, WORD_LIST

# Storage for avatar bones in the 3D scene
bones_in_scene = {}

class SignVerseApp:
    def __init__(self):
        self.engine = AnimationEngine()
        self.grammar = GrammarEngine()
        self.avatar_name = 'xbot'
        self.input_text = ""
        
    def get_json_animation(self, token):
        import json
        import os
        db_path = 'gestures.json'
        if not os.path.exists(db_path):
            return None
        
        try:
            with open(db_path, 'r') as f:
                db = json.load(f)
            
            token = token.upper()
            # Check Words first, then Letters
            poses = db.get('Word', {}).get(token) or db.get('Letter', {}).get(token)
            
            if poses:
                # Convert JSON poses to Engine steps
                anim_steps = []
                for pose in poses:
                    step = []
                    for bone, rot in pose.items():
                        for axis in ['x', 'y', 'z']:
                            step.append((bone, axis, rot[axis]))
                    anim_steps.append(step)
                return anim_steps
        except: pass
        return None

    def handle_translation(self, text):
        if not text or not text.strip():
            ui.notify('Please enter some text', type='warning')
            return

        ui.notify('Processing translation...')
        result = detect_and_translate(text)
        translated = result['translated_text']
        
        tokens = self.grammar.preprocess(translated)
        reordered = self.grammar.reorder(tokens)
        
        self.engine.animations = []
        
        for token in reordered:
            # 1. Try JSON Database first (Custom gestures)
            json_anim = self.get_json_animation(token)
            if json_anim:
                self.engine.queue_animation(json_anim)
                self.engine.animations.append([]) # Pause
                continue

            # 2. Try Hardcoded Words
            word_anim = get_word_animation(token)
            if word_anim:
                self.engine.queue_animation(word_anim)
                self.engine.animations.append([]) 
                continue
            
            # 3. Fallback to fingerspelling
            for char in token:
                # Try JSON for individual letters first
                json_char_anim = self.get_json_animation(char)
                if json_char_anim:
                    self.engine.queue_animation(json_char_anim)
                else:
                    anim = get_alphabet_animation(char)
                    if anim:
                        self.engine.queue_animation(anim)
                self.engine.animations.append([]) 
    
    def update_loop(self):
        """Called every frame to update the 3D scene."""
        if not hasattr(self, 'scene'):
            return
        updates = self.engine.step()
        if updates:
            # Send updates to JS for bone manipulation
            ui.run_javascript(f'if (window.updateAvatarBones) window.updateAvatarBones({self.scene.id}, {updates});')

app.add_static_files('/assets', 'assets')

@ui.page('/')
def main_page():
    # Custom JS to handle GLTF bone manipulation
    ui.add_head_html('''
    <script>
    window.updateAvatarBones = (scene_id, updates) => {
        const sceneObj = window['scene_c' + scene_id];
        if (!sceneObj) return;
        const model = sceneObj.children.find(c => c.type === "Group");
        if (!model) return;
        for (const [key, value] of Object.entries(updates)) {
            const [boneName, , axis] = key.split(".");
            const bone = model.getObjectByName(boneName);
            if (bone) {
                bone.rotation[axis] = value;
            }
        }
    };
    window.updateModelPose = (scene_id, rx, ry, rz, x, y) => {
        const sceneObj = window['scene_c' + scene_id];
        if (!sceneObj) return;
        const model = sceneObj.children.find(c => c.type === "Group");
        if (model) {
            model.rotation.set(rx, ry, rz);
            model.position.x = x;
            model.position.y = y;
        }
    };

    window.getModelPose = (scene_id) => {
        const sceneObj = window['scene_c' + scene_id];
        if (!sceneObj) return null;
        const model = sceneObj.children.find(c => c.type === "Group");
        if (!model) return null;
        return {
            rx: model.rotation.x,
            ry: model.rotation.y,
            rz: model.rotation.z,
            x: model.position.x,
            y: model.position.y
        };
    };

    window.updateBoneRotation = (scene_id, bone_name, rx, ry, rz) => {
        const sceneObj = window['scene_c' + scene_id];
        if (!sceneObj) return;
        const model = sceneObj.children.find(c => c.type === "Group");
        if (!model) return;
        const bone = model.getObjectByName(bone_name);
        if (bone) {
            bone.rotation.set(rx, ry, rz);
        }
    };

    window.getBoneRotation = (scene_id, bone_name) => {
        const sceneObj = window['scene_c' + scene_id];
        if (!sceneObj) return null;
        const model = sceneObj.children.find(c => c.type === "Group");
        if (!model) return null;
        const bone = model.getObjectByName(bone_name);
        if (bone) {
            return {
                x: bone.rotation.x,
                y: bone.rotation.y,
                z: bone.rotation.z
            };
        }
        return null;
    };

    window.captureCurrentPose = (scene_id) => {
        const sceneObj = window['scene_c' + scene_id];
        if (!sceneObj) return null;
        const model = sceneObj.children.find(c => c.type === "Group");
        if (!model) return null;
        
        const bones = {};
        // Optimization: Find the first SkinnedMesh to get the skeleton directly
        let skeleton = null;
        model.traverse(node => {
            if (node.isSkinnedMesh && node.skeleton) {
                skeleton = node.skeleton;
            }
        });

        if (skeleton) {
            skeleton.bones.forEach(bone => {
                // Only capture bones we likely care about for signing
                if (bone.name.toLowerCase().includes('arm') || 
                    bone.name.toLowerCase().includes('hand') || 
                    bone.name.toLowerCase().includes('forearm') ||
                    bone.name.toLowerCase().includes('finger') ||
                    bone.name.toLowerCase().includes('thumb') ||
                    bone.name.toLowerCase().includes('index') ||
                    bone.name.toLowerCase().includes('middle') ||
                    bone.name.toLowerCase().includes('ring') ||
                    bone.name.toLowerCase().includes('pinky')) {
                    bones[bone.name] = {
                        x: Number(bone.rotation.x.toFixed(4)),
                        y: Number(bone.rotation.y.toFixed(4)),
                        z: Number(bone.rotation.z.toFixed(4))
                    };
                }
            });
        }
        return bones;
    };
    </script>
    ''')
    
    app_logic = SignVerseApp()
    
    with ui.header().classes('bg-slate-900 text-white p-4 justify-between items-center'):
        ui.label('SignVerse Python Port').classes('text-2xl font-bold')

    with ui.row().classes('w-full h-screen no-wrap items-stretch p-4 gap-4'):
        # Left Panel: Controls
        left_panel = ui.column().classes('w-1/4 min-w-[350px] bg-slate-100 p-6 rounded-xl shadow-lg overflow-y-auto')
        with left_panel:
            ui.label('Conversion Toolkit').classes('text-xl font-semibold mb-4')
            
            text_input = ui.input('Enter text').classes('w-full mb-4')
            
            with ui.row().classes('w-full justify-between'):
                ui.button('Sign it!', on_click=lambda: app_logic.handle_translation(text_input.value)).props('elevated')
                ui.button('Clear', on_click=lambda: text_input.set_value('')).props('outline')
            
            ui.separator().classes('my-6')
            
            with ui.expansion('Calibration & Tracking', icon='settings').classes('w-full bg-white border rounded-lg shadow-sm'):
                ui.label('Avatar Calibration').classes('text-lg font-medium mt-2')
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('AV-RX:').classes('w-12')
                    rx_slider = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.11).classes('grow')
                    ui.number(step=0.01).bind_value(rx_slider).classes('w-20').props('dense outlined')
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('AV-RY:').classes('w-12')
                    ry_slider = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.07).classes('grow')
                    ui.number(step=0.01).bind_value(ry_slider).classes('w-20').props('dense outlined')
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('AV-RZ:').classes('w-12')
                    rz_slider = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.18).classes('grow')
                    ui.number(step=0.01).bind_value(rz_slider).classes('w-20').props('dense outlined')
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('AV-X:').classes('w-12')
                    avx_slider = ui.slider(min=-5.0, max=5.0, step=0.01, value=0.28).classes('grow')
                    ui.number(step=0.01).bind_value(avx_slider).classes('w-20').props('dense outlined')
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('AV-Y:').classes('w-12')
                    avy_slider = ui.slider(min=-2.0, max=2.0, step=0.01, value=-0.19).classes('grow')
                    ui.number(step=0.01).bind_value(avy_slider).classes('w-20').props('dense outlined')
                
                ui.separator().classes('my-2')
                ui.label('Camera Calibration').classes('text-lg font-medium')
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('CAM-Y:').classes('w-12')
                    camy_slider = ui.slider(min=0.0, max=3.0, step=0.01, value=1.01).classes('grow')
                    ui.number(step=0.01).bind_value(camy_slider).classes('w-20').props('dense outlined')
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('CAM-Z:').classes('w-12')
                    camz_slider = ui.slider(min=0.1, max=5.0, step=0.01, value=1.35).classes('grow')
                    ui.number(step=0.01).bind_value(camz_slider).classes('w-20').props('dense outlined')

                ui.button('Log Settings', on_click=lambda: ui.notify(f'RX: {rx_slider.value:.2f}, RY: {ry_slider.value:.2f}, RZ: {rz_slider.value:.2f}, AV-X: {avx_slider.value:.2f}, AV-Y: {avy_slider.value:.2f}, CAM-Y: {camy_slider.value:.2f}, CAM-Z: {camz_slider.value:.2f}')).classes('w-full mt-2')

                ui.separator().classes('my-4')
                
                ui.label('Live Scene Tracker').classes('text-lg font-medium')
                live_tracker_label = ui.label('Move controls to update...').classes('text-sm text-slate-600 font-mono bg-slate-100 p-2 rounded w-full whitespace-pre')
                
                async def poll_scene():
                    try:
                        cam = await scene.get_camera()
                        cam_str = f"CAM-Y: {cam['position']['y']:.2f} | CAM-Z: {cam['position']['z']:.2f}" if cam else ""
                        model_data = await ui.run_javascript(f'window.getModelPose({scene.id})')
                        model_str = f"AV-RX: {model_data['rx']:.2f} | AV-RY: {model_data['ry']:.2f} | AV-RZ: {model_data['rz']:.2f} | AV-X: {model_data['x']:.2f} | AV-Y: {model_data['y']:.2f}" if model_data else ""
                        live_tracker_label.set_text(f"{cam_str}\n{model_str}")
                    except: pass
                
                ui.timer(0.5, poll_scene)

            ui.separator().classes('my-6')

            with ui.expansion('Avatar Stimulator', icon='accessibility').classes('w-full bg-white border rounded-lg shadow-sm'):
                ui.label('Stimulate bones and record poses').classes('text-sm text-slate-500 mb-2')
                
                with ui.row().classes('w-full gap-2'):
                    sim_name = ui.input('Name (e.g. A, HOME)').classes('grow')
                    sim_cat = ui.select(['Letter', 'Word'], value='Letter').classes('w-24')

                with ui.row().classes('w-full items-center justify-between mt-2'):
                    selected_side = ui.radio(['Left', 'Right'], value='Right').props('inline')
                    mirror_mode = ui.checkbox('Mirror Arm').classes('text-sm')
                
                with ui.row().classes('w-full items-center gap-2 mt-2'):
                    ui.label('Bone:').classes('w-12')
                    selected_bone = ui.select(['Arm', 'ForeArm', 'Hand', 'HandThumb1', 'HandThumb2', 'HandIndex1', 'HandMiddle1', 'HandRing1', 'HandPinky1'], value='Arm').classes('grow')
                
                def update_bone_sim():
                    side = selected_side.value
                    bone = f'mixamorig{side}{selected_bone.value}'
                    ui.run_javascript(f'window.updateBoneRotation({scene.id}, "{bone}", {sim_rx.value}, {sim_ry.value}, {sim_rz.value})')
                    
                    if mirror_mode.value:
                        other_side = 'Left' if side == 'Right' else 'Right'
                        other_bone = f'mixamorig{other_side}{selected_bone.value}'
                        # Mirror Y and Z rotations for symmetrical movement
                        ui.run_javascript(f'window.updateBoneRotation({scene.id}, "{other_bone}", {sim_rx.value}, {-sim_ry.value}, {-sim_rz.value})')

                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('RX:').classes('w-8')
                    sim_rx = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.0).classes('grow').on_value_change(update_bone_sim)
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('RY:').classes('w-8')
                    sim_ry = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.0).classes('grow').on_value_change(update_bone_sim)
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('RZ:').classes('w-8')
                    sim_rz = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.0).classes('grow').on_value_change(update_bone_sim)

                ui.separator().classes('my-4')
                
                ui.label('Live Points Monitor').classes('text-xs font-bold text-slate-400 uppercase tracking-wider')
                sim_live_monitor = ui.label('Select a bone to see points...').classes('text-xs font-mono bg-slate-50 p-2 rounded w-full')

                async def refresh_sim_monitor():
                    try:
                        bone_name = f'mixamorig{selected_side.value}{selected_bone.value}'
                        data = await ui.run_javascript(f'window.getBoneRotation({scene.id}, "{bone_name}")', timeout=0.5)
                        cam = await scene.get_camera()
                        
                        bone_str = f"{bone_name}: RX:{data['x']:.3f} RY:{data['y']:.3f} RZ:{data['z']:.3f}" if data else "Bone not found"
                        cam_str = f"CAM-Y: {cam['position']['y']:.2f} | CAM-Z: {cam['position']['z']:.2f}" if cam else ""
                        
                        sim_live_monitor.set_text(f"{bone_str}\n{cam_str}")
                    except Exception:
                        # Ignore timeouts in background monitor to prevent UI spam
                        pass
                
                ui.timer(0.5, refresh_sim_monitor)

                ui.separator().classes('my-4')

                ui.label('Pose Sequencer').classes('text-xs font-bold text-slate-400 uppercase tracking-wider')
                marked_poses_label = ui.label('No poses marked yet.').classes('text-sm italic text-slate-500 mb-1')
                marked_list_container = ui.row().classes('w-full flex-wrap gap-1 mb-2')
                
                if not hasattr(app_logic, 'marked_poses'):
                    app_logic.marked_poses = []
                    app_logic.loop_enabled = False

                def update_marked_ui():
                    marked_list_container.clear()
                    with marked_list_container:
                        for i, _ in enumerate(app_logic.marked_poses):
                            ui.badge(f'Pose {i+1}', color='blue').classes('text-[10px] px-2 py-1')
                    marked_poses_label.set_text(f'{len(app_logic.marked_poses)} poses marked')

                async def mark_pose():
                    try:
                        data = await ui.run_javascript(f'window.captureCurrentPose({scene.id})', timeout=5.0)
                        if data:
                            app_logic.marked_poses.append(data)
                            update_marked_ui()
                            ui.notify(f'Pose {len(app_logic.marked_poses)} marked!')
                    except Exception as e:
                        ui.notify(f'Failed to mark pose: {str(e)}', type='negative')

                def play_sequence():
                    if not app_logic.marked_poses:
                        ui.notify('No poses to play!', type='warning')
                        return
                    
                    app_logic.engine.animations = []
                    for pose_data in app_logic.marked_poses:
                        # Combine ALL bone rotations for this pose into a SINGLE step
                        # So they move in parallel
                        all_bone_rotations = []
                        for bone, rot in pose_data.items():
                            for axis in ['x', 'y', 'z']:
                                all_bone_rotations.append((bone, axis, rot[axis]))
                        
                        app_logic.engine.animations.append(all_bone_rotations)
                        app_logic.engine.animations.append([]) # Pause marker between poses
                    
                    ui.notify('Playing sequence...')
                    
                def clear_marked():
                    app_logic.marked_poses = []
                    update_marked_ui()
                    ui.notify('Sequence cleared')

                import json
                import os

                def save_to_db():
                    if not app_logic.marked_poses:
                        ui.notify('No poses to save!', type='warning')
                        return
                    if not sim_name.value:
                        ui.notify('Please enter a Name first!', type='warning')
                        return
                    
                    db_path = 'gestures.json'
                    db = {}
                    if os.path.exists(db_path):
                        try:
                            with open(db_path, 'r') as f:
                                db = json.load(f)
                        except: pass
                    
                    cat = sim_cat.value
                    name = sim_name.value.upper()
                    
                    if cat not in db: db[cat] = {}
                    db[cat][name] = app_logic.marked_poses
                    
                    with open(db_path, 'w') as f:
                        json.dump(db, f, indent=4)
                    
                    ui.notify(f'Saved {name} to {db_path}!')

                with ui.row().classes('w-full gap-2 mt-2'):
                    ui.button('Mark Pose', on_click=mark_pose).classes('grow').props('icon=add_circle color=primary')
                    ui.button('Clear', on_click=clear_marked).classes('w-20').props('outline color=red')
                
                with ui.row().classes('w-full gap-2 mt-2'):
                    ui.button('Play Sequence', on_click=play_sequence).classes('grow').props('icon=play_arrow color=positive')
                    loop_btn = ui.button('Loop', on_click=lambda: toggle_loop()).classes('w-24')

                def toggle_loop():
                    app_logic.loop_enabled = not app_logic.loop_enabled
                    loop_btn.props(f'color={"primary" if app_logic.loop_enabled else "grey"}')
                    ui.notify(f'Looping {"ON" if app_logic.loop_enabled else "OFF"}')

                ui.button('Save to JSON Database', on_click=save_to_db).classes('w-full mt-2').props('icon=save color=secondary')

                ui.separator().classes('my-4')
                
                ui.label('Shortcuts').classes('text-xs font-bold text-slate-400 uppercase tracking-wider')
                
                def attention_pose():
                    # Reset Stimulator Sliders ONLY
                    # We do not touch Camera or Avatar Calibration to preserve the user's view
                    sim_rx.value = 0.0
                    sim_ry.value = 0.0
                    sim_rz.value = 0.0
                    
                    # Apply the bone reset
                    ui.run_javascript(f'''
                        const model = window['scene_c{scene.id}'].children.find(c => c.type === "Group");
                        if (model) {{
                            model.traverse(node => {{
                                if (node.isBone) {{
                                    if (node.name === "mixamorigRightArm") {{
                                        node.rotation.set(0.000, 0.000, 1.380);
                                    }} else if (node.name === "mixamorigLeftArm") {{
                                        node.rotation.set(0.000, 0.000, -1.380);
                                    }} else if (node.name.includes("Arm") || node.name.includes("Hand") || node.name.includes("ForeArm")) {{
                                        // Only reset arms and hands. Do NOT reset Hips or Spine,
                                        // as 0,0,0 is not the default standing pose for the root!
                                        node.rotation.set(0,0,0);
                                    }}
                                }}
                            }});
                        }}
                    ''')
                    
                    ui.notify('Attention! Arms and Hands reset to default pose.')

                ui.button('Attention (Reset)', on_click=attention_pose).classes('w-full mt-2').props('icon=straighten color=warning')

                ui.separator().classes('my-4')

                async def capture_pose():
                    try:
                        data = await ui.run_javascript(f'window.captureCurrentPose({scene.id})', timeout=5.0)
                        if data:
                            lines = [f"# Category: {sim_cat.value}, Name: {sim_name.value}", "("]
                            for bone, rot in data.items():
                                if any(abs(rot[axis]) > 0.01 for axis in ['x', 'y', 'z']):
                                    for axis in ['x', 'y', 'z']:
                                        if abs(rot[axis]) > 0.01:
                                            lines.append(f'    ("{bone}", "{axis}", {rot[axis]}),')
                            lines.append(")")
                            pose_output.set_value("\n".join(lines))
                            ui.notify(f'Pose for {sim_name.value} captured!')
                    except Exception as e:
                        ui.notify(f'Failed to capture pose: {str(e)}', type='negative')

                ui.button('Capture Current Pose', on_click=capture_pose).classes('w-full mt-2').props('color=secondary')
                pose_output = ui.textarea('Captured Pose Data').classes('w-full mt-2 font-mono text-xs').props('outlined readonly autogrow')

            ui.separator().classes('my-6')
            
            ui.label('Settings').classes('text-lg font-medium')
            ui.slider(min=0.01, max=0.5, value=0.05).on_value_change(lambda e: setattr(app_logic.engine, 'speed', e.value))
            ui.label('Animation Speed').classes('text-sm text-slate-500')

        # Right Panel: 3D Scene
        with ui.column().classes('flex-grow h-full bg-white rounded-xl shadow-inner relative overflow-hidden'):
            with ui.scene(width=None, height=None, grid=False).classes('w-full h-full') as scene:
                scene.move_camera(0, 1.01, 1.35, 0, 1.01, 0)
                model = scene.gltf('/assets/models/xbot.glb')
                model.rotate(0.11, 0.07, 0.18)
                model.move(0.28, -0.19, 0)
                scene.spot_light(color='#ffffff', intensity=10).move(2, 5, 2)
                app_logic.scene = scene

        def update_scene():
            ui.run_javascript(f'if (window.updateModelPose) window.updateModelPose({scene.id}, {rx_slider.value}, {ry_slider.value}, {rz_slider.value}, {avx_slider.value}, {avy_slider.value});')
            # Use duration=0 for instant snap, preventing camera interpolation glitches
            scene.move_camera(0, camy_slider.value, camz_slider.value, 0, camy_slider.value, 0, duration=0)
        
        for s in [rx_slider, ry_slider, rz_slider, avx_slider, avy_slider, camy_slider, camz_slider]:
            s.on_value_change(update_scene)

        # Apply initial pose after a short delay to ensure scene/model are ready
        ui.timer(0.2, update_scene, once=True)

        # Keyboard Shortcuts for Stimulator
        from nicegui import events
        def handle_key(e: events.KeyEventArguments):
            if e.action.keydown:
                step = 0.05
                # Only trigger if not typing in an input field
                if e.key == 'm' or e.key == 'M': mark_pose()
                elif e.key == 'a' or e.key == 'A': attention_pose()
                elif e.key == 'p' or e.key == 'P': play_sequence()
                elif e.key == 's' or e.key == 'S': save_to_db()
                elif e.key == 'c' or e.key == 'C': clear_marked()
                
                # Rotation Controls
                elif e.key.arrow_up: sim_rx.value = min(3.14, sim_rx.value + step)
                elif e.key.arrow_down: sim_rx.value = max(-3.14, sim_rx.value - step)
                elif e.key.arrow_right: sim_ry.value = min(3.14, sim_ry.value + step)
                elif e.key.arrow_left: sim_ry.value = max(-3.14, sim_ry.value - step)
                elif e.key == '[': sim_rz.value = max(-3.14, sim_rz.value - step)
                elif e.key == ']': sim_rz.value = min(3.14, sim_rz.value + step)

        ui.keyboard(on_key=handle_key)

    ui.timer(0.05, app_logic.update_loop)

ui.run(title='SignVerse Python', port=8081, reload=True)
