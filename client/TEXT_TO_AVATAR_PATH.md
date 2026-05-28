# Text → Avatar: File-by-file Data Flow

This document maps exactly which files the input text travels through, what each file does, and where the final output appears.

## Two flows
- **Client preview (local animation)** — user types text on the Convert or Video pages and the browser converts and renders the avatar locally.
- **Server creation (saved video)** — the Create Video page sends text to the backend; the backend stores/creates a video and returns a `videoId`.

---

## Client preview (live animation)
1. User input: typed or speech text is entered on the page.
   - File: [src/Pages/Convert.js](src/Pages/Convert.js) or [src/Pages/Video.js](src/Pages/Video.js)

2. Language detection & translation (if needed): the input goes to the translation helper.
   - Function: `detectAndTranslate(text)`
   - File: [src/Utils/languageUtils.js](src/Utils/languageUtils.js)

3. Normalization: translated text is uppercased and split into words/characters in `Convert.js` / `Video.js`.
   - File: [src/Pages/Convert.js](src/Pages/Convert.js) (see loop building `ref.animations`) 

4. Mapping text → animation calls:
   - For words present in `words`, the code calls `words[word](ref)`.
     - File: `src/Animations/words` (imported in `Convert.js`)
   - For characters A–Z the code calls `alphabets[ch](ref)`.
     - File: [src/Animations/alphabets.js](src/Animations/alphabets.js) which imports `src/Animations/Alphabets/*` (e.g., `A.js`).
   - Those animation functions push an animation block (arrays) into `ref.animations` and (when needed) start the animation loop.
     - Example: `src/Animations/Alphabets/A.js` pushes arrays of bone operations and then triggers `ref.animate()` if not pending.

5. Model loading and default pose:
   - GLTFLoader loads the avatar model (`xbot.glb` or `ybot.glb`) into `ref.avatar`.
   - Default neutral pose is applied with `defaultPose(ref)`.
   - Files: `src/Models/xbot/xbot.glb`, `src/Models/ybot/ybot.glb`, and `src/Animations/defaultPose.js`.
   - Loading occurs in `Convert.js` / `Video.js` (GLTFLoader usage).

6. Animation loop (renderer):
   - The core loop is `ref.animate` defined in `Convert.js` / `Video.js`.
   - It consumes items from `ref.animations`.
     - If the item is `['add-text', 'X']`, it updates the on-screen caption.
     - Otherwise the item is an array of bone operations: `[boneName, action, axis, limit, sign]`.
   - Each frame it increments/decrements `ref.avatar.getObjectByName(boneName)[action][axis]` by `speed` until `limit` is reached, then removes the operation.
   - Renderer draws the scene with `ref.renderer.render(ref.scene, ref.camera)` into the DOM node with id `canvas`.
   - Files: [src/Pages/Convert.js](src/Pages/Convert.js), [src/Pages/Video.js](src/Pages/Video.js)

7. Output (preview):
   - The visual output is drawn to the in-page canvas inside the element with id `canvas`.
   - Captions are updated in the page UI (e.g., `captionWords`, `currentWordIndex`).

---

## Server creation (Create Video → saved video)
1. Input collection: user fills the Create Video form and submits content.
   - File: [src/Pages/CreateVideo.js](src/Pages/CreateVideo.js)
   - The page packages the content as `newVideo` and sends it to the backend with Axios:
     - `axios.post(`${baseURL}/videos/create-video`, newVideo)`
   - See `baseURL` in [src/Config/config.js](src/Config/config.js).

2. Backend processing (not in this repo):
   - The server receives the `content` string and `create-video` endpoint likely triggers server-side rendering/saving of the video and returns a `videoId`.
   - The client receives `res.data.videoId` and displays it in a confirmation modal (`ConfirmModal`) for the user to copy.
   - File (client): [src/Components/CreateVideo/ConfirmModal.js](src/Components/CreateVideo/ConfirmModal.js)

3. Replay / fetch saved video content in client:
   - On the `Video` page the app can fetch stored video metadata/content by id:
     - `axios.get(`${baseURL}/videos/${videoID}`)` in [src/Pages/Video.js](src/Pages/Video.js)
   - The `content` fetched is passed to the same `sign()` function in `Video.js`, which rebuilds `ref.animations` and plays the animation locally (same renderer flow as the preview).

Note: This repo's client code handles local preview rendering. The server endpoint (`/videos/create-video`) is where client-sent text becomes a saved video file (server-side); server rendering code is not present in this repository.

---

## Quick references (where to open)
- `src/Pages/CreateVideo.js` — collects content and posts to the server.
- `src/Pages/Convert.js` — converts text → animation queue and renders locally.
- `src/Pages/Video.js` — fetches stored content by `videoId` and replays it.
- `src/Utils/languageUtils.js` — `detectAndTranslate()` (language detection + translation).
- `src/Animations/alphabets.js` and `src/Animations/Alphabets/*` — per-character animation builders (they push to `ref.animations`).
- `src/Animations/words` — per-word animations (if present) used by `Video/Convert` pages.
- `src/Animations/defaultPose.js` — sets neutral pose after model load.
- `src/Models/xbot/xbot.glb`, `src/Models/ybot/ybot.glb` — 3D avatar models loaded by GLTFLoader.

---

If you want, I can now:
- Extract the exact bone names referenced by the animations into a single list, or
- Add inline file links to the animation queue building lines in `Convert.js` and `Video.js` with exact line numbers for quick navigation.
