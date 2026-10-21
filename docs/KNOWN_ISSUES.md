# Known Issues

## Performance and render time

Performance and render time is a work in progress. Not all effect stacks are created equal, some will incur greater performance issues that others.

## GLEECH randomness and slider effectiveness

GLEECH button randomness, and slider effectiveness. The GLEECH button is truly random which can be good and bad. The subtle to distorted slider is likely not weighted enough currently and needs further tuning all around.

## Filter shader and preset defaults

Filters/Shaders/Presets good defaults. Not all filters/shaders currently have good defaults. Further tuning is needed.

## Mask painting

Mask painting sometimes lags while painting. Further performance improvements need to be made here.

## Phase sliders

Some filters/shaders effects have phase sliders that don't do much. If you run across one, or any slider that doesn't seem to have an effect please report it.

## Mandelbrot Slices

The Mandelbrot Slices is a crazy shader. It just is, it can do some interesting things but it is like trying to control an untamed beast. It's very unintuitive, and visually difficult to understand what's happening. It's probably the most schizo shader in the stack. I will make improvements here eventually, but I wanted you to know what you're getting yourself into if you use it.

## Sliders getting stuck

Some sliders might get stuck and display a "no" circle/slash icon while dragging. This is a known bug and there are unit tests to detect this but they are not perfect, so if you run into this please place a bug report and include the effect stack and what slider was effected.

## Project compatibility

General warning overall, due to the fact that this is a beta test and things might change suddenly saved project files from one version might not open or render exactly the same in future versions. I try to do my best to avoid this whenever possible and retain backwards compatibility but it might not always be possible. If this happens I will do my best to note what filters/effects might be affected from patch to patch if this occurs.

## Timeline

- Playback renders reduced previews; heavy stacks play below real time on the
  first pass and smoothly once frames are cached.
- Subject-based effects detect the subject once, on the clip frame that is the
  source image (the first frame, or the frame Image mode last opened on).
- Crop "Follow subject" currently keeps the picture centered.
- Projects store video and audio file paths; moved files show as offline.

## UI organization

General overall UI clean up and organization. As an overall house keeping measure some effects groupings and placement could be organized better or more efficiently. This is an ongoing effort and work in progress.
