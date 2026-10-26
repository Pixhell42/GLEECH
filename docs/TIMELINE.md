# Timeline, video and GIF

GLEECH has two editor modes, switched in the center of the title bar. **Image**
is the still editor. **Timeline** animates any effect control over time and
renders video, GIFs and loops, image sequences and flip books. A still project
has no timeline until Timeline is opened; until then Image mode works exactly as
before.

Image mode always shows the frame at the playhead. When a project has animation
or a video clip, a gold diamond and timecode next to the mode switch show that
frame; click it to return to Timeline. Exports, Copy and Snapshot capture that
exact frame, so a still can be pulled from any moment. With a video clip,
switching to Image mode makes the clip frame at the playhead the source image,
so masks, subject detection and Image details work on that frame; switching back
to Timeline plays the clip again.

## Timeline mode

The Effects panel moves into a full-width timeline dock along the bottom, the
canvas gains its width and the inspector stays on the right. Drag the gap above
the dock to change its height. Edited / Original moves to the canvas, top left.

**Transport:** go to start, previous keyframe, Play/Pause, next keyframe, go to
end and Loop. The timecode reads minutes:seconds:frames; click the total length
to change the timeline duration, and the rate chip to change the frame rate
(keys stay on frames when the rate changes). With an audio track, the tempo
chip shows the detected BPM; choose a fixed tempo there for synced LFOs. The
speaker button and slider next to Loop set the playback volume. They only change
what you hear while previewing: they are remembered in GLEECH, not saved in the
project, and never change renders.

**Ruler:** drag to scrub. The gold band at the top is the work area: drag its
ends to set the range that loops and renders; double-click it to clear. A thin
green line marks frames already cached for instant playback. Markers and
captured snapshots appear in cyan; beat ticks appear when a track is analyzed.

**Tracks:** Source (the still image or video clip, as a filmstrip), Audio (the
waveform, with the track's own mute and volume), one track per effect (eye,
name, animated count, lock and delete on hover; Alt+Up/Down reorders), its
animated parameter lanes, **Animate parameter**, and Seed. The plus button in
the Tracks header adds an effect, a video clip, an audio track or a marker.

**Effect ranges:** drag the ends of an effect's bar to keep it on for only part
of the timeline. Double-click the bar to use the whole timeline again.

**Seed:** Fixed keeps one pattern. Every frame or Every N frames changes the seed
on a steady rhythm so seeded glitches flicker and boil. Frame 0 always uses the
project seed, so the first frame matches the still image.

Playback renders reduced-resolution previews and caches them (the header chip
shows the frame rate), then refines the frame at full resolution when paused.

## Keyframes

1. Click a control's diamond. It turns gold and a key lands at the playhead with
   the current value. In Image mode, diamonds appear when you hover a control.
2. Move the playhead and change the control. Animated controls add a key there,
   or update the key already at that frame.
3. A solid diamond means a key at the playhead; click it to remove the key. The
   small arrows beside it jump to the previous or next key.

Selecting an animated control opens its **Animation** card: the ease for its
keys, Add LFO, Link to audio and Clear. Clicking a parameter's name in the Keys
or Curves view brings that card into view, or opens the control's Audio/LFO
stack when it has modulators. Number controls ease between keys; colors blend;
choices and switches step at each key.

In the **Keys** view, drag diamonds to retime them (Shift-click selects several).
Snap pulls keys to frames, other keys, markers and beats. Double-click a lane to
add a key; Delete removes selected keys; right-click a key for interpolation,
Snap to nearest beat and Delete. The transport's ease buttons apply Linear,
Ease in-out or Hold to the selected keys.

The **Curves** view draws every animated parameter on one graph, normalized to
0–100% of each control's range, with the Audio track (waveform, mute and volume)
kept above it. Solid lines are editable keys; dashed lines are live modulation.
Drag a key in time and value. A selected Bezier key shows two handles; dragging
a handle turns that segment into a custom Bezier curve. The list on the left
filters to the selected effect or all effects and hides individual curves.

## Audio and LFO modulators

Modulators drive a numeric control automatically, on top of its keys. Click the
Audio or LFO tag beside a modulated control (or its name in the timeline) to
open its stack: base value, live value at the playhead and one card per
modulator. Cards apply top to bottom after keyframes, and the result is clamped
to the control's range.

- **Audio** follows a band of the audio track (Low 40–160 Hz, Mid, High or a
  custom range), with attack and release smoothing and an output range. Replace
  sets the value from the audio; Add, Subtract and Multiply combine it with the
  keyed value. A control fully driven by Replace is read-only on the slider.
  **Invert** turns peaks into valleys. **Intensity** reshapes the curve around
  the middle of its analyzed range: 0% flattens it, 100% follows the audio as
  analyzed and more exaggerates peaks and valleys (the control's range still
  limits the result). **Position** moves the whole curve up or down.
- **LFO** shapes are sine, triangle, square, saw and random steps, synced to the
  tempo (bars and beats) or free in Hz, with depth and phase. LFOs are computed
  from time and tempo, and random steps follow the project seed.

Audio is analyzed once when the track is added (band energy, beats and tempo)
and the analysis is saved in the project, so preview, scrubbing and renders
match exactly. During playback a small card on the canvas shows live meters.
Audio is green and LFOs are pink everywhere; these signal colors never follow
the UI color.

**Copy to keyframes** (in a control's modulator stack) turns the modulated curve
into keyframes that follow it, so you can edit it with points, Bezier handles
and easing. It removes the modulators; **Link to audio** later puts the original
link and its settings back, after a warning that the edited keys are replaced.

## Video clips and audio tracks

**Open video…** in the hamburger menu (or Video clip… in the Tracks menu) opens
an MP4, MOV, M4V, WebM, MKV, AVI or GIF clip. Opening a clip works like opening
an image: it replaces the current image or clip, names the project after the
clip and keeps the effect stack and keys. Its first frame becomes the source
image, the timeline takes the clip's length and rate, and every frame renders
from the clip. If the clip has sound, it becomes the Audio track, analyzed for
beats and audio modulators, unless you already added a separate audio track.
Opening an image (or Remove video clip) removes the clip and its sound and keeps
the rest of the timeline. Audio track… adds or replaces the track with a WAV,
MP3, M4A, AAC, FLAC, OGG or Opus file; **Use clip audio** in the Tracks menu
switches back to the clip's own sound.

The Audio track's mute button and volume slider are part of the project: they
change playback and the rendered audio. A muted track is left out of renders.

Projects keep the clip and track file paths rather than embedding them. If a
file moves, GLEECH reports it as offline; add it again from the Tracks menu.
Codecs Chromium can't play directly (ProRes, AVI/MPEG-4 and similar) still work
but scrub more slowly. Preview plays a clip's sound from a small audio-only copy
GLEECH makes with ffmpeg (cached in the temp folder), so it works for any clip
and doesn't slow down the picture; renders read the clip itself.

## Rendering

Render Video… (Ctrl+Shift+R) and Export GIF… (Ctrl+Shift+G) in the Export menu,
and the timeline's Render Video button, open one dialog with two tabs. The left
column shows the frame at the playhead, the range (work area, whole timeline or
In/Out, set with I and O), a live summary with the estimated file size and the
save location. Renders are named after the saved project file (an unsaved
project uses its name plus `_gleech`); type a different name in the Save to box,
or pick a folder and name with **Change…**. For image sequences the name also
names the frames and their subfolder. The box warns when a render would replace
a file. Renders run in the background with their own GPU worker, so you can keep
editing; the queue at the bottom right shows progress, Cancel and Show in
folder. **Add to Queue** keeps the dialog open for another output.

**Video** presets set size, codec, compression and audio: 8K and 4K UHD (HEVC),
2K Master, 1080p Social, Vertical 9:16, Half-res Draft, Edit Master and 4K Edit
Master (ProRes 422 HQ) and Custom. Compression choices run from Highest quality
to Small file, plus Lossless (FFV1, or PNG in MOV with alpha) and Raw (10-bit
4:2:2). Advanced encoder settings pick the encoder (CPU or NVENC, AMF, Quick
Sync, Media Foundation, VideoToolbox when available), color depth, keyframe
interval, speed and fast start.

- **Image sequence:** separate PNG files (8- or 16-bit, every frame, every 2nd,
  keyframes or markers), or a **flip book**: printable PDF pages (Letter, A4 or
  4×6 cards, binding margin, cut lines, frame numbers, cover) or a sprite sheet
  with optional JSON frame data.
- **Fit** appears when the output aspect differs from the source: Fit, Stretch,
  Crop, or letterbox, with black, blurred-video, color or transparent bars.
- **Upscaling** appears when the target is larger than the source. Render at full
  size draws effects natively at the target size; Upscale result uses Lanczos,
  Nearest neighbor, Real-ESRGAN, Real-CUGAN or waifu2x (the ncnn-vulkan tools on
  your PATH) or your own command line.
- **Effects only** leaves the source out and keeps what the effects add, with
  alpha. MP4 can't store alpha, so the format switches to ProRes 4444.
- **Audio** comes from the audio track, the clip's own audio or a mix, with
  loudness normalization and fades. The track's volume applies and a muted
  track is left out; the playback volume never affects renders.

**GIF & Loops** makes short looping files: GIF, animated WebP, APNG or an MP4
loop. Presets: Social Loop, High Quality, Tiny, Sticker and Crunchy Pixels. Loop
styles are Forward, Reverse, Boomerang and Concat (joins ranges or marker
sections); speed, frame rate, smoothing and repeat count are adjustable. GIF
palettes use palettegen with Bayer, Floyd–Steinberg or Sierra dithering and a
lossy setting. A size limit lowers quality automatically and notes when the
loop was trimmed to fit.

### Memory and recovery

The **Memory and recovery** section estimates peak RAM before an export starts.
Memory checks are on by default; an export that exceeds the estimate's safe
budget opens a warning with selectable alternatives. The shared runner checks
again when a queued job starts, using currently free RAM and headroom for the
app and OS. This is a conservative estimate; codec, effect and driver allocations
vary, and available GPU memory cannot be reliably measured on every system.

- **Automatic** chooses standard buffering or one frame at a time based on free
  RAM. **Standard** keeps normal throughput. **One frame at a time** limits
  decoder read-ahead, frame overlap and software encoder buffering, trading speed
  for a smaller working set. Frames are streamed to the encoder as they finish.
- **Tiled processing** bounds effect intermediates with 256, 512 or 1024-pixel
  tiles. It supports uniform, full-coverage Hue/Saturation, Levels/Curves,
  Gradient Map and Photo Adjustments. Spatial effects, imported shaders, painted
  masks and coordinate-dependent application/tint settings are refused rather
  than rendered with seams. The full input and output frame must still fit.
- **Effect processing size** can reduce effects to the output resolution when
  exporting a smaller video. Full source resolution preserves the existing
  rendering behavior. Smaller processing can change fine effect detail.
- **Render in parts** encodes short movie files and assembles their video streams
  without re-encoding. Audio is mixed once over the complete range. Disposable
  caches and decoders restart between parts for frame-independent stacks.
- **Keep completed parts for recovery** stores verified parts beside the output
  in a hidden `.<output>.<identity>.gleech-parts` folder. **Resume completed parts**
  reuses them when the project, media, range, processing and encoding settings,
  output path and part length match. Select the same settings after reopening
  the project. An interrupted part is rendered again; completed parts are hashed
  before reuse. Imported shaders may replay earlier frames to restore state.

Parts and resume apply to Video movie outputs, including lossless movies; they
are unavailable for GIF/Loops and image sequences. Without Keep enabled, parts
are temporary and removed when the job ends or is cancelled. Kept parts remain
after success, cancellation or failure; remove their folder manually once no
longer needed and no export is using it. They consume additional disk space.
Splitting a video into parts does not solve a single frame that cannot fit;
choose compatible tiles or a smaller processing resolution for that case.

### ffmpeg

Movies, loops and video import use ffmpeg. Packaged apps include FFmpeg with
x264/x265. An executable you choose with **Locate ffmpeg…** takes priority over
the bundle; if it is missing or unusable, GLEECH tries the bundle, then your PATH.
Image sequences and flip books render without ffmpeg. See
[development setup](DEVELOPMENT.md#ffmpeg) for local builds.

AI assistants connected through MCP can edit keys, modulators, ranges and the
timeline, move the playhead and queue renders; see [MCP](MCP.md#timeline-and-rendering).

## Shortcuts in Timeline mode

- Space: play/pause (on the canvas, Space still shows Original while held).
- Left / Right: previous / next frame; Shift for 10 frames. Home / End: start / end.
- , and . : previous / next keyframe.
- I / O: set In and Out; M: add a marker at the playhead.
- Delete: remove selected keys; \\: fit the timeline; Z: zoom to the selected keys.
- Ctrl + scroll: zoom the timeline; Shift + scroll: pan.
- Ctrl+Shift+R: Render Video…; Ctrl+Shift+G: Export GIF….
