# Third-party assets

| Asset | Source | License |
| --- | --- | --- |
| GlamVelvetSofa, SpecularSilkPouf, DiffuseTransmissionPlant (models) | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) — Eric Chadwick / Wayfair | CC BY 4.0 |
| SheenChair, GlassVaseFlowers (models) | Khronos glTF Sample Assets — Eric Chadwick | CC0 |
| pedestrian_overpass_1k.hdr, venice_sunset_1k.hdr | [Poly Haven](https://polyhaven.com) via three.js examples | CC0 |
| hardwood2 textures | three.js examples | MIT (three.js repository) |
| three.js r170, Lenis 1.1.13 | npm | MIT |
| acad-ts 3.7.0 (`vendor/acad-ts/`, DWG → DXF in the editor) | npm `@node-projects/acad-ts@3.7.0`, `dist/index-min.js` unmodified (tarball sha256 9ecd23e5…5d35); Jochen Kühner, port of ACadSharp by Albert Domenech | MIT (`vendor/acad-ts/LICENSE`) |

Models were re-encoded with gltf-transform (meshopt geometry, 1K WebP textures).
All other textures are generated procedurally in `src/textures.js`.
