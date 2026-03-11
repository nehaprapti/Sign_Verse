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

const LEFT_HAND_CANDIDATES = ['mixamorigLeftHand', 'LeftHand'];
const RIGHT_HAND_CANDIDATES = ['mixamorigRightHand', 'RightHand'];
const LEFT_ARM_CANDIDATES = ['mixamorigLeftArm', 'LeftArm'];
const RIGHT_ARM_CANDIDATES = ['mixamorigRightArm', 'RightArm'];
const LEFT_FOREARM_CANDIDATES = ['mixamorigLeftForeArm', 'LeftForeArm'];
const RIGHT_FOREARM_CANDIDATES = ['mixamorigRightForeArm', 'RightForeArm'];

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

function Simulate() {
  const [bot, setBot] = useState(ybot);
  const [wordName, setWordName] = useState('ABBREVIATION');
  const [selectedHand, setSelectedHand] = useState('left');
  const [stationaryFinger, setStationaryFinger] = useState('index');
  const [movingFinger, setMovingFinger] = useState('thumb');
  const [moveStep, setMoveStep] = useState(0.02);
  const [rotationStep, setRotationStep] = useState(0.05);
  const [cameraZoom, setCameraZoom] = useState(1.6);
  const [capturedFrames, setCapturedFrames] = useState([]);
  const [statusMessage, setStatusMessage] = useState('Use keyboard/mouse to pose the avatar hands.');
  const selectedHandRef = useRef('left');
  const moveStepRef = useRef(0.02);
  const rotationStepRef = useRef(0.05);

  const componentRef = useRef({
    isMouseDown: false,
    animationFrameId: null,
    fingerMotionFrameId: null,
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
    moveStepRef.current = moveStep;
  }, [moveStep]);

  useEffect(() => {
    rotationStepRef.current = rotationStep;
  }, [rotationStep]);

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

      applyRigDeltas(rig, [
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

      applyRigDeltas(rig, [
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
    applyRigDeltas(rig, action);
  }, [getArmRig, zoomCamera]);

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

      const rig = getArmRig(selectedHandRef.current);
      if (!rig.arm || !rig.forearm || !rig.hand) {
        return;
      }

      const xDelta = event.movementX * 0.0025;
      const yDelta = event.movementY * 0.0025;

      applyRigDeltas(rig, [
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

      const rig = getArmRig(selectedHandRef.current);
      if (!rig.arm || !rig.forearm) {
        return;
      }

      const horizontalDelta = event.deltaX * -0.0012;
      const zDelta = event.deltaY * -0.0012;

      if (horizontalDelta) {
        applyRigDeltas(rig, [['forearm', 'y', horizontalDelta]]);
      }

      if (zDelta) {
        applyRigDeltas(rig, [
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

      if (ref.renderer) {
        ref.renderer.dispose();
      }
    };
  }, [applyKeyboardControl, bot, getArmRig, ref, zoomCamera]);

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

  const clearData = () => {
    setCapturedFrames([]);
    setStatusMessage('All captured frames cleared.');
  };

  const setFingerPose = useCallback((pose, target = 'selected') => {
    const hands = target === 'both' ? ['left', 'right'] : [selectedHandRef.current];
    const curlAmount = pose === 'close' ? Math.PI / 3 : 0;
    const thumbBend = pose === 'close' ? Math.PI / 6 : 0;

    let totalUpdated = 0;
    for (const hand of hands) {
      const fingerRig = getFingerRig(hand);
      const sideSign = hand === 'left' ? -1 : 1;
      const thumbSpread = pose === 'close'
        ? (hand === 'left' ? Math.PI / 6 : -Math.PI / 6)
        : 0;

      const fingerRotations = [
        ['index1', 'z', sideSign * curlAmount],
        ['index2', 'z', sideSign * curlAmount],
        ['index3', 'z', sideSign * curlAmount],
        ['middle1', 'z', sideSign * curlAmount],
        ['middle2', 'z', sideSign * curlAmount],
        ['middle3', 'z', sideSign * curlAmount],
        ['ring1', 'z', sideSign * curlAmount],
        ['ring2', 'z', sideSign * curlAmount],
        ['ring3', 'z', sideSign * curlAmount],
        ['pinky1', 'z', sideSign * curlAmount],
        ['pinky2', 'z', sideSign * curlAmount],
        ['pinky3', 'z', sideSign * curlAmount],
        ['thumb1', 'x', thumbBend],
        ['thumb2', 'y', thumbSpread],
      ];

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
      setStatusMessage(`Both hands fingers ${pose === 'close' ? 'closed' : 'opened'}.`);
      return;
    }

    const hand = selectedHandRef.current;
    setStatusMessage(`${hand === 'left' ? 'Left' : 'Right'} hand fingers ${pose === 'close' ? 'closed' : 'opened'}.`);
  }, [getFingerRig]);

  const setSingleFingerPose = useCallback((finger, pose) => {
    const hand = selectedHandRef.current;
    const fingerRig = getFingerRig(hand);
    const sideSign = hand === 'left' ? -1 : 1;

    const curlAmount = pose === 'close' ? Math.PI / 3 : 0;
    const thumbBend = pose === 'close' ? Math.PI / 6 : 0;
    const thumbSpread = pose === 'close'
      ? (hand === 'left' ? Math.PI / 6 : -Math.PI / 6)
      : 0;

    const fingerJointMap = {
      thumb: [['thumb1', 'x', thumbBend], ['thumb2', 'y', thumbSpread]],
      index: [['index1', 'z', sideSign * curlAmount], ['index2', 'z', sideSign * curlAmount], ['index3', 'z', sideSign * curlAmount]],
      middle: [['middle1', 'z', sideSign * curlAmount], ['middle2', 'z', sideSign * curlAmount], ['middle3', 'z', sideSign * curlAmount]],
      ring: [['ring1', 'z', sideSign * curlAmount], ['ring2', 'z', sideSign * curlAmount], ['ring3', 'z', sideSign * curlAmount]],
      pinky: [['pinky1', 'z', sideSign * curlAmount], ['pinky2', 'z', sideSign * curlAmount], ['pinky3', 'z', sideSign * curlAmount]],
    };

    const joints = fingerJointMap[finger];
    if (!joints) {
      return;
    }

    let updated = 0;
    for (const [joint, axis, value] of joints) {
      const bone = fingerRig[joint];
      if (!bone) {
        continue;
      }

      bone.rotation[axis] = clampRotation(value);
      updated += 1;
    }

    if (updated === 0) {
      setStatusMessage('Finger joints not found yet. Please wait for model to finish loading.');
      return;
    }

    const handLabel = hand === 'left' ? 'Left' : 'Right';
    const fingerLabel = finger.charAt(0).toUpperCase() + finger.slice(1);
    setStatusMessage(`${handLabel} ${fingerLabel} finger ${pose === 'close' ? 'closed' : 'opened'}.`);
  }, [getFingerRig]);

  const stopCircularFingerMotion = useCallback(() => {
    if (ref.fingerMotionFrameId) {
      cancelAnimationFrame(ref.fingerMotionFrameId);
      ref.fingerMotionFrameId = null;
      setStatusMessage('Circular finger motion stopped.');
    }
  }, [ref]);

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

          <label className='label-style'>Finger Controls (Selected Hand)</label>
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
