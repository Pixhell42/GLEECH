# GLEECH roadmap

Updated 2026-10-14. This roadmap describes product priorities, not committed
release dates. Beta feedback helps determine the order of work.

## Available today

- Windows x64 beta with 109 built-in effects, including 46 shaders; 29 presets;
  40 depth maps and 40 vector maps.
- Editable effect stacks, procedural and painted masks, seeded patterns, effect
  locks, GLEECH randomization and Variation previews.
- Stages and baking, portable projects/presets, image exports, shader imports
  and local stdio MCP control.
- Favorites, adjustable panels, remembered control sections, UI color choices
  and native bug/feature reporting through GitHub sign-in.

## Performance and responsiveness

- Reduce preview latency and UI hitches with large mixed effect/shader stacks.
- Improve mask-painting responsiveness while preserving export quality.
- Profile shader loading, compilation, resource reuse and GPU/CPU transfers.
- Reduce redundant rendering when changing controls, seeds or application masks.
- Improve full-resolution export speed and memory use; make progress and
  hardware limits easier to understand.
- Continue checking CPU fallback and results across different graphics hardware.

## Filters, shaders and creative content

- Expand the original shader collection with distinct geometric, glitch,
  material, organic and image-distortion looks.
- Refine existing filters and shaders before adding near-duplicate effects.
  Priorities include useful parameter ranges, visible Phase/New Pattern changes,
  positioning, blending and consistent color controls where applicable.
- Extend compatible effects with reusable direction fields, depth maps and
  application masks where those inputs create useful new results.
- Add original presets, including combinations of multiple shaders, with clear
  thumbnails and useful variation ranges.
- Expand depth/vector starter maps when they enable looks the current collection
  cannot produce; keep imported maps and portable presets practical to use.

## Editing and workflow

- General UI cleanup and organization: consistent controls, spacing, menus and
  panel grouping, with clear labels and accessible interactions.
- Continue improving effect-stack navigation, discoverability and control layout
  based on beta feedback.
- Refine mask controls and painting behavior, preset browsing and editing, and
  variation selection for more predictable creative iteration.
- Improve project/preset compatibility, feedback diagnostics and recovery from
  unsupported resources or interrupted operations.
- Expand local MCP control where it helps agents edit the same project the user
  sees, with clear state inspection and Undo behavior.

## Shader compatibility

- Improve validation, import diagnostics and portability of supported shader
  packages while preserving creator attribution and license information.
- Consider additional shader adapters and multipass resources after a separate
  compatibility and performance design.
- Keep shaders as named effects with clear controls. An in-app shader code
  editor remains outside the product scope.

## Linux and macOS

Native port work and packages have not started. Each platform will ship when its
core workflows are validated, independently of the Windows release schedule.

- Support native windows, shortcuts, paths, fonts, clipboard and credentials.
- Validate image processing, shaders, CPU fallback and local MCP on native hardware.
- Provide native packages and test project/preset compatibility, masks and exports.

This is one shared roadmap, maintained on main. Contributors should bring shared
fixes back from port branches early, keep those branches current with main, and
add reliable native checks as support becomes available. Platform release notes
may differ; separate copies of the product roadmap should not diverge.

## Waiting for design

- Global drawing tools and blank layers, polygon/Bezier drawing, raster drawing,
  eraser/fill, and Image Size/Canvas Size tools.
- Video/GIF animation, shader playback and animation export, animation tools
  and timeline editing.
- Shape-local shader patterns with a choice of whether the pattern follows the
  shape; keep this distinct from a static application mask.

These are planned product directions awaiting interaction and technical design
before implementation. They are not available in the current beta.

## Deferred exploration

- HTTP transport and remote MCP connections.

Deferred items need their own design and validation before implementation.

Current controls and implemented effects are documented in the
[user guide](USER_GUIDE.md) and [effect inventory](EFFECTS.md). Contributor release
procedures and repository administration belong in the
[release checklist](RELEASE.md), rather than this product roadmap.
