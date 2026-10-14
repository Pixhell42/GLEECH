# Original shader sample

`prism-weave.gleech-shader` is original GLEECH code licensed under MIT.
Use Add Shader in the Library menu or Effects library to import it. It exposes
named number, choice and color controls with shared Opacity, Tint/Gradient,
blending, Phase and masks. The Windows package copies it into `resources/shaders`.

Projects and presets embed its package, so removing its library tile or original
file does not break saved copies. Enabled imported WGSL needs WebGPU; disable
the layer to continue rendering the remaining stack on CPU. See
`docs/SHADER_PACKAGES.md` for the supported contract and limits.
