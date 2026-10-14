# Local subject detection

`u2netp.onnx` is the small U²-Net salient-object model by Xuebin Qin et al.,
converted to ONNX and distributed by rembg. It is bundled with the Windows app.
Images stay on this machine; there is no service, account, or runtime download.

- Model source: https://github.com/xuebinqin/U-2-Net
- ONNX distribution: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
- License: Apache-2.0, reproduced in `U2NET-LICENSE.txt`.
- SHA-256: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`
- Upstream distribution MD5: `8e83ca70e441ab06c318d82300c84806`

Inference uses CPU ONNX Runtime with two threads in the image worker. The
immutable decoded image is composited on white and resized to 320 × 320, then
normalized by its largest channel value and the ImageNet channel mean/std.
The first probability output is normalized to 8-bit [0, 255] and cached per source.
Masks are sampled in normalized image coordinates for preview and export.
This lightweight detector estimates the salient foreground; fine hair, transparent
objects, clutter, and multiple subjects can need refinement. It does not use an
image's alpha channel as a substitute for photo subject detection.
