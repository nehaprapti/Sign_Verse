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

const AXES = ['x', 'y', 'z'];
const EPSILON = 0.0005;

const getArmBoneCandidates = (side) => ({
  arm: [`mixamorig${side}Arm`, `${side}Arm`],
  forearm: [`mixamorig${side}ForeArm`, `${side}ForeArm`],
  hand: [`mixamorig${side}Hand`, `${side}Hand`],
});

const getFingerBoneCandidates = (side) => ({
  thumb1: [`mixamorig${side}HandThumb1`, `${side}HandThumb1`],
  thumb2: [`mixamorig${side}HandThumb2`, `${side}HandThumb2`],
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
});

const resolveBoneName = (avatar, candidates) => {
  if (!avatar || !candidates) {
    return null;
  }

  for (const candidate of candidates) {
    if (avatar.getObjectByName(candidate)) {
      return candidate;
    }
  }

  return null;
};

const addRotationSteps = (animation, boneName, currentRotation, targetRotation) => {
  if (!boneName || !targetRotation) {
    return;
  }

  for (const axis of AXES) {
    const currentValue = currentRotation?.[axis] ?? 0;
    const targetValue = targetRotation?.[axis];
    if (typeof targetValue !== 'number') {
      continue;
    }

    const delta = targetValue - currentValue;
    if (Math.abs(delta) <= EPSILON) {
      continue;
    }

    animation.push([boneName, 'rotation', axis, targetValue, delta > 0 ? '+' : '-']);
  }
};

const queuePoseSnapshotAnimation = (ref, snapshot) => {
  if (!ref.avatar || !snapshot) {
    return;
  }

  const animation = [];
  const sideConfig = [
    { key: 'leftHand', side: 'Left' },
    { key: 'rightHand', side: 'Right' },
  ];

  for (const config of sideConfig) {
    const handSnapshot = snapshot[config.key];
    if (!handSnapshot) {
      continue;
    }

    const armCandidates = getArmBoneCandidates(config.side);
    const fingerCandidates = getFingerBoneCandidates(config.side);

    const armBoneName = resolveBoneName(ref.avatar, armCandidates.arm);
    const forearmBoneName = resolveBoneName(ref.avatar, armCandidates.forearm);
    const handBoneName = resolveBoneName(ref.avatar, armCandidates.hand);

    addRotationSteps(
      animation,
      armBoneName,
      ref.avatar.getObjectByName(armBoneName)?.rotation,
      handSnapshot.arm,
    );
    addRotationSteps(
      animation,
      forearmBoneName,
      ref.avatar.getObjectByName(forearmBoneName)?.rotation,
      handSnapshot.forearm,
    );
    addRotationSteps(
      animation,
      handBoneName,
      ref.avatar.getObjectByName(handBoneName)?.rotation,
      handSnapshot.hand,
    );

    for (const [jointName, targetRotation] of Object.entries(handSnapshot.fingers || {})) {
      const fingerBoneName = resolveBoneName(ref.avatar, fingerCandidates[jointName]);
      if (!fingerBoneName) {
        continue;
      }

      addRotationSteps(
        animation,
        fingerBoneName,
        ref.avatar.getObjectByName(fingerBoneName)?.rotation,
        targetRotation,
      );
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
  const existing = readStoredMoveLists();
  existing[moveName] = payload;
  localStorage.setItem(MOVELIST_STORAGE_KEY, JSON.stringify(existing));
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
  const [movelistImportMessage, setMovelistImportMessage] = useState("");
  const [movelistImportError, setMovelistImportError] = useState("");

  const componentRef = useRef({});
  const { current: ref } = componentRef;

  let textFromAudio = React.createRef();
  let textFromInput = React.createRef();

  const {
    transcript,
    listening,
    resetTranscript,
  } = useSpeechRecognition();

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
        const normalizedWord = word.replace(/[^A-Z]/g, '');
        if (!normalizedWord) {
          continue;
        }

        if (storedMoveLists[normalizedWord]) {
          wordArray.push(normalizedWord);
          ref.animations.push(['add-text', normalizedWord + ' ']);
          queueStoredMoveList(ref, storedMoveLists[normalizedWord]);
          continue;
        }

        if (words.wordList.includes(normalizedWord) && typeof words[normalizedWord] === 'function') {
          wordArray.push(normalizedWord);
          ref.animations.push(['add-text', normalizedWord + ' ']);
          words[normalizedWord](ref);
          continue;
        }

        // Fallback to fingerspelling for words without movelist support.
        for (const [index, ch] of normalizedWord.split('').entries()) {
          if (alphabets[ch] && typeof alphabets[ch] === 'function') {
            wordArray.push(ch);
            if (index === normalizedWord.length - 1)
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
        const normalizedWord = word.replace(/[^A-Z]/g, '');
        if (!normalizedWord) {
          continue;
        }

        if (storedMoveLists[normalizedWord]) {
          wordArray.push(normalizedWord);
          ref.animations.push(['add-text', normalizedWord + ' ']);
          queueStoredMoveList(ref, storedMoveLists[normalizedWord]);
          continue;
        }

        if (words.wordList.includes(normalizedWord) && typeof words[normalizedWord] === 'function') {
          wordArray.push(normalizedWord);
          ref.animations.push(['add-text', normalizedWord + ' ']);
          words[normalizedWord](ref);
          continue;
        }

        for (const [index, ch] of normalizedWord.split('').entries()) {
          if (alphabets[ch] && typeof alphabets[ch] === 'function') {
            wordArray.push(ch);
            if (index === normalizedWord.length - 1)
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

      const moveNameRaw = typeof payload?.move === 'string'
        ? payload.move
        : (typeof payload?.word === 'string' ? payload.word : '');

      const moveName = moveNameRaw.trim().toUpperCase();
      if (!moveName) {
        throw new Error('Missing "move" (or "word") in JSON payload.');
      }

      if (!Array.isArray(payload?.poses) || payload.poses.length === 0) {
        throw new Error('JSON must contain a non-empty "poses" array.');
      }

      const validPoseCount = payload.poses.filter((pose) => pose?.snapshot).length;
      if (validPoseCount === 0) {
        throw new Error('JSON poses do not contain snapshots.');
      }

      const normalizedPayload = {
        ...payload,
        move: moveName,
        totalPoses: payload.totalPoses || payload.poses.length,
      };

      saveStoredMoveList(moveName, normalizedPayload);
      setMovelistImportError('');
      setMovelistImportMessage(`Imported "${moveName}" with ${normalizedPayload.poses.length} poses. You can use this word in Convert now.`);
      setMovelistFile(null);
    } catch (error) {
      console.error('Movelist import failed:', error);
      setMovelistImportMessage('');
      setMovelistImportError(`Import failed: ${error.message}`);
    }
  };

  return (
    <div className='container-fluid page-container-cream'>
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
          <img src={xbotPic} className='bot-image col-md-11' onClick={() => { setBot(xbot) }} alt='Avatar 1: XBOT' />
          <img src={ybotPic} className='bot-image col-md-11' onClick={() => { setBot(ybot) }} alt='Avatar 2: YBOT' />
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