# Architecture

## Workspace boundaries

`apps/desktop` owns Electron main/preload, React UI, image/file services,
preferences, GitHub reporting and the local MCP bridge. Shared packages are
bundled from TypeScript source and are not independently published packages.

- `project-model`: validated effects, defaults, project/stage schemas, masks,
  map attachments, shader packages and catalog metadata.
- `command-service`: immutable project mutations, grouped Undo/Redo, snapshots,
  preset placement, locks and reproducible GLEECH/Variation recipes.
- `effects`: deterministic CPU rendering and shared composition, masks, fields,
  gradients, finishing and cancellation.
- `renderer-core`: WebGPU programs/readback, shader validation/specialization,
  geometry and preview presentation.
- `mcp`: MCP schemas/server, local connection protocol, semantic operations and
  resources. It delegates actual edits/rendering to the open desktop instance.

Shared packages must not import Electron or React. The renderer reaches native
services only through narrow typed preload methods and validated IPC handlers.
Production windows enable context isolation and sandboxing, disable Node
integration and deny unexpected navigation/new windows.

## Rendering

Recipes are stored in render order, bottom layer first; the UI displays the
reverse order. Stable instance IDs identify effects; positions are not IDs.
The renderer renders immutable revisions and discards superseded work. Reduced
interactive previews refine after the gesture; final exports use source resolution.

Original built-in shaders have CPU implementations and lazy per-device WebGPU
pipelines. Kernels are specialized/pruned at build time; device loss or missing
capabilities can fall back to CPU for built-ins. Imported WGSL requires WebGPU;
supported imported ISF requires WebGL2 and has no generic CPU equivalent.

Bounded draft checkpoints reuse unchanged stack prefixes across adaptive sizes.
Image decoding, subject inference and encoding run off the UI thread. Painted
mask overlay rasterization has its own worker. Live stroke drafts stay in the
viewport until committed; cursor updates avoid rerendering the editor. Mask
rasterizers recompose dirty segment bounds while preserving exact coverage,
opacity, erasing, cancellation and Undo behavior.

CPU/effect outputs use straight RGBA; image sampling accounts for alpha.
Source/procedural/imported scalar and vector fields use normalized image-space
placement so previews and exports agree. Preview/cache limits are implementation
details and do not replace original-resolution export.

## Data and history

Commands validate state before committing one undoable edit. Continuous slider
and painting gestures are grouped. Projects embed source assets, saved recipes,
baked images and attachment data. Portable presets explicitly select recipe
fields and omit project file paths. Imported shader packages and cached glyph
coverage sheets remain embedded for portability. Libraries/preferences and
recent-file lists are per-user data outside project history.

The image worker handles Sharp codecs and local U²-Net inference with ONNX Runtime.
The bundled model and its Apache license remain separate from GLEECH's MIT code.
File contracts and size budgets are documented in [FILE_FORMATS.md](FILE_FORMATS.md).

## MCP and feedback

The bundled MCP stdio server connects to a Windows named pipe or a macOS Unix
socket using a per-instance connection file/token. Unix sockets use a private
temporary directory. Modes and approved folders gate operations;
file grants are checked again before writes. Revision checks prevent stale
edits. Isolated batches retain the working project's UI/history. No HTTP server,
remote pairing or hosted relay is part of this transport.

Feedback uses GitHub device authorization with a public Client ID, protected
per-user credentials and native issue submission. Requests have validation,
bounded input and submission/recovery identifiers. Stack attachments whitelist
settings and omit image pixels, shader source, painted strokes and paths.

## Platforms

Windows x64 is the supported target; the experimental macOS build targets Intel
and Apple Silicon. Linux/macOS ports share these
packages and the UI; platform adapters must isolate window controls, shortcuts,
paths, credential storage, fonts, native dependencies, packaging and MCP
connection discovery. One [roadmap](ROADMAP.md) on main records all platform status.
