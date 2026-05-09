import '../App.css'
import React, { useState, useEffect, useRef } from "react";
import Slider from 'react-input-slider';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'font-awesome/css/font-awesome.min.css';

import xbot from '../Models/xbot/xbot.glb';
import ybot from '../Models/ybot/ybot.glb';
import xbotPic from '../Models/xbot/xbot.png';
import ybotPic from '../Models/ybot/ybot.png';

import * as words from '../Animations/words';
import * as alphabets from '../Animations/alphabets';
import { defaultPose } from '../Animations/defaultPose';
import { detectAndTranslate } from '../Utils/languageUtils';

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';

const MOVELIST_STORAGE_KEY = 'signverse_custom_movelists';

const STRICT_PROMPT_TEMPLATE = `You are generating motion data for the SignVerse avatar system.

TASK
- Convert the user's motion description into a single valid JSON object only.
- Do not include explanation text, markdown, or code fences.

STRICT OUTPUT RULES
- Return exactly one JSON object.
- Required top-level keys: move, totalPoses, poses.
- move must be uppercase letters/numbers/underscore only.
- totalPoses must equal poses.length.
- poses must be a non-empty array.
- Each pose item must contain: index, name, snapshot.
- snapshot must contain: leftHand and rightHand.
- Each hand must contain: arm, forearm, hand, fingers.
- arm/forearm/hand must each contain numeric x, y, z in radians.
- fingers must be an object where each key is one of:
  thumb1, thumb2, index1, index2, index3, middle1, middle2, middle3,
  ring1, ring2, ring3, pinky1, pinky2, pinky3
- Every provided finger joint must contain numeric x, y, z in radians.

USER MOTION DESCRIPTION
[PASTE VIDEO DESCRIPTION OR PROMPT HERE]

TARGET SHAPE (example values; replace with real values)
{
  "move": "CUSTOM_MOVE_NAME",
  "totalPoses": 2,
  "poses": [
    {
      "index": 1,
      "name": "POSE_1",
      "snapshot": {
        "leftHand": {
          "arm": { "x": 0.0, "y": 0.0, "z": 0.0 },
          "forearm": { "x": 0.0, "y": 0.0, "z": 0.0 },
          "hand": { "x": 0.0, "y": 0.0, "z": 0.0 },
          "fingers": {
            "thumb1": { "x": 0.0, "y": 0.0, "z": 0.0 },
            "index1": { "x": 0.0, "y": 0.0, "z": 0.0 }
          }
        },
        "rightHand": {
          "arm": { "x": 0.0, "y": 0.0, "z": 0.0 },
          "forearm": { "x": 0.0, "y": 0.0, "z": 0.0 },
          "hand": { "x": 0.0, "y": 0.0, "z": 0.0 },
          "fingers": {
            "thumb1": { "x": 0.0, "y": 0.0, "z": 0.0 },
            "index1": { "x": 0.0, "y": 0.0, "z": 0.0 }
          }
        }
      }
    }
  ]
}`;

const AXES = ['x', 'y', 'z'];
const EPSILON = 0.0005;

const normalizeMoveKey = (rawValue) => {
  return String(rawValue || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
};

const buildLegacyMoveKey = (normalizedKey) => {
  return String(normalizedKey || '').replace(/[^A-Z]/g, '');
};

const resolveStoredMoveList = (storedMoveLists, rawToken) => {
  const normalizedKey = normalizeMoveKey(rawToken);
  if (!normalizedKey) {
    return null;
  }

  if (storedMoveLists[normalizedKey]) {
    return {
      moveName: normalizedKey,
      payload: storedMoveLists[normalizedKey],
    };
  }

  const legacyKey = buildLegacyMoveKey(normalizedKey);
  if (legacyKey && storedMoveLists[legacyKey]) {
    return {
      moveName: legacyKey,
      payload: storedMoveLists[legacyKey],
    };
  }

  return null;
};

const resolveAvatarModel = (avatarName) => {
  const normalizedAvatarName = String(avatarName || '').trim().toLowerCase();

  if (normalizedAvatarName === 'xbot') {
    return xbot;
  }

  if (normalizedAvatarName === 'ybot') {
    return ybot;
  }

  return null;
};

const resolveAvatarLabel = (avatarModel) => {
  if (avatarModel === xbot) {
    return 'XBOT';
  }

  if (avatarModel === ybot) {
    return 'YBOT';
  }

  return 'UNKNOWN';
};

const setBoneRotation = (bone, x = 0, y = 0, z = 0) => {
  if (!bone) {
    return;
  }

  bone.rotation.set(x, y, z);
};

const getFingerBoneNameCandidates = (hand, joint) => {
  const side = hand === 'left' ? 'Left' : 'Right';
  const map = {
    index1: [`mixamorig${side}HandIndex1`, `${side}HandIndex1`],
    index2: [`mixamorig${side}HandIndex2`, `${side}HandIndex2`],
    index3: [`mixamorig${side}HandIndex3`, `${side}HandIndex3`],
    middle1: [`mixamorig${side}HandMiddle1`, `${side}HandMiddle1`],
    middle2: [`mixamorig${side}HandMiddle2`, `${side}HandMiddle2`],
    middle3: [`mixamorig${side}HandMiddle3`, `${side}HandMiddle3`],
    ring1: [`mixamorig${side}HandRing1`, `${side}HandRing1`],
    ring2: [`mixamorig${side}HandRing2`, `${side}HandRing2`],
    ring3: [`mixamorig${side}HandRing3`, `${side}HandRing3`],
    pinky1: [`mixamorig${side}HandPinky1`, `${side}HandPinky1`],
    pinky2: [`mixamorig${side}HandPinky2`, `${side}HandPinky2`],
    pinky3: [`mixamorig${side}HandPinky3`, `${side}HandPinky3`],
    thumb1: [`mixamorig${side}HandThumb1`, `${side}HandThumb1`],
    thumb2: [`mixamorig${side}HandThumb2`, `${side}HandThumb2`],
  };
  return map[joint] || [];
};

const getArmBoneNameCandidates = (hand, part) => {
  const side = hand === 'left' ? 'Left' : 'Right';
  if (part === 'arm') return [`mixamorig${side}Arm`, `${side}Arm`];
  if (part === 'forearm') return [`mixamorig${side}ForeArm`, `${side}ForeArm`];
  if (part === 'hand') return [`mixamorig${side}Hand`, `${side}Hand`];
  return [];
};

const findBone = (avatar, candidates) => {
  if (!avatar || !candidates) return null;
  for (const name of candidates) {
    const bone = avatar.getObjectByName(name);
    if (bone) return bone;
  }
  return null;
};

const addRotationSteps = (ref, animation, hand, part, joint, targetValue, boneName, axis) => {
  const bone = ref.avatar.getObjectByName(boneName);
  if (!bone) return;
  
  const currentValue = bone.rotation[axis];
  const delta = targetValue - currentValue;
  if (Math.abs(delta) <= EPSILON) {
    return;
  }

  animation.push([boneName, 'rotation', axis, targetValue, delta > 0 ? '+' : '-']);
};

const queuePoseSnapshotAnimation = (ref, snapshot) => {
  if (!ref.avatar || !snapshot) {
    return;
  }

  const animation = [];
  const sideConfig = [
    { key: 'leftHand', side: 'left' },
    { key: 'rightHand', side: 'right' },
  ];

  for (const config of sideConfig) {
    const handSnapshot = snapshot[config.key];
    const hand = config.side;
    if (!handSnapshot) {
      continue;
    }

    // Compare arm, forearm, hand
    for (const part of ['arm', 'forearm', 'hand']) {
      const candidates = getArmBoneNameCandidates(hand, part);
      const bone = findBone(ref.avatar, candidates);
      if (!bone) {
        continue;
      }
      const boneName = bone.name;
      const target = handSnapshot[part];
      if (target) {
        addRotationSteps(ref, animation, hand, part, null, target.x, boneName, 'x');
        addRotationSteps(ref, animation, hand, part, null, target.y, boneName, 'y');
        addRotationSteps(ref, animation, hand, part, null, target.z, boneName, 'z');
      }
    }

    // Compare fingers
    for (const [joint, targetRotation] of Object.entries(handSnapshot.fingers || {})) {
      const candidates = getFingerBoneNameCandidates(hand, joint);
      const bone = findBone(ref.avatar, candidates);
      if (!bone) {
        continue;
      }
      const boneName = bone.name;
      if (targetRotation) {
        addRotationSteps(ref, animation, hand, null, joint, targetRotation.x, boneName, 'x');
        addRotationSteps(ref, animation, hand, null, joint, targetRotation.y, boneName, 'y');
        addRotationSteps(ref, animation, hand, null, joint, targetRotation.z, boneName, 'z');
      }
    }
  }

  if (animation.length > 0) {
    ref.animations.push(animation);
  }
};

const queueStoredMoveList = (ref, moveListPayload) => {
  const poses = moveListPayload?.poses || [];
  for (const pose of poses) {
    queuePoseSnapshotAnimation(ref, pose.snapshot);
  }
};

const readStoredMoveLists = () => {
  try {
    const raw = localStorage.getItem(MOVELIST_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('Unable to read stored move lists:', error);
    return {};
  }
};

const saveStoredMoveList = (moveName, payload) => {
  const normalizedMoveName = normalizeMoveKey(moveName);
  if (!normalizedMoveName) {
    return;
  }

  const existing = readStoredMoveLists();
  existing[normalizedMoveName] = {
    ...payload,
    move: normalizedMoveName,
  };

  const legacyKey = buildLegacyMoveKey(normalizedMoveName);
  if (legacyKey && legacyKey !== normalizedMoveName) {
    existing[legacyKey] = existing[normalizedMoveName];
  }

  localStorage.setItem(MOVELIST_STORAGE_KEY, JSON.stringify(existing));
};

const extractJsonObjectFromText = (rawText) => {
  const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
  if (!trimmed) {
    throw new Error('Prompt text is empty. Paste a move prompt first.');
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }

  const firstBraceIndex = trimmed.indexOf('{');
  const lastBraceIndex = trimmed.lastIndexOf('}');
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return trimmed.slice(firstBraceIndex, lastBraceIndex + 1).trim();
  }

  return trimmed;
};

const normalizeImportedMoveList = (payload) => {
  const moveNameRaw = typeof payload?.move === 'string'
    ? payload.move
    : (typeof payload?.word === 'string' ? payload.word : '');

  const moveName = normalizeMoveKey(moveNameRaw);
  if (!moveName) {
    throw new Error('Missing "move" (or "word") in payload.');
  }

  if (!Array.isArray(payload?.poses) || payload.poses.length === 0) {
    throw new Error('Payload must contain a non-empty "poses" array.');
  }

  const validPoseCount = payload.poses.filter((pose) => pose?.snapshot).length;
  if (validPoseCount === 0) {
    throw new Error('Payload poses do not contain snapshots.');
  }

  return {
    moveName,
    normalizedPayload: {
      ...payload,
      move: moveName,
      avatar: typeof payload?.avatar === 'string'
        ? payload.avatar.trim().toLowerCase()
        : payload.avatar,
      totalPoses: payload.totalPoses || payload.poses.length,
    },
  };
};

const parseMoveListFromPromptText = (promptText) => {
  const jsonText = extractJsonObjectFromText(promptText);
  const parsedPayload = JSON.parse(jsonText);
  return normalizeImportedMoveList(parsedPayload);
};

function Convert() {
  const [text, setText] = useState("");
  const [bot, setBot] = useState(ybot);
  const [speed, setSpeed] = useState(0.1);
  const [pause, setPause] = useState(800);
  const [fullCaption, setFullCaption] = useState("");
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [captionWords, setCaptionWords] = useState([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState("");
  const [translationError, setTranslationError] = useState("");
  const [movelistFile, setMovelistFile] = useState(null);
  const [movelistPromptText, setMovelistPromptText] = useState('');
  const [movelistImportMessage, setMovelistImportMessage] = useState("");
  const [movelistImportError, setMovelistImportError] = useState("");
  const [templateCopyMessage, setTemplateCopyMessage] = useState('');
  const [templateCopyError, setTemplateCopyError] = useState('');
  const [showCorrectOverlay, setShowCorrectOverlay] = useState(false);

  const componentRef = useRef({});
  const { current: ref } = componentRef;

  let textFromAudio = React.createRef();
  let textFromInput = React.createRef();

  const {
    transcript,
    listening,
    resetTranscript,
  } = useSpeechRecognition();

  const resetAvatarPose = () => {
    if (!ref.avatar) {
      return;
    }

    ref.animations = [];
    ref.pending = false;
    ref.flag = false;

    const findAndSetRotation = (hand, part, x, y, z) => {
      const candidates = getArmBoneNameCandidates(hand, part);
      const bone = findBone(ref.avatar, candidates);
      if (bone) {
        setBoneRotation(bone, x, y, z);
      }
    };

    setBoneRotation(ref.avatar.getObjectByName('mixamorigNeck') || ref.avatar.getObjectByName('Neck'), Math.PI / 12, 0, 0);
    
    findAndSetRotation('left', 'arm', 0, 0, -Math.PI / 3);
    findAndSetRotation('left', 'forearm', 0, -Math.PI / 1.5, 0);
    findAndSetRotation('left', 'hand', 0, 0, 0);

    findAndSetRotation('right', 'arm', 0, 0, Math.PI / 3);
    findAndSetRotation('right', 'forearm', 0, Math.PI / 1.5, 0);
    findAndSetRotation('right', 'hand', 0, 0, 0);

    const resetFingers = (hand) => {
      const joints = [
        'thumb1', 'thumb2', 'index1', 'index2', 'index3',
        'middle1', 'middle2', 'middle3', 'ring1', 'ring2', 'ring3',
        'pinky1', 'pinky2', 'pinky3'
      ];
      
      joints.forEach((joint) => {
        const candidates = getFingerBoneNameCandidates(hand, joint);
        const bone = findBone(ref.avatar, candidates);
        if (bone) {
          setBoneRotation(bone, 0, 0, 0);
        }
      });
    };

    resetFingers('left');
    resetFingers('right');

    if (ref.renderer && ref.scene && ref.camera) {
      ref.renderer.render(ref.scene, ref.camera);
    }
  };

  useEffect(() => {
    ref.flag = false;
    ref.pending = false;

    ref.animations = [];
    ref.characters = [];

    ref.scene = new THREE.Scene();
    ref.scene.background = new THREE.Color(0xdddddd);

    const spotLight = new THREE.SpotLight(0xffffff, 2);
    spotLight.position.set(0, 5, 5);
    ref.scene.add(spotLight);
    ref.renderer = new THREE.WebGLRenderer({ antialias: true });

    const canvasWidth = Math.min(window.innerWidth * 0.57, 800);
    const canvasHeight = Math.min(window.innerHeight - 100, 700);

    ref.camera = new THREE.PerspectiveCamera(
      30,
      canvasWidth / canvasHeight,
      0.1,
      1000
    )
    ref.renderer.setSize(canvasWidth, canvasHeight);

    document.getElementById("canvas").innerHTML = "";
    document.getElementById("canvas").appendChild(ref.renderer.domElement);

    ref.camera.position.z = 1.6;
    ref.camera.position.y = 1.4;

    let loader = new GLTFLoader();
    loader.load(
      bot,
      (gltf) => {
        gltf.scene.traverse((child) => {
          if (child.type === 'SkinnedMesh') {
            child.frustumCulled = false;
          }
        });
        ref.avatar = gltf.scene;
        ref.scene.add(ref.avatar);
        defaultPose(ref);
      },
      (xhr) => {
        console.log(xhr);
      }
    );

  }, [ref, bot]);

  ref.animate = () => {
    if (ref.animations.length === 0) {
      ref.pending = false;
      setCurrentWordIndex(0); // Reset index when animations complete
      setShowCorrectOverlay(true);
      setTimeout(() => setShowCorrectOverlay(false), 3000);
      return;
    }
    requestAnimationFrame(ref.animate);
    if (ref.animations[0].length) {
      if (!ref.flag) {
        if (ref.animations[0][0] === 'add-text') {
          setText((prev) => prev + ref.animations[0][1]);
          setCurrentWordIndex(prev => prev + 1); // Move to next word
          ref.animations.shift();
        }
        else {
          for (let i = 0; i < ref.animations[0].length;) {
            let [boneName, action, axis, limit, sign] = ref.animations[0][i]
            if (sign === "+" && ref.avatar.getObjectByName(boneName)[action][axis] < limit) {
              ref.avatar.getObjectByName(boneName)[action][axis] += speed;
              ref.avatar.getObjectByName(boneName)[action][axis] = Math.min(ref.avatar.getObjectByName(boneName)[action][axis], limit);
              i++;
            }
            else if (sign === "-" && ref.avatar.getObjectByName(boneName)[action][axis] > limit) {
              ref.avatar.getObjectByName(boneName)[action][axis] -= speed;
              ref.avatar.getObjectByName(boneName)[action][axis] = Math.max(ref.avatar.getObjectByName(boneName)[action][axis], limit);
              i++;
            }
            else {
              ref.animations[0].splice(i, 1);
            }
          }
        }
      }
    }
    else {
      ref.flag = true;
      setTimeout(() => {
        ref.flag = false
      }, pause);
      ref.animations.shift();
    }
    ref.renderer.render(ref.scene, ref.camera);
  }

  const sign = async (inputRef) => {
    var str = inputRef.current.value;

    if (!str || str.trim() === '') {
      setTranslationError("Please enter some text");
      return;
    }

    // Reset states
    setTranslationError("");
    setDetectedLanguage("");
    setIsTranslating(true);
    resetAvatarPose();

    try {
      const rawInput = str.trim();
      const isPlainEnglishInput = /^[A-Za-z\s]+$/.test(rawInput);
      let translatedStr = rawInput;

      if (!isPlainEnglishInput) {
        const result = await detectAndTranslate(rawInput);

        if (!result.error && result.translatedText) {
          translatedStr = result.translatedText;

          if (result.detectedLang !== 'en') {
            setDetectedLanguage(`Detected: ${result.detectedLangName} → English`);
          } else {
            setDetectedLanguage('Language: English');
          }
        } else {
          // If translation is unavailable, continue with raw input instead of blocking animation.
          setDetectedLanguage('Translation unavailable. Using original input text.');
          setTranslationError('');
        }
      } else {
        setDetectedLanguage('Language: English');
      }

      translatedStr = translatedStr.toUpperCase();
      var strWords = translatedStr.split(/\s+/).filter(Boolean);
      setText('');

      // Set full caption and prepare word array for highlighting
      setFullCaption(translatedStr);
      let wordArray = [];
      const storedMoveLists = readStoredMoveLists();

      for (let word of strWords) {
        const normalizedWord = normalizeMoveKey(word);
        const letterOnlyWord = buildLegacyMoveKey(normalizedWord);
        if (!normalizedWord && !letterOnlyWord) {
          continue;
        }

        const storedMove = resolveStoredMoveList(storedMoveLists, word);
        if (storedMove) {
          wordArray.push(storedMove.moveName);
          ref.animations.push(['add-text', storedMove.moveName + ' ']);

          const importedAvatar = resolveAvatarModel(storedMove.payload?.avatar);
          if (importedAvatar && importedAvatar !== bot) {
            setBot(importedAvatar);
          }

          queueStoredMoveList(ref, storedMove.payload);
          continue;
        }

        if (letterOnlyWord && words.wordList.includes(letterOnlyWord) && typeof words[letterOnlyWord] === 'function') {
          wordArray.push(letterOnlyWord);
          ref.animations.push(['add-text', letterOnlyWord + ' ']);
          words[letterOnlyWord](ref);
          continue;
        }

        // Fallback to fingerspelling for words without movelist support.
        for (const [index, ch] of letterOnlyWord.split('').entries()) {
          if (alphabets[ch] && typeof alphabets[ch] === 'function') {
            wordArray.push(ch);
            if (index === letterOnlyWord.length - 1)
              ref.animations.push(['add-text', ch + ' ']);
            else
              ref.animations.push(['add-text', ch]);
            alphabets[ch](ref);
          } else {
            console.log(`Skipping character '${ch}' - no animation available`);
          }
        }
      }

      console.log('Animation queue built. Total animations:', ref.animations.length);
      console.log('Word array for caption:', wordArray);
      console.log('ref.pending status:', ref.pending);

      setCaptionWords(wordArray);
      setCurrentWordIndex(0);

      // Start animations if not already running
      if (!ref.pending && ref.animations.length > 0) {
        console.log('Starting animation loop...');
        ref.pending = true;
        ref.animate();
      } else {
        console.log('Animation NOT started. Pending:', ref.pending, 'Queue length:', ref.animations.length);
      }
    } catch (error) {
      console.error("Sign conversion error:", error);
      const fallbackText = str.trim().toUpperCase();
      if (!fallbackText) {
        setTranslationError(`Error: ${error.message}`);
        return;
      }

      // Final fallback path: keep animation functional with original input.
      setDetectedLanguage('Translation unavailable. Using original input text.');
      setTranslationError('');

      const strWords = fallbackText.split(/\s+/).filter(Boolean);
      setText('');
      setFullCaption(fallbackText);

      let wordArray = [];
      const storedMoveLists = readStoredMoveLists();

      for (let word of strWords) {
        const normalizedWord = normalizeMoveKey(word);
        const letterOnlyWord = buildLegacyMoveKey(normalizedWord);
        if (!normalizedWord && !letterOnlyWord) {
          continue;
        }

        const storedMove = resolveStoredMoveList(storedMoveLists, word);
        if (storedMove) {
          wordArray.push(storedMove.moveName);
          ref.animations.push(['add-text', storedMove.moveName + ' ']);

          const importedAvatar = resolveAvatarModel(storedMove.payload?.avatar);
          if (importedAvatar && importedAvatar !== bot) {
            setBot(importedAvatar);
          }

          queueStoredMoveList(ref, storedMove.payload);
          continue;
        }

        if (letterOnlyWord && words.wordList.includes(letterOnlyWord) && typeof words[letterOnlyWord] === 'function') {
          wordArray.push(letterOnlyWord);
          ref.animations.push(['add-text', letterOnlyWord + ' ']);
          words[letterOnlyWord](ref);
          continue;
        }

        for (const [index, ch] of letterOnlyWord.split('').entries()) {
          if (alphabets[ch] && typeof alphabets[ch] === 'function') {
            wordArray.push(ch);
            if (index === letterOnlyWord.length - 1)
              ref.animations.push(['add-text', ch + ' ']);
            else
              ref.animations.push(['add-text', ch]);
            alphabets[ch](ref);
          }
        }
      }

      setCaptionWords(wordArray);
      setCurrentWordIndex(0);

      if (!ref.pending && ref.animations.length > 0) {
        ref.pending = true;
        ref.animate();
      }
    } finally {
      setIsTranslating(false);
    }
  }

  const startListening = () => {
    // Use English for speech recognition, we'll auto-detect the language from the transcribed text
    SpeechRecognition.startListening({ continuous: true, language: 'en-US' });
  }

  const stopListening = () => {
    SpeechRecognition.stopListening();
  }

  const importWordAnimationJson = async () => {
    if (!movelistFile) {
      setMovelistImportError('Please choose a movelist JSON file first.');
      setMovelistImportMessage('');
      return;
    }

    try {
      const fileContent = await movelistFile.text();
      const payload = JSON.parse(fileContent);
      const { moveName, normalizedPayload } = normalizeImportedMoveList(payload);

      const importedAvatar = resolveAvatarModel(normalizedPayload.avatar);
      if (importedAvatar) {
        setBot(importedAvatar);
      }

      saveStoredMoveList(moveName, normalizedPayload);
      setMovelistImportError('');
      setMovelistImportMessage(`Imported "${moveName}" with ${normalizedPayload.poses.length} poses using ${resolveAvatarLabel(importedAvatar || bot)}.`);
      setMovelistFile(null);
    } catch (error) {
      console.error('Movelist import failed:', error);
      setMovelistImportMessage('');
      setMovelistImportError(`Import failed: ${error.message}`);
    }
  };

  const importWordAnimationPrompt = () => {
    try {
      const { moveName, normalizedPayload } = parseMoveListFromPromptText(movelistPromptText);
      const importedAvatar = resolveAvatarModel(normalizedPayload.avatar);
      if (importedAvatar) {
        setBot(importedAvatar);
      }
      saveStoredMoveList(moveName, normalizedPayload);
      setMovelistImportError('');
      setMovelistImportMessage(`Imported from prompt: "${moveName}" with ${normalizedPayload.poses.length} poses using ${resolveAvatarLabel(importedAvatar || bot)}.`);
      setMovelistPromptText('');
    } catch (error) {
      console.error('Prompt import failed:', error);
      setMovelistImportMessage('');
      setMovelistImportError(`Prompt import failed: ${error.message}`);
    }
  };

  const copyStrictTemplate = async () => {
    const textToCopy = STRICT_PROMPT_TEMPLATE;

    if (!textToCopy.trim()) {
      setTemplateCopyMessage('');
      setTemplateCopyError('No template available to copy.');
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = textToCopy;
        tempTextArea.setAttribute('readonly', '');
        tempTextArea.style.position = 'absolute';
        tempTextArea.style.left = '-9999px';
        document.body.appendChild(tempTextArea);
        tempTextArea.select();

        const copied = document.execCommand('copy');
        document.body.removeChild(tempTextArea);

        if (!copied) {
          throw new Error('Clipboard command failed.');
        }
      }

      setTemplateCopyError('');
      setTemplateCopyMessage('Template copied. Paste it into ChatGPT/Claude.');
    } catch (error) {
      console.error('Template copy failed:', error);
      setTemplateCopyMessage('');
      setTemplateCopyError('Could not copy automatically. Select and copy manually.');
    }
  };

  const insertTemplateIntoPrompt = () => {
    setMovelistPromptText(STRICT_PROMPT_TEMPLATE);
    setTemplateCopyError('');
    setTemplateCopyMessage('Template inserted into the prompt box.');
    setMovelistImportError('');
  };

  const clearPromptText = () => {
    setMovelistPromptText('');
    setMovelistImportError('');
    setTemplateCopyError('');
    setTemplateCopyMessage('Prompt box cleared.');
  };

  return (
    <div className='container-fluid page-container-cream'>
      {showCorrectOverlay && (
        <div className="correct-sign-overlay">
          <div className="correct-sign-content">
            <div className="checkmark-circle">
              <i className="fa fa-check" />
            </div>
            <h1>CORRECT SIGN!</h1>
          </div>
        </div>
      )}
      <div className='row'>
        <div className='col-md-3'>
          {/* Detected Language Display */}
          {detectedLanguage && !isTranslating && (
            <div className='detected-language-display' style={{
              padding: '12px',
              marginBottom: '16px',
              backgroundColor: '#d4edda',
              borderRadius: '6px',
              fontSize: '16px',
              fontWeight: 'bold',
              color: '#155724',
              textAlign: 'center'
            }}>
              <i className="fa fa-language" style={{ marginRight: '8px' }} />
              {detectedLanguage}
            </div>
          )}

          {/* Translation Status */}
          {isTranslating && (
            <div className='translation-status' style={{
              padding: '8px',
              marginBottom: '12px',
              backgroundColor: '#fff3cd',
              borderRadius: '4px',
              fontSize: '14px',
              color: '#856404'
            }}>
              <i className="fa fa-spinner fa-spin" style={{ marginRight: '8px' }} />
              Translating...
            </div>
          )}

          {translationError && (
            <div className='translation-error' style={{
              padding: '8px',
              marginBottom: '12px',
              backgroundColor: '#f8d7da',
              borderRadius: '4px',
              fontSize: '14px',
              color: '#721c24'
            }}>
              <i className="fa fa-exclamation-circle" style={{ marginRight: '8px' }} />
              {translationError}
            </div>
          )}

          <label className='label-style'>
            Processed Text
          </label>
          <textarea rows={3} value={text} className='w-100 input-style' readOnly />
          <label className='label-style'>
            Speech Recognition: {listening ? 'on' : 'off'}
          </label>
          <div className='space-between'>
            <button className="btn btn-brown btn-style w-33" onClick={startListening}>
              Mic On <i className="fa fa-microphone" />
            </button>
            <button className="btn btn-brown btn-style w-33" onClick={stopListening}>
              Mic Off <i className="fa fa-microphone-slash" />
            </button>
            <button className="btn btn-brown btn-style w-33" onClick={resetTranscript}>
              Clear
            </button>
          </div>
          <textarea rows={3} ref={textFromAudio} value={transcript} placeholder="Speech input ..." className='w-100 input-style' />
          <button
            onClick={() => { sign(textFromAudio) }}
            className='btn btn-brown w-100 btn-style btn-start'
            disabled={isTranslating}
          >
            {isTranslating ? 'Translating...' : 'Start Animations'}
          </button>
          <label className='label-style'>
            Text Input
          </label>
          <textarea rows={3} ref={textFromInput} placeholder="Enter text in any language ..." className='w-100 input-style' />
          <button
            onClick={() => { sign(textFromInput) }}
            className='btn btn-brown w-100 btn-style btn-start'
            disabled={isTranslating}
          >
            {isTranslating ? 'Translating...' : 'Start Animations'}
          </button>

          <label className='label-style mt-2'>
            Import Word Animation JSON
          </label>
          <input
            type='file'
            accept='.json,application/json'
            className='w-100 input-style'
            onChange={(event) => {
              const selectedFile = event.target.files && event.target.files[0] ? event.target.files[0] : null;
              setMovelistFile(selectedFile);
              setMovelistImportMessage('');
              setMovelistImportError('');
            }}
          />
          <button
            className='btn btn-brown w-100 btn-style btn-start'
            onClick={importWordAnimationJson}
            disabled={!movelistFile}
          >
            Import JSON
          </button>

          <label className='label-style mt-2'>
            Paste Motion Prompt
          </label>
          <textarea
            rows={6}
            value={movelistPromptText}
            onChange={(event) => {
              setMovelistPromptText(event.target.value);
              if (movelistImportError) {
                setMovelistImportError('');
              }
              if (templateCopyMessage) {
                setTemplateCopyMessage('');
              }
              if (templateCopyError) {
                setTemplateCopyError('');
              }
            }}
            placeholder='Paste ChatGPT/Claude output that includes move-list JSON.'
            className='w-100 input-style'
          />
          <button
            className='btn btn-brown w-100 btn-style btn-start'
            onClick={importWordAnimationPrompt}
            disabled={!movelistPromptText.trim()}
          >
            Import Prompt
          </button>

          <label className='label-style mt-2'>
            Strict Prompt Template
          </label>
          <textarea
            rows={8}
            value={STRICT_PROMPT_TEMPLATE}
            readOnly
            className='w-100 input-style'
          />
          <button
            className='btn btn-brown w-100 btn-style btn-start'
            onClick={copyStrictTemplate}
          >
            Copy Template (One Click)
          </button>
          <div className='space-between'>
            <button
              className='btn btn-brown btn-style'
              style={{ width: '49%' }}
              onClick={insertTemplateIntoPrompt}
            >
              Insert Template
            </button>
            <button
              className='btn btn-brown btn-style'
              style={{ width: '49%' }}
              onClick={clearPromptText}
            >
              Clear Prompt
            </button>
          </div>

          {templateCopyMessage && (
            <div style={{
              padding: '8px',
              marginBottom: '12px',
              backgroundColor: '#d4edda',
              borderRadius: '4px',
              fontSize: '14px',
              color: '#155724'
            }}>
              <i className="fa fa-check-circle" style={{ marginRight: '8px' }} />
              {templateCopyMessage}
            </div>
          )}
          {templateCopyError && (
            <div style={{
              padding: '8px',
              marginBottom: '12px',
              backgroundColor: '#f8d7da',
              borderRadius: '4px',
              fontSize: '14px',
              color: '#721c24'
            }}>
              <i className="fa fa-exclamation-circle" style={{ marginRight: '8px' }} />
              {templateCopyError}
            </div>
          )}

          {movelistImportMessage && (
            <div style={{
              padding: '8px',
              marginBottom: '12px',
              backgroundColor: '#d4edda',
              borderRadius: '4px',
              fontSize: '14px',
              color: '#155724'
            }}>
              <i className="fa fa-check-circle" style={{ marginRight: '8px' }} />
              {movelistImportMessage}
            </div>
          )}
          {movelistImportError && (
            <div style={{
              padding: '8px',
              marginBottom: '12px',
              backgroundColor: '#f8d7da',
              borderRadius: '4px',
              fontSize: '14px',
              color: '#721c24'
            }}>
              <i className="fa fa-exclamation-circle" style={{ marginRight: '8px' }} />
              {movelistImportError}
            </div>
          )}
        </div>
        <div className='col-md-7' style={{ position: 'relative' }}>
          <div id='canvas' />
          {fullCaption && (
            <div className='caption-overlay'>
              <div className='caption-text'>
                {captionWords.map((word, index) => (
                  <span
                    key={index}
                    className={index === currentWordIndex ? 'caption-word-active' : 'caption-word'}
                  >
                    {word}{index < captionWords.length - 1 ? ' ' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className='col-md-2'>
          <p className='bot-label'>
            Select Avatar
          </p>
          <img
            src={xbotPic}
            className='bot-image col-md-11'
            style={{
              border: bot === xbot ? '4px solid #8B4513' : '4px solid transparent',
              borderRadius: '12px',
              boxSizing: 'border-box',
            }}
            onClick={() => { setBot(xbot); }}
            alt='Avatar 1: XBOT'
          />
          <img
            src={ybotPic}
            className='bot-image col-md-11'
            style={{
              border: bot === ybot ? '4px solid #8B4513' : '4px solid transparent',
              borderRadius: '12px',
              boxSizing: 'border-box',
            }}
            onClick={() => { setBot(ybot); }}
            alt='Avatar 2: YBOT'
          />
          <div className='simulator-status' style={{ marginTop: '8px' }}>
            Current Avatar: {resolveAvatarLabel(bot)}
          </div>
          <p className='label-style'>
            Animation Speed: {Math.round(speed * 100) / 100}
          </p>
          <Slider
            axis="x"
            xmin={0.05}
            xmax={0.50}
            xstep={0.01}
            x={speed}
            onChange={({ x }) => setSpeed(x)}
            className='w-100'
          />
          <p className='label-style'>
            Pause time: {pause} ms
          </p>
          <Slider
            axis="x"
            xmin={0}
            xmax={2000}
            xstep={100}
            x={pause}
            onChange={({ x }) => setPause(x)}
            className='w-100'
          />
        </div>
      </div>
    </div>
  )
}


export default Convert;