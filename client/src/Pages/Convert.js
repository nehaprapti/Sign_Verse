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
          setText(text + ref.animations[0][1]);
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
      // Always auto-detect and translate
      const result = await detectAndTranslate(str);

      if (result.error) {
        setTranslationError(`Translation failed: ${result.error}`);
        setIsTranslating(false);
        return;
      }

      var translatedStr = result.translatedText;

      // Show detected language info
      if (result.detectedLang !== 'en') {
        setDetectedLanguage(`Detected: ${result.detectedLangName} → English`);
      } else {
        setDetectedLanguage(`Language: English`);
      }

      setIsTranslating(false);

      translatedStr = translatedStr.toUpperCase();
      var strWords = translatedStr.split(' ');
      setText('');

      // Set full caption and prepare word array for highlighting
      setFullCaption(translatedStr);
      let wordArray = [];

      // Fingerspell all translated English text character by character
      for (let word of strWords) {
        // Process each character in the word
        for (const [index, ch] of word.split('').entries()) {
          // Check if character is A-Z (alphabets only has A-Z)
          if (alphabets[ch] && typeof alphabets[ch] === 'function') {
            wordArray.push(ch);
            if (index === word.length - 1)
              ref.animations.push(['add-text', ch + ' ']); // Add space after word
            else
              ref.animations.push(['add-text', ch]);
            alphabets[ch](ref);
          } else {
            // Skip non-alphabetic characters (numbers, punctuation, special chars)
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
      setTranslationError(`Error: ${error.message}`);
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