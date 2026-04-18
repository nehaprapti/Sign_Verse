import '../App.css'
import React, { useCallback, useEffect, useRef, useState } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';

import xbot from '../Models/xbot/xbot.glb';
import ybot from '../Models/ybot/ybot.glb';
import xbotPic from '../Models/xbot/xbot.png';
import ybotPic from '../Models/ybot/ybot.png';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { defaultPose } from '../Animations/defaultPose';
import EvaluationPanel from '../Components/EvaluationPanel';
import {
  computePoseError,
  evaluatePoseAgainstTolerance,
  buildEvaluationSummary,
  validateMoveListSchema,
  DEFAULT_AVG_TOLERANCE_DEG,
  DEFAULT_MAX_TOLERANCE_DEG,
} from '../Utils/evaluationUtils';

const LEFT_HAND_CANDIDATES = ['mixamorigLeftHand', 'LeftHand'];
const RIGHT_HAND_CANDIDATES = ['mixamorigRightHand', 'RightHand'];
const LEFT_ARM_CANDIDATES = ['mixamorigLeftArm', 'LeftArm'];
const RIGHT_ARM_CANDIDATES = ['mixamorigRightArm', 'RightArm'];
const LEFT_FOREARM_CANDIDATES = ['mixamorigLeftForeArm', 'LeftForeArm'];
const RIGHT_FOREARM_CANDIDATES = ['mixamorigRightForeArm', 'RightForeArm'];
const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const DEFAULT_FINGER_CLOSE_LEVELS = {
  thumb: 3,
  index: 3,
  middle: 3,
  ring: 3,
  pinky: 3,
};
const OPEN_FINGER_LEVELS = {
  thumb: 0,
  index: 0,
  middle: 0,
  ring: 0,
  pinky: 0,
};

const MOVELIST_STORAGE_KEY = 'signverse_custom_movelists';

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

const extractJsonObjectFromText = (rawText) => {
  const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
  if (!trimmed) {
    throw new Error('Prompt text is empty. Paste the model output first.');
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

const parseMoveListFromPromptText = (promptText) => {
  const jsonText = extractJsonObjectFromText(promptText);
  return JSON.parse(jsonText);
};

const toVector = (vector) => ({
  x: Number(vector.x.toFixed(4)),
  y: Number(vector.y.toFixed(4)),
  z: Number(vector.z.toFixed(4)),
});

const clampRotation = (value) => {
  const min = -Math.PI;
  const max = Math.PI;
  return Math.max(min, Math.min(max, value));
};

const clampToRange = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};

const normalizeAngle = (angle) => {
  let normalized = angle;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
};

const lerpAngle = (from, to, t) => {
  const shortest = normalizeAngle(to - from);
  return clampRotation(from + shortest * t);
};

function Simulate() {
  const [bot, setBot] = useState(ybot);
  const [wordName, setWordName] = useState('ABBREVIATION');
  const [poseName, setPoseName] = useState('Pose 1');
  const [selectedHand, setSelectedHand] = useState('left');
  const [mirrorModeEnabled, setMirrorModeEnabled] = useState(false);
  const [fingerCloseLevels, setFingerCloseLevels] = useState(DEFAULT_FINGER_CLOSE_LEVELS);
  const [stationaryFinger, setStationaryFinger] = useState('index');
  const [movingFinger, setMovingFinger] = useState('thumb');
  const [moveStep, setMoveStep] = useState(0.02);
  const [rotationStep, setRotationStep] = useState(0.05);
  const [cameraZoom, setCameraZoom] = useState(1.6);
  const [cameraPoseEnabled, setCameraPoseEnabled] = useState(false);
  const [cameraHandMapping, setCameraHandMapping] = useState('selected');
  const [cameraFingerMappingEnabled, setCameraFingerMappingEnabled] = useState(true);
  const [markedPoses, setMarkedPoses] = useState([]);
  const [isPosePlaybackActive, setIsPosePlaybackActive] = useState(false);
  const [isPoseLoopEnabled, setIsPoseLoopEnabled] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState([]);
  const [statusMessage, setStatusMessage] = useState('Use keyboard/mouse to pose the avatar hands.');
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [photoFileName, setPhotoFileName] = useState('');

  // ── Evaluation Engine State ──────────────────────────────────────────
  const [evaluationStatus, setEvaluationStatus] = useState('idle'); // idle | running | passed | failed
  const [evaluationResults, setEvaluationResults] = useState([]);
  const [evaluationSummary, setEvaluationSummary] = useState(null);
  const [evaluationPassed, setEvaluationPassed] = useState(false); // gates Save button
  const [evaluatedPayload, setEvaluatedPayload] = useState(null); // payload that passed eval
  const [evalUploadFile, setEvalUploadFile] = useState(null);
  const [evalUploadMessage, setEvalUploadMessage] = useState('');
  const [evalPromptText, setEvalPromptText] = useState('');
  const [evalPromptMessage, setEvalPromptMessage] = useState('');
  const [evalPromptError, setEvalPromptError] = useState('');
  const [evalTemplateCopyMessage, setEvalTemplateCopyMessage] = useState('');
  const [evalTemplateCopyError, setEvalTemplateCopyError] = useState('');
  const [currentEvalPoseIndex, setCurrentEvalPoseIndex] = useState(-1); // which pose is being shown

  const selectedHandRef = useRef('left');
  const mirrorModeRef = useRef(false);
  const moveStepRef = useRef(0.02);
  const rotationStepRef = useRef(0.05);
  const cameraVideoRef = useRef(null);

  const componentRef = useRef({
    isMouseDown: false,
    animationFrameId: null,
    fingerMotionFrameId: null,
    cameraPoseFrameId: null,
    posePlaybackFrameId: null,
    photoPoseFrameId: null,
    cameraStream: null,
    handLandmarker: null,
  });
  const { current: ref } = componentRef;

  const zoomCamera = useCallback((delta) => {
    if (!ref.camera) {
      return;
    }

    const minDistance = 0.9;
    const maxDistance = 3.2;
    ref.camera.position.z = Math.min(maxDistance, Math.max(minDistance, ref.camera.position.z + delta));
    setCameraZoom(Number(ref.camera.position.z.toFixed(2)));
  }, [ref]);

  useEffect(() => {
    selectedHandRef.current = selectedHand;
  }, [selectedHand]);

  useEffect(() => {
    mirrorModeRef.current = mirrorModeEnabled;
  }, [mirrorModeEnabled]);

  useEffect(() => {
    moveStepRef.current = moveStep;
  }, [moveStep]);

  useEffect(() => {
    rotationStepRef.current = rotationStep;
  }, [rotationStep]);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  const handlePhotoUpload = useCallback((event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }

    const nextUrl = URL.createObjectURL(file);
    setPhotoPreviewUrl(nextUrl);
    setPhotoFileName(file.name);
    setStatusMessage('Photo loaded. Click Detect Pose to apply the pose to the avatar.');
  }, [photoPreviewUrl]);

  const getBone = useCallback((boneNameList) => {
    if (!ref.avatar) {
      return null;
    }

    for (const name of boneNameList) {
      const bone = ref.avatar.getObjectByName(name);
      if (bone) {
        return bone;
      }
    }

    return null;
  }, [ref]);

  const getHandBone = useCallback((hand) => {
    return hand === 'left'
      ? getBone(LEFT_HAND_CANDIDATES)
      : getBone(RIGHT_HAND_CANDIDATES);
  }, [getBone]);

  const getArmRig = useCallback((hand) => {
    if (hand === 'left') {
      return {
        arm: getBone(LEFT_ARM_CANDIDATES),
        forearm: getBone(LEFT_FOREARM_CANDIDATES),
        hand: getBone(LEFT_HAND_CANDIDATES),
      };
    }

    return {
      arm: getBone(RIGHT_ARM_CANDIDATES),
      forearm: getBone(RIGHT_FOREARM_CANDIDATES),
      hand: getBone(RIGHT_HAND_CANDIDATES),
    };
  }, [getBone]);

  const getPhotoPoseTargets = useCallback((poseLandmarks) => {
    if (!poseLandmarks || poseLandmarks.length < 17) {
      return null;
    }

    const vec = (p) => ({ x: p.x, y: p.y, z: p.z });
    const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
    const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const cross = (a, b) => ({
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    });
    const len = (a) => Math.sqrt(dot(a, a));
    const normalize = (a) => {
      const length = len(a);
      if (!length) {
        return { x: 0, y: 0, z: 0 };
      }
      return scale(a, 1 / length);
    };

    const leftShoulder = poseLandmarks[11] ? vec(poseLandmarks[11]) : null;
    const rightShoulder = poseLandmarks[12] ? vec(poseLandmarks[12]) : null;
    if (!leftShoulder || !rightShoulder) {
      return null;
    }

    const leftHip = poseLandmarks[23] ? vec(poseLandmarks[23]) : null;
    const rightHip = poseLandmarks[24] ? vec(poseLandmarks[24]) : null;
    const shoulderMid = scale(add(leftShoulder, rightShoulder), 0.5);
    const hipMid = leftHip && rightHip
      ? scale(add(leftHip, rightHip), 0.5)
      : { x: shoulderMid.x, y: shoulderMid.y + 0.25, z: shoulderMid.z };

    const torsoUp = normalize(sub(shoulderMid, hipMid));
    const torsoRight = normalize(sub(rightShoulder, leftShoulder));
    let torsoForward = normalize(cross(torsoRight, torsoUp));
    if (len(torsoForward) === 0) {
      torsoForward = { x: 0, y: 0, z: 1 };
    }

    const toTorsoFrame = (v) => ({
      x: dot(v, torsoRight),
      y: dot(v, torsoUp),
      z: dot(v, torsoForward),
    });

    const getTargetsForSide = (side) => {
      const source = side === 'left'
        ? { shoulder: 11, elbow: 13, wrist: 15 }
        : { shoulder: 12, elbow: 14, wrist: 16 };

      const shoulder = poseLandmarks[source.shoulder];
      const elbow = poseLandmarks[source.elbow];
      const wrist = poseLandmarks[source.wrist];

      if (!shoulder || !elbow || !wrist) {
        return null;
      }

      const upperVec = normalize(sub(elbow, shoulder));
      const foreVec = normalize(sub(wrist, elbow));

      const upperLocal = toTorsoFrame(upperVec);
      const foreLocal = toTorsoFrame(foreVec);

      const elbowAngle = angleAtJoint(shoulder, elbow, wrist);
      const elbowFlex = clampToRange((Math.PI - elbowAngle) / (Math.PI - 0.35), 0, 1);

      const armYaw = clampToRange(Math.atan2(upperLocal.x, upperLocal.z) * 0.9, -1.2, 1.2);
      const armPitch = clampToRange(Math.atan2(-upperLocal.y, Math.sqrt(upperLocal.x ** 2 + upperLocal.z ** 2)) * 1.05, -1.2, 1.2);
      const armRoll = 0;

      const forearmYaw = clampToRange(Math.atan2(foreLocal.x, foreLocal.z) * 0.9, -1.25, 1.25);
      const forearmPitch = clampToRange(Math.atan2(-foreLocal.y, Math.sqrt(foreLocal.x ** 2 + foreLocal.z ** 2)) + (elbowFlex * 0.9), -1.35, 1.35);
      const forearmRoll = 0;

      return {
        arm: { x: armPitch, y: armYaw, z: armRoll },
        forearm: { x: forearmPitch, y: forearmYaw, z: forearmRoll },
      };
    };

    return {
      left: getTargetsForSide('left'),
      right: getTargetsForSide('right'),
    };
  }, []);

  const animatePhotoPose = useCallback((targets, durationMs = 700) => {
    if (!targets) {
      return;
    }

    const startTime = performance.now();
    const leftRig = getArmRig('left');
    const rightRig = getArmRig('right');

    const startRotations = {
      left: {
        arm: leftRig.arm ? { x: leftRig.arm.rotation.x, y: leftRig.arm.rotation.y, z: leftRig.arm.rotation.z } : null,
        forearm: leftRig.forearm ? { x: leftRig.forearm.rotation.x, y: leftRig.forearm.rotation.y, z: leftRig.forearm.rotation.z } : null,
      },
      right: {
        arm: rightRig.arm ? { x: rightRig.arm.rotation.x, y: rightRig.arm.rotation.y, z: rightRig.arm.rotation.z } : null,
        forearm: rightRig.forearm ? { x: rightRig.forearm.rotation.x, y: rightRig.forearm.rotation.y, z: rightRig.forearm.rotation.z } : null,
      },
    };

    if (ref.photoPoseFrameId) {
      cancelAnimationFrame(ref.photoPoseFrameId);
      ref.photoPoseFrameId = null;
    }

    const lerpRotation = (from, to, t) => {
      if (!from || !to) {
        return null;
      }

      return {
        x: lerpAngle(from.x, to.x, t),
        y: lerpAngle(from.y, to.y, t),
        z: lerpAngle(from.z, to.z, t),
      };
    };

    const animate = (now) => {
      const progress = Math.min((now - startTime) / durationMs, 1);

      const leftTarget = targets.left;
      if (leftTarget) {
        const armRotation = lerpRotation(startRotations.left.arm, leftTarget.arm, progress);
        const forearmRotation = lerpRotation(startRotations.left.forearm, leftTarget.forearm, progress);

        if (leftRig.arm && armRotation) {
          leftRig.arm.rotation.set(armRotation.x, armRotation.y, armRotation.z);
        }
        if (leftRig.forearm && forearmRotation) {
          leftRig.forearm.rotation.set(forearmRotation.x, forearmRotation.y, forearmRotation.z);
        }
      }

      const rightTarget = targets.right;
      if (rightTarget) {
        const armRotation = lerpRotation(startRotations.right.arm, rightTarget.arm, progress);
        const forearmRotation = lerpRotation(startRotations.right.forearm, rightTarget.forearm, progress);

        if (rightRig.arm && armRotation) {
          rightRig.arm.rotation.set(armRotation.x, armRotation.y, armRotation.z);
        }
        if (rightRig.forearm && forearmRotation) {
          rightRig.forearm.rotation.set(forearmRotation.x, forearmRotation.y, forearmRotation.z);
        }
      }

      if (progress < 1) {
        ref.photoPoseFrameId = requestAnimationFrame(animate);
        return;
      }

      ref.photoPoseFrameId = null;
    };

    ref.photoPoseFrameId = requestAnimationFrame(animate);
  }, [getArmRig, ref]);

  const detectPoseFromPhoto = useCallback(async () => {
    if (!photoPreviewUrl) {
      setStatusMessage('Upload a photo first to detect a pose.');
      return;
    }

    try {
      setStatusMessage('Detecting pose from photo...');

      const image = new Image();
      image.src = photoPreviewUrl;
      await new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = (error) => reject(error);
      });

      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
      const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        },
        runningMode: 'IMAGE',
        numPoses: 1,
      });

      const result = poseLandmarker.detect(image);
      poseLandmarker.close();

      const poseLandmarks = result?.landmarks?.[0];
      const targets = getPhotoPoseTargets(poseLandmarks);
      if (!targets || (!targets.left && !targets.right)) {
        setStatusMessage('No clear pose detected in the photo. Try a clearer upper-body image.');
        return;
      }

      animatePhotoPose(targets, 750);
      setStatusMessage('Photo pose applied. Avatar animated to match the image.');
    } catch (error) {
      console.error(error);
      setStatusMessage('Unable to detect pose from the photo. Try another image.');
    }
  }, [animatePhotoPose, getPhotoPoseTargets, photoPreviewUrl]);

  const getFingerRig = useCallback((hand) => {
    const side = hand === 'left' ? 'Left' : 'Right';

    return {
      index1: getBone([`mixamorig${side}HandIndex1`, `${side}HandIndex1`]),
      index2: getBone([`mixamorig${side}HandIndex2`, `${side}HandIndex2`]),
      index3: getBone([`mixamorig${side}HandIndex3`, `${side}HandIndex3`]),
      middle1: getBone([`mixamorig${side}HandMiddle1`, `${side}HandMiddle1`]),
      middle2: getBone([`mixamorig${side}HandMiddle2`, `${side}HandMiddle2`]),
      middle3: getBone([`mixamorig${side}HandMiddle3`, `${side}HandMiddle3`]),
      ring1: getBone([`mixamorig${side}HandRing1`, `${side}HandRing1`]),
      ring2: getBone([`mixamorig${side}HandRing2`, `${side}HandRing2`]),
      ring3: getBone([`mixamorig${side}HandRing3`, `${side}HandRing3`]),
      pinky1: getBone([`mixamorig${side}HandPinky1`, `${side}HandPinky1`]),
      pinky2: getBone([`mixamorig${side}HandPinky2`, `${side}HandPinky2`]),
      pinky3: getBone([`mixamorig${side}HandPinky3`, `${side}HandPinky3`]),
      thumb1: getBone([`mixamorig${side}HandThumb1`, `${side}HandThumb1`]),
      thumb2: getBone([`mixamorig${side}HandThumb2`, `${side}HandThumb2`]),
    };
  }, [getBone]);

  const getWorldPosition = (bone) => {
    const worldPos = new THREE.Vector3();
    bone.getWorldPosition(worldPos);
    return toVector(worldPos);
  };

  const applyRigDeltas = (rig, deltas) => {
    for (const [part, axis, delta] of deltas) {
      const bone = rig[part];
      if (!bone) {
        continue;
      }

      bone.rotation[axis] = clampRotation(bone.rotation[axis] + delta);
    }
  };

  const applyHandRigDeltas = useCallback((sourceHand, deltas) => {
    const sourceRig = getArmRig(sourceHand);
    applyRigDeltas(sourceRig, deltas);

    if (!mirrorModeRef.current || sourceHand !== 'left') {
      return;
    }

    const mirroredDeltas = deltas.map(([part, axis, delta]) => {
      const mirroredDelta = axis === 'y' || axis === 'z' ? -delta : delta;
      return [part, axis, mirroredDelta];
    });

    const rightRig = getArmRig('right');
    applyRigDeltas(rightRig, mirroredDeltas);
  }, [getArmRig]);

  const getFingerJointWeightsForLevel = useCallback((level) => {
    if (level <= 0) {
      return {
        finger: [0, 0, 0],
        thumb: [0, 0],
      };
    }

    if (level === 1) {
      return {
        finger: [0.6, 0.1, 0],
        thumb: [0.5, 0.25],
      };
    }

    if (level === 2) {
      return {
        finger: [0.85, 0.65, 0.2],
        thumb: [0.8, 0.65],
      };
    }

    return {
      finger: [1, 0.9, 0.75],
      thumb: [1, 1],
    };
  }, []);

  const getFingerJointMapByLevels = useCallback((hand, levels) => {
    const sideSign = hand === 'left' ? -1 : 1;
    const thumbSpreadSign = hand === 'left' ? 1 : -1;
    const normalizedLevels = {
      ...OPEN_FINGER_LEVELS,
      ...(levels || {}),
    };

    const curlAmount = Math.PI / 3;
    const thumbBendAmount = Math.PI / 6;
    const thumbSpreadAmount = Math.PI / 6;

    const fingerJoints = (fingerName, level) => {
      const boundedLevel = Math.round(clampToRange(Number(level) || 0, 0, 3));
      const weights = getFingerJointWeightsForLevel(boundedLevel);

      return [
        [`${fingerName}1`, 'z', sideSign * curlAmount * weights.finger[0]],
        [`${fingerName}2`, 'z', sideSign * curlAmount * weights.finger[1]],
        [`${fingerName}3`, 'z', sideSign * curlAmount * weights.finger[2]],
      ];
    };

    const thumbLevel = Math.round(clampToRange(Number(normalizedLevels.thumb) || 0, 0, 3));
    const thumbWeights = getFingerJointWeightsForLevel(thumbLevel);

    return {
      thumb: [
        ['thumb1', 'x', thumbBendAmount * thumbWeights.thumb[0]],
        ['thumb2', 'y', thumbSpreadSign * thumbSpreadAmount * thumbWeights.thumb[1]],
      ],
      index: fingerJoints('index', normalizedLevels.index),
      middle: fingerJoints('middle', normalizedLevels.middle),
      ring: fingerJoints('ring', normalizedLevels.ring),
      pinky: fingerJoints('pinky', normalizedLevels.pinky),
    };
  }, [getFingerJointWeightsForLevel]);

  const angleAtJoint = (a, b, c) => {
    const abx = a.x - b.x;
    const aby = a.y - b.y;
    const abz = a.z - b.z;
    const cbx = c.x - b.x;
    const cby = c.y - b.y;
    const cbz = c.z - b.z;

    const dot = abx * cbx + aby * cby + abz * cbz;
    const magAB = Math.sqrt(abx * abx + aby * aby + abz * abz);
    const magCB = Math.sqrt(cbx * cbx + cby * cby + cbz * cbz);

    if (magAB === 0 || magCB === 0) {
      return Math.PI;
    }

    const cosTheta = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
    return Math.acos(cosTheta);
  };

  const readBoneRotation = (bone) => {
    if (!bone) {
      return null;
    }

    return {
      x: bone.rotation.x,
      y: bone.rotation.y,
      z: bone.rotation.z,
    };
  };

  const applyBoneRotation = (bone, targetRotation) => {
    if (!bone || !targetRotation) {
      return;
    }

    bone.rotation.x = clampRotation(targetRotation.x);
    bone.rotation.y = clampRotation(targetRotation.y);
    bone.rotation.z = clampRotation(targetRotation.z);
  };

  const captureHandPoseSnapshot = useCallback((hand) => {
    const rig = getArmRig(hand);
    const fingerRig = getFingerRig(hand);

    const fingers = {};
    for (const [jointName, jointBone] of Object.entries(fingerRig)) {
      const jointRotation = readBoneRotation(jointBone);
      if (jointRotation) {
        fingers[jointName] = jointRotation;
      }
    }

    return {
      arm: readBoneRotation(rig.arm),
      forearm: readBoneRotation(rig.forearm),
      hand: readBoneRotation(rig.hand),
      fingers,
    };
  }, [getArmRig, getFingerRig]);

  const applyHandPoseSnapshot = useCallback((hand, handSnapshot) => {
    if (!handSnapshot) {
      return;
    }

    const rig = getArmRig(hand);
    const fingerRig = getFingerRig(hand);

    applyBoneRotation(rig.arm, handSnapshot.arm);
    applyBoneRotation(rig.forearm, handSnapshot.forearm);
    applyBoneRotation(rig.hand, handSnapshot.hand);

    for (const [jointName, jointRotation] of Object.entries(handSnapshot.fingers || {})) {
      const jointBone = fingerRig[jointName];
      applyBoneRotation(jointBone, jointRotation);
    }
  }, [getArmRig, getFingerRig]);

  const applyFullPoseSnapshot = useCallback((snapshot) => {
    if (!snapshot) {
      return;
    }

    applyHandPoseSnapshot('left', snapshot.leftHand);
    applyHandPoseSnapshot('right', snapshot.rightHand);
  }, [applyHandPoseSnapshot]);

  const interpolateRotation = useCallback((fromRotation, toRotation, t) => {
    if (!fromRotation && !toRotation) {
      return null;
    }

    if (!fromRotation) {
      return toRotation;
    }

    if (!toRotation) {
      return fromRotation;
    }

    return {
      x: lerpAngle(fromRotation.x, toRotation.x, t),
      y: lerpAngle(fromRotation.y, toRotation.y, t),
      z: lerpAngle(fromRotation.z, toRotation.z, t),
    };
  }, []);

  const interpolateHandSnapshot = useCallback((fromHand, toHand, t) => {
    const fromFingers = fromHand?.fingers || {};
    const toFingers = toHand?.fingers || {};
    const fingerNames = new Set([...Object.keys(fromFingers), ...Object.keys(toFingers)]);

    const fingers = {};
    for (const fingerName of fingerNames) {
      const interpolatedFinger = interpolateRotation(fromFingers[fingerName], toFingers[fingerName], t);
      if (interpolatedFinger) {
        fingers[fingerName] = interpolatedFinger;
      }
    }

    return {
      arm: interpolateRotation(fromHand?.arm, toHand?.arm, t),
      forearm: interpolateRotation(fromHand?.forearm, toHand?.forearm, t),
      hand: interpolateRotation(fromHand?.hand, toHand?.hand, t),
      fingers,
    };
  }, [interpolateRotation]);

  const interpolatePoseSnapshot = useCallback((fromPose, toPose, t) => {
    return {
      leftHand: interpolateHandSnapshot(fromPose?.leftHand, toPose?.leftHand, t),
      rightHand: interpolateHandSnapshot(fromPose?.rightHand, toPose?.rightHand, t),
    };
  }, [interpolateHandSnapshot]);

  const stopPosePlayback = useCallback((message = 'Pose playback stopped.') => {
    if (ref.posePlaybackFrameId) {
      cancelAnimationFrame(ref.posePlaybackFrameId);
      ref.posePlaybackFrameId = null;
    }

    setIsPosePlaybackActive(false);
    setStatusMessage(message);
  }, [ref]);

  // Reset evaluation whenever poses change
  const resetEvaluation = useCallback(() => {
    setEvaluationStatus('idle');
    setEvaluationResults([]);
    setEvaluationSummary(null);
    setEvaluationPassed(false);
    setEvaluatedPayload(null);
    setCurrentEvalPoseIndex(-1);
  }, []);

  const markCurrentPose = useCallback(() => {
    if (!ref.avatar) {
      setStatusMessage('Avatar not loaded yet. Please wait and try again.');
      return;
    }

    const leftSnapshot = captureHandPoseSnapshot('left');
    const rightSnapshot = captureHandPoseSnapshot('right');

    if (!leftSnapshot.hand && !rightSnapshot.hand) {
      setStatusMessage('Unable to detect hand rig for pose marking.');
      return;
    }

    const nextIndex = markedPoses.length + 1;
    const normalizedPoseName = (poseName || '').trim() || `Pose ${nextIndex}`;

    const poseEntry = {
      id: `${Date.now()}-${nextIndex}`,
      name: normalizedPoseName,
      capturedAt: new Date().toISOString(),
      snapshot: {
        leftHand: leftSnapshot,
        rightHand: rightSnapshot,
      },
    };

    setMarkedPoses((prev) => [...prev, poseEntry]);
    setPoseName(`Pose ${nextIndex + 1}`);
    setStatusMessage(`Marked ${normalizedPoseName}.`);
    resetEvaluation(); // poses changed, must re-evaluate
  }, [captureHandPoseSnapshot, markedPoses.length, poseName, ref.avatar, resetEvaluation]);

  const playPoseList = useCallback((poseList, options = {}) => {
    const { startLabel = 'marked', completedLabel = 'Pose playback completed.' } = options;

    if (!Array.isArray(poseList) || poseList.length === 0) {
      setStatusMessage('Mark at least one pose before playback.');
      return false;
    }

    if (poseList.length === 1) {
      applyFullPoseSnapshot(poseList[0].snapshot);
      setStatusMessage(`Applied ${poseList[0].name || 'Pose 1'}. Add more poses to animate.`);
      return true;
    }

    if (ref.posePlaybackFrameId) {
      cancelAnimationFrame(ref.posePlaybackFrameId);
      ref.posePlaybackFrameId = null;
    }

    setIsPosePlaybackActive(true);
    setStatusMessage(`${isPoseLoopEnabled ? 'Looping' : 'Playing'} ${poseList.length} ${startLabel} poses...`);

    const transitionDurationMs = 700;
    let segmentIndex = 0;
    let segmentStartTime = performance.now();

    const animateSegment = (now) => {
      const fromPose = poseList[segmentIndex]?.snapshot;
      const toPose = poseList[segmentIndex + 1]?.snapshot;

      if (!fromPose || !toPose) {
        stopPosePlayback(completedLabel);
        return;
      }

      const rawT = clampToRange((now - segmentStartTime) / transitionDurationMs, 0, 1);
      const smoothT = rawT * rawT * (3 - 2 * rawT);
      const interpolatedPose = interpolatePoseSnapshot(fromPose, toPose, smoothT);
      applyFullPoseSnapshot(interpolatedPose);

      if (rawT < 1) {
        ref.posePlaybackFrameId = requestAnimationFrame(animateSegment);
        return;
      }

      segmentIndex += 1;
      segmentStartTime = now;

      if (segmentIndex >= poseList.length - 1) {
        applyFullPoseSnapshot(poseList[poseList.length - 1].snapshot);

        if (isPoseLoopEnabled) {
          segmentIndex = 0;
          segmentStartTime = now;
          ref.posePlaybackFrameId = requestAnimationFrame(animateSegment);
          return;
        }

        stopPosePlayback(completedLabel);
        return;
      }

      ref.posePlaybackFrameId = requestAnimationFrame(animateSegment);
    };

    ref.posePlaybackFrameId = requestAnimationFrame(animateSegment);
    return true;
  }, [applyFullPoseSnapshot, interpolatePoseSnapshot, isPoseLoopEnabled, ref, stopPosePlayback]);

  const playMarkedPoses = useCallback(() => {
    playPoseList(markedPoses, {
      startLabel: 'marked',
      completedLabel: 'Marked pose playback completed.',
    });
  }, [markedPoses, playPoseList]);

  const applyMarkedPoseByIndex = useCallback((index) => {
    const targetPose = markedPoses[index];
    if (!targetPose) {
      return;
    }

    applyFullPoseSnapshot(targetPose.snapshot);
    setStatusMessage(`Applied ${targetPose.name}.`);
  }, [applyFullPoseSnapshot, markedPoses]);

  const clearMarkedPoses = useCallback(() => {
    stopPosePlayback('Cleared all marked poses.');
    setMarkedPoses([]);
    setPoseName('Pose 1');
    resetEvaluation(); // poses cleared, must re-evaluate
  }, [stopPosePlayback, resetEvaluation]);

  const applyCameraFingerPose = useCallback((hand, landmarks) => {
    const fingerRig = getFingerRig(hand);
    if (!fingerRig || !landmarks) {
      return;
    }

    const angleToCurl = (angleRadians) => {
      // Around 165deg is open, around 75deg is strongly closed.
      const openAngle = 2.88;
      const closedAngle = 1.31;
      return Math.max(0, Math.min(1, (openAngle - angleRadians) / (openAngle - closedAngle)));
    };

    const sideSign = hand === 'left' ? -1 : 1;
    const thumbSpreadSign = hand === 'left' ? 1 : -1;
    const blend = 0.2;

    const thumbCurl = angleToCurl(angleAtJoint(landmarks[1], landmarks[2], landmarks[4]));
    const indexCurl = angleToCurl(angleAtJoint(landmarks[5], landmarks[6], landmarks[8]));
    const middleCurl = angleToCurl(angleAtJoint(landmarks[9], landmarks[10], landmarks[12]));
    const ringCurl = angleToCurl(angleAtJoint(landmarks[13], landmarks[14], landmarks[16]));
    const pinkyCurl = angleToCurl(angleAtJoint(landmarks[17], landmarks[18], landmarks[20]));

    const setJoint = (jointName, axis, target) => {
      const joint = fingerRig[jointName];
      if (!joint) {
        return;
      }
      joint.rotation[axis] = clampRotation(joint.rotation[axis] * (1 - blend) + target * blend);
    };

    const fingerCurlToZ = (curl, weight = 1) => sideSign * (Math.PI / 2.9) * curl * weight;

    setJoint('index1', 'z', fingerCurlToZ(indexCurl, 0.7));
    setJoint('index2', 'z', fingerCurlToZ(indexCurl, 1.0));
    setJoint('index3', 'z', fingerCurlToZ(indexCurl, 1.15));

    setJoint('middle1', 'z', fingerCurlToZ(middleCurl, 0.7));
    setJoint('middle2', 'z', fingerCurlToZ(middleCurl, 1.0));
    setJoint('middle3', 'z', fingerCurlToZ(middleCurl, 1.15));

    setJoint('ring1', 'z', fingerCurlToZ(ringCurl, 0.7));
    setJoint('ring2', 'z', fingerCurlToZ(ringCurl, 1.0));
    setJoint('ring3', 'z', fingerCurlToZ(ringCurl, 1.15));

    setJoint('pinky1', 'z', fingerCurlToZ(pinkyCurl, 0.7));
    setJoint('pinky2', 'z', fingerCurlToZ(pinkyCurl, 1.0));
    setJoint('pinky3', 'z', fingerCurlToZ(pinkyCurl, 1.15));

    setJoint('thumb1', 'x', (Math.PI / 9) + (Math.PI / 2.8) * thumbCurl);
    setJoint('thumb2', 'y', thumbSpreadSign * (Math.PI / 4.8) * thumbCurl);
  }, [getFingerRig]);

  const captureCurrentData = () => {
    const leftHand = getHandBone('left');
    const rightHand = getHandBone('right');

    if (!leftHand || !rightHand) {
      setStatusMessage('Hands not found on avatar yet. Please wait for model to finish loading.');
      return;
    }

    const frame = {
      frame: capturedFrames.length + 1,
      capturedAt: new Date().toISOString(),
      leftHand: {
        position: toVector(leftHand.position),
        worldPosition: getWorldPosition(leftHand),
        rotation: toVector(leftHand.rotation),
        joints: {
          arm: toVector(getArmRig('left').arm?.rotation || new THREE.Vector3()),
          forearm: toVector(getArmRig('left').forearm?.rotation || new THREE.Vector3()),
          hand: toVector(getArmRig('left').hand?.rotation || new THREE.Vector3()),
        },
      },
      rightHand: {
        position: toVector(rightHand.position),
        worldPosition: getWorldPosition(rightHand),
        rotation: toVector(rightHand.rotation),
        joints: {
          arm: toVector(getArmRig('right').arm?.rotation || new THREE.Vector3()),
          forearm: toVector(getArmRig('right').forearm?.rotation || new THREE.Vector3()),
          hand: toVector(getArmRig('right').hand?.rotation || new THREE.Vector3()),
        },
      },
    };

    setCapturedFrames((prev) => [...prev, frame]);
    setStatusMessage(`Captured frame ${frame.frame}.`);
  };

  const saveFramesAsJson = () => {
    if (capturedFrames.length === 0) {
      setStatusMessage('Capture at least one data point before saving JSON.');
      return;
    }

    const normalizedWord = (wordName || 'NEW_WORD').trim().toUpperCase();

    const payload = {
      word: normalizedWord,
      avatar: bot === xbot ? 'xbot' : 'ybot',
      totalFrames: capturedFrames.length,
      moveStep,
      rotationStep,
      createdAt: new Date().toISOString(),
      frames: capturedFrames,
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${normalizedWord.toLowerCase()}_hand_points.json`;
    anchor.click();

    URL.revokeObjectURL(url);
    setStatusMessage(`Saved ${capturedFrames.length} frames to JSON for word "${normalizedWord}".`);
  };

  // ── Phase 2: JSON Round-Trip Evaluation Function ──────────────────────
  // ── Visible Evaluation: replay each pose on avatar with real delay ──
  const VISIBLE_POSE_DELAY_MS = 700;
  const SETTLE_DELAY_MS = 80;

  const evaluateMoveListVisually = useCallback(async (payload) => {
    const validation = validateMoveListSchema(payload);
    if (!validation.valid) {
      return { error: validation.error };
    }

    const poseResults = [];

    for (let i = 0; i < payload.poses.length; i++) {
      const poseEntry = payload.poses[i];
      const expectedSnapshot = poseEntry.snapshot;

      setCurrentEvalPoseIndex(i);
      setStatusMessage(`Evaluating pose ${i + 1}/${payload.poses.length}: ${poseEntry.name || 'Pose ' + (i + 1)}...`);

      applyFullPoseSnapshot(expectedSnapshot);

      await new Promise((resolve) => setTimeout(resolve, VISIBLE_POSE_DELAY_MS));
      await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));

      const actualSnapshot = {
        leftHand: captureHandPoseSnapshot('left'),
        rightHand: captureHandPoseSnapshot('right'),
      };

      const errorResult = computePoseError(
        expectedSnapshot,
        actualSnapshot,
        DEFAULT_MAX_TOLERANCE_DEG,
      );

      const pass = evaluatePoseAgainstTolerance(
        errorResult,
        DEFAULT_AVG_TOLERANCE_DEG,
        DEFAULT_MAX_TOLERANCE_DEG,
      );

      poseResults.push({
        poseName: poseEntry.name || `Pose ${i + 1}`,
        expectedPoseIndex: i,
        averageErrorDegrees: errorResult.averageErrorDegrees,
        maxErrorDegrees: errorResult.maxErrorDegrees,
        pass,
        failedJoints: errorResult.failedJoints,
      });
    }

    setCurrentEvalPoseIndex(-1);

    return buildEvaluationSummary(
      poseResults,
      DEFAULT_AVG_TOLERANCE_DEG,
      DEFAULT_MAX_TOLERANCE_DEG,
    );
  }, [applyFullPoseSnapshot, captureHandPoseSnapshot]);

  // ── Helper: download + localStorage save ──
  const executeMoveListSave = useCallback((payload) => {
    const normalizedWord = normalizeMoveKey(payload.move || 'NEW_WORD') || 'NEW_WORD';
    const normalizedMoveName = normalizedWord.toLowerCase();
    const normalizedPayload = {
      ...payload,
      move: normalizedWord,
    };

    const json = JSON.stringify(normalizedPayload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${normalizedMoveName}_movelist.json`;
    anchor.click();

    URL.revokeObjectURL(url);

    try {
      const existingRaw = localStorage.getItem(MOVELIST_STORAGE_KEY);
      const existingMap = existingRaw ? JSON.parse(existingRaw) : {};

      existingMap[normalizedWord] = normalizedPayload;
      const legacyKey = buildLegacyMoveKey(normalizedWord);
      if (legacyKey && legacyKey !== normalizedWord) {
        existingMap[legacyKey] = normalizedPayload;
      }
      localStorage.setItem(MOVELIST_STORAGE_KEY, JSON.stringify(existingMap));

      setStatusMessage(`Saved move list JSON with ${normalizedPayload.poses.length} poses for "${normalizedWord}" and registered it for Convert.`);
    } catch (error) {
      console.error('Unable to persist move list in localStorage:', error);
      setStatusMessage(`Saved move list JSON with ${normalizedPayload.poses.length} poses for "${normalizedWord}" (browser save unavailable).`);
    }
  }, []);

  // ── Build the move list payload from current state ──
  const buildMoveListPayload = useCallback(() => {
    const normalizedWord = normalizeMoveKey(wordName || 'NEW_WORD') || 'NEW_WORD';
    return {
      move: normalizedWord,
      avatar: bot === xbot ? 'xbot' : 'ybot',
      totalPoses: markedPoses.length,
      loopPlaybackDefault: isPoseLoopEnabled,
      fingerCloseLevels,
      createdAt: new Date().toISOString(),
      poses: markedPoses.map((pose, index) => ({
        step: index + 1,
        id: pose.id,
        name: pose.name,
        capturedAt: pose.capturedAt,
        snapshot: pose.snapshot,
      })),
    };
  }, [bot, fingerCloseLevels, isPoseLoopEnabled, markedPoses, wordName]);

  // ── "Evaluate Moves" button ──
  const evaluateMarkedPoses = useCallback(async () => {
    if (markedPoses.length === 0) {
      setStatusMessage('Mark at least one pose before evaluating.');
      return;
    }

    const payload = buildMoveListPayload();

    setEvaluationStatus('running');
    setEvaluationResults([]);
    setEvaluationSummary(null);
    setEvaluationPassed(false);
    setEvaluatedPayload(null);
    setStatusMessage('Evaluating: replaying all poses on avatar...');

    try {
      const summary = await evaluateMoveListVisually(payload);

      if (summary.error) {
        setStatusMessage(`Evaluation error: ${summary.error}`);
        setEvaluationStatus('idle');
        return;
      }

      setEvaluationResults(summary.results);
      setEvaluationSummary(summary);

      if (summary.overallPass) {
        setEvaluationStatus('passed');
        setEvaluationPassed(true);
        setEvaluatedPayload(payload);
        setStatusMessage(`Evaluation passed! All ${summary.totalPoses} poses verified. You can now save.`);
      } else {
        setEvaluationStatus('failed');
        setEvaluationPassed(false);
        setEvaluatedPayload(null);
        setStatusMessage(`Evaluation failed: ${summary.failedPoses} of ${summary.totalPoses} poses mismatch. Fix poses and re-evaluate.`);
      }
    } catch (error) {
      console.error('Evaluation error:', error);
      setEvaluationStatus('idle');
      setEvaluationPassed(false);
      setStatusMessage('Evaluation encountered an unexpected error.');
    }
  }, [buildMoveListPayload, evaluateMoveListVisually, markedPoses.length]);

  // ── "Save Move List JSON" - only after evaluation passed ──
  const saveMoveListAsJson = useCallback(() => {
    if (!evaluationPassed || !evaluatedPayload) {
      setStatusMessage('Run evaluation first. Save is only available after all poses pass.');
      return;
    }
    executeMoveListSave(evaluatedPayload);
  }, [evaluationPassed, evaluatedPayload, executeMoveListSave]);

  // ── Evaluation panel callbacks ──
  const handleEvalSaveAnyway = useCallback(() => {
    const payload = evaluatedPayload || buildMoveListPayload();
    executeMoveListSave(payload);
    setStatusMessage('Saved move list (evaluation overridden).');
    setEvaluationStatus('idle');
  }, [buildMoveListPayload, evaluatedPayload, executeMoveListSave]);

  const handleEvalCancel = useCallback(() => {
    setEvaluationStatus('idle');
    setStatusMessage('Evaluation dismissed. Adjust poses and re-evaluate.');
  }, []);

  const handleEvalDismiss = useCallback(() => {
    setEvaluationStatus('idle');
  }, []);

  const handleReplayFailedPoses = useCallback(() => {
    const failedIndices = evaluationResults
      .filter((r) => !r.pass)
      .map((r) => r.expectedPoseIndex);

    if (failedIndices.length === 0 || markedPoses.length === 0) {
      return;
    }

    const firstFailed = failedIndices[0];
    if (markedPoses[firstFailed]) {
      applyFullPoseSnapshot(markedPoses[firstFailed].snapshot);
      setStatusMessage(`Applied failed pose: ${markedPoses[firstFailed].name}. Use Marked Pose List to step through others.`);
    }
  }, [applyFullPoseSnapshot, evaluationResults, markedPoses]);

  const runExternalPayloadEvaluation = useCallback(async (payload, startMessage) => {
    setEvaluationStatus('running');
    setEvaluationResults([]);
    setEvaluationSummary(null);
    setStatusMessage(startMessage);

    const summary = await evaluateMoveListVisually(payload);

    if (summary.error) {
      setStatusMessage(`Evaluation error: ${summary.error}`);
      setEvaluationStatus('idle');
      return summary;
    }

    setEvaluationResults(summary.results);
    setEvaluationSummary(summary);
    setEvaluationStatus(summary.overallPass ? 'passed' : 'failed');
    setStatusMessage('Evaluation complete. See results below.');

    return summary;
  }, [evaluateMoveListVisually]);

  // ── Upload-and-Evaluate Tool ──
  const handleEvalUpload = useCallback(async () => {
    if (!evalUploadFile) {
      setEvalUploadMessage('Choose a move-list JSON file first.');
      return;
    }

    try {
      const fileContent = await evalUploadFile.text();
      const payload = JSON.parse(fileContent);

      setEvalUploadMessage('');
      setEvalPromptMessage('');
      setEvalPromptError('');

      const summary = await runExternalPayloadEvaluation(payload, 'Evaluating uploaded move list on avatar...');

      if (summary.error) {
        setEvalUploadMessage(`Validation error: ${summary.error}`);
        return;
      }

      setEvalUploadMessage(
        summary.overallPass
          ? `Upload evaluation passed: ${summary.passedPoses}/${summary.totalPoses} poses OK.`
          : `Upload evaluation failed: ${summary.failedPoses}/${summary.totalPoses} poses exceeded tolerance.`,
      );
    } catch (error) {
      console.error('Upload evaluation error:', error);
      setEvalUploadMessage(`Error: ${error.message}`);
      setEvaluationStatus('idle');
    }
  }, [evalUploadFile, runExternalPayloadEvaluation]);

  const copySimulateTemplate = useCallback(async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(STRICT_PROMPT_TEMPLATE);
      } else {
        const tempTextArea = document.createElement('textarea');
        tempTextArea.value = STRICT_PROMPT_TEMPLATE;
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

      setEvalTemplateCopyError('');
      setEvalTemplateCopyMessage('Template copied. Paste it into ChatGPT/Claude.');
    } catch (error) {
      console.error('Template copy failed:', error);
      setEvalTemplateCopyMessage('');
      setEvalTemplateCopyError('Could not copy automatically. Select and copy manually.');
    }
  }, []);

  const insertTemplateIntoPrompt = useCallback(() => {
    setEvalPromptText(STRICT_PROMPT_TEMPLATE);
    setEvalTemplateCopyMessage('Template inserted into prompt box.');
    setEvalTemplateCopyError('');
    setEvalPromptError('');
  }, []);

  const clearPromptText = useCallback(() => {
    setEvalPromptText('');
    setEvalPromptMessage('');
    setEvalPromptError('');
    setEvalTemplateCopyError('');
    setEvalTemplateCopyMessage('Prompt box cleared.');
  }, []);

  const validatePromptJson = useCallback(() => {
    try {
      const payload = parseMoveListFromPromptText(evalPromptText);
      const validation = validateMoveListSchema(payload);

      if (!validation.valid) {
        throw new Error(validation.error || 'Prompt JSON failed schema validation.');
      }

      const moveName = typeof payload.move === 'string' ? payload.move : (payload.word || 'UNKNOWN_MOVE');
      setEvalPromptError('');
      setEvalPromptMessage(`Prompt JSON is valid for move "${String(moveName).toUpperCase()}" with ${payload.poses.length} poses.`);
    } catch (error) {
      setEvalPromptMessage('');
      setEvalPromptError(`Validation failed: ${error.message}`);
    }
  }, [evalPromptText]);

  const evaluatePromptJson = useCallback(async () => {
    try {
      const payload = parseMoveListFromPromptText(evalPromptText);
      const validation = validateMoveListSchema(payload);

      if (!validation.valid) {
        throw new Error(validation.error || 'Prompt JSON failed schema validation.');
      }

      setEvalUploadMessage('');
      setEvalPromptMessage('');
      setEvalPromptError('');

      const summary = await runExternalPayloadEvaluation(payload, 'Evaluating pasted prompt JSON on avatar...');
      if (summary.error) {
        setEvalPromptError(`Evaluation error: ${summary.error}`);
        return;
      }

      setEvalPromptMessage(
        summary.overallPass
          ? `Prompt evaluation passed: ${summary.passedPoses}/${summary.totalPoses} poses OK.`
          : `Prompt evaluation failed: ${summary.failedPoses}/${summary.totalPoses} poses exceeded tolerance.`,
      );
    } catch (error) {
      setEvalPromptMessage('');
      setEvalPromptError(`Prompt evaluation failed: ${error.message}`);
      setEvaluationStatus('idle');
    }
  }, [evalPromptText, runExternalPayloadEvaluation]);

  const playPromptPoses = useCallback(() => {
    try {
      const payload = parseMoveListFromPromptText(evalPromptText);
      const validation = validateMoveListSchema(payload);

      if (!validation.valid) {
        throw new Error(validation.error || 'Prompt JSON failed schema validation.');
      }

      const normalizedPoseList = payload.poses
        .filter((pose) => pose?.snapshot)
        .map((pose, index) => ({
          id: `${Date.now()}-prompt-${index + 1}`,
          name: (pose?.name || `Prompt Pose ${index + 1}`).trim(),
          capturedAt: new Date().toISOString(),
          snapshot: pose.snapshot,
        }));

      if (normalizedPoseList.length === 0) {
        throw new Error('Prompt JSON has no playable poses with snapshots.');
      }

      setMarkedPoses(normalizedPoseList);
      setPoseName(`Pose ${normalizedPoseList.length + 1}`);
      resetEvaluation();
      setEvalPromptError('');
      setEvalPromptMessage(`Loaded ${normalizedPoseList.length} prompt poses into simulator.`);

      playPoseList(normalizedPoseList, {
        startLabel: 'prompt',
        completedLabel: 'Prompt pose playback completed.',
      });
    } catch (error) {
      setEvalPromptMessage('');
      setEvalPromptError(`Play failed: ${error.message}`);
    }
  }, [evalPromptText, playPoseList, resetEvaluation]);


  const applyKeyboardControl = useCallback((event) => {
    const key = event.key.toLowerCase();

    if (key === '+' || key === '=') {
      event.preventDefault();
      zoomCamera(-0.1);
      return;
    }

    if (key === '-' || key === '_') {
      event.preventDefault();
      zoomCamera(0.1);
      return;
    }

    if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();

      const activeHand = selectedHandRef.current;
      const rig = getArmRig(activeHand);
      if (!rig.hand) {
        return;
      }

      const step = rotationStepRef.current;
      const wristDelta = event.key === 'ArrowLeft' ? step : -step;

      applyHandRigDeltas(activeHand, [
        ['hand', 'z', wristDelta],
        ['forearm', 'z', wristDelta * 0.45],
      ]);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();

      const activeHand = selectedHandRef.current;
      const rig = getArmRig(activeHand);
      if (!rig.hand) {
        return;
      }

      const step = rotationStepRef.current;
      const tiltDelta = event.key === 'ArrowUp' ? step : -step;

      applyHandRigDeltas(activeHand, [
        ['hand', 'x', tiltDelta],
        ['forearm', 'x', tiltDelta * 0.35],
      ]);
      return;
    }

    const activeHand = selectedHandRef.current;
    const rig = getArmRig(activeHand);
    if (!rig.arm || !rig.forearm || !rig.hand) {
      return;
    }

    const moveStepValue = moveStepRef.current;
    const rotationStepValue = rotationStepRef.current;

    const movementMap = {
      a: [['arm', 'y', -moveStepValue], ['forearm', 'y', -moveStepValue * 0.8]],
      d: [['arm', 'y', moveStepValue], ['forearm', 'y', moveStepValue * 0.8]],
      w: [['arm', 'x', -moveStepValue], ['forearm', 'x', -moveStepValue * 0.7]],
      s: [['arm', 'x', moveStepValue], ['forearm', 'x', moveStepValue * 0.7]],
      q: [['arm', 'z', moveStepValue], ['forearm', 'z', moveStepValue * 0.5]],
      e: [['arm', 'z', -moveStepValue], ['forearm', 'z', -moveStepValue * 0.5]],
    };

    const rightMovementMap = {
      j: [['arm', 'y', -moveStepValue], ['forearm', 'y', -moveStepValue * 0.8]],
      l: [['arm', 'y', moveStepValue], ['forearm', 'y', moveStepValue * 0.8]],
      i: [['arm', 'x', -moveStepValue], ['forearm', 'x', -moveStepValue * 0.7]],
      k: [['arm', 'x', moveStepValue], ['forearm', 'x', moveStepValue * 0.7]],
      u: [['arm', 'z', moveStepValue], ['forearm', 'z', moveStepValue * 0.5]],
      o: [['arm', 'z', -moveStepValue], ['forearm', 'z', -moveStepValue * 0.5]],
    };

    const leftRotationMap = {
      t: [['hand', 'x', rotationStepValue]],
      g: [['hand', 'x', -rotationStepValue]],
      f: [['hand', 'y', rotationStepValue]],
      h: [['hand', 'y', -rotationStepValue]],
      r: [['hand', 'z', rotationStepValue]],
      y: [['hand', 'z', -rotationStepValue]],
    };

    const rightRotationMap = {
      b: [['hand', 'x', rotationStepValue]],
      n: [['hand', 'x', -rotationStepValue]],
      v: [['hand', 'y', rotationStepValue]],
      m: [['hand', 'y', -rotationStepValue]],
      p: [['hand', 'z', rotationStepValue]],
      '[': [['hand', 'z', -rotationStepValue]],
    };

    let action = null;

    if (activeHand === 'left') {
      action = event.shiftKey ? leftRotationMap[key] : movementMap[key];
    } else {
      action = event.shiftKey ? rightRotationMap[key] : rightMovementMap[key];
    }

    if (!action) {
      return;
    }

    event.preventDefault();
    applyHandRigDeltas(activeHand, action);
  }, [applyHandRigDeltas, getArmRig, zoomCamera]);

  useEffect(() => {
    ref.scene = new THREE.Scene();
    ref.scene.background = new THREE.Color(0xdddddd);

    const spotLight = new THREE.SpotLight(0xffffff, 2);
    spotLight.position.set(0, 5, 5);
    ref.scene.add(spotLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    ref.scene.add(ambientLight);

    const canvasWidth = Math.min(window.innerWidth * 0.57, 800);
    const canvasHeight = Math.min(window.innerHeight - 100, 700);

    ref.camera = new THREE.PerspectiveCamera(30, canvasWidth / canvasHeight, 0.1, 1000);
    ref.camera.position.z = 1.6;
    ref.camera.position.y = 1.4;
    setCameraZoom(Number(ref.camera.position.z.toFixed(2)));

    ref.renderer = new THREE.WebGLRenderer({ antialias: true });
    ref.renderer.setSize(canvasWidth, canvasHeight);

    const canvas = document.getElementById('simulate-canvas');
    canvas.innerHTML = '';
    canvas.appendChild(ref.renderer.domElement);

    const loader = new GLTFLoader();
    loader.load(bot, (gltf) => {
      gltf.scene.traverse((child) => {
        if (child.type === 'SkinnedMesh') {
          child.frustumCulled = false;
        }
      });

      ref.avatar = gltf.scene;
      ref.scene.add(ref.avatar);
      ref.animations = [];
      ref.pending = false;
      defaultPose(ref);
      setStatusMessage('Model loaded. Start moving hands and capture frames.');
    });

    const renderLoop = () => {
      ref.animationFrameId = requestAnimationFrame(renderLoop);
      if (ref.renderer && ref.scene && ref.camera) {
        ref.renderer.render(ref.scene, ref.camera);
      }
    };

    renderLoop();
    window.addEventListener('keydown', applyKeyboardControl);

    const rendererDom = ref.renderer.domElement;

    const onMouseDown = () => {
      ref.isMouseDown = true;
    };

    const onMouseUp = () => {
      ref.isMouseDown = false;
    };

    const onMouseMove = (event) => {
      if (!ref.isMouseDown) {
        return;
      }

      const activeHand = selectedHandRef.current;
      const rig = getArmRig(activeHand);
      if (!rig.arm || !rig.forearm || !rig.hand) {
        return;
      }

      const xDelta = event.movementX * 0.0025;
      const yDelta = event.movementY * 0.0025;

      applyHandRigDeltas(activeHand, [
        ['arm', 'y', xDelta],
        ['forearm', 'y', xDelta * 0.8],
        ['arm', 'x', yDelta],
        ['forearm', 'x', yDelta * 0.8],
      ]);
    };

    const onWheel = (event) => {
      event.preventDefault();

      if (event.ctrlKey) {
        zoomCamera(event.deltaY * 0.0012);
        return;
      }

      const activeHand = selectedHandRef.current;
      const rig = getArmRig(activeHand);
      if (!rig.arm || !rig.forearm) {
        return;
      }

      const horizontalDelta = event.deltaX * -0.0012;
      const zDelta = event.deltaY * -0.0012;

      if (horizontalDelta) {
        applyHandRigDeltas(activeHand, [['forearm', 'y', horizontalDelta]]);
      }

      if (zDelta) {
        applyHandRigDeltas(activeHand, [
          ['arm', 'z', zDelta],
          ['forearm', 'z', zDelta * 0.7],
        ]);
      }
    };

    rendererDom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    rendererDom.addEventListener('mousemove', onMouseMove);
    rendererDom.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', applyKeyboardControl);
      window.removeEventListener('mouseup', onMouseUp);

      if (rendererDom) {
        rendererDom.removeEventListener('mousedown', onMouseDown);
        rendererDom.removeEventListener('mousemove', onMouseMove);
        rendererDom.removeEventListener('wheel', onWheel);
      }

      if (ref.animationFrameId) {
        cancelAnimationFrame(ref.animationFrameId);
      }

      if (ref.fingerMotionFrameId) {
        cancelAnimationFrame(ref.fingerMotionFrameId);
        ref.fingerMotionFrameId = null;
      }

      if (ref.cameraPoseFrameId) {
        cancelAnimationFrame(ref.cameraPoseFrameId);
        ref.cameraPoseFrameId = null;
      }

      if (ref.posePlaybackFrameId) {
        cancelAnimationFrame(ref.posePlaybackFrameId);
        ref.posePlaybackFrameId = null;
      }

      if (ref.photoPoseFrameId) {
        cancelAnimationFrame(ref.photoPoseFrameId);
        ref.photoPoseFrameId = null;
      }

      if (ref.cameraStream) {
        const tracks = ref.cameraStream.getTracks();
        for (const track of tracks) {
          track.stop();
        }
        ref.cameraStream = null;
      }

      if (ref.handLandmarker) {
        ref.handLandmarker.close();
        ref.handLandmarker = null;
      }

      if (ref.renderer) {
        ref.renderer.dispose();
      }
    };
  }, [applyHandRigDeltas, applyKeyboardControl, bot, getArmRig, ref, zoomCamera]);

  const resetPose = () => {
    if (!ref.avatar) {
      return;
    }

    const leftRig = getArmRig('left');
    const rightRig = getArmRig('right');
    const rigs = [leftRig, rightRig];

    for (const rig of rigs) {
      if (rig.arm) {
        rig.arm.rotation.set(0, 0, 0);
      }
      if (rig.forearm) {
        rig.forearm.rotation.set(0, 0, 0);
      }
      if (rig.hand) {
        rig.hand.rotation.set(0, 0, 0);
      }
    }

    defaultPose(ref);
    setStatusMessage('Pose reset. Joints remain connected and ready for mouse placement.');
  };

  const setAttentionPose = useCallback(() => {
    if (!ref.avatar) {
      return;
    }

    const hands = ['left', 'right'];
    for (const hand of hands) {
      const rig = getArmRig(hand);
      const sideSign = hand === 'left' ? -1 : 1;

      if (rig.arm) {
        rig.arm.rotation.set(0, 0, clampRotation(sideSign * (Math.PI / 2)));
      }
      if (rig.forearm) {
        rig.forearm.rotation.set(0, 0, 0);
      }
      if (rig.hand) {
        rig.hand.rotation.set(0, 0, 0);
      }

      const fingerRig = getFingerRig(hand);
      const fingerJointMap = getFingerJointMapByLevels(hand, OPEN_FINGER_LEVELS);
      const fingerRotations = Object.values(fingerJointMap).flat();

      for (const [joint, axis, value] of fingerRotations) {
        const bone = fingerRig[joint];
        if (!bone) {
          continue;
        }
        bone.rotation[axis] = clampRotation(value);
      }
    }

    setStatusMessage('Attention pose applied. Both hands lowered and fingers opened.');
  }, [getArmRig, getFingerJointMapByLevels, getFingerRig, ref]);

  const clearData = () => {
    setCapturedFrames([]);
    setStatusMessage('All captured frames cleared.');
  };

  const setFingerPose = useCallback((pose, target = 'selected') => {
    const activeHand = selectedHandRef.current;
    const hands = target === 'both'
      ? ['left', 'right']
      : (mirrorModeRef.current && activeHand === 'left' ? ['left', 'right'] : [activeHand]);
    const poseLevels = pose === 'close'
      ? fingerCloseLevels
      : OPEN_FINGER_LEVELS;

    let totalUpdated = 0;
    for (const hand of hands) {
      const fingerRig = getFingerRig(hand);
      const fingerJointMap = getFingerJointMapByLevels(hand, poseLevels);
      const fingerRotations = Object.values(fingerJointMap).flat();

      for (const [joint, axis, value] of fingerRotations) {
        const bone = fingerRig[joint];
        if (!bone) {
          continue;
        }

        bone.rotation[axis] = clampRotation(value);
        totalUpdated += 1;
      }
    }

    if (totalUpdated === 0) {
      setStatusMessage('Finger joints not found yet. Please wait for model to finish loading.');
      return;
    }

    if (target === 'both') {
      if (pose === 'close') {
        setStatusMessage('Both hands fingers closed using per-finger levels.');
      } else {
        setStatusMessage('Both hands fingers opened.');
      }
      return;
    }

    const hand = selectedHandRef.current;
    if (mirrorModeRef.current && hand === 'left') {
      if (pose === 'close') {
        setStatusMessage('Mirror mode: both hands fingers closed using per-finger levels.');
      } else {
        setStatusMessage('Mirror mode: both hands fingers opened.');
      }
      return;
    }

    if (pose === 'close') {
      setStatusMessage(`${hand === 'left' ? 'Left' : 'Right'} hand fingers closed using per-finger levels.`);
    } else {
      setStatusMessage(`${hand === 'left' ? 'Left' : 'Right'} hand fingers opened.`);
    }
  }, [fingerCloseLevels, getFingerJointMapByLevels, getFingerRig]);

  const setSingleFingerPose = useCallback((finger, pose) => {
    const hand = selectedHandRef.current;
    const hands = mirrorModeRef.current && hand === 'left' ? ['left', 'right'] : [hand];
    const poseLevels = pose === 'close'
      ? fingerCloseLevels
      : OPEN_FINGER_LEVELS;

    let updated = 0;
    for (const targetHand of hands) {
      const fingerRig = getFingerRig(targetHand);
      const fingerJointMap = getFingerJointMapByLevels(targetHand, poseLevels);

      const joints = fingerJointMap[finger];
      if (!joints) {
        continue;
      }

      for (const [joint, axis, value] of joints) {
        const bone = fingerRig[joint];
        if (!bone) {
          continue;
        }

        bone.rotation[axis] = clampRotation(value);
        updated += 1;
      }
    }

    if (updated === 0) {
      setStatusMessage('Finger joints not found yet. Please wait for model to finish loading.');
      return;
    }

    const handLabel = hand === 'left' ? 'Left' : 'Right';
    const fingerLabel = finger.charAt(0).toUpperCase() + finger.slice(1);

    if (mirrorModeRef.current && hand === 'left') {
      if (pose === 'close') {
        const boundedLevel = Math.round(clampToRange(Number(fingerCloseLevels[finger]) || 0, 0, 3));
        setStatusMessage(`Mirror mode: both ${fingerLabel} fingers closed (Level ${boundedLevel}).`);
      } else {
        setStatusMessage(`Mirror mode: both ${fingerLabel} fingers opened.`);
      }
      return;
    }

    if (pose === 'close') {
      const boundedLevel = Math.round(clampToRange(Number(fingerCloseLevels[finger]) || 0, 0, 3));
      setStatusMessage(`${handLabel} ${fingerLabel} finger closed (Level ${boundedLevel}).`);
    } else {
      setStatusMessage(`${handLabel} ${fingerLabel} finger opened.`);
    }
  }, [fingerCloseLevels, getFingerJointMapByLevels, getFingerRig]);

  const stopCircularFingerMotion = useCallback(() => {
    if (ref.fingerMotionFrameId) {
      cancelAnimationFrame(ref.fingerMotionFrameId);
      ref.fingerMotionFrameId = null;
      setStatusMessage('Circular finger motion stopped.');
    }
  }, [ref]);

  const stopCameraPoseDetection = useCallback(() => {
    if (ref.cameraPoseFrameId) {
      cancelAnimationFrame(ref.cameraPoseFrameId);
      ref.cameraPoseFrameId = null;
    }

    if (ref.cameraStream) {
      const tracks = ref.cameraStream.getTracks();
      for (const track of tracks) {
        track.stop();
      }
      ref.cameraStream = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }

    if (ref.handLandmarker) {
      ref.handLandmarker.close();
      ref.handLandmarker = null;
    }

    setCameraPoseEnabled(false);
    setStatusMessage('Camera pose detection stopped.');
  }, [ref]);

  const startCameraPoseDetection = useCallback(async () => {
    try {
      if (!cameraVideoRef.current) {
        setStatusMessage('Camera preview element is not ready yet.');
        return;
      }

      if (ref.cameraPoseFrameId) {
        cancelAnimationFrame(ref.cameraPoseFrameId);
        ref.cameraPoseFrameId = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
      });

      cameraVideoRef.current.srcObject = stream;
      await cameraVideoRef.current.play();
      ref.cameraStream = stream;

      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');

      ref.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        },
        runningMode: 'VIDEO',
        numHands: 1,
      });

      setCameraPoseEnabled(true);
      setStatusMessage('Camera pose detection enabled. Move your palm to drive wrist rotation.');

      const detectAndApply = () => {
        if (!ref.handLandmarker || !cameraVideoRef.current || !ref.avatar) {
          ref.cameraPoseFrameId = requestAnimationFrame(detectAndApply);
          return;
        }

        const result = ref.handLandmarker.detectForVideo(cameraVideoRef.current, performance.now());
        const landmarks = result?.landmarks?.[0];

        if (landmarks) {
          const wrist = landmarks[0];
          const indexMcp = landmarks[5];
          const middleMcp = landmarks[9];
          const pinkyMcp = landmarks[17];
          const handednessLabel = result?.handednesses?.[0]?.[0]?.categoryName?.toLowerCase();

          let hand = selectedHandRef.current;
          if (cameraHandMapping === 'detected' && handednessLabel) {
            hand = handednessLabel === 'left' ? 'left' : 'right';
          } else if (cameraHandMapping === 'mirror' && handednessLabel) {
            hand = handednessLabel === 'left' ? 'right' : 'left';
          } else if (cameraHandMapping === 'left') {
            hand = 'left';
          } else if (cameraHandMapping === 'right') {
            hand = 'right';
          }

          const sideSign = hand === 'left' ? -1 : 1;
          const rig = getArmRig(hand);

          const blendAxis = (bone, axis, target, blend, minLimit, maxLimit) => {
            if (!bone) {
              return;
            }

            const limitedTarget = clampToRange(target, minLimit, maxLimit);
            bone.rotation[axis] = clampRotation(bone.rotation[axis] * (1 - blend) + limitedTarget * blend);
          };

          const palmCenterX = (indexMcp.x + middleMcp.x + pinkyMcp.x) / 3;
          const palmCenterY = (indexMcp.y + middleMcp.y + pinkyMcp.y) / 3;

          const handPitch = (wrist.y - palmCenterY) * 3.4;
          const handYaw = (palmCenterX - wrist.x) * 3.0 * sideSign;
          const palmRoll = Math.atan2(indexMcp.y - pinkyMcp.y, indexMcp.x - pinkyMcp.x) * sideSign;

          const forearmPitch = handPitch * 0.62;
          const forearmYaw = handYaw * 0.58;
          const forearmRoll = palmRoll * 0.5;

          const shoulderLift = (0.62 - wrist.y) * 1.9;
          const shoulderSwing = (wrist.x - 0.5) * 1.8 * sideSign;
          const shoulderTwist = palmRoll * 0.25;

          blendAxis(rig.hand, 'x', handPitch, 0.2, -1.25, 1.25);
          blendAxis(rig.hand, 'y', handYaw, 0.2, -1.1, 1.1);
          blendAxis(rig.hand, 'z', palmRoll, 0.22, -1.35, 1.35);

          blendAxis(rig.forearm, 'x', forearmPitch, 0.16, -1.05, 1.05);
          blendAxis(rig.forearm, 'y', forearmYaw, 0.16, -1.05, 1.05);
          blendAxis(rig.forearm, 'z', forearmRoll, 0.16, -1.1, 1.1);

          blendAxis(rig.arm, 'x', -shoulderLift, 0.14, -1.05, 0.95);
          blendAxis(rig.arm, 'y', shoulderSwing, 0.1, -1.0, 1.0);
          blendAxis(rig.arm, 'z', shoulderTwist, 0.1, -0.7, 0.7);

          if (cameraFingerMappingEnabled) {
            applyCameraFingerPose(hand, landmarks);
          }
        }

        ref.cameraPoseFrameId = requestAnimationFrame(detectAndApply);
      };

      ref.cameraPoseFrameId = requestAnimationFrame(detectAndApply);
    } catch (error) {
      console.error(error);
      stopCameraPoseDetection();
      setStatusMessage('Unable to start camera pose detection. Allow camera permission and try again.');
    }
  }, [applyCameraFingerPose, cameraFingerMappingEnabled, cameraHandMapping, getArmRig, ref, stopCameraPoseDetection]);

  const runCircularFingerMotion = useCallback(() => {
    if (stationaryFinger === movingFinger) {
      setStatusMessage('Choose different fingers for stationary and moving controls.');
      return;
    }

    const activeHand = selectedHandRef.current;
    const handBone = getHandBone(activeHand);
    const fingerRig = getFingerRig(activeHand);

    if (!handBone || !fingerRig) {
      setStatusMessage('Hand/finger rig not found yet. Please wait for model loading.');
      return;
    }

    const fingerJointMap = {
      thumb: ['thumb1', 'thumb2'],
      index: ['index1', 'index2', 'index3'],
      middle: ['middle1', 'middle2', 'middle3'],
      ring: ['ring1', 'ring2', 'ring3'],
      pinky: ['pinky1', 'pinky2', 'pinky3'],
    };

    const stationaryJoints = (fingerJointMap[stationaryFinger] || []).map((jointName) => fingerRig[jointName]).filter(Boolean);
    const movingJoints = (fingerJointMap[movingFinger] || []).map((jointName) => fingerRig[jointName]).filter(Boolean);

    if (movingJoints.length === 0) {
      setStatusMessage('Unable to find moving finger joints on this avatar.');
      return;
    }

    if (ref.fingerMotionFrameId) {
      cancelAnimationFrame(ref.fingerMotionFrameId);
      ref.fingerMotionFrameId = null;
    }

    const stationaryPose = stationaryJoints.map((joint) => ({
      joint,
      x: joint.rotation.x,
      y: joint.rotation.y,
      z: joint.rotation.z,
    }));

    const movingPose = movingJoints.map((joint) => ({
      joint,
      x: joint.rotation.x,
      y: joint.rotation.y,
      z: joint.rotation.z,
    }));

    const baseHandRotation = {
      x: handBone.rotation.x,
      y: handBone.rotation.y,
      z: handBone.rotation.z,
    };

    const sideSign = activeHand === 'left' ? -1 : 1;
    const startTime = performance.now();
    const durationMs = 2600;

    const animateCircularMotion = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const phase = progress * Math.PI * 4;

      // Palm rotates clockwise and anti-clockwise while the moving finger traces a circle.
      handBone.rotation.x = clampRotation(baseHandRotation.x + Math.sin(phase) * 0.12);
      handBone.rotation.y = clampRotation(baseHandRotation.y + Math.cos(phase) * 0.18 * sideSign);
      handBone.rotation.z = clampRotation(baseHandRotation.z + Math.sin(phase) * 0.28 * sideSign);

      for (const pose of stationaryPose) {
        pose.joint.rotation.x = clampRotation(pose.x);
        pose.joint.rotation.y = clampRotation(pose.y);
        pose.joint.rotation.z = clampRotation(pose.z);
      }

      for (let i = 0; i < movingPose.length; i += 1) {
        const pose = movingPose[i];
        const attenuation = Math.max(0.16, 0.34 - i * 0.08);

        pose.joint.rotation.z = clampRotation(pose.z + Math.cos(phase) * attenuation * sideSign);
        pose.joint.rotation.x = clampRotation(pose.x + Math.sin(phase) * attenuation * 0.55);

        if (movingFinger === 'thumb') {
          pose.joint.rotation.y = clampRotation(pose.y + Math.sin(phase) * attenuation * 0.45 * sideSign);
        }
      }

      if (progress < 1) {
        ref.fingerMotionFrameId = requestAnimationFrame(animateCircularMotion);
        return;
      }

      handBone.rotation.x = clampRotation(baseHandRotation.x);
      handBone.rotation.y = clampRotation(baseHandRotation.y);
      handBone.rotation.z = clampRotation(baseHandRotation.z);

      for (const pose of stationaryPose) {
        pose.joint.rotation.x = clampRotation(pose.x);
        pose.joint.rotation.y = clampRotation(pose.y);
        pose.joint.rotation.z = clampRotation(pose.z);
      }

      for (const pose of movingPose) {
        pose.joint.rotation.x = clampRotation(pose.x);
        pose.joint.rotation.y = clampRotation(pose.y);
        pose.joint.rotation.z = clampRotation(pose.z);
      }

      ref.fingerMotionFrameId = null;
      const handLabel = activeHand === 'left' ? 'Left' : 'Right';
      setStatusMessage(`${handLabel} hand: ${stationaryFinger} stayed fixed, ${movingFinger} moved circularly, palm rotated both directions.`);
    };

    ref.fingerMotionFrameId = requestAnimationFrame(animateCircularMotion);
    setStatusMessage('Running circular finger motion with clockwise and anti-clockwise palm rotation...');
  }, [getFingerRig, getHandBone, movingFinger, ref, stationaryFinger]);

  return (
    <div className='container-fluid page-container-cream'>
      <div className='row'>
        <div className='col-md-3'>
          <h1 className='heading'>Simulate</h1>

          <label className='label-style'>Word Name</label>
          <input
            className='w-100 input-style simulator-input'
            value={wordName}
            onChange={(event) => setWordName(event.target.value)}
            placeholder='Example: ABBREVIATION'
          />

          <label className='label-style mt-3'>Pose Name</label>
          <input
            className='w-100 input-style simulator-input'
            value={poseName}
            onChange={(event) => setPoseName(event.target.value)}
            placeholder='Example: Pose 1'
          />
          <div className='space-between'>
            <button className='btn btn-brown btn-style simulator-zoom-btn' onClick={markCurrentPose}>
              Mark Pose
            </button>
            <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={playMarkedPoses}>
              Play Poses
            </button>
          </div>
          <div className='space-between'>
            <button className='btn btn-outline-danger btn-style simulator-zoom-btn' onClick={() => stopPosePlayback('Pose playback stopped manually.')}>
              Stop Pose Play
            </button>
            <button className='btn btn-outline-secondary btn-style simulator-zoom-btn' onClick={clearMarkedPoses}>
              Clear Poses
            </button>
          </div>
          {/* Step 1: Evaluate Moves (visually replays all poses on avatar) */}
          <button
            className='btn btn-brown w-100 btn-style'
            onClick={evaluateMarkedPoses}
            disabled={markedPoses.length === 0 || evaluationStatus === 'running'}
          >
            {evaluationStatus === 'running'
              ? `Evaluating Pose ${currentEvalPoseIndex + 1}/${markedPoses.length}...`
              : 'Evaluate Moves'}
          </button>

          {/* Step 2: Save Move List JSON (only enabled after eval passes) */}
          <button
            className='btn btn-success w-100 btn-style'
            onClick={saveMoveListAsJson}
            disabled={!evaluationPassed || evaluationStatus === 'running'}
            title={!evaluationPassed ? 'Run evaluation first to unlock save' : 'Save the verified move list as JSON'}
          >
            {evaluationPassed ? 'Save Move List JSON' : 'Save Move List JSON (Evaluate First)'}
          </button>

          <button className='btn btn-outline-dark w-100 btn-style' onClick={setAttentionPose}>
            Attention Pose (Lower Hands)
          </button>
          <div className='simulator-status'>Marked Poses: {markedPoses.length}</div>
          <div className='simulator-status'>Pose Playback: {isPosePlaybackActive ? 'Playing' : 'Idle'}</div>
          <div className='simulator-status'>
            Evaluation: {evaluationStatus === 'idle'
              ? (evaluationPassed ? 'Passed - Ready to Save' : 'Not Run')
              : evaluationStatus === 'running'
                ? `Running (Pose ${currentEvalPoseIndex + 1}/${markedPoses.length})`
                : evaluationStatus === 'passed'
                  ? 'Passed'
                  : 'Failed'}
          </div>

          {/* Evaluation Results Panel */}
          <EvaluationPanel
            evaluationStatus={evaluationStatus}
            evaluationResults={evaluationResults}
            evaluationSummary={evaluationSummary}
            onSaveAnyway={handleEvalSaveAnyway}
            onCancel={handleEvalCancel}
            onReplayFailed={handleReplayFailedPoses}
            onDismiss={handleEvalDismiss}
          />

          {/* Upload & Evaluate Tool */}
          <div className='eval-upload-panel'>
            <p className='eval-upload-title'>Upload & Evaluate Move List</p>
            <p className='eval-upload-subtitle'>Upload an external move-list JSON to visually verify poses on the avatar.</p>
            <input
              type='file'
              accept='.json,application/json'
              className='w-100 input-style simulator-input'
              onChange={(event) => {
                const file = event.target.files && event.target.files[0];
                setEvalUploadFile(file || null);
                setEvalUploadMessage('');
              }}
            />
            <button
              className='btn btn-outline-dark w-100 btn-style'
              onClick={handleEvalUpload}
              disabled={!evalUploadFile || evaluationStatus === 'running'}
            >
              Evaluate Uploaded JSON
            </button>
            {evalUploadMessage && (
              <div className='simulator-status'>{evalUploadMessage}</div>
            )}

            <label className='label-style mt-2'>Paste Prompt Output</label>
            <textarea
              rows={6}
              value={evalPromptText}
              onChange={(event) => {
                setEvalPromptText(event.target.value);
                if (evalPromptMessage) {
                  setEvalPromptMessage('');
                }
                if (evalPromptError) {
                  setEvalPromptError('');
                }
                if (evalTemplateCopyMessage) {
                  setEvalTemplateCopyMessage('');
                }
                if (evalTemplateCopyError) {
                  setEvalTemplateCopyError('');
                }
              }}
              placeholder='Paste ChatGPT/Claude output that contains move-list JSON.'
              className='w-100 input-style simulator-input'
            />
            <div className='space-between'>
              <button
                className='btn btn-outline-dark btn-style simulator-zoom-btn'
                onClick={validatePromptJson}
                disabled={!evalPromptText.trim() || evaluationStatus === 'running'}
              >
                Validate Prompt JSON
              </button>
              <button
                className='btn btn-outline-dark btn-style simulator-zoom-btn'
                onClick={evaluatePromptJson}
                disabled={!evalPromptText.trim() || evaluationStatus === 'running'}
              >
                Evaluate Prompt JSON
              </button>
            </div>
            <button
              className='btn btn-brown w-100 btn-style'
              onClick={playPromptPoses}
              disabled={!evalPromptText.trim() || evaluationStatus === 'running'}
            >
              Play Prompt Poses
            </button>

            <label className='label-style mt-2'>Strict Prompt Template</label>
            <textarea
              rows={8}
              value={STRICT_PROMPT_TEMPLATE}
              readOnly
              className='w-100 input-style simulator-input'
            />
            <button
              className='btn btn-outline-dark w-100 btn-style'
              onClick={copySimulateTemplate}
              disabled={evaluationStatus === 'running'}
            >
              Copy Template (One Click)
            </button>
            <div className='space-between'>
              <button
                className='btn btn-outline-dark btn-style simulator-zoom-btn'
                onClick={insertTemplateIntoPrompt}
                disabled={evaluationStatus === 'running'}
              >
                Insert Template
              </button>
              <button
                className='btn btn-outline-dark btn-style simulator-zoom-btn'
                onClick={clearPromptText}
                disabled={evaluationStatus === 'running'}
              >
                Clear Prompt
              </button>
            </div>

            {evalTemplateCopyMessage && (
              <div className='simulator-status'>{evalTemplateCopyMessage}</div>
            )}
            {evalTemplateCopyError && (
              <div className='simulator-status'>{evalTemplateCopyError}</div>
            )}
            {evalPromptMessage && (
              <div className='simulator-status'>{evalPromptMessage}</div>
            )}
            {evalPromptError && (
              <div className='simulator-status'>{evalPromptError}</div>
            )}
          </div>
          <div className='form-check mt-2'>
            <input
              id='pose-loop-playback'
              type='checkbox'
              className='form-check-input'
              checked={isPoseLoopEnabled}
              onChange={(event) => setIsPoseLoopEnabled(event.target.checked)}
            />
            <label className='form-check-label normal-text' htmlFor='pose-loop-playback'>
              Loop Pose Playback (until Stop Pose Play)
            </label>
          </div>
          {markedPoses.length > 0 && (
            <div className='simulator-keymap mt-2'>
              <p className='simulator-keymap-title'>Marked Pose List</p>
              {markedPoses.map((pose, index) => (
                <button
                  key={pose.id}
                  className='btn btn-outline-dark btn-style w-100 mt-1'
                  onClick={() => applyMarkedPoseByIndex(index)}
                >
                  {index + 1}. {pose.name}
                </button>
              ))}
            </div>
          )}

          <label className='label-style'>Selected Hand</label>
          <div className='space-between'>
            <button
              className={`btn btn-style w-33 ${selectedHand === 'left' ? 'btn-brown' : 'btn-outline-dark'}`}
              onClick={() => setSelectedHand('left')}
            >
              Left
            </button>
            <button
              className={`btn btn-style w-33 ${selectedHand === 'right' ? 'btn-brown' : 'btn-outline-dark'}`}
              onClick={() => setSelectedHand('right')}
            >
              Right
            </button>
          </div>
          <div className='form-check mt-2'>
            <input
              id='mirror-left-right-mode'
              type='checkbox'
              className='form-check-input'
              checked={mirrorModeEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setMirrorModeEnabled(enabled);
                setStatusMessage(enabled
                  ? 'Mirror mode enabled: left-hand actions now mirror to right hand.'
                  : 'Mirror mode disabled. Hands can be controlled independently.');
              }}
            />
            <label className='form-check-label normal-text' htmlFor='mirror-left-right-mode'>
              Mirror Left to Right
            </label>
          </div>

          <label className='label-style'>Move Step: {moveStep.toFixed(2)}</label>
          <input
            type='range'
            min='0.005'
            max='0.08'
            step='0.005'
            value={moveStep}
            onChange={(event) => setMoveStep(Number(event.target.value))}
            className='w-100'
          />

          <label className='label-style'>Rotation Step: {rotationStep.toFixed(2)}</label>
          <input
            type='range'
            min='0.01'
            max='0.2'
            step='0.01'
            value={rotationStep}
            onChange={(event) => setRotationStep(Number(event.target.value))}
            className='w-100'
          />

          <label className='label-style'>Avatar Zoom: {cameraZoom.toFixed(2)}</label>
          <div className='space-between'>
            <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => zoomCamera(-0.1)}>
              Zoom In
            </button>
            <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => zoomCamera(0.1)}>
              Zoom Out
            </button>
          </div>

          <label className='label-style'>Camera Pose Detection</label>
          <div className='space-between'>
            <button className='btn btn-brown btn-style simulator-zoom-btn' onClick={startCameraPoseDetection}>
              Start Camera Pose
            </button>
            <button className='btn btn-outline-danger btn-style simulator-zoom-btn' onClick={stopCameraPoseDetection}>
              Stop Camera Pose
            </button>
          </div>
          <label className='normal-text mt-2'>Camera Hand Mapping</label>
          <select
            className='w-100 input-style simulator-input mt-2'
            value={cameraHandMapping}
            onChange={(event) => setCameraHandMapping(event.target.value)}
          >
            <option value='selected'>Use Selected Hand</option>
            <option value='detected'>Use Detected Handedness</option>
            <option value='mirror'>Mirror Detected Handedness</option>
            <option value='left'>Force Left Avatar Hand</option>
            <option value='right'>Force Right Avatar Hand</option>
          </select>
          <div className='form-check mt-2'>
            <input
              id='camera-finger-mapping'
              type='checkbox'
              className='form-check-input'
              checked={cameraFingerMappingEnabled}
              onChange={(event) => setCameraFingerMappingEnabled(event.target.checked)}
            />
            <label className='form-check-label normal-text' htmlFor='camera-finger-mapping'>
              Enable Finger Pose Mapping (Open/Close)
            </label>
          </div>
          <div className='simulator-status'>Camera Pose: {cameraPoseEnabled ? 'On' : 'Off'}</div>

          <label className='label-style'>Finger Controls (Selected Hand)</label>
          <label className='normal-text mt-2'>Per-Finger Close Levels (Joint-based)</label>
          <div className='mt-2'>
            {FINGER_NAMES.map((fingerName) => {
              const label = fingerName.charAt(0).toUpperCase() + fingerName.slice(1);
              return (
                <div key={`close-level-${fingerName}`} className='space-between mt-1'>
                  <span className='normal-text'>{label}</span>
                  <select
                    className='input-style simulator-input'
                    style={{ width: '55%' }}
                    value={fingerCloseLevels[fingerName]}
                    onChange={(event) => {
                      const level = Math.round(clampToRange(Number(event.target.value) || 0, 1, 3));
                      setFingerCloseLevels((prev) => ({
                        ...prev,
                        [fingerName]: level,
                      }));
                    }}
                  >
                    <option value='1'>Level 1</option>
                    <option value='2'>Level 2</option>
                    <option value='3'>Level 3</option>
                  </select>
                </div>
              );
            })}
          </div>
          <div className='space-between'>
            <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setFingerPose('open')}>
              Open Fingers
            </button>
            <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setFingerPose('close')}>
              Close Fingers
            </button>
          </div>

          <label className='label-style'>Finger Controls (Both Hands)</label>
          <div className='space-between'>
            <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setFingerPose('open', 'both')}>
              Open Both
            </button>
            <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setFingerPose('close', 'both')}>
              Close Both
            </button>
          </div>

          <label className='label-style'>Finger Controls (Individual - Selected Hand)</label>
          <div className='mb-2'>
            <div className='space-between'>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('thumb', 'open')}>
                Open Thumb
              </button>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('thumb', 'close')}>
                Close Thumb
              </button>
            </div>
            <div className='space-between'>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('index', 'open')}>
                Open Index
              </button>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('index', 'close')}>
                Close Index
              </button>
            </div>
            <div className='space-between'>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('middle', 'open')}>
                Open Middle
              </button>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('middle', 'close')}>
                Close Middle
              </button>
            </div>
            <div className='space-between'>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('ring', 'open')}>
                Open Ring
              </button>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('ring', 'close')}>
                Close Ring
              </button>
            </div>
            <div className='space-between'>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('pinky', 'open')}>
                Open Pinky
              </button>
              <button className='btn btn-outline-dark btn-style simulator-zoom-btn' onClick={() => setSingleFingerPose('pinky', 'close')}>
                Close Pinky
              </button>
            </div>
          </div>

          <label className='label-style'>Circular Motion (Selected Hand)</label>
          <label className='normal-text'>Stationary Finger</label>
          <select
            className='w-100 input-style simulator-input mt-2'
            value={stationaryFinger}
            onChange={(event) => setStationaryFinger(event.target.value)}
          >
            <option value='thumb'>Thumb</option>
            <option value='index'>Index</option>
            <option value='middle'>Middle</option>
            <option value='ring'>Ring</option>
            <option value='pinky'>Pinky</option>
          </select>

          <label className='normal-text mt-3'>Moving Finger</label>
          <select
            className='w-100 input-style simulator-input mt-2'
            value={movingFinger}
            onChange={(event) => setMovingFinger(event.target.value)}
          >
            <option value='thumb'>Thumb</option>
            <option value='index'>Index</option>
            <option value='middle'>Middle</option>
            <option value='ring'>Ring</option>
            <option value='pinky'>Pinky</option>
          </select>

          <div className='space-between'>
            <button className='btn btn-brown btn-style simulator-zoom-btn' onClick={runCircularFingerMotion}>
              Run Circular Motion
            </button>
            <button className='btn btn-outline-danger btn-style simulator-zoom-btn' onClick={stopCircularFingerMotion}>
              Stop Motion
            </button>
          </div>

          <button className='btn btn-brown w-100 btn-style' onClick={captureCurrentData}>
            Get Data Point
          </button>
          <button className='btn btn-success w-100 btn-style' onClick={saveFramesAsJson}>
            Save JSON
          </button>
          <button className='btn btn-outline-secondary w-100 btn-style' onClick={resetPose}>
            Reset Pose
          </button>
          <button className='btn btn-outline-danger w-100 btn-style' onClick={clearData}>
            Clear Captured Data
          </button>

          <div className='simulator-status'>{statusMessage}</div>
          <div className='simulator-status'>Captured Frames: {capturedFrames.length}</div>
        </div>

        <div className='col-md-7'>
          <div id='simulate-canvas' />
          <video
            ref={cameraVideoRef}
            className='mt-3 w-100'
            style={{ maxHeight: '480px', objectFit: 'cover', border: '2px solid #8B4513', borderRadius: '6px' }}
            autoPlay
            muted
            playsInline
          />
          <div className='sim-photo-panel'>
            <p className='sim-photo-title'>Upload Photo (Pose Detection)</p>
            <p className='sim-photo-subtitle'>Upload a clear upper-body photo to match the avatar pose.</p>
            <input
              type='file'
              accept='image/*'
              className='w-100 input-style simulator-input'
              onChange={handlePhotoUpload}
            />
            {photoFileName && (
              <p className='sim-photo-filename'>Selected: {photoFileName}</p>
            )}
            {photoPreviewUrl && (
              <img
                src={photoPreviewUrl}
                alt='Uploaded pose reference'
                className='sim-photo-preview'
              />
            )}
            <button
              className='btn btn-brown w-100 btn-style'
              onClick={detectPoseFromPhoto}
            >
              Detect Pose
            </button>
          </div>
        </div>

        <div className='col-md-2'>
          <p className='bot-label'>Select Avatar</p>
          <img src={xbotPic} className='bot-image col-md-11' onClick={() => setBot(xbot)} alt='Avatar 1: XBOT' />
          <img src={ybotPic} className='bot-image col-md-11' onClick={() => setBot(ybot)} alt='Avatar 2: YBOT' />

          <div className='simulator-keymap'>
            <p className='simulator-keymap-title'>Keyboard Controls</p>
            <p>Left arm chain move: W A S D Q E</p>
            <p>Left wrist rotate (hold Shift): T G F H R Y</p>
            <p>Right arm chain move: I J K L U O</p>
            <p>Right wrist rotate (hold Shift): B N V M P [</p>
            <p>Selected palm/wrist rotate: Ctrl + Left / Right Arrow</p>
            <p>Selected palm tilt: Up / Down Arrow</p>
            <p>Zoom: + or -, buttons, or Ctrl + mouse wheel</p>
            <p>Mouse: drag rotates arm chain to place hand, wheel rotates depth, touchpad horizontal scroll moves forearm</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Simulate;
