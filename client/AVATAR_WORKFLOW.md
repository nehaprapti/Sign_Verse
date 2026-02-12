# Avatar Workflow — Beginner-Friendly Guide

## Overview (for a child)
- The avatar is like a puppet. Animations are a list of puppet poses. The screen is the stage where we show many pictures quickly so the puppet appears to move.

## Simple step-by-step story
1. You type a letter or choose a word.
2. The app finds a matching animation (a set of poses and timings).
3. The app loads the avatar model (the puppet's body and joints).
4. For each pose, the app moves parts of the avatar (hands, arms, head) and draws it on the screen.
5. The app shows the moving avatar or records the frames into a video.

## What each part is (plain language)
- **Avatar model**: the puppet’s body (mesh and joints). Look in `src/Models/xbot` and `src/Models/ybot`.
- **Animation data**: sequences of poses with timings. See `src/Animations/` and the per-letter/word files under `src/Animations/Alphabets` and `src/Animations/Words`.
- **Mapper / utils**: code that maps typed text to the correct animation key. See `src/Utils/languageUtils.js`.
- **Renderer**: the code that applies poses to the model and draws frames (live preview or video export). Pages like `src/Pages/Video.js` and `src/Pages/CreateVideo.js` control playback and export.
- **UI and control**: components and modals that let the user start/stop/export. Examples: `src/Components/CreateVideo/ConfirmModal.js`, `src/Components/Videos/VideoCard.js`.

## Concrete technical workflow
1. Input stage: user enters text or selects a word (UI in `src/Pages/CreateVideo.js` / `src/Pages/Convert.js`).
2. Lookup stage: a mapping converts input → animation key (check `src/Utils/languageUtils.js`).
3. Preparation stage:
   - Load the avatar model (mesh, skeleton, joint names).
   - Load animation frames (poses + durations) from `src/Animations/`.
4. Playback stage (render loop):
   - Each frame: compute interpolated pose between key poses based on elapsed time.
   - Apply transforms to the avatar’s joints.
   - Draw the avatar to the canvas/WebGL/renderer surface.
5. Output stage:
   - Preview: display frames live on screen.
   - Export: capture frames into a video (CreateVideo flow).
6. Cleanup: reset avatar to `defaultPose` after animation ends.

## How animations are encoded (what to expect in files)
- Animation files usually contain arrays of timed poses. A pose lists values for joint rotations/positions and a duration for how long that pose lasts.
- The renderer interpolates between successive poses for smooth motion.

## Where to look in this repo (quick links)
- Animations: `src/Animations/alphabets.js`, `src/Animations/defaultPose.js`, `src/Animations/Alphabets/*`, `src/Animations/Words/*`.
- Models: `src/Models/xbot/`, `src/Models/ybot/`.
- Playback & pages: `src/Pages/CreateVideo.js`, `src/Pages/Convert.js`, `src/Pages/Video.js`.
- UI components: `src/Components/CreateVideo/ConfirmModal.js`, `src/Components/Videos/VideoCard.js`, `src/Components/Navbar.js`, `src/Components/Footer.js`.
- Config: `src/Config/config.js`.
- Mapping utils: `src/Utils/languageUtils.js`.

## Simple troubleshooting tips
- Ensure model joint names match the animation joint names.
- Check that timing values are present and non-zero.
- Verify `defaultPose` is applied before/after animations to avoid jumps.

## How to add a new sign (step-by-step)
1. Add a new animation file in `src/Animations/Words/` (or `Alphabets/`) named for the sign.
2. In that file, export an array/list of poses with small changes between them and durations for each pose.
3. Add or update the mapping in `src/Utils/languageUtils.js` so your text maps to the new animation key.
4. Test the animation in `CreateVideo` or `Convert` pages.

## Next steps and suggestions
- If you want, I can open the key files and extract exact variable and joint names, showing where interpolation and rendering happen.
- I can also add a small example animation file (template) and a tiny test page to preview it.

---
Generated for the Sign_Verse project. Open `AVATAR_WORKFLOW.md` to read this guide in the repo.
