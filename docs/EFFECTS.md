# Built-in effect inventory

Verified against the current project-model definitions: 109 effects, including 46 shaders.

The library also includes [29 presets](#built-in-presets), 40 depth maps and 40 vector maps. Imported shaders add their own library entries.

Controls and aliases are defined in source and explained through UI tooltips. See the [user guide](USER_GUIDE.md) for shared behavior.

## Filters and layers

- Advanced Bit Damage (`bit-damage`)
- Bit crush (`bit-crush`)
- Block corruption (`block-corruption`)
- Blur (`blur`)
- Cel Shading (`cel-shading`)
- Channel Transform (`channel-transform`)
- Chroma Mosh (`chroma-mosh`)
- Compression Breakup (`compression-breakup`)
- Contour Waves (`contour-waves`)
- CRT (`crt`)
- Data Weave (`data-weave`)
- Depth Color Mapping (`depth-color-map`)
- Depth Field (`depth-field`)
- Depth Haze (`depth-haze`)
- Depth Parallax / Push-Pull (`depth-parallax`)
- Detail / Sharpen / Clarity (`detail`)
- Dither (`dither`)
- Feedback Bloom / Melt (`feedback-bloom`)
- Freeze / Dropout (`freeze-dropout`)
- Glow (`glow`)
- Glyph Renderer (`glyph`)
- Gradient Map (`gradient-map`)
- Granular Echo (`granular-echo`)
- Halation (`halation`)
- Halftone (`halftone`)
- Hue / Saturation (`hue-saturation`)
- Indexed Palette (`indexed-palette`)
- JPEG Recompression (`jpeg-recompression`)
- Kaleidoscope (`kaleidoscope`)
- LED Matrix (`led-matrix`)
- Lens Distortion (`lens-distortion`)
- Levels / Curves (`levels-curves`)
- Mandelbrot (`mandelbrot`)
- Micro Collage (`micro-collage`)
- Mirroring (`mirroring`)
- Motion Mosh (`motion-mosh`)
- Motion Transfer (`motion-transfer`)
- Neon Print (`neon-print`)
- Noise / Grain (`noise-grain`)
- Photo Adjustments (`photo-adjustments`)
- Pigment Drag (`pigment-drag`)
- Pixel Dissolve (`pixel-dissolve`)
- Pixel Sorting (`pixel-sort`)
- Pixel Stretch (`pixel-stretch`)
- Recursive Space (`recursive-space`)
- Reference / Cross-image Mosh (`reference-mosh`)
- RGB split (`rgb-split`)
- Scanlines (`scanlines`)
- Shapes (`shapes`)
- Signal Tearing (`signal-tearing`)
- Signal Weave (`signal-weave`)
- Solid (`solid`)
- Spatial crush (`spatial-crush`)
- Subject / Depth / Hybrid Cutout (`cutout`)
- System Crash (`system-crash`)
- Temporal Echo (`temporal-echo`)
- Terminal Wireframe (`terminal-wireframe`)
- Threshold / Photocopy (`threshold`)
- Transform (`transform`)
- Vector Corruption (`vector-corruption`)
- Vignette (`vignette`)
- Wave distortion (`wave-distortion`)
- Window Fragments (`window-fragments`)

## Original shaders

- Arc Network (`shader-arc-network`)
- Bead Weave (`shader-bead-weave`)
- Billowing Smoke (`shader-billowing-smoke`)
- Bloom Field (`shader-bloom-field`)
- Caustics (`shader-caustics`)
- Cellular Membrane (`shader-cellular-membrane`)
- Cellular Mesh (`shader-cellular-mesh`)
- Chromatic Erosion (`shader-chromatic-erosion`)
- Circuit Matrix (`shader-circuit-matrix`)
- Contour Melt (`shader-contour-melt`)
- Crystal Facets (`shader-crystal-facets`)
- Data Lattice (`shader-data-lattice`)
- Diffraction (`shader-diffraction`)
- Digital Fracture (`shader-digital-fracture`)
- Facet Mandala (`shader-facet-mandala`)
- Filament Flow (`shader-filament-flow`)
- Flow Field (`shader-flow-field`)
- Hatched Solids (`shader-hatched-solids`)
- Heat Mirage (`shader-heat-mirage`)
- Hologram (`shader-hologram`)
- Infinity Tunnel (`shader-infinity-tunnel`)
- Iridescence (`shader-iridescence`)
- Liquid Chrome (`shader-liquid-chrome`)
- Liquid Foil (`shader-liquid-foil`)
- Liquid Glass (`shader-liquid-glass`)
- Liquid Marbling (`shader-liquid-marbling`)
- Mandelbrot Slices (`shader-mandelbrot-slices`)
- Microculture (`shader-microculture`)
- Moiré Interference (`shader-moire`)
- Nebula (`shader-nebula`)
- Neon Edges (`shader-neon-edges`)
- Op Art (`shader-op-art`)
- Paint Flow (`shader-paint-flow`)
- Particle Burst (`shader-particle-burst`)
- Particle Web (`shader-particle-web`)
- Polar Grid (`shader-polar-grid`)
- Prismatic Panels (`shader-prismatic-panels`)
- Prismatic Shatter (`shader-prismatic-shatter`)
- Radial Extrusion (`shader-radial-extrusion`)
- Shader Plasma (`shader-plasma`)
- Shader Ripple (`shader-ripple`)
- Signal Collapse (`shader-signal-collapse`)
- Signal Orb (`shader-signal-orb`)
- Spectral Terrain (`shader-spectral-terrain`)
- Truchet Mosaic (`shader-truchet-mosaic`)
- Wire Ghost (`shader-wire-ghost`)

## Effect descriptions and control reference

Each entry below describes the effect and its specific controls. Numeric controls are sliders unless they belong to a dedicated editor. Style, mode and source selections determine which controls are visible; the reference includes controls across those choices. Turning an optional feature off keeps its settings for later.

Shared blending, tint, gradient, application and field controls are explained once below. The per-effect entries link to the shared controls they support. See [Known Issues](KNOWN_ISSUES.md) for beta behavior and tuning caveats.

### Shared controls

- **Opacity:** Mix the effect result with the incoming image. Zero shows the incoming image; 100% applies the full result.
- **Blend mode:** Choose how the result combines with the incoming image, such as Normal, Multiply, Screen, Color Dodge, Color Burn or Difference. Available modes depend on the effect.
- **Tint and Tint strength:** Enable optional tinting and adjust how strongly the chosen tint multiplies the processed colors. Tint begins off; its strength slider is disabled while off.
- **Solid / Gradient color controls:** Where supported, switch a color swatch between a solid color and a gradient. Choose start/end colors and add, move or remove intermediate stops. Spatial gradients expose Direction, Position X/Y and Span: these rotate, reposition and widen the transition. Height- or fractal-driven gradients follow their field instead of a canvas direction.
- **Application, Coverage and Softness:** Select where the effect applies, change the covered region or signal range, and feather its boundary. Painted masks further restrict that application; they can be enabled, disabled or inverted.
- **Edge Handling:** Extend repeats the outermost pixels; Wrap (Tile) samples the opposite edge; Mirror reflects the image at its edges. Wrap can reveal a seam when opposite edges differ.
- **New pattern:** Where available, change the selected effect's saved pattern variation. Phase sliders select a fixed state rather than playing an animation.

### Shared depth field controls

Effects that expose a depth field can use image brightness, procedural fields or an imported/starter depth map. Import and Starter Maps choose the map input; preview controls inspect it without changing the effect. Controls appear according to the selected source.

- **Field source:** Choose the height signal that drives the effect: source-image brightness, an imported depth map or a procedural field. Options: Brightness, Imported Map, Linear Ramp, Radial Ramp, Perlin, Simplex, Value, Voronoi / Worley, Shapes.
- **Field shape:** Choose the primitive used by the Shapes field source: Circle, Square or Triangle. Options: Circle, Square, Triangle.
- **Field scale:** Size of noise cells, shape tiles or the ramp span, as a percentage of the shorter image side.
- **Field position X:** Horizontal field center on the image canvas.
- **Field position Y:** Vertical field center on the image canvas.
- **Field rotation:** Rotate ramps and shape patterns around their field center.
- **Field detail:** Number of finer noise octaves contributing to the field.
- **Field roughness:** Contribution of finer noise octaves.
- **Invert field:** Reverse the height values so near/high regions become far/low regions and vice versa.
- **Normalize field:** Stretch the field’s sampled height range to the full range before applying the remaining depth adjustments.
- **Field contrast:** Expand or compress height values around the midpoint.
- **Field smoothing:** Smooth heights over this percentage of the shorter image side before normalization and contrast.
- **Near:** Height mapped to the foreground end of the depth range. Move below Far to invert the selected range.
- **Far:** Height mapped to the background end of the depth range. Equal values produce a hard threshold.
- **Field falloff:** Blend a smooth height transition into the selected near/far range; 0% keeps a linear or hard transition.

### Shared direction field controls

Compatible effects can replace their ordinary direction with linear, radial, inward, circular, spiral, perspective, flow, depth-gradient or imported vector patterns. Native preserves the effect's own direction controls. Import and Starter Maps choose a vector image. Controls appear according to the selected field.

- **Direction field:** Native keeps this filter’s existing direction behavior. Other fields share a saved canvas-space vector pattern across compatible filters. Copying a field creates independent settings, not a live link. Options: Native, Linear, Away from center, Toward center, Circular, Spiral, Perspective, Noise / Flow, Stage brightness gradient, Imported vector map.
- **Field influence:** Blend the native direction with the shared vector field. Zero keeps native behavior. Opposing vectors can cancel at the midpoint.
- **Field position X:** Horizontal field origin on the stage canvas.
- **Field position Y:** Vertical field origin on the stage canvas.
- **Field scale:** Scale field coordinates around its origin. Smaller values make tighter patterns; imported maps outside their bounds contribute zero.
- **Field rotation:** Rotate field coordinates and vector directions together.
- **Spiral twist:** Mix outward radial travel with circular flow. Negative values spiral inward; zero is circular.
- **Flow seed:** Saved seed for Noise / Flow. Copied fields keep the same seed independently of effect identity.
- **Reverse field:** Reverse both components of the vector field.
- **Glyph field drift:** Drift the rendered glyph pattern along the field in units of cell size. Glyph selection stays anchored to the original grid.

### Filters and layers

#### Advanced Bit Damage

Corrupt selected bit planes in individual color channels or transparency.

- **Operation:** Modify selected bit planes. Shift/Rotate/Scramble operate among selected planes; Isolate erases all other bits. Swap uses two selected indices; XOR/AND/OR use Operand. Injection replaces bits, Byte scramble reorders cells and Crossfeed reads Source channel. Options: Flip, Clear, Set, Shift, Rotate, Scramble, Isolate, Swap bit pair, XOR, AND, OR, Random bit injection, Byte scramble, Channel crossfeed.
- **Target:** Choose which encoded 8-bit channels to process. Alpha modifies transparency; Visualize on Alpha shows its selected planes as gray while preserving transparency. Options: RGB, RGBA, Luma, Red, Green, Blue, Alpha.
- **Low bit:** First bit in the inclusive selected range, counted from zero. Reversed endpoints are sorted automatically.
- **High bit:** Last bit in the inclusive selected range. Bit 7 has the strongest visible effect.
- **Bit shift:** Positive moves selected bits toward larger values; negative toward smaller values. Rotate wraps within the range; Shift discards bits that leave it.
- **Damage density:** Fraction of seeded cells affected. Zero preserves the source exactly; 100% processes every cell.
- **Cell size:** Width and height of damage cells in original-image pixels. Larger cells group corruption into patches.
- **Visualize planes:** Display the selected range stretched to full brightness instead of applying the operation. Untargeted channels stay unchanged.
- **Bit selection:** Select a continuous Low/High range or individually choose any of the eight bit planes.
- **Selected planes:** Bit mask for custom selection. Each enabled plane participates; all unselected planes are preserved except with Isolate.
- **First swap bit:** First absolute bit index to swap. Both swap bits must be included in the selected planes.
- **Second swap bit:** Second absolute bit index to swap. Equal indices leave the byte unchanged.
- **Operand:** Saved 8-bit value for XOR, AND or OR. Only selected planes are modified.
- **Source channel:** Copy the selected bit planes from this input channel into the target channels. Reads original input values, so RGBA processing cannot feed back on itself. Options: Red, Green, Blue, Alpha, Luma.
- **Bit probability:** Within damaged cells, independently choose which selected bits receive the operation. Zero preserves the source; 100% applies every selected bit.
- **Burst length:** Length of horizontal damage runs in cells. With clustering, neighbors share damage decisions. Byte scramble reorders whole input bytes within runs of at least two cells.
- **Damage clustering:** Blend independent cell selection with shared decisions across horizontal bursts and three adjacent cell rows. Density still controls the damaged fraction.

#### Bit crush

Reduce color depth into stepped tones.

- **Link RGB depths:** On uses one Color depth for red, green and blue. Off starts each channel at that depth and lets you adjust them separately. Linking again uses the Red depth. Alpha always has its own depth.
- **Color depth:** Bits per red, green and blue channel. 1 bit gives two levels per channel; 8 bits preserves the original 256 levels. Lower values create stronger color bands. Transparency is preserved.
- **Red depth:** Bits for the red channel when RGB depths are unlinked. 1 bit gives two levels; 8 preserves all 256 values. Other channels keep their own depths.
- **Green depth:** Bits for the green channel when RGB depths are unlinked. 1 bit gives two levels; 8 preserves all 256 values. Other channels keep their own depths.
- **Blue depth:** Bits for the blue channel when RGB depths are unlinked. 1 bit gives two levels; 8 preserves all 256 values. Other channels keep their own depths.
- **Alpha depth:** Bits for transparency. 8 preserves the original alpha; lower values reduce it to stepped transparency levels. RGB linking does not change this setting. Dithering and Opacity also apply.
- **Dithering:** None keeps clean color bands. Ordered uses a fixed repeating pattern; Random uses seeded noise to break up banding. Color depth stays unchanged. Options: None, Ordered, Random.
- **Dither strength:** Strength of the ordered or random dithering before reducing color depth. 0% keeps clean bands; 100% uses the full pattern. Choose a dithering mode to enable this control.

#### Block corruption

Displace a seeded pattern of image blocks.

- **Block size:** Size of each block as a percentage of the shorter image side. Larger values create chunkier blocks. Export keeps the same proportions.
- **Density:** Chance that each block is displaced. 0% moves no blocks; 100% moves every block. The seed determines which blocks are selected.
- **Displacement:** Maximum distance a selected block can move, as a percentage of the shorter image side. The seed controls the direction and distance.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Replacement:** Keep displaced source blocks or replace selected blocks with checker/noise patterns. Options: Source, Checker, Noise.
- **Replacement color:** Color or gradient used by replacement patterns.
- **Pattern scale:** Number of small pattern cells inside each replacement block.
- **Fragment erosion:** Erode the edges of selected corruption blocks.
- **Fragment travel:** Additional independently seeded travel of corruption fragments.

#### Blur

Soften, streak or selectively defocus your image.

- **Field blur editor:** In Field style, add up to eight points. Each point’s X/Y sets its position and Radius sets its local blur; zero keeps that point sharp. Values blend smoothly between points. **Radius** is labeled **Distance** for Motion and **Size** for Box.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Style:** Choose a blur style. Style-specific controls retain their values when switching. Options: Gaussian, Motion, Radial, Lens, Surface, Box, Grainy, Shape, Background, Field, Tilt-shift, Spin, Zoom, Smart Blur, Depth Field.
- **Radius:** Blur radius as a percentage of the shorter original image side. Zero leaves the image sharp.
- **Angle:** Direction of motion streaks or the angle of the tilt-shift focus band.
- **Aspect:** Stretch the blur footprint horizontally relative to its height.
- **Center X:** Horizontal position of the spin, zoom or radial blur center.
- **Center Y:** Vertical position of the spin, zoom or radial blur center.
- **Travel:** Spin angular travel (percentage of one turn) or signed radial zoom travel; negative reverses direction.
- **Spin / Zoom balance:** 0% is rotational spin; 100% is radial zoom.
- **Aperture sides:** Polygon side count for Lens or the Polygon footprint.
- **Footprint rotation:** Rotate a polygon, square or triangular aperture.
- **Highlight response:** Give bright samples more weight to emphasize bokeh highlights.
- **Color threshold:** Surface only mixes samples whose RGB distance from this pixel is within this threshold.
- **Sensitivity:** Smart Blur uses a smooth bilateral color weight; lower values protect smaller color differences.
- **Detail preservation:** Retain original fine detail after edge-aware Smart Blur smoothing.
- **Sample density:** Number of seeded jittered samples in Grainy Blur.
- **Footprint:** Choose the primitive footprint through which Shape Blur samples pixels. Options: Circle, Square, Triangle, Polygon, Ring.
- **Mask softness:** Feather the detected subject boundary; background samples exclude protected subject colors.
- **Subject refinement:** Adjust the subject mask threshold. Positive protects more of the detected subject.
- **Focus position (Tilt-shift):** Move the tilt-shift focus band along its normal.
- **Focus width (Tilt-shift):** Width of the sharp band, relative to the shorter original image side.
- **Focus falloff (Tilt-shift):** Distance over which the image transitions from sharp to fully blurred.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Near blur strength:** Scale Radius on the near/high side of the focus band. Zero keeps this side sharp; 1× retains the original blur.
- **Far blur strength:** Scale Radius on the far/low side of the focus band independently. Focus position, range and falloff still define the sharp band.
- **Focus position (Depth Field):** Height value at the center of the sharp focus band. Black is 0%; white is 100%.
- **Focus range (Depth Field):** Full width of the sharp height band around Focus position. Pixels in this band remain unchanged.
- **Focus falloff (Depth Field):** Height distance beyond the focus band over which blur grows smoothly to Radius. Zero gives a hard focus boundary.

#### Cel Shading

Flatten source colors into clean shaded bands with adjustable ink outlines.

- **Shade bands:** Number of brightness steps used to create flat illustrated shading.
- **Color bands:** Number of steps per color channel. Fewer steps create broader, flatter color areas.
- **Surface smoothing:** Smooth small texture before shading while retaining boundaries. Radius is a percentage of the shorter image side.
- **Contrast:** Expand the source brightness range before choosing shade bands.
- **Saturation:** Control the saturation of the illustrated colors. Zero creates grayscale shading.
- **Outline width:** Sampling radius used to detect ink boundaries. Zero disables outlines.
- **Outline threshold:** Minimum image contrast that creates an ink boundary. Higher values retain only stronger edges.
- **Outline opacity:** Opacity of the ink boundaries over the shaded colors. Zero disables outlines.
- **Ink color:** Color of the illustrated ink outlines.

#### Channel Transform

Transform red, green and blue independently, then swap or mix their source channels.

- **Crossfeed:** Mix each transformed channel with its selected Source. Zero uses its own channel; 100% uses the chosen source. Route one source to several destinations to duplicate a channel.
- **Pivot X:** Horizontal pivot for all channel scale, rotation and mirroring, as a percentage of image width.
- **Pivot Y:** Vertical pivot for all channel scale, rotation and mirroring, as a percentage of image height.
- **Red position X:** Move this channel horizontally as a percentage of image width. Positive moves right.
- **Red position Y:** Move this channel vertically as a percentage of image height. Positive moves down.
- **Red scale:** Scale this channel around the shared pivot. 100% keeps its original size.
- **Red rotation:** Rotate this channel clockwise around the shared pivot.
- **Red mirror:** Mirror this channel around the shared pivot before scaling and rotation. Options: Off, Horizontal, Vertical, Both.
- **Red source:** Choose the channel sampled through this destination transform. Crossfeed controls how much of this source is used. Options: Red, Green, Blue, Luminance.
- **Green position X:** Move this channel horizontally as a percentage of image width. Positive moves right.
- **Green position Y:** Move this channel vertically as a percentage of image height. Positive moves down.
- **Green scale:** Scale this channel around the shared pivot. 100% keeps its original size.
- **Green rotation:** Rotate this channel clockwise around the shared pivot.
- **Green mirror:** Mirror this channel around the shared pivot before scaling and rotation. Options: Off, Horizontal, Vertical, Both.
- **Green source:** Choose the channel sampled through this destination transform. Crossfeed controls how much of this source is used. Options: Red, Green, Blue, Luminance.
- **Blue position X:** Move this channel horizontally as a percentage of image width. Positive moves right.
- **Blue position Y:** Move this channel vertically as a percentage of image height. Positive moves down.
- **Blue scale:** Scale this channel around the shared pivot. 100% keeps its original size.
- **Blue rotation:** Rotate this channel clockwise around the shared pivot.
- **Blue mirror:** Mirror this channel around the shared pivot before scaling and rotation. Options: Off, Horizontal, Vertical, Both.
- **Blue source:** Choose the channel sampled through this destination transform. Crossfeed controls how much of this source is used. Options: Red, Green, Blue, Luminance.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Chroma Mosh

Drag, freeze and smear color while retaining sharp brightness detail.

- **Style:** Smear moves color continuously. Blocks reuse coarse color cells with seeded travel. Trails accumulate several color samples with persistence. Options: Smear, Blocks, Trails.
- **Chroma size:** Size of shared color cells as a percentage of the shorter image side. Larger cells create coarse bleeding color patches while preserving brightness detail.
- **Color travel:** Travel of color information along Direction. Brightness and transparency remain at their original pixels.
- **Direction:** Direction of the displaced color: 0 degrees is horizontal and 90 degrees is vertical.
- **Density:** Fraction of seeded color cells affected by Blocks and Trails. New pattern changes the selected cells.
- **Persistence:** Weight retained by distant color samples in a trail. Higher values produce stronger lingering color.
- **Trail samples:** Number of color samples along each trail. More samples make a smoother smear; work is bounded for responsive rendering.
- **Color mix:** Mix damaged color into the original color while retaining the original brightness. Zero restores the original image.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Compression Breakup

Break image detail into damaged compression blocks and bleeding color.

- **Compression:** Quantize the block transform. Higher values remove fine detail and create stronger stepped tonal patches. This simulates compression without encoding a JPEG.
- **Block size:** Width of each square compression block as a percentage of the shorter image side, with a minimum of eight source pixels. Larger blocks produce coarser damage; positions stay fixed in original-image coordinates.
- **Color resolution:** Resolution of color information inside each block. Luminance keeps its own detail; lower color resolution creates broad color patches. Options: Full, Half, Quarter, One color per block.
- **Color bleed:** Shift sampled color horizontally by up to one block width while keeping luminance in place. Edge Handling controls color sampling beyond the canvas.
- **Ringing:** Exaggerate light and dark halos around contrast edges in the decoded block detail.
- **Block seams:** Darken narrow edges between compression blocks. Zero hides the added seams.
- **Damage density:** Fraction of seeded compression blocks with extra decoder-style damage. New pattern changes which blocks fail. Zero disables damage.
- **Damage type:** Mixed chooses a failure per block. Color shift corrupts color, DC dropout changes average block brightness, and Coefficient loss drops detail frequencies. Options: Mixed, Color shift, DC dropout, Coefficient loss.
- **Damage strength:** Severity of the selected block failures, independently of their density. Zero removes extra damage.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Contour Waves

Draw stacked lines lifted into waves by source brightness, procedural noise, or an imported height map.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Lines:** Number of stacked lines across the canvas.
- **Wave height:** Maximum line displacement driven by the height field.
- **Line width:** Thickness of each line relative to the shorter original image side.
- **Direction:** Rotate the line layout across the canvas.
- **Phase:** Select a frozen offset in the contour pattern. 0% and 100% match.
- **Source background:** Mix the source image into the background behind the lines.
- **Line colors:** Use one line color or sample color from the incoming image along each line.
- **Line color:** Color of the stacked wave lines.
- **Background color:** Color behind the lines.
- **Line breakup:** Create seeded gaps along the contour lines.
- **Raster step:** Snap sampled wave heights to coarse increments. Zero retains smooth curves.
- **Contour tears:** Shift seeded portions of lines sideways. Zero retains the original layout.

#### CRT

Curve the image into a phosphor screen with highlight bloom and interlaced field blending.

- **Curvature:** Bend the image toward a curved screen. Zero keeps the image flat; increasing curvature bends edges and compresses corners.
- **Clip screen:** Make areas outside the curved screen transparent, with softened edges. Off fills them using Edge Handling. Clipping affects the warped image, not your painted mask.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Phosphor pattern:** Choose RGB stripes, rectangular RGB slots, or staggered circular RGB dots. These modulate image colors and stay aligned to the screen after curvature. Options: Off, Aperture grille, Slot mask, Dot mask.
- **Phosphor strength:** Mix the phosphor pattern into the image. Zero bypasses the pattern and its gain; 100% uses the full RGB mask.
- **Phosphor pitch:** Width of a complete RGB triplet in original-image pixels. Larger values expose the phosphor structure. Reduced previews average fine patterns to avoid flickering.
- **Phosphor width:** Fill more or less of each phosphor cell. Lower values widen the dark gaps; higher values make broader stripes, slots or dots.
- **Phosphor gain:** Boost the illuminated phosphor cells to compensate for dark gaps. High gain can clip highlights. This only applies while the pattern has nonzero strength.
- **Field blend:** Blend a shifted copy into alternating row bands. This simulates two misaligned fields of a still image; it does not introduce animation.
- **Shifted field:** Choose which alternating row bands use the shifted image. The other field stays in place.
- **Field height:** Height of each alternating field band in original-image pixels. One simulates interlaced rows; larger bands make field damage more visible.
- **Field offset X:** Shift the selected field horizontally in original-image pixels. Positive values move its content right. Zero keeps horizontal registration.
- **Field offset Y:** Shift the selected field vertically in original-image pixels. Positive values move its content down. Zero keeps vertical registration.
- **Bloom:** Spread light from bright image phosphors into nearby visible pixels. Zero disables bloom. The warped image transparency is preserved.
- **Bloom radius:** Radius of the soft highlight spread as a percentage of the shorter original-image side. Zero adds highlight light without spreading it.
- **Bloom threshold:** Minimum brightness contributing to phosphor bloom, with a soft transition. Lower values let more image areas glow.
- **Bloom color mix:** Zero keeps the phosphor highlight colors. Increasing this recolors the bloom with Bloom color, including its gradient.
- **Bloom color:** Choose a solid or gradient color for the bloom. Bloom color mix controls its contribution; the shared Tint colors the entire CRT result.

#### Data Weave

Reveal the image through disrupted rows of colored data dashes.

- **Dash length:** Length of each horizontal dash, relative to the shorter original image side.
- **Dash spacing:** Horizontal gap between dashes.
- **Row spacing:** Distance between data rows, relative to the shorter original image side.
- **Dash thickness:** Fraction of each row occupied by a dash.
- **Disruption:** Seeded missing dashes and uneven dash lengths.
- **Source visibility:** Reveal the unfiltered image behind the dash rows.
- **Phase:** Select a frozen moment of row drift. 0% and 100% match.
- **Dash color:** Use sampled image colors or the chosen dash color.
- **Dash color:** Color of dashes when Dash color is set to Chosen color.
- **Background color:** Color of the gaps and missing data dashes.

#### Depth Color Mapping

Map white-near / black-far height values to a multi-stop color ramp.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Depth palette:** Map far/black areas to the start color and near/white areas to the end color. Intermediate stops define depth bands.
- **Reverse palette:** Swap the near and far palette direction without changing the height field.
- **Preserve shading:** Retain source luminance within the mapped palette. Zero uses the pure depth colors.

#### Depth Field

Manufacture height fields for displacement, contour slices and relief.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Treatment:** Choose treatment. Settings are saved with the recipe. Options: Displacement, Contour Slicing, Relief, Stepped Relief, Show Field.
- **Displacement:** Move pixels along Direction according to their field height relative to the midpoint.
- **Direction:** Direction of depth-driven pixel displacement or contour slicing.
- **Contour count:** Number of discrete height terraces and visible contour bands.
- **Contour width:** Thickness of color bands along each height terrace. Zero hides the bands while retaining slicing.
- **Contour offset:** Shift the contour bands and terraces through one height interval without moving the depth map.
- **Contour softness:** Soften the contour ink falloff. Zero keeps a sharp antialiased edge; higher values feather the bands.
- **Terrace bevel:** Fraction of each height interval used to smooth the step into the next terrace. Zero creates hard steps; 100% rounds the whole interval.
- **Light elevation:** Height of the light above the surface. Low angles emphasize ridges; 90 degrees lights from directly above.
- **Ambient light:** Fill the shaded areas with uniform light. Higher values reduce the contrast of relief lighting.
- **Relief highlights:** Add narrow highlights where relief normals face the simulated light. Zero keeps diffuse lighting only.
- **Light angle:** Direction of simulated relief lighting across the height field.
- **Relief strength:** Strength of relief shading derived from height gradients.
- **Contour color:** Solid or gradient contour ink mapped through field height.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Depth Haze

Blend fog into distant areas of a static depth field while preserving source transparency.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Fog density:** Maximum fog opacity at the far end of the selected distance range.
- **Fog start:** Distance at which fog begins: 0 is near/white, 100% is far/black.
- **Fog end:** Distance at which fog reaches full density. Endpoints may be crossed; their sorted range is used.
- **Fog falloff:** Shape the fog increase: higher values concentrate fog farther away.
- **Fog color:** Choose a fog color or a multi-stop gradient fixed to the stage canvas.

#### Depth Parallax / Push-Pull

Use a static height field for simulated parallax, depth-dependent scale or torn depth slices.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Style:** Parallax shifts layers relative to a focus plane; Push / Pull scales by depth; Tearing shifts discrete depth bands. These are 2.5D approximations. Options: Parallax, Push / Pull, Depth tearing.
- **Camera X:** Horizontal depth-dependent travel relative to the shorter image side.
- **Camera Y:** Vertical depth-dependent travel relative to the shorter image side.
- **Focus depth:** Height plane that stays still. White is near/high and black is far/low.
- **Push / Pull:** Depth-dependent scale around the center. Positive expands near areas and contracts far areas.
- **Near push strength:** Scale the near/high side of Push / Pull independently. Zero leaves near areas unchanged; 1× retains the original Push / Pull strength.
- **Far pull strength:** Scale the far/low side of Push / Pull independently. Zero leaves far areas unchanged. Negative overall Push / Pull reverses both directions.
- **Depth bands:** Number of discrete height slices for Tearing.
- **Band scatter:** Seeded additional offsets of torn depth bands.
- **Center X:** Horizontal scaling center for Push / Pull.
- **Center Y:** Vertical scaling center for Push / Pull.
- **Edges:** Choose transparent clipping, extended edge pixels, tiled wrapping or mirrored pixels. Options: Transparent, Extend, Tile / Wrap, Mirror.

#### Detail / Sharpen / Clarity

Sharpen fine edges and adjust broader local contrast.

- **Sharpen:** Add or subtract fine detail relative to the blurred source. Negative values soften; zero disables fine sharpening.
- **Sharpen radius:** Fine-detail radius in original-image pixels; scales with draft previews.
- **Detail threshold:** Suppress sharpening of differences below this brightness threshold, reducing amplification of tiny noise.
- **Clarity:** Add or subtract broad luminance detail, weighted toward midtones. Zero disables clarity.
- **Clarity radius:** Broad local-contrast radius as a percentage of the shorter image side.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Dither

Render reduced tones with diffusion, blue-noise or corrupted patterns.

- **Algorithm:** Choose hard mapping, ordered Bayer, Floyd–Steinberg, Atkinson, full Sierra, Jarvis–Judice–Ninke, toroidal blue-noise ranks, seeded random noise or corrupted Floyd–Steinberg diffusion. Options: None, Ordered / Bayer, Floyd–Steinberg, Atkinson, Sierra, Jarvis–Judice–Ninke, Blue Noise, Random, Corrupted Dither.
- **Coloring:** Monochrome diffuses brightness into gray tones. RGB reduces and diffuses each channel independently. Color ramp maps the same brightness levels through an editable color bar. Options: Monochrome, RGB channels, Color ramp.
- **Levels per channel:** Discrete values per brightness/RGB channel. Two gives a binary bitmap; RGB can produce up to this count cubed colors. This is not a total indexed-palette count.
- **Ramp start:** Color for the lowest brightness level in Color ramp mode.
- **Ramp end:** Color for the highest brightness level in Color ramp mode.
- **Cell size:** Size of each processed cell in original-image pixels. Larger cells average visible color into coarse tiles. Transparency remains at its original pixels.
- **Dither strength:** Scale threshold noise or quantization-error diffusion. Zero uses hard nearest-color mapping; 100% uses the selected algorithm at full strength.
- **Scan:** Error diffusion alternates row direction in Serpentine mode or always scans left to right. Non-diffusion algorithms do not use scan direction.
- **Skipped cells:** Seeded fraction of cells left as incoming image color in Corrupted Dither. These cells do not propagate error. Zero skips none.
- **Error displacement:** Maximum horizontal travel of diffused error in original-image pixels in Corrupted Dither. Errors only reach future cells; zero preserves ordinary destinations.
- **Random direction:** Seeded fraction of diffusion rows and error destinations whose horizontal direction is reversed in Corrupted Dither.
- **Block interruptions:** Seeded fraction of blocks that discard incoming and outgoing diffusion error, creating islands of hard quantization.
- **Interruption size:** Size of corruption blocks in original-image pixels. Enabled by Block interruptions.
- **Channel divergence:** Give RGB channels independent seeded error paths and perturbations in Corrupted Dither. Monochrome and Color ramp share one brightness path.

#### Feedback Bloom / Melt

Accumulate expanding echoes or melting image feedback.

- **Style:** Bloom expands repeated echoes around a center. Melt drags them along a coherent flowing field.
- **Iterations:** Number of feedback passes. Each pass transforms the preceding result; more passes accumulate longer trails.
- **Displacement:** Travel per pass as a percentage of the shorter image side. Bloom swells outward; Melt flows along Direction.
- **Scale:** Scale of each feedback copy. Above 1 expands echoes; below 1 pulls them inward.
- **Rotation:** Rotate each feedback copy around the center, accumulating a spiral over successive passes.
- **Direction:** Direction of the melt flow. 90 degrees flows downward.
- **Persistence:** How much transformed feedback survives each pass. Lower values restore more of the incoming image.
- **Decay:** Fade feedback color and transparency each pass. The incoming image supplies fresh detail.
- **Refresh:** Fraction of seeded patches restored from the incoming image on each pass, interrupting the feedback trails.
- **Coherence:** Size of the flow and refresh patches relative to the shorter image side. Larger values produce broader motion.
- **Center X:** Horizontal center of the feedback scale and rotation.
- **Center Y:** Vertical center of the feedback scale and rotation.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Freeze / Dropout

Simulate stuck patches, duplicated blocks, missing regions and noisy decoder failures.

- **Style:** Choose retained earlier patches, randomly displaced copies, colored dropout regions, or seeded colored noise. Options: Freeze, Duplicate, Blank, Noise.
- **Patch size:** Square patch size as a percentage of the shorter original-image side.
- **Failure density:** Control how many patches fail. Zero preserves the input exactly; 100% selects every patch.
- **Clustering:** Group failure decisions into larger neighborhoods. Zero selects independently; 100% shares selection across three-by-three patch clusters.
- **Simulated steps:** Number of translation steps reached by the moving background in Freeze. This is a reproducible still-image simulation.
- **Hold age:** How many simulated steps selected patches lag behind, capped at Simulated steps. Zero catches all patches up.
- **Travel per step:** Translation per simulated step, as a percentage of the shorter image side. Duplicate uses Travel times Simulated steps for its offset distance.
- **Direction:** Direction of travel: 0 degrees moves right; 90 moves down.
- **Scatter:** Vary duplicated patch offsets around Direction by a seeded amount. Zero uses one uniform offset.
- **Grid position X:** Move the patch grid horizontally as a percentage of image width.
- **Grid position Y:** Move the patch grid vertically as a percentage of image height.
- **Dropout color:** Color or gradient filling Blank patches. Input transparency stays fixed unless Clear transparency is on.
- **Clear transparency:** Make Blank patches transparent instead of colored. Opacity and masks can soften the cutout.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Glow

Diffuse bright areas into a soft luminous halo.

- **Radius:** Spread selected highlights with a soft halo, as a percentage of the shorter original image side. 0% brightens selected pixels without spreading light. The halo remains inside existing transparency.
- **Glow strength:** Light added from blurred highlights. 0 removes the glow; larger values brighten the halo. Opacity mixes the complete result with the incoming image.
- **Threshold:** Incoming brightness above this level contributes light. Lower values include more of the image; higher values isolate the brightest highlights.
- **Highlight softness:** Soften the transition around Threshold. 0% gives a hard threshold; larger values gradually admit nearby highlight tones.
- **Halo color:** Choose a solid halo color or canvas gradient. Halo color mix controls whether the halo follows its original highlight colors or this selected color.
- **Halo color mix:** 0% retains the blurred highlights original colors. 100% recolors their brightness with Halo color. This colors only the added halo; the optional Tint below affects the complete processed image.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Glyph Renderer

Rebuild images with ASCII, text, pixel emoji, Braille or block glyphs.

- **Installed font selection:** Choose Installed Font to reveal local font family and style selectors for supported glyph styles. Saved projects and presets retain the generated font atlas.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Style:** Brightness-ranked ASCII, extended symbols and Unicode shapes; source-channel byte digits for Binary, Hexadecimal and Numbers; brightness-ranked terminal characters; custom ordered symbols or repeating text; original pixel emoji; Braille dots and block quadrants. Options: ASCII, Extended ASCII, Unicode, Emoji, Binary, Hexadecimal, Numbers, Terminal, Custom Glyph Set, Custom Text, Braille, Blocks.
- **Cell size:** Cell width in original-image pixels. Smaller cells retain finer detail; larger cells make the glyphs more visible. Preview and export use the same canvas grid.
- **Cell aspect:** Cell height divided by cell width. One makes square cells; larger values make taller cells. This changes the sampled image grid.
- **Glyph scale:** Size of the glyph within each cell. Lower values add space around characters; higher values fill more of the cell. Sampling remains based on the full cell.
- **Contrast:** Expand or compress visible brightness around the midpoint before selecting glyphs. One keeps the sampled brightness; zero maps visible tones to the midpoint.
- **Symbol density:** Multiply the adjusted brightness used to choose characters, dots and blocks. Lower values use fewer marks; higher values use denser marks. Zero leaves only Background.
- **Dot / block threshold:** Minimum adjusted brightness for each visible Braille dot or block quadrant. ASCII uses ranked character density instead. Invisible samples never create marks.
- **Invert:** Reverse visible brightness before density and threshold selection. Dark regions receive dense glyphs and light regions receive sparse glyphs; source colors and transparency stay unchanged.
- **Glyph colors:** Source image colors glyphs with the alpha-weighted cell color. Custom uses Foreground, including gradients. Background uses its own color or gradient in either mode.
- **Foreground:** Solid or gradient color for glyph marks in Custom mode. Source image mode uses sampled cell colors instead.
- **Background:** Solid or gradient color between glyph marks. Original alpha remains at its original pixels; this does not create opacity in transparent areas.
- **Font source:** Use the original bitmap characters or a locally installed typeface. Saved character images preserve the installed font appearance in projects and presets.
- **Custom glyph set:** Symbols ordered from least to most dense. Repeated characters add weight. Uses the selected font source; unsupported symbols become an outlined diamond.
- **Custom text:** Repeat this text in reading order across the cell grid. Spaces remain spaces; line breaks act as spaces. Uses the selected font source.
- **Glyph rotation:** Rotate each glyph about its own cell center, without rotating the grid or image.
- **Rotation jitter:** Seeded variation above and below Glyph rotation for each cell.
- **Position jitter:** Seeded offsets up to this fraction of a cell in each axis. Marks remain clipped to their original cell.
- **Missing glyphs:** Seeded probability that a cell contains only Background.
- **Duplicate glyphs:** Seeded probability of a second, offset copy inside the same cell.
- **Glyph glitches:** Seeded probability of replacing a glyph or flipping a Braille/block bit. Custom Text gets a corrupted symbol in that cell.
- **Emoji mapping:** Choose emoji by painted brightness, average native color, a combined match or a repeatable random selection. Options: Luminance, Color, Luminance + color, Seeded random.
- **Emoji palette:** Choose from the original GLEECH pixel-emoji atlas. This fixed set renders identically without installed emoji fonts. Options: All, Faces, Objects, Symbols, Nature, Geometric, Custom set.
- **Custom emoji set:** Enter characters from the built-in atlas. Unsupported emoji are ignored; an empty usable set falls back to All. Open Atlas to see available characters.
- **Emoji colors:** Native preserves original emoji colors; Source tint uses sampled cell RGB; Monochrome uses Foreground; Palette tint shades Foreground through native brightness. Options: Native, Source tint, Monochrome, Palette tint.
- **Emoji red offset:** Add or subtract red after the emoji color treatment, before color falloff and blending.
- **Emoji green offset:** Add or subtract green after the emoji color treatment, before color falloff and blending.
- **Emoji blue offset:** Add or subtract blue after the emoji color treatment, before color falloff and blending.
- **Size falloff:** Vary the drawn glyph size across the image. Sampling cells remain fixed.
- **Size direction:** Choose a left-to-right, top-to-bottom, circular or square transition. Invert reverses its progression. Options: Horizontal, Vertical, Radial, Square.
- **Size start position:** Position where the transition starts. The starting value holds before this position. Equal start/end positions make a hard edge.
- **Size end position:** Position where the transition finishes. The ending value holds after this position. Start may be above End to reverse the ramp.
- **Size center X:** Horizontal center of the radial or square falloff.
- **Size center Y:** Vertical center of the radial or square falloff.
- **Size invert:** Reverse the transition while keeping the same positions and center.
- **Starting size:** Starting size multiplied by Glyph scale. Zero hides the glyph; values above one enlarge it within the cell.
- **Ending size:** Ending size multiplied by Glyph scale. The grid and sampled source remain fixed.
- **Color falloff:** Vary glyph colors across the image, using sampled source colors or two chosen colors.
- **Color direction:** Choose a left-to-right, top-to-bottom, circular or square transition. Invert reverses its progression. Options: Horizontal, Vertical, Radial, Square.
- **Color start position:** Position where the transition starts. The starting value holds before this position. Equal start/end positions make a hard edge.
- **Color end position:** Position where the transition finishes. The ending value holds after this position. Start may be above End to reverse the ramp.
- **Color center X:** Horizontal center of the radial or square falloff.
- **Color center Y:** Vertical center of the radial or square falloff.
- **Color invert:** Reverse the transition while keeping the same positions and center.
- **Falloff colors:** Source image fades from Background to each cell’s sampled image color. Chosen colors interpolates Foreground and Ending color.
- **Starting color strength:** Starting strength of sampled source color against Background. Zero uses Background; one uses the full sampled color.
- **Ending color strength:** Ending strength of sampled source color against Background.
- **Ending color:** Ending color for Chosen colors falloff. Foreground supplies the starting color.

#### Gradient Map

Recolor shadows through highlights with a two-color ramp.

- **Shadows:** Color for the darkest incoming pixels. Midtones blend smoothly between Shadows and Highlights. Reverse exchanges the dark and bright ends.
- **Highlights:** Color for the brightest incoming pixels. Both colors follow incoming brightness rather than image position. Transparency stays unchanged.
- **Midpoint:** Incoming brightness mapped halfway between the two colors. Lower values favor Highlights; higher values favor Shadows. 50% gives a linear brightness ramp.
- **Reverse:** Swap the ramp direction: dark pixels use Highlights and bright pixels use Shadows. Your selected colors are retained.
- **Tonal ramp stops:** Map brightness through up to sixteen colors.

#### Granular Echo

Scatter powdery image fragments and directional ghost trails while retaining source colors.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Particle size:** Size of fragments in the original image.
- **Trail length:** Distance traveled by the directional ghost traces.
- **Trail layers:** Number of overlapping image echoes.
- **Breakup:** Seeded gaps and powdery fragmentation in the traces.
- **Trail direction:** Direction followed by fragments when no shared direction field is selected.
- **Particle threshold:** Minimum source brightness represented by particle trails.
- **Monochrome:** Keep the source colors or render a monochrome powder treatment.
- **Particle coloring:** Use source colors or the chosen color/gradient for particle trails.
- **Particle color:** Color or gradient of chosen particle trails.
- **Phase:** Choose a frozen stage of the granular drift.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Halation

Spread a colored photographic halo from bright regions into darker surroundings.

- **Halo strength:** Intensity of colored highlight spill. Zero preserves the source exactly.
- **Halo radius:** Spread radius as a percentage of the shorter image side. Larger values create broader soft halos.
- **Highlight threshold:** Brightness above which visible image pixels generate halo energy.
- **Highlight softness:** Soften the transition into highlight selection. Zero uses a hard threshold.
- **Dark-side bias:** Suppress halos in bright centers and favor their darker surroundings. Zero allows spill across all tones.
- **Halo color:** Color or multi-stop gradient of the halo. The default creates warm red-orange film-like spill.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Halftone

Turn image tones into ink dots or lines.

- **Style:** Dots creates a regular grid of round ink dots. Lines creates parallel ink bands that widen in darker parts of the image.
- **Size:** Scale the ink dot radius or line width independently of spacing. 0% shows only the background color; 100% uses the tonal size; higher values create denser, overlapping marks.
- **Spacing:** Distance between dot centers or line centers, as a percentage of the shorter original image side. Higher values make a coarser print. Preview and export keep the same proportions.
- **Rotation:** Rotate the dot grid or parallel lines. 0° gives an upright dot grid and vertical ink lines; 90° turns lines horizontal.
- **Contrast:** Expand tonal differences around middle gray before sizing the ink marks. 1× uses the incoming tones; higher values create stronger light/dark separation; 0× makes a uniform middle-gray pattern.
- **Ink color:** Choose the color of the halftone dots or lines. Swap ink and paper colors to invert the print treatment.
- **Paper color:** Choose the color between the ink marks. This colors the existing image area and preserves its transparency.

#### Hue / Saturation

Shift colors, saturation and lightness.

- **Hue:** Rotate colors around the color wheel. 120° moves red to green, green to blue, and blue to red. Gray pixels remain gray.
- **Saturation:** Adjust HSL saturation. Negative values reduce color toward gray; positive values strengthen existing colors toward full saturation. Gray pixels stay gray. 0% preserves saturation.
- **Lightness:** Move HSL lightness toward black (negative) or white (positive). -100% makes black; +100% makes white. 0% preserves lightness. Transparency stays unchanged.

#### Indexed Palette

Limit colors to a palette, then scramble or drift their assignments.

- **Palette:** Choose stage-source colors or a fixed palette. Hardware-inspired sets are artistic palettes, not strict display emulation. Custom ramp uses the editable color bar. Options: Source sampled, RGB332, Grayscale, CGA-like, EGA-like, VGA-like, Game Boy-like, Monochrome, Custom ramp.
- **Color count:** Maximum total palette entries, from 2 to 256. Source sampling can return fewer colors for simple images. Fixed small palettes keep their native maximum; they never invent extra colors.
- **Palette start:** Dark end of the custom palette ramp. Add or edit colors in the palette bar.
- **Palette end:** Light end of the custom palette ramp. Color count samples discrete entries along this ramp.
- **Dithering:** Hard nearest-color mapping, or Bayer, error diffusion, blue noise or seeded random mapping into the same palette. Options: None, Ordered / Bayer, Floyd–Steinberg, Blue Noise, Random.
- **Dither strength:** Scale threshold noise or quantization-error diffusion. Zero uses hard nearest-color mapping; 100% uses the selected algorithm at full strength.
- **Cell size:** Size of each processed cell in original-image pixels. Larger cells average visible color into coarse tiles. Transparency remains at its original pixels.
- **Color swaps:** Shuffle this seeded fraction of palette entries after nearest-color matching. Zero preserves ordinary assignments. New pattern chooses another permutation.
- **Hue damage:** Apply seeded hue rotations to individual palette entries. Higher values allow greater color-wheel changes; zero preserves palette hues.
- **Saturation damage:** Apply seeded saturation changes to palette entries, from faded toward vivid colors. Zero preserves the palette. Gray entries remain gray.
- **Palette drift:** Shift color assignments by seeded offsets in spatial patches. Higher values allow greater palette-index shifts. The original palette still supplies the colors.
- **Drift size:** Width of palette-drift patches as a percentage of the shorter original image side.

#### JPEG Recompression

Repeated real JPEG compression creates block damage, ringing and color bleed.

- **Quality:** JPEG quality of the first generation. Lower values produce stronger block and ringing damage; 100 is still lossy.
- **Generations:** Number of sequential JPEG encode/decode passes. Each pass starts from the preceding decoded image. More generations take longer and may converge when quality loss is zero.
- **Quality loss per generation:** Subtract this many quality points for each later generation, down to a minimum quality of 1. Zero recompresses at the same quality.
- **Chroma subsampling:** 4:2:0 encodes color at reduced resolution, creating more bleed around colored edges. 4:4:4 retains full color sampling while still compressing each channel.

#### Kaleidoscope

Repeat reflected image sectors around a center.

- **Segments:** Number of repeated sectors around the center. Each sector contains two mirrored halves. Higher values create finer radial symmetry.
- **Rotation:** Rotate the source wedge and the resulting symmetry together around the chosen center.
- **Center X:** Horizontal center of the kaleidoscope, as a percentage of original image width. 50% is the middle.
- **Center Y:** Vertical center of the kaleidoscope, as a percentage of original image height. 50% is the middle.
- **Zoom:** Enlarge the source wedge content. 1× keeps its original scale; values above 1× zoom in, and values below 1× reveal more of the image. Edge Handling controls sampling beyond its boundary.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Output alignment:** Align the finished object using its transparency, or the detected subject for ordinary photos. Center, edge and corner presets move its visible bounds without changing the reflection axis or sampled source wedge. None keeps its rendered position. Offsets apply afterward; newly uncovered areas are transparent. Options: None, Center, Top, Bottom, Left, Right, Top left, Top right, Bottom left, Bottom right.
- **Output offset X:** Move the finished result horizontally after alignment, as a percentage of image width. Negative moves left; positive moves right. This does not change the reflection pattern.
- **Output offset Y:** Move the finished result vertically after alignment, as a percentage of image height. Negative moves up; positive moves down. This does not change the reflection pattern.

#### LED Matrix

Render image colors as glowing light cells with adjustable shapes and signal failures.

- **Cell size:** Spacing of LED cells relative to the shorter original image side.
- **Emitter shape:** Choose round emitters, square pixels or hollow rings. Options: Circle, Square, Ring.
- **Cell gap:** Dark space between neighboring emitters.
- **Brightness:** Brightness gain of the sampled LED colors.
- **Glow:** Spread soft light into the spaces around each emitter.
- **Dead cells:** Fraction of cells removed by the saved failure pattern.
- **Grid rotation:** Rotate the display grid without rotating the source image.
- **Phase:** Select a frozen offset and flicker state of the grid. 0% and 100% match.
- **LED colors:** Use sampled image colors, or apply a chosen color/gradient with image brightness.
- **LED color:** Emitter color when LED colors uses Chosen color.
- **Display background:** Color or gradient between light cells.
- **Brightness source:** Drive light cells with source brightness or a frozen procedural signal field.
- **Pattern frequency:** Number of broad signal bands across the canvas.

#### Lens Distortion

Smooth barrel or pincushion distortion with an adjustable optical center and edge handling.

- **Barrel / Pincushion:** Positive values produce barrel distortion; negative values produce pincushion distortion. Zero is neutral when the secondary term is also zero.
- **Outer curvature:** Additional curvature that increases toward the perimeter.
- **Optical center X:** Horizontal optical center.
- **Optical center Y:** Vertical optical center.
- **Zoom:** Magnify the result to crop transparent lens margins or reveal more of the image.
- **Edges:** Choose transparent clipping, extended edge pixels, tiled wrapping or mirrored pixels. Options: Transparent, Extend, Tile / Wrap, Mirror.

#### Levels / Curves

Shape contrast and color with levels or an editable tonal curve.

- **Curve editor:** In Curves mode, select the channel, move curve points and choose interpolation to remap input brightness to output brightness.

- **Mode:** Levels remaps the input range, gamma and output range. Curves uses five adjustable tonal points. Each mode retains its settings when switching.
- **Channel:** Apply this tonal adjustment to all RGB channels or just one. Other channels and alpha stay unchanged before blending and tint. Use additional instances for independent channel adjustments. Options: RGB (all), Red, Green, Blue.
- **Input black:** Incoming values at or below this level map to Output black. Increasing it deepens shadows. It must stay below Input white.
- **Input white:** Incoming values at or above this level map to Output white. Decreasing it brightens highlights. It must stay above Input black.
- **Gamma:** Adjust midtones between the input endpoints. Above 1 brightens; below 1 darkens; 1 preserves the normalized midtones.
- **Output black:** Set the darkest output level. Raise it for faded shadows. Crossing Output white reverses the tonal range.
- **Output white:** Set the brightest output level. Lower it to soften highlights. Crossing Output black reverses the tonal range.
- **Curve interpolation:** Smooth joins the five points with a shape-preserving curve; Linear joins them with straight segments. Drag points vertically or use their sliders. Crossing point heights can solarize colors.
- **Curve shadows:** Output brightness at 0% incoming brightness. Adjust this slider or drag the corresponding graph point vertically. 0% is black; 100% is white.
- **Curve dark tones:** Output brightness at 25% incoming brightness. Adjust this slider or drag the corresponding graph point vertically. 0% is black; 100% is white.
- **Curve midtones:** Output brightness at 50% incoming brightness. Adjust this slider or drag the corresponding graph point vertically. 0% is black; 100% is white.
- **Curve light tones:** Output brightness at 75% incoming brightness. Adjust this slider or drag the corresponding graph point vertically. 0% is black; 100% is white.
- **Curve highlights:** Output brightness at 100% incoming brightness. Adjust this slider or drag the corresponding graph point vertically. 0% is black; 100% is white.

#### Mandelbrot

Weave images through Mandelbrot and Julia fractals.

- **Fractal Explorer:** Pan and zoom around the set to adjust its real and imaginary center coordinates and magnification. The center coordinates listed below belong to this explorer.

- **Operation:** Image Weave repeats and transforms image pieces through the fractal orbit. Color Texture paints escape-time bands. Distort displaces pixels. Keep set and Cut out mask the bounded region. Options: Image Weave, Color Texture, Distort, Keep set, Cut out.
- **Fractal set:** Mandelbrot varies the formula parameter across the image; Julia uses a fixed parameter and varies the starting point.
- **Julia real:** Real part of Julia’s formula parameter. Small changes reshape the fractal; this is separate from its view center.
- **Julia imaginary:** Imaginary part of Julia’s formula parameter. Use Explore for curated starting shapes and precise values.
- **Real center:** Real coordinate at the center of the fractal viewport. Move horizontally through the complex plane; this does not move the source image.
- **Imaginary center:** Imaginary coordinate at the center of the fractal viewport. Move vertically through the complex plane.
- **Fractal zoom:** Zoom the complex-plane viewport around Real/Imaginary center. 1× shows 3.4 complex units across the shorter image side. Higher values reveal boundary detail.
- **Rotation:** Rotate the complex-plane viewport around its center without changing source-image orientation.
- **Iterations:** Maximum z² + c steps before treating a point as inside. Higher values resolve more boundary detail but take longer. Classification is a finite approximation.
- **Palette cycles:** Number of color oscillations over the escape-time range in Texture mode. Higher values produce more contrasting fractal bands.
- **Palette offset:** Shift the texture palette through one complete color cycle. This changes colors without moving the fractal geometry.
- **Outside color:** One end of the exterior escape-time palette in Texture mode.
- **Inside color:** Color of the bounded region, and the other end of the exterior palette in Texture mode.
- **Distortion:** Maximum source displacement in Distort mode, as a percentage of the shorter original image side. The bounded complex orbit determines the direction; zero leaves source pixels unchanged.
- **Image scale:** Scale image pieces inside Image Weave without changing the fractal view. Larger values enlarge recognizable pieces.
- **Image rotation:** Rotate sampled image pieces independently of fractal view rotation in Image Weave.
- **Mirror pieces:** Alternate reflected image pieces according to the chosen orbit step in Image Weave.
- **Abstraction:** Move source coordinates from the incoming image toward repeated orbit-mapped pieces. 0% preserves the image; 100% fully follows the fractal.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Micro Collage

Rebuild the source from small image fragments, optionally sampled from a reference image.

- **Optional reference image:** Sample collage pieces from another image; without one, pieces sample the current image.

- **Fragment size:** Size of mosaic fragments relative to the shorter original image side.
- **Fragment spacing:** Gap around each fragment as a fraction of its size.
- **Fragment travel:** Seeded distance between a fragment and its sampled source position.
- **Fragment zoom:** Magnify the image content inside each fragment.
- **Random rotation:** Maximum seeded rotation of sampled content inside each fragment.
- **Source visibility:** Blend the original image with the fragment collage to retain recognizable content.
- **Phase:** Select a frozen moment of fragment sampling. 0% and 100% match.
- **Gap color:** Color exposed between fragments.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Mirroring

Reflect image regions across an adjustable axis.

- **Axis:** Vertical reflects left/right; Horizontal reflects top/bottom; Angled enables Rotation for a diagonal reflection axis. Options: Vertical, Horizontal, Angled.
- **Source side:** Keep the selected half and reflect it into the opposite half. Left / Top keeps the left half for a vertical axis or the top half for a horizontal axis. For an angled axis these choices select opposite sides of the line.
- **Position X:** Place the reflection axis horizontally as a percentage of image width. 50% centers it. Horizontal axes use Position Y instead.
- **Position Y:** Place the reflection axis vertically as a percentage of image height. 50% centers it. Vertical axes use Position X instead.
- **Rotation:** Rotate an angled reflection axis: 0° is vertical, 90° is horizontal. Axis must be Angled to enable this control.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Output alignment:** Align the finished object using its transparency, or the detected subject for ordinary photos. Center, edge and corner presets move its visible bounds without changing the reflection axis or sampled source wedge. None keeps its rendered position. Offsets apply afterward; newly uncovered areas are transparent. Options: None, Center, Top, Bottom, Left, Right, Top left, Top right, Bottom left, Bottom right.
- **Output offset X:** Move the finished result horizontally after alignment, as a percentage of image width. Negative moves left; positive moves right. This does not change the reflection pattern.
- **Output offset Y:** Move the finished result vertically after alignment, as a percentage of image height. Negative moves up; positive moves down. This does not change the reflection pattern.

#### Motion Mosh

Drag frozen blocks into persistent directional trails.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Block size:** Size of each block as a percentage of the shorter image side. Larger values create chunkier blocks. Export keeps the same proportions.
- **Coherence:** Higher coherence follows the selected direction or shared field. Lower values add seeded angular disorder per block. 100% with Native retains the original motion.
- **Density:** Fraction of source blocks selected for motion. New pattern changes the selection; 0% leaves the image unchanged, and 100% moves all blocks.
- **Direction:** Direction the blocks travel: 0° moves right, 90° moves down, 180° moves left, and 270° moves up.
- **Travel:** Distance the selected blocks move, as a percentage of the shorter original image side. Zero travel preserves the input.
- **Trail length:** How much of the travel path retains earlier block positions. 0% shows only the final displaced blocks; 100% reaches back to their original positions.
- **Persistence:** Visibility of earlier trail positions. 0% shows only the latest position; 100% holds earlier positions at full strength.
- **Trail samples:** Number of retained positions along each trail. More positions make denser smears and take longer to render; one shows just the final position.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Motion Transfer

Displace the image using an explicitly imported vector or grayscale map. No video or motion extraction is required.

- **Map image:** Import a vector/grayscale displacement image or choose a starter vector map. The map is embedded in saved projects and presets.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Map encoding:** Red / Green uses R for horizontal and G for vertical displacement, with 128 exactly neutral. Grayscale direction uses brightness about mid-gray; Slopes uses changes in brightness. Options: Red / Green vectors, Grayscale direction, Grayscale slopes.
- **Travel:** Maximum displacement as a percentage of the shorter image side. Transparent map pixels are neutral.
- **Direction:** Travel direction for Grayscale direction maps.
- **Map scale:** Scale the map about its position. 100% maps the full input across the image.
- **Map position X:** Horizontal map position in the stage canvas.
- **Map position Y:** Vertical map position in the stage canvas.
- **Map rotation:** Rotate map coordinates around its position; vector directions follow the same rotation.
- **Invert horizontal:** Reverse horizontal displacement.
- **Invert vertical:** Reverse vertical displacement.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Neon Print

Print the source with coarse stippling, dark outlines and a limited neon ink palette.

- **Print size:** Size of the coarse print cells relative to the shorter original image side.
- **Stippling:** Seeded ink and paper variation within the limited palette.
- **Print contrast:** Contrast applied before selecting the nearest ink color.
- **Outlines:** Strength of dark image-derived contour lines.
- **Outline width:** Distance used to detect image contours, relative to the shorter canvas side.
- **Ink 1:** First print ink; cyan by default.
- **Ink 2:** Second print ink; magenta by default.
- **Ink 3:** Third print ink; yellow by default.
- **Paper color:** Lightest color of the print and paper speckles.
- **Dark ink:** Darkest print color and image contours.

#### Noise / Grain

Add photographic grain or layered procedural noise.

- **Style:** Choose independent grain, photographic grain or a smooth procedural field. Each style retains its controls. Options: White Noise, Gaussian, Speckle, Film Grain, Perlin, Simplex, Voronoi / Worley, Value, Salt-and-pepper, Scan Noise.
- **Intensity:** Strength of the noise brightness or selected noise colors.
- **Grain size:** Grain cell size as a percentage of the shorter original image side.
- **Scale:** Size of procedural noise cells relative to the shorter original image side.
- **Detail / Octaves:** Number of layered frequencies; more layers add finer structure.
- **Roughness:** How much finer layers contribute to the procedural field.
- **Variant:** Layer signed noise, fold it into turbulence or form ridged bands. Options: Fractal (fBm), Turbulence, Ridged.
- **Density:** Fraction of grain cells affected by speckles or salt-and-pepper impulses.
- **Clumping:** Mix small grain with a broader uneven film texture.
- **Tonal response:** Concentrate photographic grain in midtones and reduce it in deep shadows and highlights.
- **Cell pattern:** Use seeded cell colors, nearest feature-point distance or boundaries between neighboring cells. Options: Filled Cells, Distance, Cell Borders.
- **Noise colors:** Use grayscale grain, independent RGB noise, or an editable solid/two-color noise ramp. Options: Monochrome, Color, Selected color / ramp.
- **Noise color:** Choose a solid noise color or two-color ramp sampled by the noise value.
- **Salt / Pepper balance:** Chance of a white impulse instead of black. 0% uses only pepper; 100% uses only salt. Selected color ramps replace these two endpoints.
- **Scan direction:** Correlate noise along rows, columns or their intersections. Options: Horizontal, Vertical, Crossed.
- **Scan spacing:** Distance between noise bands as a percentage of the shorter original image side.
- **Band width:** Thickness of each noisy band. Widths at least as large as Scan spacing fill the gaps.
- **Irregularity:** Mix coherent line noise with local signal breakup. Zero keeps each row or column uniform.

#### Photo Adjustments

Adjust exposure, tonal contrast, highlights, shadows, vibrance and white balance.

- **Exposure:** Exposure in stops: +1 doubles linear-light intensity; -1 halves it.
- **Contrast:** Increase or reduce contrast around mid-gray. Zero keeps contrast unchanged.
- **Highlights:** Lift or lower bright tones with a smooth luminance-weighted adjustment.
- **Shadows:** Lift or deepen dark tones with a smooth luminance-weighted adjustment.
- **Vibrance:** Boost muted colors more than already saturated colors; negative values reduce saturation. Grays remain gray.
- **Temperature:** Shift white balance toward cool blue or warm amber using relative linear-light channel gains.

#### Pigment Drag

Smear source pigment into scraped brush tracks, fine grain and gravity-aligned runs.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Brush size:** Width of individual dragged pigment tracks.
- **Drag length:** Maximum sampling travel in the original image.
- **Drag direction:** Direction of the smear when no shared direction field is selected.
- **Scraping:** Break drag strokes into scraped edges and exposed source patches.
- **Pigment grain:** Amount of seeded particulate variation in the dragged color.
- **Source retention:** Blend the dragged result back toward the original image.
- **Drips:** Add downward pigment runs independently of the main drag direction.
- **Chosen pigment:** Mix source pigment with the chosen color or gradient.
- **Pigment color:** Optional color or multi-stop gradient applied to the pigment.
- **Phase:** Choose a frozen state of the dragged brush tracks.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Pixel Dissolve

Break source-colored pixels into scattered blocks and selectively dissolve them.

- **Block size:** Size of each block relative to the shorter original image side.
- **Dissolve:** Fraction of seeded blocks removed from the image. Zero keeps all blocks; 100% removes all.
- **Breakup:** Fraction of remaining blocks with displaced source content.
- **Scatter:** Maximum travel of displaced blocks relative to the shorter canvas side.
- **Direction:** Rotate the dominant direction of block scatter.
- **Dissolve softness:** Smooth the opacity threshold between surviving and dissolved blocks. Zero produces a hard breakup.
- **Phase:** Select a frozen moment of block travel and dissolve. 0% and 100% match.
- **Dissolve bias:** Favor dark or bright image blocks when dissolving, or use a uniform seeded threshold. Options: Uniform, Dark first, Bright first.
- **Dissolved pixels:** Expose transparency or fill removed blocks with the chosen background color.
- **Background color:** Fill color when Dissolved pixels is set to Background color.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Pixel Sorting

Reorder selected pixel stretches into tonal or colored streaks.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Sort by:** Use the selected measure for both threshold selection and ordering. Brightness follows image tones; Hue follows the color wheel; Saturation orders muted to vivid colors. Options: Brightness, Hue, Saturation.
- **Threshold start:** Start of the selected range. Brightness and saturation use 0-100%. Hue runs around the color wheel: red at 0%, green near 33%, blue near 67%. A hue start above the end selects across the red seam. Other criteria accept either endpoint order.
- **Threshold end:** End of the selected range. Pixels outside the range remain unchanged and split sort runs. Swapping hue endpoints can select across the red seam; brightness and saturation use the interval between the endpoints.
- **Direction:** Direction in original-image coordinates: 0 degrees runs left to right, 90 top to bottom, 180 right to left and 270 bottom to top. Intermediate angles follow discrete pixel lines without resampling the image.
- **Streak length:** Maximum length of a sorted stretch as a percentage of the original canvas span along Direction. 100% allows whole selected runs; lower values split them into shorter streaks. Zero restores the incoming image.
- **Order:** Ascending orders dark-to-light, early-to-late hue or muted-to-vivid saturation along Direction. Descending reverses the ordering. Equal values retain their original relative order.
- **Density:** Fraction of seeded stretches that are sorted. Zero restores the incoming image; 100% sorts every eligible stretch. New pattern changes the chosen stretches.
- **Boundary breaks:** Add seeded breaks to otherwise continuous selected runs. Higher values fragment the streaks; zero keeps only threshold, transparency and length boundaries. New pattern changes the broken boundaries.

#### Pixel Stretch

Pull selected image strips into patchwork, long bands or radial edge trails.

- **Style:** Choose scattered stretch patches, long directional bands or outward trails. Options: Patchwork, Bands, Radial edge flow.
- **Axis:** Direction of bands and patchwork stretches.
- **Stretch length:** Reach of the stretched strips relative to the shorter original image side. Zero leaves the image unchanged.
- **Strip width:** Width of individual source strips or radial sectors.
- **Stretch density:** Seeded fraction of strips that are stretched.
- **Origin X:** Horizontal anchor position for bands and radial trails.
- **Origin Y:** Vertical anchor position for bands and radial trails.
- **Brightness threshold:** Only stretch anchors at or above this source brightness. Zero includes all anchors.
- **Trail softness:** Feather streaks into the incoming image. Zero creates clipped patches.
- **Phase:** Select a frozen drift of the stretch pattern. 0% and 100% match.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Edge bias:** Favor high-contrast source edges over flat regions.
- **Protected center:** Keep a circular region around the stretch origin unchanged.

#### Recursive Space

Repeat image pieces into receding tunnels, spirals and lattices.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Style:** Tunnel repeats full image pieces on four corridor walls. Spiral repeats radial panels around the vanishing point. Mirrored Lattice tiles receding planes. Options: Tunnel, Spiral, Mirrored Lattice.
- **Depth:** Number of nested repetitions toward the vanishing point. This creates a finite illusion of depth without estimating a photo depth map.
- **Repetition scale:** Size of each nested repetition relative to the previous one. Lower values leave broader panels; higher values create tightly packed repetitions.
- **Perspective:** Bias the spacing of nested repetitions toward the vanishing point. Higher values make the depth progression more compressed toward the center.
- **Vanishing point X:** Horizontal vanishing-point position as a percentage of the original image width.
- **Vanishing point Y:** Vertical vanishing-point position as a percentage of the original image height.
- **Rotation:** Rotate the entire recursive layout around its vanishing point.
- **Twist:** Rotate successive radial panels or lattice planes as they recede. Tunnel keeps straight walls and disables Twist.
- **Repeats:** Radial panels per turn in Spiral, or tiles across a plane in Mirrored Lattice. Tunnel has four fixed walls.
- **Image scale:** Zoom the source image inside each repeated panel without changing the layout. Edge Handling controls pixels outside the source.
- **Mirror copies:** Reflect alternating wall/radial panels and lattice tiles. Off repeats each image with the same orientation.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Depth field:** Use a static stage-source height field to vary this recursive layout. Off preserves the ordinary layout.
- **Field repetition:** Vary local repetition spacing around its ordinary value. Positive packs repetitions more closely in white/high areas; negative reverses it.
- **Field image scale:** Vary source-image scale with field height. Positive enlarges image pieces in white/high areas; negative reverses it.
- **Field distortion:** Displace recursive-layout coordinates horizontally and vertically according to height relative to mid-gray, as a percentage of the shorter image side.

#### Reference / Cross-image Mosh

Break a still-image transition using an embedded reference image or frozen saved stage.

- **Reference image:** Choose another image or copy a saved stage. Placement and Reference X/Y position that input before the selected mosh treatment.

- **Style:** Replace seeded patches, softly transition between inputs or drag reference patches through the current image. Options: Retained patches, Broken dissolve, Dragged patches.
- **Progression:** Scrub selected patches from the incoming image at 0% to the reference at 100%. Unselected patches remain unchanged; Replacement density at 100% allows a full transition. Patch identities stay stable while scrubbing.
- **Persistence:** Delay replacement of strongly retained patches until later in the transition.
- **Replacement density:** Fraction of patches allowed to change. Progression advances only those patches; at 100% progression, unselected patches still retain the incoming image. New pattern changes the selection.
- **Patch size:** Size of retained patches relative to the shorter original-image side.
- **Drag distance:** Travel of reference patches during the transition; the final reference returns to its original position.
- **Direction:** Direction of dragged reference patches.
- **Reference placement:** Fit preserves the whole reference with transparent margins; Fill crops while preserving aspect; Stretch fills the canvas. Options: Fit, Fill, Stretch.
- **Reference position X:** Move the reference image horizontally as a percentage of the canvas width. Zero centers it; positive values move it right.
- **Reference position Y:** Move the reference image vertically as a percentage of the canvas height. Zero centers it; positive values move it down.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### RGB split

Separate red and blue channels.

- **Horizontal shift:** Shift red and blue in opposite horizontal directions, as a percentage of image width. Negative values reverse the direction. Green and transparency stay in place.
- **Vertical shift:** Shift red and blue in opposite vertical directions, as a percentage of image height. Negative values reverse the direction. Green and transparency stay in place.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Scanlines

Add TV raster lines and monitor phosphor patterns.

- **Style:** Monitor creates crisp raster bands; TV uses rounded dark bands; Interlaced darkens alternating raster intervals; Phosphor grille creates vertical RGB stripes. Options: Monitor, TV, Interlaced, Phosphor grille.
- **Line color:** Choose the color of the scanlines and their halo. Black darkens in Normal or Multiply; white brightens in Normal, Screen, or Add. Grille uses the color with its separate RGB stripe masks. Click the swatch to open the color picker.
- **Invert lines:** Invert the selected line color: black becomes white, white becomes black, and custom colors become their complementary colors. This leaves the line placement unchanged.
- **Frequency:** Number of raster intervals across a distance equal to the shorter original image side. Higher values make finer lines. Interlaced darkens every other interval; Phosphor grille counts complete RGB stripe groups. Fine patterns are averaged when smaller than a preview or export pixel.
- **Thickness:** Width of each dark band as a percentage of its raster interval. For Phosphor grille, this sets the dark gap between colored stripes. 0% removes the gaps; 100% fills them.
- **Intensity:** How strongly the pattern darkens the image or separates its RGB colors. 0% leaves the incoming pixels unchanged; 100% applies the deepest bands or strongest color separation. Transparency stays unchanged.
- **Rotation:** Rotate the pattern from its native orientation. At 0°, Monitor, TV, and Interlaced run horizontally; Phosphor grille runs vertically. 90° turns the pattern a quarter turn.
- **Offset:** Slide the pattern through one complete repeating cycle. 0% and 100% align identically. Interlaced repeats over two raster intervals; a grille cycle includes all three RGB stripes.
- **Field:** Choose which alternating raster field is darkened in Interlaced style. Even darkens the first interval of each pair; Odd darkens the second. This is a still-image treatment, with no animated field switching.
- **Glow:** Spread a soft halo around the lines using their color and blend mode. White or bright colors create glow; black creates a soft shadow. 0% keeps the original crisp pattern. The halo stays within existing transparency.
- **Glow size:** Radius of the line halo as a percentage of the shorter original image side. Larger values spread it across more neighboring bands. Glow must be above 0% to enable this control.
- **Signal error:** Simulate still-image signal failures: Line Jitter shifts individual raster intervals; Sync Loss jumps groups and their vertical alignment; Rolling Tear displaces one seeded tear band; Dropout removes selected bands. New pattern changes the failure layout. Options: None, Line Jitter, Sync Loss, Rolling Tear, Dropout.
- **Error strength:** Strength of the selected signal failure. Increase travel for Jitter/Sync Loss, the width and travel of a tear band, or the fraction of dropped bands. 0% restores a stable raster. Displaced content carries its transparency.
- **Error position X:** Move the signal failure right (positive) or left (negative), as a percentage of image width. This moves only the failure field, leaving raster Offset unchanged. Full-width horizontal bands have no horizontal position; rotate the lines to enable this axis.
- **Error position Y:** Move the signal failure down (positive) or up (negative), as a percentage of image height. This moves only the failure field, leaving raster Offset unchanged. Full-height vertical bands have no vertical position; rotate the lines to enable this axis.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Shapes

Mask, cut, warp, or color single and tiled geometric regions.

- **Layout:** Single retains the original one-shape workflow. Tiled repeats shapes across the image, with Size relative to tile spacing.
- **Tile pattern:** Grid uses aligned rows; Staggered offsets alternating rows; Radial distributes shapes across concentric rings. Options: Grid, Staggered, Radial.
- **Spacing:** Distance between grid centers or radial rings, as a percentage of the shorter original image side. Size controls each shape as a fraction of this spacing.
- **Layout rotation:** Rotate tile positions around Position X/Y without changing individual shape rotation.
- **Radial repeats:** Shapes on the first radial ring. Each successive ring has this many additional shapes, keeping outer rings populated.
- **Shape:** Choose the primitive used by the operation. Ring thickness controls the hole in a ring. Options: Triangle, Square, Circle, Ring, Polygon.
- **Operation:** Keep inside retains the primitive and makes its surroundings transparent. Cut out removes it. Distort zooms and twists the pixels inside it. Overlay colors the region without adding opacity outside the image. Options: Keep inside, Cut out, Distort, Overlay.
- **Size:** Single: size as a percentage of the shorter image side. Tiled: size as a percentage of tile spacing. Scale multiplies the base size independently of spacing.
- **Scale:** Multiply the primitive size without changing its saved base Size. 1× keeps the base size.
- **Rotation:** Rotate the primitive around its position. Circles and rings have rotational symmetry; triangle and square visibly rotate.
- **Rotation style:** Uniform uses Rotation everywhere. Linear progresses toward End rotation. Graduated eases that progression. Random uses stable seeded angles between the two values. Options: Uniform, Linear, Graduated, Random.
- **End rotation:** Final angle for Linear/Graduated rotation, or the second bound for seeded Random rotation. Rotation supplies the starting angle.
- **Start sides:** Polygon side count for Single/Uniform, or the starting side count for tiled progression. Counts are always discrete integers.
- **End sides:** Final polygon side count, or the second bound for Random side counts. For example, Start sides 10 and End sides 3 progresses from decagons to triangles.
- **Polygon style:** Uniform keeps Start sides. Linear or Graduated changes discrete side counts across the field; Random selects an integer between Start sides and End sides for each tile. Options: Uniform, Linear, Graduated, Random.
- **Position X:** Horizontal center of the single shape or tile layout, as a percentage of image width. 50% centers it.
- **Position Y:** Vertical center of the single shape or tile layout, as a percentage of image height. 50% centers it.
- **Progression field:** Shared spatial progression for rotation and polygon sides. Linear directions cross the image; Radial expands in circles; Square expands in square bands. Options: Left to right, Right to left, Top to bottom, Bottom to top, Radial, Square.
- **Progression center X:** Move the horizontal midpoint/origin of the progression field independently of the tile layout.
- **Progression center Y:** Move the vertical midpoint/origin of the progression field independently of the tile layout.
- **Progression range:** Width/height of a directional progression as a percentage of that image axis. Radial/Square use half this percentage of the shorter side as their endpoint radius. Smaller ranges reach the final values sooner.
- **Ring thickness:** Ring wall thickness as a fraction of its outer radius. 100% fills the hole and produces a disk. Used only by Ring.
- **Edge softness:** Feather edges as a percentage of the shorter image side in Single, or tile spacing in Tiled. 0% keeps a crisp antialiased edge; higher values create a gradual falloff.
- **Content scale:** Zoom the image contents within the primitive in Distort mode. This changes sampled content, independently of the primitive Size and Scale.
- **Twist:** Twist the image contents around the primitive center in Distort mode. Rotation still controls the shape boundary.
- **Shape color:** Color painted within the primitive in Overlay mode. Blend mode and Opacity control its combination with the input.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Signal Tearing

Displace the image in angled slices, clustered bursts or stair steps.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Style:** Separate strips, groups of strips moving together, or a repeating stepped displacement. Options: Slices, Bursts, Stair steps.
- **Displacement:** Maximum travel as a percentage of the shorter original-image side.
- **Slice size:** Width of a strip as a percentage of the shorter image side. Bursts group several strips.
- **Density:** Fraction of slices or bursts that move. Zero keeps the original image.
- **Slice angle:** Zero creates horizontal strips, 90 creates vertical strips, and intermediate angles create diagonal strips.
- **Direction:** Direction of pixel travel, independent of Slice angle. Zero moves horizontally and 90 vertically.
- **Frequency:** Number of displacement-wave cycles across the shorter image side. Stair steps use a sawtooth wave.
- **Randomness:** Mix seeded random travel with the repeating displacement wave. Density remains seeded at zero randomness.
- **Burst length:** Number of adjacent slices sharing one displacement and activation in Bursts mode.
- **Slice softness:** Ease displacement back to zero near slice or burst edges. Zero makes a hard tear; higher values make a softer transition.
- **Position X:** Horizontal anchor of the angled slice layout.
- **Position Y:** Vertical anchor of the slice layout.
- **Height steering:** Use a procedural, source-brightness or imported depth field to steer native pixel travel. A shared Direction field at 100% influence overrides height steering.
- **Height steering influence:** Rotate travel direction with field height. Mid-gray keeps Direction; at full influence black and white span a full turn.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Signal Weave

Weave vertical raster threads through horizontal spectral bands and signal dropouts.

- **Raster spacing:** Distance between vertical threads, relative to the shorter original image side.
- **Raster width:** Fraction of each raster period occupied by a visible thread.
- **Color bands:** Number of horizontal spectral color bands across the image.
- **Band color:** Mix spectral colors into the sampled source. Zero preserves source colors.
- **Dropouts:** Seeded probability of missing signal segments within the raster.
- **Signal displacement:** Horizontal displacement of source content within individual signal bands.
- **Phase:** Select a frozen moment of spectral color and raster displacement. 0% and 100% match.
- **Background color:** Color between raster threads and inside signal dropouts.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Solid

Layer a color, gradient, stage source or another image over the stack.

- **New Image input:** Choose an image when Content is New Image; Source Image uses the current stage input, including a baked source.

- **Content:** Color and Gradient create a full-canvas layer. Source Image uses this stage’s input, including a baked source. New Image embeds a separately chosen image in your projects and presets. Options: Solid Color, Gradient, Source Image, New Image, Drawing.
- **Fill color:** Choose the layer color or the starting color of its gradient.
- **Image placement:** Fit shows the whole image with transparent margins; Fill covers the canvas and crops excess; Stretch fits the canvas without preserving proportions. Placement is centered. Options: Fit, Fill, Stretch.

#### Spatial crush

Reduce detail into chunky pixels.

- **Block size:** Size of each block as a percentage of the shorter image side. Larger values create chunkier blocks. Export keeps the same proportions.
- **Sampling:** Nearest samples each block center. Linear smooths between those samples. Average blends each block. Dirty Nearest jitters block boundaries. Random sample picks within each block. Corrupted Sample pulls some blocks from the wrong grid locations. Options: Nearest, Linear, Average, Dirty Nearest, Random sample, Corrupted Sample.
- **Grid jitter:** Make Dirty Nearest block edges uneven using the seed. Zero restores the regular Nearest grid; higher values create more irregular block widths and heights.
- **Sampling errors:** Increase the fraction of blocks sampled from the wrong locations and how far those samples can travel. Zero restores Nearest. New pattern changes which blocks are corrupted.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Subject / Depth / Hybrid Cutout

Remove pixels using detected subject coverage, a height interval or both. The mask stays in static stage coordinates.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Fill holes:** Fill enclosed holes in the cutout mask. Open background connected to the canvas border remains outside.
- **Remove specks:** Remove disconnected foreground islands smaller than this percentage of the mask area. Zero preserves every island.
- **Cleanup smoothing:** Smooth jagged mask edges in canvas space. Radius is a percentage of the shorter source side.
- **Expand / Contract:** Move the actual cutout boundary. Positive expands the retained region; negative contracts it. Measured against the shorter source side.
- **Spatial feather:** Feather the cleaned boundary in canvas space. Edge softness instead changes the subject/depth confidence threshold.
- **Cutout source:** Detect a subject in a photo, select a height range or combine both sources. Baking makes the cutout part of later distorted content. Options: Detected subject, Depth range, Subject + depth.
- **Keep:** Keep the selected subject/depth region or its complement.
- **Near limit:** Upper height boundary. White is near/high. The two limits are sorted when crossed.
- **Far limit:** Lower height boundary. Black is far/low.
- **Edge softness:** Feather subject and depth boundaries. Zero makes a hard clipped selection.
- **Subject threshold:** Confidence boundary for the detected subject.
- **Combine masks:** Intersection keeps pixels present in both masks; Union keeps pixels in either mask.

#### System Crash

Convert image structure into diagnostic text with displaced image windows.

- **Diagnostic text:** Original diagnostic text repeated across the image. Letters, numbers and punctuation use portable bitmap glyphs.
- **Text size:** Width of each diagnostic character relative to the shorter original image side.
- **Text density:** Seeded fraction of character cells populated with diagnostic text.
- **Image threshold:** Brightness at which diagnostic text begins to reveal source structure.
- **Source visibility:** Reveal the source behind the diagnostic blue screen.
- **Image windows:** Number of displaced source-image windows laid over the text treatment.
- **Window size:** Width and height of diagnostic image windows relative to canvas bounds.
- **Window travel:** Maximum seeded displacement of image content inside the diagnostic windows.
- **Phase:** Select a frozen moment of text drift and window travel. 0% and 100% match.
- **Text color:** Color of bright diagnostic characters and window borders.
- **Screen color:** Color of the diagnostic screen behind text and image windows.
- **Window placement:** Arrange the diagnostic windows randomly, on a grid, or along one axis. Options: Random, Grid, Horizontal, Vertical.
- **Horizontal spread:** Spread the window centers across the canvas.
- **Vertical spread:** Spread the window centers vertically.
- **Window position X:** Move the entire window arrangement horizontally.
- **Window position Y:** Move the entire window arrangement vertically.
- **Graphic overlays:** Enable independent anchors, connectors, labels and frames without changing the image glitches.
- **Anchor density:** Fraction of annotation sites with anchors.
- **Connectors:** Join annotation anchors with elbow paths, straight lines or no connectors. Options: Elbow, Straight, Off.
- **Anchor labels:** Show labels at annotation anchors.
- **Anchor text:** Slash-separated decorative labels. They do not describe or identify objects in the image.
- **Graphic frames:** Draw optional frames and header bars around image panels.
- **Overlay width:** Width of connectors and frames relative to the shorter image side.

#### Temporal Echo

Overlay fading image copies, color-separated trails or colored silhouettes.

- **Style:** Keep copied image colors, cycle red/green/blue echoes, or replace copied colors with Echo color. Silhouettes follow input transparency; an opaque image gives full-frame silhouettes. Options: Image copies, Color-separated, Silhouettes.
- **Copies:** Number of transformed echoes overlaid on the original image.
- **Echo opacity:** Opacity of the nearest echo before overall filter Opacity. Zero leaves the original image.
- **Spacing:** Travel added for each echo, as a percentage of the shorter image side.
- **Direction:** Direction of echo travel. Zero moves right, 90 down and 180 left.
- **Falloff:** Opacity retained at each additional echo. Zero keeps only the nearest copy; 100% gives every copy the same opacity.
- **Scale per echo:** Multiply image scale at each echo around the pivot. Below one shrinks successive copies; above one enlarges them.
- **Rotation per echo:** Clockwise rotation added at each echo around the pivot.
- **Pivot X:** Horizontal pivot for echo scale and rotation.
- **Pivot Y:** Vertical pivot for echo scale and rotation.
- **Position jitter:** Add seeded offset variation up to one spacing step to each copy. New pattern changes the offsets without changing the recipe controls.
- **First echo channel:** First color-separated echo channel. Subsequent copies cycle through the other two channels. Options: Red, Green, Blue.
- **Echo color:** Solid or canvas-positioned multi-stop gradient used by Silhouettes. Copied alpha defines the shape; Tint colors the entire result separately.
- **Clip copies:** On makes areas outside each transformed source rectangle transparent. Off samples those areas using Edge Handling.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Terminal Wireframe

Trace image-derived contours with dashed terminal glyphs and perspective.

- **Character size:** Size of each terminal character relative to the shorter original image side.
- **Contour strength:** Amplify image-derived contours and choose where wireframe characters appear.
- **Line continuity:** Increase continuous contour dashes; lower values break them into isolated marks.
- **Character density:** Seeded fraction of image cells contributing terminal structure.
- **Perspective:** Compress distant rows around the center to create a terminal perspective treatment.
- **Source visibility:** Reveal the source behind the terminal wireframe.
- **Phase:** Select a frozen moment of terminal row drift. 0% and 100% match.
- **Terminal frame:** Add an optional terminal border and corner marks.
- **Wire color:** Use the two-color terminal palette or sampled image colors.
- **Wire color:** Main terminal contour color.
- **Accent color:** Color of brighter characters and terminal framing.
- **Background color:** Terminal background behind characters and contours.
- **Tracing:** Keep the original dashed glyph contours or build orthogonal circuit paths.
- **Right-angle bias:** Prefer elbows and right-angle paths over direct connections.
- **Trace color separation:** Separate colored trace channels by a fraction of a cell.

#### Threshold / Photocopy

Clip tones into bitmap levels or a distressed photocopy.

- **Style:** Threshold makes two tones; Bitmap levels keeps multiple discrete tones; Dirty Photocopy adds selectable edge emphasis and seeded ink/paper defects. Options: Threshold, Bitmap levels, Dirty Photocopy.
- **Threshold:** Brightness boundary between ink and paper. In Bitmap mode this shifts the level boundaries; with Local threshold it biases the boundary relative to the local mean.
- **Input black:** Brightness mapped to black before thresholding. Must remain below Input white.
- **Input white:** Brightness mapped to white before thresholding. Must remain above Input black.
- **Gamma:** Adjust midtone brightness after input levels and before thresholding. One preserves the normalized tones.
- **Bitmap levels:** Number of discrete tones between Ink and Paper in Bitmap levels mode.
- **Invert:** Exchange the ink and paper assignments without changing your selected colors.
- **Local threshold:** Use an alpha-weighted neighborhood mean to reveal details under uneven lighting. Fully transparent pixels supply no hidden color.
- **Local radius:** Neighborhood radius for Local threshold as a percentage of the shorter original image side. Sampling extends the edge with clipped windows.
- **Edge emphasis:** Darken local brightness transitions in Dirty Photocopy mode. Zero leaves only the threshold treatment.
- **Photocopy dirt:** Seeded ink speckles and paper dropouts in Dirty Photocopy mode. Zero produces a clean copy; New pattern changes the defect field.
- **Dirt size:** Size of photocopy defects as a percentage of the shorter original image side.
- **Ink:** Color assigned to dark bitmap tones. Solid or a canvas gradient; alpha stays unchanged.
- **Paper:** Color assigned to light bitmap tones. Intermediate Bitmap levels interpolate between Ink and Paper.

#### Transform

Position, resize and rotate the preceding stack on the canvas.

- **Position X:** Move horizontally by a percentage of canvas width.
- **Position Y:** Move vertically by a percentage of canvas height.
- **Scale:** Resize proportionally. 100% keeps the original size.
- **Rotation:** Rotate clockwise around the image center before alignment.
- **Alignment:** Align the bounding box of the scaled, rotated canvas to this point before applying Position X/Y. Options: Center, Top Left, Top, Top Right, Left, Right, Bottom Left, Bottom, Bottom Right.
- **Outside edges:** Transparent leaves uncovered canvas clear. Extend repeats edge pixels; Tile wraps the image; Mirror reflects at the edges. Options: Transparent, Extend, Tile, Mirror.

#### Vector Corruption

Corrupt a seeded synthetic displacement field. This is a still-image simulation, not decoded video motion vectors.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Operation:** Scramble directions, reverse selected vectors, rotate them by a quarter-turn or snap vectors to discrete directions. Options: Scramble, Reverse, Rotate, Quantize.
- **Travel:** Maximum displacement as a percentage of the shorter image side.
- **Direction:** Base travel direction in degrees; 0 is horizontal and 90 is vertical.
- **Vector cell size:** Size of each vector cell relative to the shorter original-image side.
- **Coherence:** Group vector directions into coherent larger regions. Zero gives independent cells.
- **Corruption density:** Fraction of vector cells affected. Zero preserves the source exactly.
- **Directions:** Number of direction steps for Quantize.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Vignette

Apply a positioned, feathered elliptical or circular color vignette.

- **Vignette strength:** Mix the vignette color into the selected region. Zero preserves the source exactly.
- **Size:** Outer radius relative to half the canvas dimensions. Increase to move the vignette farther toward the corners.
- **Feather:** Fraction of the radius used for smooth falloff. Zero makes a hard edge.
- **Roundness:** Zero fits an ellipse to the canvas; 100% uses a circle based on the shorter side.
- **Center X:** Horizontal position of the vignette center.
- **Center Y:** Vertical position of the vignette center.
- **Rotation:** Rotate the ellipse around its center. A true circle is unchanged by rotation.
- **Invert:** Apply color to the center instead of the outside.
- **Vignette color:** Choose a dark, light or colored vignette, or a multi-stop gradient. Source transparency stays fixed.

#### Wave distortion

Bend the image into smooth, flowing waves.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Strength:** Maximum wave displacement as a percentage of the shorter image side. 0% leaves the image unchanged; larger values create stronger bends. Color and transparency move together.
- **Frequency:** Number of wave cycles over a distance equal to the shorter image side. Lower values create broad bends; higher values create tighter ripples. Zoom and export keep the same wave proportions.
- **Direction:** Direction the pixels move: 0° is horizontal, 90° is vertical, and intermediate angles create diagonal waves. The wave repeats across the perpendicular direction.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Window Fragments

Overlay seeded windows containing displaced and recolored fragments of the source or an embedded image.

- **Optional reference image:** Sample fragments from another image; without one, fragments sample the current image.

- **Windows:** Number of overlapping image fragments.
- **Window width:** Base window width as a percentage of the canvas width.
- **Window height:** Base window height as a percentage of the canvas height.
- **Size variation:** Seeded variation around the chosen width and height.
- **Fragment displacement:** Maximum displacement of the content sampled inside each window.
- **Fragment zoom:** Magnification of sampled content inside each fragment.
- **Color shift:** Apply a different seeded channel treatment to each window.
- **Border width:** Window border width relative to the shorter canvas side.
- **Border color:** Color of window borders and optional corner decorations.
- **Corner details:** Add small corner marks and a thin title strip.
- **Phase:** Select a frozen moment of window movement. 0% and 100% match.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

### Original shaders

#### Arc Network

Connect source-driven or procedural emitters with jagged electrical branches.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Emitters:** Gate emitters with source brightness or create a free electrical field.
- **Emitter density:** Fraction of grid sites carrying electrical emitters.
- **Branch length:** Reach of branching connections between emitters.
- **Jaggedness:** Deviation of each electrical path from a straight line.
- **Charge:** Intensity and continuity of current along each branch.
- **Arc glow:** Halo around bright traces and nodes.
- **Arc width:** Thickness of the electric traces relative to a cell.

#### Bead Weave

Weave rings, beads or square emitters into swaying segmented columns.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Bead shape:** Hollow rings, shaded beads or square emitters. Options: Rings, Beads, Squares.
- **Row spacing:** Distance between beads along a column.
- **Wave amplitude:** Sideways sway of the woven columns.
- **Gaps:** Seeded missing segments in the weave.
- **Bead size:** Radius of beads relative to the cell spacing.
- **Row stagger:** Offset alternating columns along their lengths.
- **Ring width:** Thickness of hollow ring walls.

#### Billowing Smoke

Build rolling clouds of shaded smoke from a layered turbulent field.

- **Phase:** Advance the frozen smoke through local rolling eddies and turbulent billows. 0% and 100% match. This does not start live playback.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Smoke color:** Use the chosen smoke color, or reduce this value to draw smoke with source image colors.
- **Smoke color:** Color of the lit smoke billows.
- **Background color:** Color of clear areas and the deepest smoke shadows.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Density:** Expand the amount of visible smoke. Zero clears the smoke field.
- **Turbulence:** Twist the cloud field into smaller rolling curls. Zero retains broad soft billows.
- **Eddy curl:** Strength of local swirling motion as Phase advances. Zero disables the large eddies while retaining smaller turbulent billows.
- **Eddy size:** Size of the swirling regions relative to the procedural pattern. Larger values create broad rolling eddies.
- **Volume:** Increase optical thickness through the layered smoke field.
- **Lighting:** Shade cloud ridges and cavities to give the smoke a sense of depth.
- **Softness:** Control the smooth falloff from dense smoke into clear areas.
- **Volume layers:** Number of bounded field layers combined into each still smoke frame. More layers create richer volume and take longer to render.
- **Canvas:** Preserve the source silhouette or fill the full canvas with smoke and its background.

#### Bloom Field

Scatter rotating dot flowers through a smooth seeded noise field.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Petals:** Number of dots around each flower.
- **Flower radius:** Distance from the flower center to its petal dots, relative to a grid cell.
- **Dot size:** Radius of each petal dot relative to a grid cell.
- **Density:** Noise threshold controlling the fraction of cells containing a flower.
- **Cluster size:** Size of coherent flower clusters in grid cells.
- **Rotation:** Rotate the petal arrangement within each flower.
- **Pattern color:** Mix the chosen flower color with the incoming image color.
- **Flower color:** Color of the petal dots.
- **Background color:** Color between flower clusters.
- **Canvas:** Preserve the incoming silhouette or generate an opaque flower texture.

#### Caustics

Interlocking pools of light form a bright underwater network.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Focus:** Concentrate broad pools into thin, bright light seams.
- **Dispersion:** Separate the light network into subtle spectral colors. Zero keeps the light neutral.

#### Cellular Membrane

Refract the image through seeded cells with luminous elastic walls.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Strength:** Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Wall width:** Width of the cell boundary and its colored membrane.
- **Cell disorder:** Move cell centers away from a regular lattice.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Cells, Bubbles, Diamond cells.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Cellular Mesh

Rebuild the flat image as rounded cellular forms, holes and fractured mesh boundaries.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Hole size:** Radius of rounded openings inside cellular forms.
- **Cell rounding:** Round off cellular faces and soften their boundaries.
- **Fractures:** Seeded fraction of broken cellular faces.
- **Wireframe:** Reveal bright cellular boundary wires.

#### Chromatic Erosion

Shred the image into ragged ribbons with independently adjustable spectral contour bands.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Distortion:** Travel of the torn image ribbons, independent of the rainbow color treatment.
- **Color bands:** Number of spectral contours across the sampled brightness range.
- **Erosion:** Replace dark ribbon fragments with the background color. Zero keeps every fragment.
- **Direction:** Rotate the ribbon field and displacement direction.
- **Spectral color:** Mix rainbow contour colors with the displaced source. Zero retains source colors.
- **Dark fragment color:** Color of retained dark contours.
- **Eroded background:** Color exposed by eroding a ribbon.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Circuit Matrix

Trace seeded circuits, junctions and angular connections over the image.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Trace width:** Thickness of the circuit paths.
- **Junction glow:** Brightness and spread around circuit junctions.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Right angles, Diagonal, Loops.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Contour Melt

Warp height contours into flowing, pixel-stepped bands of color.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Style:** Smooth flowing bands or stepped pixel terraces.
- **Contour count:** Number of bands traced through the height field.
- **Flow strength:** Curl and displace the contour coordinates.
- **Pixel size:** Size of the sampling grid relative to the shorter image side.
- **Contour width:** Thickness of bright contour bands relative to their spacing.
- **Hue:** Rotate the material and sampled image colors.

#### Crystal Facets

Refract the source through crisp angled crystal planes.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Strength:** Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Facet bevel:** Size of the bright beveled boundaries between crystal planes.
- **Facet tilt:** Increase the directional change in refraction between planes.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Diamonds, Triangles, Hexagonal facets.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Data Lattice

Build structured digital cells, broken data blocks and barcode fragments.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Block fill:** Fraction of seeded data cells that contain a visible mark.
- **Corruption:** Break and offset the regular data lattice.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Bits, Bricks, Barcode.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Diffraction

Spread source highlights into spectral starbursts and streaks.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Ray count:** Number of directions sampled around each highlight.
- **Ray length:** Length of highlight streaks relative to the shorter image side.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Star, Cross, Spectral.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.
- **Highlight threshold:** Only source light above this brightness contributes to the starbursts.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Treatment:** Keep source-highlight starbursts or project a positioned fan of spectral rays.
- **Fan spread:** Angular width of the positioned light fan.
- **Ray length:** Reach of projected rays relative to the shorter canvas side.
- **Grating frequency:** Number of repeated spectral interference lines along the rays.

#### Digital Fracture

Break the source into displaced geometric shards with bright seams.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Strength:** Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Seam width:** Width of illuminated gaps between displaced shards.
- **Scatter:** Vary displacement between neighboring shards.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Tiles, Strips, Diagonal shards.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Facet Mandala

Layer triangular radial facets and outlined polygon rings into an ornament.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Facets:** Triangular facets or paired diamond planes.
- **Symmetry:** Number of repeated radial sectors.
- **Ring count:** Number of overlapping ornamental rings.
- **Facet divisions:** Number of alternating planes within each sector.
- **Ring overlap:** Amount by which adjacent rings overlap.
- **Outline width:** Width of the fine edges between facets.
- **Ring rotation:** Progressive rotation between adjacent rings.

#### Filament Flow

Thread the source into curling strands, layered ribbons or short spectral fibers.

- **Direction field:** Uses the [shared direction field controls](#shared-direction-field-controls).

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Style:** Thin threads, broad curling ribbons or dense short fibers. Options: Threads, Ribbons, Fibers.
- **Strand density:** Amount of the image occupied by flowing strands.
- **Strand length:** Length of continuous strand segments.
- **Curl:** Amount of bending around the local flow direction.
- **Strand thickness:** Width of strands relative to their spacing.
- **Strand layers:** Number of interleaved strand sheets.
- **Taper:** Fade strand ends rather than keeping uniform widths.
- **Hue:** Rotate the material and sampled image colors.

#### Flow Field

A seeded curl field bends the image into coherent swirls.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Strength:** Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Hatched Solids

Print the source or a seeded collection of actual 3D primitives with layered hatching.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Hatching:** Parallel lines, crossed lines or engraved dots. Options: Parallel, Cross, Engraved.
- **Objects:** Project the material onto the source, or render optional procedural 3D objects.
- **Primitive:** Choose seeded mixed geometry or one primitive type. Options: Mixed, Sphere, Cube, Cylinder, Cone.
- **Object count:** Number of independently placed 3D primitives.
- **Object size:** Size of each primitive relative to the shorter canvas side.
- **Scatter:** Spread the primitives away from the canvas center.
- **Object rotation:** Rotate the primitives independently of the hatch pattern.
- **Camera yaw:** View the optional geometry from the left or right.
- **Camera pitch:** View the optional geometry from above or below.
- **Hatch width:** Width of ink strokes relative to their spacing.
- **Lighting:** Amount of directional shading applied to the surface.
- **Light angle:** Move the light around the surface.
- **Horizontal scatter:** Scale horizontal object separation without changing vertical placement.
- **Vertical scatter:** Scale vertical object separation without changing horizontal placement.

#### Heat Mirage

Layered heat turbulence shimmers along a chosen direction.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Strength:** Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Direction:** Direction in which the heat shimmer displaces the image.
- **Falloff:** Concentrate shimmer near Center Y with a soft vertical fade. Zero applies it across the canvas.

#### Hologram

Luminous cyan interference bands and contours follow the image.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.

#### Infinity Tunnel

Fold repeated source images into a twisted geometric tunnel.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Strength:** Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Tunnel depth:** Number of repeating scales along the tunnel.
- **Twist:** Rotate successive repetitions around the tunnel center.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Circular, Square, Hexagonal.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Iridescence

Spectral film follows the image’s light and dark structure.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.

#### Liquid Chrome

Metallic folds refract the image and reflect its colors into bright highlights.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Strength:** Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Shine:** Brightness of the metallic highlight ridges. Zero retains only the warped image and contrast.
- **Metal contrast:** Sharpen reflections into dark cavities and bright metal folds.

#### Liquid Foil

Light crumpled metallic material on the source or optional folded 3D forms.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Reflection:** Soft metal reflections or sharper iridescent highlights.
- **Objects:** Project the material onto the source, or render optional procedural 3D objects.
- **Geometry:** Render a folded sphere, torus or intersecting sculptural rings. Options: Sphere, Torus, Rings.
- **Object size:** Radius of the optional sculptural form.
- **Object rotation:** Rotate geometry independently of the fold pattern.
- **Fold scale:** Density of creases across the material.
- **Fold strength:** Relief and sharpness of metallic creases.
- **Roughness:** Spread reflections from sharp chrome to diffuse metal.
- **Metallic response:** Strength of the reflective environment treatment.
- **Height relief:** Drive relief with source luminance, manufactured height or an imported depth map.
- **Light angle:** Rotate the reflected lighting around the material.
- **Camera pitch:** View the optional form from above or below.

#### Liquid Glass

Smooth glass folds refract the image into flowing ripples.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Strength:** Refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Liquid Marbling

Curl the image and height field into striped folds or flowing ink bands.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Field influence:** Mix the shared height field into the stripe layout. Source luminance, noise and imported depth maps are available.
- **Light ink:** Color of raised/light marbling bands.
- **Dark ink:** Color of recessed/dark marbling bands.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Style:** Choose nested striped folds or sharper ink-like curls.
- **Swirl:** Bend the material into coherent curls. Zero removes procedural curling.
- **Color bands:** Number of alternating color bands across the marbled field.
- **Band sharpness:** Blend softly between bands or retain crisp ink boundaries.
- **Image distortion:** Displace source sampling through the same curl field. Zero keeps the original sampling positions.
- **Source colors:** Mix source colors into the two-color marbling palette.

#### Mandelbrot Slices

Project Mandelbrot material or view two-dimensional Mandelbrot slices stacked in 3D.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Material:** Colored escape bands or computationally warped source imagery.
- **Objects:** Project the material onto the source, or render optional procedural 3D objects.
- **Slice count:** Number of separate two-dimensional Mandelbrot slices.
- **Slice thickness:** Thickness of each fractal slab, without changing spacing.
- **Slice spacing:** Distance between the centers of the fractal slabs.
- **Slice variation:** Seeded changes in the fractal coordinates between slices.
- **Fractal zoom:** Magnify the Mandelbrot boundary; Explore fractal zooms toward a chosen detail.
- **Fractal real:** Horizontal coordinate in the complex plane.
- **Fractal imaginary:** Vertical coordinate in the complex plane.
- **Iterations:** Fractal iteration limit; larger values reveal finer boundaries.
- **Camera yaw:** View the stacked slices from the left or right.
- **Camera pitch:** View the stacked slices from above or below.
- **Lighting:** Directional light and depth shading of the fractal slabs.
- **Boundary extent:** Control the visible near-boundary band in both flat and stacked modes. Higher values narrow it toward the set.
- **Image warp:** Warp source sampling through fractal escape bands.
- **Slice:** Choose a slice in flat mode or the first slice of a 3D stack. Slice variation controls the difference between slices.

#### Microculture

Layer translucent cells, organic membranes and granular colonies over the image.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Stain color:** Primary stain; nearby cells use related contrasting stains.
- **Culture background:** Base color between translucent cells.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Style:** Choose stained translucent tissue or granular clustered colonies.
- **Cell radius:** Size of the rounded cell bodies relative to their spacing.
- **Membrane width:** Thickness of the boundary surrounding each cell.
- **Granules:** Amount of fine internal particulate texture.
- **Clustering:** Vary cell size and population through a coherent organic field.
- **Source background:** Reveal the image beneath the translucent culture.
- **Lens vignette:** Blend a circular microscope-lens vignette over the culture. Zero leaves the full canvas visible.

#### Moiré Interference

Interfere rotated lines, rings or grids into intricate geometric bands.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Interference angle:** Angle between the two interfering patterns, from parallel to a quarter turn.
- **Contrast:** Sharpen the interference into graphic bands.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Lines, Rings, Grids.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Nebula

Layered cosmic clouds reveal luminous cores and dark cavities.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Contrast:** Contrast between luminous cloud forms and dark space. Zero produces a uniform cloud color.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Cloud detail:** Number of cloud layers. More layers add fine turbulence; fewer make broad, soft forms.
- **Core glow:** Strength of luminous cores inside the denser cloud regions.
- **Canvas:** Keep the incoming transparency, or generate an opaque nebula across the whole canvas.

#### Neon Edges

Trace the image with glowing spectral contours and dark interiors.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Contour width:** Distance used to detect image contours, relative to the shorter original image side.
- **Glow:** Strength of wider light around the sharp neon contours.
- **Interior darkness:** Darken the image between contours without changing its transparency.

#### Op Art

Bend alternating geometric fields into bold optical patterns.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Curve bend:** Bend the regular pattern into waves or bulging optical forms.
- **Contrast:** Sharpen the transition between light and dark regions.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Checker, Stripes, Concentric.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Paint Flow

Spread source-colored paint into irregular splashes or flowing liquid ribbons.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Paint color:** Mix the chosen paint color with sampled source colors. Zero paints with the source image colors.
- **Paint color:** Chosen paint color mixed into the source-colored fluid.
- **Background color:** Color between paint forms when Background source is reduced.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Mode:** Choose irregular paint droplets and sprays or continuous flowing liquid ribbons.
- **Paint coverage:** Coverage of the painted forms. Higher values fill more of the image.
- **Paint size:** Size of the splash clusters or thickness of the liquid ribbons within each pattern cell.
- **Flow distance:** Distance the fluid field moves source samples as a percentage of the shorter image side.
- **Viscosity:** Thick paint holds short rounded splashes. Lower viscosity lets paint run downward into longer, thinner drips; Liquid mode stretches into gravity-driven streams.
- **Color variation:** Mix seeded color differences into the paint. Zero retains the source/chosen paint color; higher values create a more varied palette. Drips keep their parent splash color.
- **Background source:** Reveal the original image between paint forms. Zero uses the chosen background color.

#### Particle Burst

Reveal source structure through scattered particles, branching streaks and a focal cross glow.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Particle density:** Seeded fraction of source-brightness-driven particle cells.
- **Particle size:** Radius of a particle relative to its procedural cell.
- **Scatter:** Seeded movement of particle positions inside their cells.
- **Branch streaks:** Strength and length of directional particle streaks.
- **Focal glow:** Strength of the cross-shaped light at the selected Center.
- **Focal length:** Extent of the horizontal and vertical focal light.

#### Particle Web

Connect luminous particles into a fine network with a clustered central core.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Distribution:** Concentrate particles around the center or distribute them uniformly.
- **Node density:** Fraction of available sites occupied by nodes.
- **Connection distance:** Maximum reach of connections between neighboring nodes.
- **Core falloff:** Fade the network away from its center.
- **Line width:** Thickness of connections relative to a cell.
- **Web glow:** Halo around lines and particle junctions.
- **Node motion:** Seeded position variation and frozen Phase motion of nodes.

#### Polar Grid

Overlay radial spokes, concentric rings and spiraling radar geometry.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Scale:** Pattern density per shorter image side. Lower values make broader folds or bands.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Spokes:** Number of radial divisions around the center.
- **Line width:** Width of the radial and circular grid lines.
- **Pattern rotation:** Rotate the procedural structure around its Center without rotating the source image.
- **Pattern:** Choose a different geometric construction. Each pattern uses the same saved controls and seed. Options: Grid, Spiral, Radar.
- **Accent color:** Color of the bright pattern, seam or highlight.
- **Shadow color:** Color of the dark pattern regions. Source transparency is preserved.
- **Pattern color:** Mix the selected accent/shadow palette into the shader. Zero retains source colors or neutral light.

#### Prismatic Panels

Refract the source through soft panels with pastel faces and spectral edges.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Panel color A:** First pastel face color.
- **Panel color B:** Second pastel face color.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Style:** Refract source details or emphasize the colored panel surfaces.
- **Width variation:** Vary the widths of neighboring panels using the saved seed.
- **Refraction:** Travel of source details through the glass faces.
- **Edge width:** Width of the spectral seams relative to a panel.
- **Iridescence:** Strength of the rainbow spectral color along panel edges.
- **Face softness:** Smooth the transition across each panel face.
- **Source colors:** Retain source color beneath the pastel panel treatment.

#### Prismatic Shatter

Break the source into granular crystalline facets with diagonal interference and shredded edges.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Fragment travel:** Seeded displacement of source samples within crystalline fragments.
- **Interference:** Strength of diagonal spectral interference across the facets.
- **Edge shredding:** Remove granular fragments near image contours. Zero keeps every fragment.
- **Crystal grain:** Seeded variation in granular crystalline shading.

#### Radial Extrusion

Extrude source-colored rectangular rays into a fractured radial tunnel.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Spokes:** Number of rectangular rays around the radial center.
- **Extrusion depth:** Length and depth of source-driven radial fragments.
- **Tunnel opening:** Radius of the dark central opening.
- **Facet shading:** Contrast between rectangular ray faces and their beveled sides.

#### Shader Plasma

Flowing interference bands with a vivid procedural color palette.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% meet at the same point in its cycle. This value is saved in projects and presets.
- **Scale:** Density of the plasma pattern per shorter image side.
- **Contrast:** Increase the contrast of the interference bands. Zero produces a uniform palette color.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Canvas:** Keep the source alpha silhouette, or generate an opaque image across the whole canvas.

#### Shader Ripple

Concentric liquid ripples that refract the incoming image.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% meet at the same point in its cycle. This value is saved in projects and presets.
- **Scale:** Number of ripple cycles per shorter image side.
- **Strength:** Maximum refraction distance as a percentage of the shorter image side. Zero preserves the incoming image.
- **Center X:** Horizontal ripple origin.
- **Center Y:** Vertical ripple origin.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).

#### Signal Collapse

Fold the source into jagged digital blocks, stretched ribbons, static and dropouts.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Palette strength:** Mix a limited neon palette into corrupted samples. Zero preserves source colors.
- **Neon accent:** Primary accent used in the limited neon signal palette.
- **Dropout color:** Color of missing signal blocks and darkest palette regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Collapse:** Displace and fold coherent blocks of the source. Zero disables folding while retaining other treatments.
- **Ribbon stretch:** Stretch thin source strips across several neighboring blocks. Higher values form longer ribbons; zero disables stretching.
- **Static:** Mix fine seeded signal noise into the damaged regions.
- **Dropout:** Fraction of damaged blocks replaced by the shadow color.
- **Ribbon density:** Gradually increase the number and strength of horizontal ribbon bands. Zero removes ribbons; 100% stretches every band.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Treatment:** Keep the original folded signal, quantize graphic slabs or erode their edges. Options: Folded, Slabs, Eroded.
- **Slab size:** Size of graphic replacement slabs relative to the procedural scale.
- **Palette levels:** Number of flat color levels in graphic slabs.
- **Slab stripes:** Coverage of fine stripes inside replacement slabs.
- **Edge roughness:** Break the edges of slabs with seeded coarse noise.
- **Slab dropout:** Remove complete slabs into the shadow color.
- **Slab travel:** Move sampled image regions inside the replacement slabs.
- **Stripe angle:** Rotate the fine stripe texture within the slabs.

#### Signal Orb

Wrap a luminous signal-band material around the source or an optional 3D orb.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Source colors:** Mix original image colors into the material. Zero uses the chosen material palette.
- **Bands:** Smooth luminous bands or quantized stepped bands.
- **Objects:** Project the material onto the source, or render optional procedural 3D objects.
- **Orb radius:** Radius of the optional sphere in canvas coordinates.
- **Band count:** Number of curved luminous signal bands.
- **Bulge:** Bend projected bands using source brightness, or curve the orb texture.
- **Signal glow:** Width and strength of light surrounding the bands.
- **Signal noise:** Seeded interruptions and fuzzy signal edges.
- **Object rotation:** Rotate the sphere texture independently of the material pattern.

#### Spectral Terrain

Render flowing neon ridges as a flat field or an optional height-projected terrain.

- **Depth field:** Uses the [shared depth field controls](#shared-depth-field-controls).

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Projection:** Flat uses the spectral field without landscape perspective; Terrain projects its peaks and valleys.
- **Relief height:** Strength of height shading in Flat and vertical relief in Terrain.
- **Perspective:** Perspective compression of the Terrain projection. Flat does not use perspective.
- **Ridges:** Number of spectral contour ridges across the height range.
- **Ridge width:** Width of the bright spectral ridge within its contour period.

#### Truchet Mosaic

Join quarter-circle arcs and dots into a seeded geometric tile pattern.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Pattern color:** Color of arcs and dots.
- **Tile background:** Color between the geometric paths.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Canvas:** Retain the source silhouette or fill the canvas with the material.
- **Tile style:** Choose connected arcs, dot cells, or a seeded mix of both. Options: Arcs, Dots, Arcs and dots.
- **Arc width:** Thickness of curved paths relative to a tile.
- **Dot size:** Radius of the dots relative to a tile.
- **Dot density:** Fraction of cells containing dots in mixed style, or populated cells in dots style.
- **Grid lines:** Opacity of subtle lines separating the tile cells. Zero removes the grid.
- **Source background:** Reveal the source beneath the geometric pattern.

#### Wire Ghost

Layer chromatic silhouette contours with translucent trails and signal disruptions.

- **Phase:** Select a frozen moment in the pattern. 0% and 100% are the same point in its cycle. Saved in projects and presets.
- **Pattern scale:** Procedural pattern density per shorter original image side. Higher values create smaller structures.
- **Intensity:** Mix the shader material with the incoming image. Zero preserves the image; 100% uses the full treatment.
- **Center X:** Horizontal pattern origin.
- **Center Y:** Vertical pattern origin.
- **Pattern rotation:** Rotate the procedural pattern around its center without rotating source content.
- **Spectral color:** Mix the spectral treatment with source colors. Zero retains source-colored contours or fragments.
- **Accent color:** Color mixed with the spectral highlights.
- **Shadow color:** Color of dark shader regions.
- **Edge Handling:** Uses the [shared edge handling options](#shared-controls).
- **Contour width:** Distance used to detect image contours, relative to the shorter original image side.
- **Trails:** Number of chromatic contour echoes.
- **Trail travel:** Distance of contour trails along the selected pattern rotation.
- **Disruption:** Seeded horizontal interruptions in the contour trails.
- **Glow:** Widen and brighten the contour trails.

### Imported shaders

Imported shaders add their own controls from the imported package. They share Opacity, blending, tint and application controls where supported; their specific parameter names and ranges depend on that package and are not part of the 109 built-in entries above.

## Built-in presets

The 29 starter presets below ship with GLEECH. Effects are listed top to bottom as shown in the Effects panel; the bottom effect renders first. Each preset saves a tuned combination of these effects. See the [user guide](USER_GUIDE.md#presets) for applying and combining presets.

### Amber Press

Warm printed dots and restrained monochrome paper grain.

**Effects (top to bottom):** Noise / Grain; Halftone.

### Analog Afterimage

Soft color separation, interlaced lines and phosphor glow.

**Effects (top to bottom):** CRT; Scanlines; RGB split.

### Analog Color Drag

Smeared chroma and displaced raster lines with a bright analog palette.

**Effects (top to bottom):** Scanlines; Pigment Drag; Chroma Mosh.

### Annotated Silhouette

Decorative anchors and connectors accompany source-preserving edge smears.

**Effects (top to bottom):** System Crash; Pixel Stretch.

### Boundary Weave

Repeat the source image through a Mandelbrot boundary with mirrored orbit weaving.

**Effects (top to bottom):** Levels / Curves; Mandelbrot.

### Broken Current

A broken-block vector map drives displaced chunks with signal tearing.

**Effects (top to bottom):** RGB split; Signal Tearing; Motion Transfer.

### Chrome Relic

Sculpted liquid chrome with fine iridescent reflections and deep contrast.

**Effects (top to bottom):** Levels / Curves; Iridescence; Liquid Chrome.

### Circuit Ghost

Cyan circuit traces and a broken data lattice mingle with lingering color damage.

**Effects (top to bottom):** Chroma Mosh; Circuit Matrix; Data Lattice.

### Contour Scramble

Stepped contour fragments and torn color columns preserve the central subject.

**Effects (top to bottom):** Pixel Stretch; Signal Weave; Contour Waves.

### Crystal Mosaic

Hexagonal crystal facets refract the image into an icy geometric mosaic.

**Effects (top to bottom):** Photo Adjustments; Crystal Facets.

### Flow State

Matching saved flow fields steer signal tears and waves into one broken current.

**Effects (top to bottom):** RGB split; Wave distortion; Signal Tearing.

### Fogged Architecture

Depth parallax and cool haze shaped by a receding corridor map.

**Effects (top to bottom):** Halation; Depth Haze; Depth Parallax / Push-Pull.

### Fractured Press

Diagonal shader shards break a warm halftone print into offset fragments.

**Effects (top to bottom):** RGB split; Digital Fracture; Halftone.

### Glyph Vortex

An embedded pinwheel vector field bends block glyphs and image waves together.

**Effects (top to bottom):** Glow; Wave distortion; Glyph Renderer.

### Holographic Ruin

Holographic bands, fractured signal slices and glow create a damaged transmission.

**Effects (top to bottom):** Glow; Scanlines; Signal Tearing; Hologram.

### Liquid Glass

Rippling glass refraction preserves the source beneath a luminous surface.

**Effects (top to bottom):** Glow; Photo Adjustments; Liquid Glass.

### Liquid Memory

Organic feedback melting with a soft purple-and-amber finish.

**Effects (top to bottom):** Gradient Map; Blur; Feedback Bloom / Melt.

### Polar Terminal

Source-colored hexadecimal glyphs sit beneath a luminous radar shader.

**Effects (top to bottom):** Glow; Polar Grid; Glyph Renderer.

### Prism Garden

Mirrored image petals, vivid color mapping and a soft luminous finish.

**Effects (top to bottom):** Glow; Gradient Map; Kaleidoscope.

### Psychedelic Skin

Liquid stripes and iridescent surface highlights retain the source figure.

**Effects (top to bottom):** Iridescence; Liquid Marbling.

### Shard Current

An embedded diagonal-shard vector map drives quantized digital displacement.

**Effects (top to bottom):** Noise / Grain; Gradient Map; Vector Corruption.

### Signal Burn

Broken compression and displaced signal fragments with chromatic edges.

**Effects (top to bottom):** RGB split; Signal Tearing; Compression Breakup.

### Silver Relief

Sculptural torus relief with photographic contrast and fine film grain.

**Effects (top to bottom):** Noise / Grain; Photo Adjustments; Depth Field.

### Sorted Spectrum

Long sorted color streaks with a violet-to-gold palette.

**Effects (top to bottom):** Chroma Mosh; Pixel Sorting; Gradient Map.

### Spectral Halo

Spectral diffraction casts cyan and violet rays from the source highlights.

**Effects (top to bottom):** Glow; Diffraction.

### Spiral Spectrum

Curved pixel sorting pulls violet and amber detail along a shared spiral field.

**Effects (top to bottom):** Glow; Pixel Sorting; Gradient Map.

### Spiral Transfer

A supplied spiral vector field bends the image into flowing echoes.

**Effects (top to bottom):** Glow; Temporal Echo; Motion Transfer.

### Terminal Noise

Diagnostic rows, broken data and optional graphic frames.

**Effects (top to bottom):** System Crash; Data Weave.

### Terrain Contours

Layered terrain contours and a warm depth palette, with the source still visible.

**Effects (top to bottom):** Depth Color Mapping; Depth Field.
