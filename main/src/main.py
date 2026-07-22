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
from src.utils.validator import SignValidator
from src.utils.gesture_store import load_word_gesture, save_gesture

# Storage for avatar bones in the 3D scene
bones_in_scene = {}

class SignVerseApp:
    def __init__(self):
        self.engine = AnimationEngine()
        self.grammar = GrammarEngine()
        self.avatar_name = 'xbot'
        self.input_text = ""
        self.avatar_color = '#3b82f6'  # Vibrant Blue
        self.validator = SignValidator()
        self.validation_results = []

        
    def get_json_animation(self, token):
        token = token.upper()
        # Check Words first, then Letters
        db = self.validator.db
        poses = db.get('Word', {}).get(token) or db.get('Letter', {}).get(token)
        
        if poses:
            # Convert JSON poses to Engine steps
            anim_steps = []
            for pose in poses:
                step = []
                for bone, rot in pose.items():
                    # Only use bone names that start with mixamorig
                    if not bone.startswith('mixamorig'):
                        continue
                    for axis in ['x', 'y', 'z']:
                        if axis in rot:
                            step.append((bone, axis, rot[axis]))
                anim_steps.append(step)
            return anim_steps
        return None

    def handle_translation(self, text, literal=False):
        if not text or not text.strip():
            ui.notify('Please enter some text', type='warning')
            return

        ui.notify('Processing signing...')
        
        if literal:
            translated = text
            ui.notify(f'Literal mode: signing "{text}" directly')
        else:
            result = detect_and_translate(text)
            translated = result['translated_text']
            if translated.upper() != text.upper():
                ui.notify(f'Translated: "{text}" -> "{translated}"')
        
        # 1. Preprocess into tokens
        tokens = self.grammar.preprocess(translated)
        
        # 2. Parse verbs, tenses, and continuous tenses
        normalized_tokens, tenses = self.grammar.parse_verbs_and_tenses(tokens)
        if tenses:
            for t_info in tenses:
                ui.notify(f"Detected Tense: {t_info['original']} ({t_info['tense']}) -> Base form: {t_info['verb']}")
        
        # 3. Apply grammar rules (Time-Object-Verb reordering)
        reordered = self.grammar.reorder(normalized_tokens)
        
        # 4. Resolve sequence using the hierarchy (Sentence/Phrase -> Sense -> Word -> Fingerspelling)
        resolved_sequence = self.validator.resolve_sequence(reordered)
        
        # Format validation results for the UI
        self.validation_results = []
        for item in resolved_sequence:
            orig_str = " ".join(item['original_tokens'])
            self.validation_results.append({
                'token': f"{orig_str} -> {item['resolved_token']} ({item['type'].upper()})",
                'fully_supported': item['fully_supported'],
                'is_word': item['is_word'],
                'letters': item.get('letters', [{'char': c, 'found': True} for c in item['resolved_token']])
            })
            
        self.refresh_validation_ui()
        
        self.engine.animations = []
        
        for item in resolved_sequence:
            resolved_token = item['resolved_token']
            
            # If word/phrase/sense is supported as a direct gesture in database
            if item['is_word']:
                json_anim = self.get_json_animation(resolved_token)
                if json_anim:
                    self.engine.queue_animation(json_anim)
                    self.engine.animations.append([]) # Pause between signs
                    continue
            
            # Fingerspelling fallback
            for char in resolved_token:
                json_char_anim = self.get_json_animation(char)
                if json_char_anim:
                    self.engine.queue_animation(json_char_anim)
                    self.engine.animations.append([]) 
                else:
                    pass


    def refresh_validation_ui(self):
        if hasattr(self, 'validation_container'):
            self.validation_container.clear()
            with self.validation_container:
                if not self.validation_results:
                    ui.label('No translation processed yet').classes('text-slate-400 italic')
                for res in self.validation_results:
                    with ui.row().classes('items-center gap-2 mb-1 w-full p-2 bg-white rounded border'):
                        icon = 'check_circle' if res['fully_supported'] else 'help'
                        color = 'text-green-500' if res['fully_supported'] else 'text-amber-500'
                        ui.icon(icon).classes(color)
                        
                        with ui.column().classes('grow'):
                            ui.label(res['token']).classes('font-bold')
                            if res['is_word']:
                                ui.label('Found as Word').classes('text-[10px] text-green-600 uppercase')
                            else:
                                letter_str = " ".join([f"[{l['char']}]" if l['found'] else f"({l['char']}?)" for l in res['letters']])
                                ui.label(f'Fingerspelling: {letter_str}').classes('text-[10px] text-slate-500')
    
    def update_loop(self):
        """Called every frame to update the 3D scene."""
        if not hasattr(self, 'scene'):
            return
        updates = self.engine.step()
        if updates:
            # Send updates to JS for bone manipulation
            ui.run_javascript(f'if (window.updateAvatarBones) window.updateAvatarBones({self.scene.id}, {updates});')

app.add_static_files('/assets', 'assets')


@app.post('/api/gestures')
async def api_save_gesture(request):
    """Accept a move-list payload (from client) and persist into gestures.json.
    Expected payload structure: move (name), category (optional: 'Word'|'Letter'), poses: [{snapshot: {leftHand,rightHand}}]
    This handler will convert snapshots into bone-name -> {x,y,z} maps similar to the existing stimulator format.
    """
    try:
        payload = await request.json()
    except Exception as e:
        return {'ok': False, 'error': f'invalid json: {e}'}

    import json

    # Normalize inputs
    cat = (payload.get('category') or 'Word')
    name = (payload.get('move') or payload.get('word') or payload.get('name'))
    if not name:
        return {'ok': False, 'error': 'missing move/name in payload'}

    name = str(name).upper()

    poses = payload.get('poses') or payload.get('frames') or []

    def convert_pose_snapshot_to_bones(snapshot, side_prefix='Left'):
        bones = {}
        if not snapshot:
            return bones

        # arm, forearm, hand
        arm = snapshot.get('arm')
        forearm = snapshot.get('forearm')
        hand = snapshot.get('hand')
        if arm:
            bones[f'mixamorig{side_prefix}Arm'] = { 'x': arm.get('x',0), 'y': arm.get('y',0), 'z': arm.get('z',0) }
        if forearm:
            bones[f'mixamorig{side_prefix}ForeArm'] = { 'x': forearm.get('x',0), 'y': forearm.get('y',0), 'z': forearm.get('z',0) }
        if hand:
            bones[f'mixamorig{side_prefix}Hand'] = { 'x': hand.get('x',0), 'y': hand.get('y',0), 'z': hand.get('z',0) }

        # fingers: expect keys like thumb1, index1, index2...
        fingers = snapshot.get('fingers') or {}
        for joint, rot in fingers.items():
            # joint like 'index1' -> Bone suffix 'HandIndex1'
            # Ensure capitalization matches stimulator naming
            if not isinstance(joint, str):
                continue
            # split name into letters and digits
            import re
            m = re.match(r'([a-zA-Z]+)(\d+)$', joint)
            if m:
                finger_name = m.group(1)
                number = m.group(2)
                suffix = f'Hand{finger_name.capitalize()}{number}'
            else:
                suffix = f'Hand{joint.capitalize()}'

            bone_name = f'mixamorig{side_prefix}{suffix}'
            bones[bone_name] = { 'x': rot.get('x',0), 'y': rot.get('y',0), 'z': rot.get('z',0) }

        return bones

    converted_sequence = []
    for p in poses:
        # Handle both move-list pose structure (pose.snapshot.leftHand/rightHand)
        snapshot = p.get('snapshot') if isinstance(p, dict) else None
        pose_bones = {}
        if snapshot:
            left = snapshot.get('leftHand') or {}
            right = snapshot.get('rightHand') or {}
            pose_bones.update(convert_pose_snapshot_to_bones(left, 'Left'))
            pose_bones.update(convert_pose_snapshot_to_bones(right, 'Right'))
        else:
            # Might already be in bone map format; accept as-is
            if isinstance(p, dict):
                # check if keys look like bone names
                pose_bones = p

        converted_sequence.append(pose_bones)

    try:
        save_gesture(cat, name, converted_sequence)
    except Exception as e:
        return {'ok': False, 'error': f'write failed: {e}'}

    # Reload validator DB (so UI reflects new entry)
    try:
        app_logic.validator.load_db()
    except Exception:
        pass

    return {'ok': True, 'saved': {'category': cat, 'name': name, 'poses': len(converted_sequence)}}


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
    window.mirrorAvatarSide = (scene_id, from_side, to_side) => {
        const sceneObj = window['scene_c' + scene_id];
        if (!sceneObj) return;
        const model = sceneObj.children.find(c => c.type === "Group");
        if (!model) return;
        
        let skeleton = null;
        model.traverse(node => {
            if (node.isSkinnedMesh && node.skeleton) {
                skeleton = node.skeleton;
            }
        });

        if (skeleton) {
            const bones = skeleton.bones;
            const fromBones = bones.filter(b => b.name.includes(from_side));
            fromBones.forEach(fb => {
                const tbName = fb.name.replace(from_side, to_side);
                const tb = bones.find(b => b.name === tbName);
                if (tb) {
                    // Mirror Y and Z rotations for symmetrical movement
                    tb.rotation.set(fb.rotation.x, -fb.rotation.y, -fb.rotation.z);
                }
            });
        }
    };
    window.setAvatarColor = (scene_id, color_hex) => {
        if (typeof THREE === 'undefined') return false;
        const sceneObj = window['scene_c' + scene_id];
        if (!sceneObj) return false;
        
        let meshFound = false;
        const color = new THREE.Color(color_hex);
        sceneObj.traverse(node => {
            if (node.isMesh) {
                meshFound = true;
                const materials = Array.isArray(node.material) ? node.material : [node.material];
                materials.forEach(m => {
                    if (m.name.toLowerCase().includes('joint')) {
                        m.color.set('#1a1a2e');
                    } else {
                        m.color.set(color);
                    }
                    m.roughness = 0.4;
                    m.metalness = 0.5;
                    m.needsUpdate = true;
                });
            }
        });
        return meshFound;
    };
    // Auto-apply color on load: retry until model meshes are ready (pure JS, no Python timer)
    window.autoApplyAvatarColor = (scene_id, color_hex) => {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const ok = window.setAvatarColor(scene_id, color_hex);
            if (ok || attempts > 60) clearInterval(interval);
        }, 300);
    };

    window.getSpeechTranscript = () => {
        return new Promise((resolve, reject) => {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                reject("Speech recognition not supported in this browser. Please use Chrome or Edge.");
                return;
            }
            const recognition = new SpeechRecognition();
            recognition.lang = 'en-US';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;

            const micBtn = document.querySelector('.mic-button');
            if (micBtn) {
                micBtn.style.color = '#ef4444';
                micBtn.classList.add('animate-pulse');
            }

            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                resolve(transcript);
            };

            recognition.onerror = (event) => {
                if (event.error === 'network') {
                    alert(`Speech Recognition Error: 'network'.\n\nChrome's Web Speech API requires an active internet connection to communicate with Google's speech servers. Please check your internet connection or try using Microsoft Edge (which uses a different speech engine).`);
                }
                reject(event.error);
            };

            recognition.onend = () => {
                if (micBtn) {
                    micBtn.style.color = '';
                    micBtn.classList.remove('animate-pulse');
                }
                // Resolve empty if ended without result
                setTimeout(() => resolve(""), 200);
            };

            recognition.start();
        });
    };
    </script>
    ''')
    
    app_logic = SignVerseApp()
    
    with ui.header().classes('bg-slate-900 text-white p-4 justify-between items-center'):
        ui.label('SignVerse Python Port').classes('text-2xl font-bold')
        with ui.row().classes('gap-4 items-center'):
            ui.link('Simulator/Player', '/').classes('text-white font-medium hover:text-slate-300')
            ui.link('Word Senses Editor', '/senses').classes('text-white font-medium hover:text-slate-300')

    with ui.row().classes('w-full h-screen no-wrap items-stretch p-4 gap-4'):
        # Left Panel: Controls
        left_panel = ui.column().classes('w-1/4 min-w-[350px] bg-slate-100 p-6 rounded-xl shadow-lg overflow-y-auto')
        with left_panel:
            ui.label('Conversion Toolkit').classes('text-xl font-semibold mb-4')
            
            async def trigger_voice():
                try:
                    transcript = await ui.run_javascript('window.getSpeechTranscript()', timeout=15.0)
                    if transcript:
                        text_input.set_value(transcript)
                        ui.notify(f"Voice captured: {transcript}")
                except Exception as e:
                    ui.notify(f"Voice recognition error: {str(e)}", type='negative')

            with ui.row().classes('w-full items-center mb-4 no-wrap gap-2'):
                text_input = ui.input('Enter text').classes('grow').props('id=voice-text-input')
                ui.button(icon='mic', on_click=trigger_voice).props('round flat color=primary').classes('mic-button')
            
            with ui.row().classes('w-full gap-2'):
                ui.button('Sign it!', on_click=lambda: app_logic.handle_translation(text_input.value)).props('elevated').classes('grow')
                ui.button('Literal', on_click=lambda: app_logic.handle_translation(text_input.value, literal=True)).props('outline color=secondary').classes('grow')
            
            ui.button('Clear', on_click=lambda: (text_input.set_value(''), setattr(app_logic, 'validation_results', []), app_logic.refresh_validation_ui())).props('outline').classes('w-full mt-1')
            
            ui.label('Translation Validation').classes('text-xs font-bold text-slate-400 uppercase tracking-wider mt-4')
            app_logic.validation_container = ui.column().classes('w-full mt-1 gap-1')
            app_logic.refresh_validation_ui()

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
                    rz_slider = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.30).classes('grow')
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
                    
                    async def on_mirror_toggle(e):
                        if e.value:
                            from_side = selected_side.value
                            to_side = 'Left' if from_side == 'Right' else 'Right'
                            ui.run_javascript(f'window.mirrorAvatarSide({scene.id}, "{from_side}", "{to_side}")')
                            ui.notify(f'Instantly mirrored {from_side} to {to_side}')

                    mirror_mode = ui.checkbox('Mirror Arm', on_change=on_mirror_toggle).classes('text-sm')
                
                with ui.row().classes('w-full items-center gap-2 mt-2'):
                    ui.label('Bone:').classes('w-12')
                    selected_bone = ui.select([
                        'Arm', 'ForeArm', 'Hand', 
                        'HandThumb1', 'HandThumb2', 'HandThumb3',
                        'HandIndex1', 'HandIndex2', 'HandIndex3',
                        'HandMiddle1', 'HandMiddle2', 'HandMiddle3',
                        'HandRing1', 'HandRing2', 'HandRing3',
                        'HandPinky1', 'HandPinky2', 'HandPinky3'
                    ], value='Arm').classes('grow')
                
                if not hasattr(app_logic, 'bone_rotations'):
                    app_logic.bone_rotations = {}

                def update_bone_sim():
                    side = selected_side.value
                    bone_suffix = selected_bone.value
                    bone = f'mixamorig{side}{bone_suffix}'
                    rx, ry, rz = sim_rx.value, sim_ry.value, sim_rz.value
                    
                    # Store values
                    app_logic.bone_rotations[bone] = [rx, ry, rz]
                    
                    ui.run_javascript(f'window.updateBoneRotation({scene.id}, "{bone}", {rx}, {ry}, {rz})')
                    
                    if mirror_mode.value:
                        other_side = 'Left' if side == 'Right' else 'Right'
                        other_bone = f'mixamorig{other_side}{bone_suffix}'
                        # Mirror Y and Z rotations
                        m_ry, m_rz = -ry, -rz
                        app_logic.bone_rotations[other_bone] = [rx, m_ry, m_rz]
                        ui.run_javascript(f'window.updateBoneRotation({scene.id}, "{other_bone}", {rx}, {m_ry}, {m_rz})')

                def on_selection_change():
                    side = selected_side.value
                    bone = f'mixamorig{side}{selected_bone.value}'
                    # Default rotations to 0.0 unless stored
                    rots = app_logic.bone_rotations.get(bone, [0.0, 0.0, 0.0])
                    # Update sliders (this will trigger update_bone_sim once, which is fine)
                    sim_rx.set_value(rots[0])
                    sim_ry.set_value(rots[1])
                    sim_rz.set_value(rots[2])

                selected_bone.on_value_change(on_selection_change)
                selected_side.on_value_change(on_selection_change)

                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('RX:').classes('w-8')
                    sim_rx = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.0).classes('grow').on_value_change(update_bone_sim)
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('RY:').classes('w-8')
                    sim_ry = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.0).classes('grow').on_value_change(update_bone_sim)
                with ui.row().classes('w-full items-center gap-2'):
                    ui.label('RZ:').classes('w-8')
                    sim_rz = ui.slider(min=-3.14, max=3.14, step=0.01, value=0.0).classes('grow').on_value_change(update_bone_sim)

                def close_fingers(finger_name, close=True):
                    side = selected_side.value
                    angle = 1.4 if close else 0.0
                    
                    fingers = {
                        'Index': ['HandIndex1', 'HandIndex2', 'HandIndex3'],
                        'Middle': ['HandMiddle1', 'HandMiddle2', 'HandMiddle3'],
                        'Ring': ['HandRing1', 'HandRing2', 'HandRing3'],
                        'Pinky': ['HandPinky1', 'HandPinky2', 'HandPinky3'],
                        'Thumb': ['HandThumb1', 'HandThumb2', 'HandThumb3']
                    }
                    
                    bones_to_update = []
                    if finger_name == 'All':
                        for f_list in fingers.values():
                            bones_to_update.extend(f_list)
                    else:
                        bones_to_update = fingers.get(finger_name, [])
                        
                    for b in bones_to_update:
                        bone_full = f'mixamorig{side}{b}'
                        rx, ry, rz = 0, 0, 0
                        if 'Thumb' in b:
                            # Thumb Y rotation for closure
                            ry = -angle if side == 'Right' else angle
                        else:
                            # Other fingers Z rotation for closure
                            rz = angle if side == 'Right' else -angle
                        
                        # Store values
                        app_logic.bone_rotations[bone_full] = [rx, ry, rz]
                        ui.run_javascript(f'window.updateBoneRotation({scene.id}, "{bone_full}", {rx}, {ry}, {rz})')
                    
                    # Update sliders if the current selected bone was affected
                    on_selection_change()
                    ui.notify(f'{"Closed" if close else "Opened"} {finger_name} fingers on {side} hand')

                ui.label('Finger Quick Actions').classes('text-xs font-bold text-slate-400 uppercase tracking-wider mt-4')
                with ui.row().classes('w-full flex-wrap gap-1'):
                    ui.button('Close All', on_click=lambda: close_fingers('All')).props('small outline color=primary')
                    ui.button('Open All', on_click=lambda: close_fingers('All', False)).props('small outline color=grey')
                
                with ui.row().classes('w-full flex-wrap gap-1 mt-1'):
                    for f in ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']:
                        ui.button(f, on_click=lambda f=f: close_fingers(f)).props('small outline')

                ui.separator().classes('my-4')
                
                ui.label('Live Points Monitor (Selected Side)').classes('text-xs font-bold text-slate-400 uppercase tracking-wider')
                with ui.scroll_area().classes('w-full h-64 border rounded p-2 bg-slate-50'):
                    sim_live_monitor = ui.label('Select a bone to see points...').classes('text-xs font-mono whitespace-pre')

                async def refresh_sim_monitor():
                    try:
                        side = selected_side.value
                        data = await ui.run_javascript(f'window.captureCurrentPose({scene.id})', timeout=1.0)
                        
                        if data:
                            lines = []
                            # Filter and sort bones for the selected side
                            side_bones = {k: v for k, v in data.items() if side in k}
                            # Group bones for better readability
                            for group in ['Arm', 'ForeArm', 'Hand', 'Thumb', 'Index', 'Middle', 'Ring', 'Pinky']:
                                group_bones = {k: v for k, v in side_bones.items() if group in k}
                                if group_bones:
                                    lines.append(f"--- {group} ---")
                                    for b_name, rot in sorted(group_bones.items()):
                                        # Show only name after 'mixamorig' and side
                                        display_name = b_name.replace(f'mixamorig{side}', '')
                                        lines.append(f"{display_name:10} | X:{rot['x']:6.3f} Y:{rot['y']:6.3f} Z:{rot['z']:6.3f}")
                            
                            sim_live_monitor.set_text("\n".join(lines))
                    except Exception:
                        pass
                
                ui.timer(0.5, refresh_sim_monitor)

                ui.separator().classes('my-4')

                ui.label('Pose Sequencer').classes('text-xs font-bold text-slate-400 uppercase tracking-wider')
                marked_poses_label = ui.label('No poses marked yet.').classes('text-sm italic text-slate-500 mb-1')
                with ui.scroll_area().classes('w-full h-48 border rounded bg-white mb-2'):
                    marked_list_container = ui.column().classes('w-full p-2 gap-1')
                
                if not hasattr(app_logic, 'marked_poses'):
                    app_logic.marked_poses = []
                    app_logic.loop_enabled = False

                def update_marked_ui():
                    marked_list_container.clear()
                    if not app_logic.marked_poses:
                        marked_poses_label.set_text('No poses marked yet.')
                        return
                    
                    marked_poses_label.set_text(f'{len(app_logic.marked_poses)} poses marked')
                    with marked_list_container:
                        with ui.column().classes('w-full gap-1'):
                            for i, pose in enumerate(app_logic.marked_poses):
                                with ui.row().classes('w-full items-center gap-2 p-1 bg-slate-50 rounded border border-slate-200 hover:bg-slate-100 transition-colors'):
                                    ui.label(f'{i+1}').classes('font-bold text-slate-400 w-4')
                                    ui.badge(f'Pose {i+1}', color='blue').classes('grow text-xs cursor-pointer').on('click', lambda i=i: load_pose(i))
                                    
                                    with ui.row().classes('gap-1'):
                                        # Move Up
                                        ui.button(icon='arrow_upward', on_click=lambda i=i: move_pose(i, -1)).props('flat dense size=sm').classes('text-slate-500').set_visibility(i > 0)
                                        # Move Down
                                        ui.button(icon='arrow_downward', on_click=lambda i=i: move_pose(i, 1)).props('flat dense size=sm').classes('text-slate-500').set_visibility(i < len(app_logic.marked_poses) - 1)
                                        # Load/Edit
                                        ui.button(icon='edit', on_click=lambda i=i: load_pose(i)).props('flat dense size=sm color=primary').classes('ml-2')
                                        # Update current index
                                        ui.button(icon='save', on_click=lambda i=i: update_pose_at(i)).props('flat dense size=sm color=green')
                                        # Delete
                                        ui.button(icon='delete', on_click=lambda i=i: delete_pose(i)).props('flat dense size=sm color=red')

                async def load_pose(index):
                    if 0 <= index < len(app_logic.marked_poses):
                        pose_data = app_logic.marked_poses[index]
                        ui.notify(f'Loading Pose {index+1}...')
                        
                        # Apply bone rotations to the scene
                        for bone, rot in pose_data.items():
                            ui.run_javascript(f'window.updateBoneRotation({scene.id}, "{bone}", {rot["x"]}, {rot["y"]}, {rot["z"]})')
                            # Also update internal storage so sliders can pick it up
                            app_logic.bone_rotations[bone] = [rot['x'], rot['y'], rot['z']]
                        
                        # Update sliders for the currently selected bone
                        on_selection_change()
                    else:
                        ui.notify('Invalid pose index', type='negative')

                def delete_pose(index):
                    if 0 <= index < len(app_logic.marked_poses):
                        app_logic.marked_poses.pop(index)
                        ui.notify(f'Pose {index+1} deleted')
                        update_marked_ui()

                def move_pose(index, direction):
                    new_index = index + direction
                    if 0 <= new_index < len(app_logic.marked_poses):
                        app_logic.marked_poses[index], app_logic.marked_poses[new_index] = \
                            app_logic.marked_poses[new_index], app_logic.marked_poses[index]
                        update_marked_ui()

                async def update_pose_at(index):
                    try:
                        data = await ui.run_javascript(f'window.captureCurrentPose({scene.id})', timeout=5.0)
                        if data:
                            app_logic.marked_poses[index] = data
                            ui.notify(f'Pose {index+1} updated with current avatar state!')
                            update_marked_ui()
                    except Exception as e:
                        ui.notify(f'Failed to update pose: {str(e)}', type='negative')

                async def mark_pose():
                    try:
                        data = await ui.run_javascript(f'window.captureCurrentPose({scene.id})', timeout=5.0)
                        if data:
                            app_logic.marked_poses.append(data)
                            ui.notify(f'Pose {len(app_logic.marked_poses)} marked!')
                            update_marked_ui()
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
                    ui.notify('Sequence cleared')
                    update_marked_ui()

                import json
                import os

                def save_to_db():
                    if not app_logic.marked_poses:
                        ui.notify('No poses to save!', type='warning')
                        return
                    if not sim_name.value:
                        ui.notify('Please enter a Name first!', type='warning')
                        return
                    
                    cat = sim_cat.value
                    name = sim_name.value.upper()

                    save_gesture(cat, name, app_logic.marked_poses)
                    app_logic.validator.load_db() # Reload validator DB
                    target = f'words/{name}.json' if cat == 'Word' else 'gestures.json'
                    ui.notify(f'Saved {name} to {target}!')

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

                def load_from_db():
                    cat = sim_cat.value
                    name = sim_name.value.upper()

                    if cat == 'Word':
                        poses = load_word_gesture(name)
                        if poses:
                            app_logic.marked_poses = list(poses)
                            ui.notify(f'Loaded {name} sequence from DB!')
                            update_marked_ui()
                        else:
                            ui.notify(f'{name} not found in {cat}', type='warning')
                    else:
                        try:
                            with open('gestures.json', 'r', encoding='utf-8') as f:
                                db = json.load(f)
                        except Exception:
                            ui.notify('Error reading database', type='negative')
                            return

                        if cat in db and name in db[cat]:
                            app_logic.marked_poses = list(db[cat][name])
                            ui.notify(f'Loaded {name} sequence from DB!')
                            update_marked_ui()
                        else:
                            ui.notify(f'{name} not found in {cat}', type='warning')

                with ui.row().classes('w-full gap-2 mt-2'):
                    ui.button('Save to DB', on_click=save_to_db).classes('grow').props('icon=save color=secondary')
                    ui.button('Load from DB', on_click=load_from_db).classes('grow').props('icon=download outline color=secondary')

                ui.separator().classes('my-4')
                
                ui.label('Shortcuts').classes('text-xs font-bold text-slate-400 uppercase tracking-wider')
                
                def attention_pose():
                    # Reset Stimulator Sliders AND Storage
                    app_logic.bone_rotations = {}
                    on_selection_change() # Resets UI sliders to 0.0
                    
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
            
            ui.separator().classes('my-4')
            ui.label('Appearance').classes('text-lg font-medium mb-2')
            with ui.row().classes('items-center gap-4'):
                ui.label('Avatar Color:').classes('text-sm')
                color_picker = ui.color_input(value=app_logic.avatar_color, on_change=lambda e: (setattr(app_logic, 'avatar_color', e.value), update_scene()))
                color_picker.props('inline')

        # Right Panel: 3D Scene
        with ui.column().classes('flex-grow h-full bg-white rounded-xl shadow-inner relative overflow-hidden'):
            with ui.scene(width=None, height=None, grid=False).classes('w-full h-full') as scene:
                scene.move_camera(0, 1.01, 1.35, 0, 1.01, 0)
                model = scene.gltf('/assets/models/xbot.glb')
                model.rotate(0.11, 0.07, 0.30)
                model.move(0.28, -0.19, 0)
                scene.spot_light(color='#ffffff', intensity=10).move(2, 5, 2)
                app_logic.scene = scene

        def update_scene():
            ui.run_javascript(f'if (window.updateModelPose) window.updateModelPose({scene.id}, {rx_slider.value}, {ry_slider.value}, {rz_slider.value}, {avx_slider.value}, {avy_slider.value});')
            ui.run_javascript(f'if (window.setAvatarColor) window.setAvatarColor({scene.id}, "{app_logic.avatar_color}");')
            # Use duration=0 for instant snap, preventing camera interpolation glitches
            scene.move_camera(0, camy_slider.value, camz_slider.value, 0, camy_slider.value, 0, duration=0)
        
        for s in [rx_slider, ry_slider, rz_slider, avx_slider, avy_slider, camy_slider, camz_slider]:
            s.on_value_change(update_scene)

        # Apply initial pose via JS-side auto-color retry loop (avoids Python timer context errors on reload)
        ui.run_javascript(f'window.autoApplyAvatarColor({scene.id}, "{app_logic.avatar_color}");')

        # Keyboard Shortcuts for Stimulator
        from nicegui import events
        async def handle_key(e: events.KeyEventArguments):
            if e.action.keydown:
                # Check if we are typing in an input or textarea to avoid accidental triggers
                is_typing = await ui.run_javascript('["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)')
                if is_typing:
                    return

                step = 0.05
                # Extract key name whether e.key is a string or a KeyboardKey object
                k_orig = e.key.name if hasattr(e.key, 'name') else str(e.key)
                k = k_orig.lower()
                
                if k == 'm': await mark_pose()
                elif k == 'a': attention_pose()
                elif k == 'p': play_sequence()
                elif k == 's': save_to_db()
                elif k == 'c': clear_marked()
                
                # Rotation Controls
                elif k == 'arrowup': sim_rx.value = min(3.14, sim_rx.value + step)
                elif k == 'arrowdown': sim_rx.value = max(-3.14, sim_rx.value - step)
                elif k == 'arrowright': sim_ry.value = min(3.14, sim_ry.value + step)
                elif k == 'arrowleft': sim_ry.value = max(-3.14, sim_ry.value - step)
                elif k == '[': sim_rz.value = max(-3.14, sim_rz.value - step)
                elif k == ']': sim_rz.value = min(3.14, sim_rz.value + step)

        ui.keyboard(on_key=handle_key)

    ui.timer(0.05, app_logic.update_loop)


@ui.page('/senses')
def senses_page():
    # Header
    with ui.header().classes('bg-slate-900 text-white p-4 justify-between items-center'):
        ui.label('SignVerse Python Port').classes('text-2xl font-bold')
        with ui.row().classes('gap-4 items-center'):
            ui.link('Simulator/Player', '/').classes('text-white font-medium hover:text-slate-300')
            ui.link('Word Senses Editor', '/senses').classes('text-white font-semibold underline')

    # Main content container
    with ui.column().classes('w-full p-6 gap-6 max-w-5xl mx-auto'):
        ui.label('Word Senses Editor').classes('text-3xl font-bold text-slate-800')
        ui.label('Manage linguistic metadata, parts of speech, and context clues for sign gestures.').classes('text-slate-500 -mt-4')

        # Load all JSON words
        from pathlib import Path
        import json
        from src.utils.gesture_store import ROOT_DIR, save_word_metadata
        
        words_dir = ROOT_DIR / 'words'
        word_files = sorted(list(words_dir.glob('*.json')))
        words_list = [f.stem.upper() for f in word_files]

        # Search / Select input
        with ui.row().classes('w-full items-center gap-4'):
            word_select = ui.select(words_list, label='Select Word to Edit', with_input=True).classes('w-96')

        # Editor UI container
        editor_container = ui.column().classes('w-full gap-4 border p-6 rounded-xl bg-white shadow-md')
        editor_container.set_visibility(False)

        with editor_container:
            ui.label('Edit Metadata').classes('text-xl font-semibold text-slate-700')
            
            # Fields
            sense_id_input = ui.input('Sense ID').classes('w-full')
            meaning_input = ui.input('Meaning').classes('w-full')
            
            pos_input = ui.input('Parts of Speech (comma separated)', placeholder='e.g., noun, verb').classes('w-full')
            context_input = ui.textarea('Context Clues (comma separated)', placeholder='e.g., play, game, hit').classes('w-full').props('rows=3')
            
            poses_info = ui.label('').classes('text-sm text-slate-500 font-mono')

            async def save_changes():
                name = word_select.value
                if not name:
                    return
                
                # Parse inputs
                pos_list = [p.strip().lower() for p in pos_input.value.split(',') if p.strip()]
                context_list = [c.strip().lower() for c in context_input.value.split(',') if c.strip()]
                
                meta = {
                    "sense_id": sense_id_input.value.strip(),
                    "meaning": meaning_input.value.strip(),
                    "pos": pos_list,
                    "context": context_list
                }
                
                try:
                    save_word_metadata(name, meta)
                    ui.notify(f"Successfully saved {name} metadata!", type='positive')
                except Exception as e:
                    ui.notify(f"Error saving metadata: {str(e)}", type='negative')

            ui.button('Save Metadata', on_click=save_changes).classes('w-44').props('icon=save color=primary')

        def on_word_change(e):
            name = e.value
            if not name:
                editor_container.set_visibility(False)
                return
            
            # Load file
            file_path = words_dir / f"{name}.json"
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except Exception as ex:
                ui.notify(f"Error reading {name}.json: {str(ex)}", type='negative')
                return
            
            if isinstance(data, dict):
                sense_id_input.set_value(data.get('sense_id', name.lower()))
                meaning_input.set_value(data.get('meaning', name.lower()))
                pos_input.set_value(", ".join(data.get('pos', ['noun'])))
                context_input.set_value(", ".join(data.get('context', [name.lower()])))
                poses_info.set_text(f"Gesture contains {len(data.get('poses', []))} animation frames.")
                editor_container.set_visibility(True)
            else:
                ui.notify(f"File {name}.json is not structured correctly. Run migration first.", type='warning')
                editor_container.set_visibility(False)

        word_select.on_value_change(on_word_change)

ui.run(title='SignVerse Python', port=8081, reload=True)

