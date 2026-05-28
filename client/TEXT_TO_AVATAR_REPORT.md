# Text → Avatar: Report

**Key Objective:**
- Explain, in one place, how user text is converted into avatar motion and visual output in this project by merging the roles of `src/Pages/CreateVideo.js`, `src/Pages/Convert.js`, and `src/Utils/languageUtils.js`.

**Approach done:**
- Inspected the three files and linked supporting modules (animations, models, renderer).
- Traced the complete path from user input → language detection/translation → normalization → animation queue building → avatar model loading → render loop → output (preview or server-saved video ID).

---

## Detailed Explanation (Step-by-step)

### 1. User input (where it starts)
- CreateVideo flow (save-to-server):
  - File: [src/Pages/CreateVideo.js](src/Pages/CreateVideo.js)
  - What happens: user fills form (title, desc, createdBy) and provides content via `text`, file, or speech.
  - On submit: `handleSubmit` builds `newVideo` with `content` and posts it to the backend using `axios.post(`${baseURL}/videos/create-video`, newVideo)`; server returns `videoId` shown in a confirmation modal.

- Client preview flow (local animation):
  - File: [src/Pages/Convert.js](src/Pages/Convert.js)
  - What happens: user types or speaks into the page. Buttons call `sign(inputRef)` which converts text into a sequence of animations and starts the renderer loop.

### 2. Language detection & translation (ensuring English input)
- File: [src/Utils/languageUtils.js](src/Utils/languageUtils.js)
- Main function: `detectAndTranslate(text)`
  - First does Unicode-based detection with `detectLanguageFromUnicode` to guess language by character ranges (Tamil, Malayalam, Devanagari, Chinese, etc.).
  - Calls MyMemory API (`https://api.mymemory.translated.net/get?q=...&langpair=autodetect|en`) to translate the text to English when needed.
  - Returns an object with `translatedText`, `detectedLang`, and `detectedLangName` (or falls back to original text on error).

### 3. Normalization and queue building (text → animation calls)
- Performed in `sign(...)` inside `Convert.js` (and similarly in `Video.js`):
  - Uppercase the translated text: `translatedStr = translatedStr.toUpperCase()`.
  - Split into words: `var strWords = translatedStr.split(' ')`.
  - For each word:
    - If a pre-built word-level animation exists in `src/Animations/words`, call `words[word](ref)` and push an `['add-text', word+' ']` token into `ref.animations` for captions.
    - Otherwise, fingerspell: loop characters in word and for each character `ch` call `alphabets[ch](ref)` (these functions are exported by `src/Animations/alphabets.js` and implemented in `src/Animations/Alphabets/*`).
    - After each character, push `['add-text', ch]` (or `ch + ' '` for end-of-word) into `ref.animations` to show captions synchronised with animation blocks.

### 4. How animations are represented (data format)
- `ref.animations` is a queue (array) where each element is either:
  - `['add-text', 'X']` — a caption token; or
  - an animation block: an array of operations where each operation is a 5-tuple:
    - `[boneName, action, axis, limit, sign]`
    - Example: `['mixamorigLeftHand', 'rotation', 'x', Math.PI/2, '+']`
    - Meaning: read the bone by `ref.avatar.getObjectByName(boneName)` and change its `action` (`rotation` or `position`) on `axis` (`x|y|z`) toward `limit` using `sign` (`+` means increment, `-` means decrement).

### 5. Model loading and default pose
- Files: `src/Models/xbot/xbot.glb`, `src/Models/ybot/ybot.glb` — loaded with `GLTFLoader` in `useEffect` inside `Convert.js`.
- On load: `gltf.scene` is traversed to set `child.frustumCulled = false` for `SkinnedMesh` objects so bones are always updated.
- The loaded model is assigned to `ref.avatar` and added to `ref.scene`.
- `defaultPose(ref)` (from `src/Animations/defaultPose.js`) is called to set a neutral starting pose before animations run.

### 6. Playback and render loop (how frames update)
- Core loop: `ref.animate` (defined in `Convert.js`) — driven by `requestAnimationFrame(ref.animate)`.
- Per frame: the function looks at `ref.animations[0]` (the front of queue):
  - If it's `['add-text', ...]`: update the displayed processed text/caption and shift the queue.
  - If it's an animation block (list of ops): iterate operations; for each op:
    - Get the bone object: `let bone = ref.avatar.getObjectByName(boneName)`.
    - Check `bone[action][axis]` against `limit`:
      - If `sign === '+'` and current < limit, increment by `speed` (then clamp to limit).
      - If `sign === '-'` and current > limit, decrement by `speed` (then clamp to limit).
      - When an op reaches its limit, remove it from the block.
  - When the block is empty, set `ref.flag = true` and pause `pause` ms (using `setTimeout`) before continuing. Then `ref.animations.shift()` removes the empty block.
  - Finally, `ref.renderer.render(ref.scene, ref.camera)` draws the updated avatar to the DOM canvas.

### 7. Client output vs server save
- Client preview:
  - Visual output appears on the page inside the element with id `canvas` where the three.js renderer is appended.
  - Captions overlay is updated via `captionWords` and `currentWordIndex`.

- Server save (Create Video):
  - `CreateVideo.js` posts the `content` string to `baseURL/videos/create-video`.
  - The server returns a `videoId`. The repo's `Video.js` can `GET` that id (`/videos/{videoId}`) and then call the same `sign()` logic locally to replay the saved content.
  - The server-side code that creates a real video file is not included in this client repository—only the client-side submission and replay logic are present.

### 8. Edge cases, flags, and important variables
- `ref.pending`: prevents starting multiple `ref.animate()` loops simultaneously.
- `ref.flag`: used to apply a pause between animation blocks.
- `speed`: per-frame step size for bone transformation (slider-controlled by user).
- `pause`: ms pause between blocks (slider-controlled).
- Non-A–Z characters: skipped and logged (no animation provided).
- Model bone names must match strings used by animation files (e.g., `mixamorigLeftHandIndex1`); otherwise `getObjectByName` returns undefined and operations will fail.

---

## File & Code Map (quick links)
- Input & server-submit: [src/Pages/CreateVideo.js](src/Pages/CreateVideo.js)
- Local convert & renderer: [src/Pages/Convert.js](src/Pages/Convert.js)
- Language detection & translation: [src/Utils/languageUtils.js](src/Utils/languageUtils.js)
- Per-character animations: [src/Animations/alphabets.js](src/Animations/alphabets.js) → [src/Animations/Alphabets/*](src/Animations/Alphabets/)
- Default pose: [src/Animations/defaultPose.js](src/Animations/defaultPose.js)
- Models: [src/Models/xbot](src/Models/xbot) and [src/Models/ybot](src/Models/ybot)

---

## Conclusion
- The three files together implement a two-mode workflow:
  1. A client-side conversion and preview pipeline (`Convert.js` + `alphabets`/`words` + `defaultPose`) that builds a queue of low-level bone operations and renders them in real time using three.js.
  2. A server-backed save flow (`CreateVideo.js`) that sends raw text to the backend, receives a `videoId`, and allows later replay by fetching the stored `content` and replaying it through the same client renderer.
- The system is deterministic and explicit (animations are encoded as arrays of bone-level operations). This makes it easy to extend (add words/letters) but sensitive to exact bone names and the GLTF model structure.
