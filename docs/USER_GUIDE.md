# Using GLEECH

## Open and save

Open PNG, JPEG or WebP images through the hamburger menu, drag/drop or Ctrl+V.
The bundled unfiltered statue is available from the empty canvas and Library menu.
Click the project name to edit it. Save an editable `.gleech` project through
Save → Save project / Save project as. Saving embeds the images needed by the
project. Changing the name alone does not rename an existing file on disk.

Recents lists successfully opened/saved projects. Closing or replacing unsaved
work uses the Save/Discard/Cancel flow. Save regularly during beta testing.

## Effects and controls

The plus icon opens the effects library; the adjacent trash icon deletes the
selected layer. Drag effect rows to reorder. Lower layers render first; upper
layers operate on the result below them. Select a row to edit its controls.
The eye icon enables/disables its effect. Shader layers and presets containing
shaders carry the small S mark. Stars mark favorites; favorites sort first,
followed by alphabetical listings. Library browsing also works without an image.

Controls is the default inspector tab; Image details shows source information.
Resize side panels by dragging their inner edges. Inspector sections collapse
individually; Open All and Collapse All act on all sections. Panel sizes,
collapse states, favorites and UI Color are local preferences remembered between
sessions. Hover an info icon for a control explanation. Right-click supported
controls for Copy, Paste and Reset. Right-click a layer for stack settings and
Duplicate; duplicates appear above the original. Compatible color data pastes
to the closest matching available color control.

Applicable effects share Opacity, blend modes, optional Tint and color/gradient
controls. Their effect-specific controls retain their own units and meanings.
Tint begins disabled. Solid supports color, gradients, the current stage input,
or an embedded new image with Fit/Fill/Stretch placement.

## Coverage and painted masks

Application selects a region such as All, Subject, Background or an image edge.
Coverage controls how much is affected; Softness controls the transition.
Subject/Background use local photo foreground detection, not transparency.
Use depth/direction fields on effects that expose those controls; imported maps
and selected starter maps travel with the project and portable presets.

Mask opens per-effect painting controls. Choose Paint/Erase, brush size, shape,
hardness, opacity and falloff. Finish the stroke to commit one undoable edit.
Mask controls include enabling, inversion, overlay visibility and removal.
Alt+left-click the layer's mask button toggles the mask; a disabled mask has a
red diagonal mark. Painted masks remain static in stage/image coordinates.
Bake a snapshot first when you want later effects to distort painted results.

## Patterns, GLEECH and Variation

The seed field's dice button changes the project seed. New pattern varies the
selected effect's pattern; parameter edits do not roll the seed automatically.
Undo/Redo restores changes. Locks protect effects from supported randomization;
they do not prevent you from deliberately editing or deleting a layer.

GLEECH offers Simple, Complex and GLEECHED. With an existing stack, choose:

- **Replace All:** replace the entire stack, including locked layers.
- **Keep Locked Only:** leave locked layers untouched; change, remove, replace or add unlocked layers.
- **Preserve All and Add:** retain every existing layer and add new randomized layers above them.
- **Randomize and Add:** vary unlocked layers and add new layers; locked layers remain unchanged.
- **Use Existing Only:** vary unlocked layers without adding/removing layers.

Variation displays nine alternatives. Upper previews remain closer to the current
recipe; lower previews vary it more. The Stable/Distorted slider adjusts variation
strength, and New Set refreshes the previews. Selecting a preview applies one
undoable edit while respecting locks.

## Presets

Save Stack as Preset is under Library. Choose a current-image thumbnail or a
rendered statue preview; Edit preset can change it later. Presets contain effect
settings, seed, masks and embedded attachments, including imported shaders.

- **Replace All:** replace the current stack and use the preset's seed.
- **Add Above / Add Below:** insert the preset on that side of the stack.
- **Merge:** keep current settings for matching effect types, use preset effects
  for missing types, and remove current types absent from the preset.

Import/export portable `.gleechpreset` files through the library. Built-in presets
can be applied/exported but are not edited in place; save an editable personal copy.

## Stages, snapshots and bake

The Stages panel stores recipes and previews for alternate looks. A saved
snapshot is not automatically a new input image. Baking creates a rendered image
that can become a stage's input; later layers then work on those baked pixels.
Selecting a saved recipe updates its effects while the active source stage
remains identified separately. Stage and recipe history stays in project saves.
Hover the Stages info icon for guidance; its collapsed state is remembered.

## Canvas and exports

Wheel to zoom; drag to pan when not painting. Fit restores the image bounds;
100% shows actual image pixels. Edited/Original compares the processed result
with the current source, and holding Space temporarily shows Original.

Export image supports PNG, JPEG, WebP and TIFF; PNG is the default. Quick PNG
Export uses PNG directly. PNG/TIFF preserve RGBA losslessly, WebP preserves
transparency with selectable quality, and JPEG flattens onto white. Export uses
the edited result at source resolution, regardless of comparison/preview zoom.
Projects, portable presets and exported images record GLEECH's release version,
developer URL and repository URL; other software may strip image metadata.
The hamburger menu's version footer copies the release label.

## Support and feedback

Community groups Support GLEECH, Discord, Bug Report and Feature Request.
Native reports require GitHub device sign-in. The running version and environment
are always included. Bug reports may attach settings and seed; image bytes,
shader code and painted strokes are omitted. Feature requests have no stack
attachment checkbox. See [reporting setup and privacy](GITHUB_FEEDBACK.md).

## Shortcuts

- Ctrl+Shift+O: open image; Ctrl+O: open project.
- Ctrl+S / Ctrl+Shift+S: Save / Save As.
- Ctrl+C / Ctrl+V: copy edited image / paste image, when a text field is not active.
- Ctrl+Z: Undo; Ctrl+Shift+Z or Ctrl+Y: Redo.
- Ctrl+Shift+E: Quick PNG Export.
- Home: Fit; 1: actual pixels, while the viewport has focus.
- Alt+F4: guarded application close; Escape: close/cancel the active overlay.

Global drawing tools, new blank Drawing layers, Image Size and Canvas Size remain
unavailable and are waiting for design. Saved older drawing/path data retains
render/storage compatibility.
