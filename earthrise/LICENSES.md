# Earthrise for Daedalus: third-party licences

This copy of the site is static files only: there is no server code and no counter, and nothing is stored about
visitors. Everything the page loads comes from its own origin: no CDN, no font service, no analytics.
This file lists every piece of third-party code in that folder, with its licence, and the AI-generated 3D models the
site shows. It also lists the data the site is built from. Checked on 2026-10-05 against the files in `web/` and the
upstream licence files linked below.

## Summary

| What | Files on this site | Licence | Copyright | Full text |
|---|---|---|---|---|
| three.js r186 | `vendor/three/three.core.js`, `vendor/three/three.module.js`, `vendor/three/addons/loaders/GLTFLoader.js`, `STLLoader.js`, `DRACOLoader.js`, `vendor/three/addons/utils/BufferGeometryUtils.js`, `SkeletonUtils.js` | MIT | © 2010-2026 three.js authors | `vendor/three/LICENSE` and [below](#threejs) |
| meshoptimizer decoder 1.1 (distributed with three.js) | `vendor/three/addons/libs/meshopt_decoder.module.js` | MIT | © 2016-2026 Arseny Kapoulkine | file header and [below](#meshoptimizer) |
| webgl-noise: 3D simplex noise (`src/noise3D.glsl`, 2011 version) | inlined in `js/earth.js` (the `NOISE` shader string) | MIT | © 2011 Ashima Arts (simplex noise); © 2011-2016 Stefan Gustavson | comment above `NOISE` in `js/earth.js` and [below](#webgl-noise) |
| Fonts | none | — | — | [see Fonts](#fonts) |

The addons under `vendor/three/` are unmodified, except that their `from 'three'` imports were rewritten to relative
paths so the page needs no import map.

**Draco decoder (repository copy only).** `vendor/three/addons/libs/draco/gltf/` (`draco_decoder.js`,
`draco_decoder.wasm`, `draco_wasm_wrapper.js`) comes with the three.js package and sits in the repository's `web/`
folder. It is **not
deployed**: `tools/web_dist.mjs` leaves it out, and no model on this site uses Draco compression. Draco is © 2016 The
Draco Authors and licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
([github.com/google/draco](https://github.com/google/draco)). If it is ever deployed, the Apache 2.0 text has to go
with it.

## Generated 3D models (Tripo)

The Earth and the watcher are AI-generated with Tripo (tripo3d.ai): text-to-3D through the Tripo API, model
v3.1-20260211, on 2026-10-05, from the author's account, then post-processed by our own scripts. Rights in this output
are governed by Tripo's terms of service for the account that generated it. The task records are in the project's
`props/tripo_log.json`.

| What | Files on this site | Tripo task | What we changed |
|---|---|---|---|
| Earth (candidate c2) | `assets/props/earth.glb`, `assets/props/earth_mask.png`, `assets/props/earth_textures_preview.jpg` | `c4fa9012-1e6c-42da-8a93-ca3905ef5e33` | geometry resampled to an icosphere (81,920 triangles), drawn as a true sphere (the model's relief kept in its shading); a land / sea / window mask read from its texture; the page repaints day and night itself |
| Watcher (candidate c3) | `assets/props/watcher.glb` | `ec9958e4-f636-443a-9d62-338bb6063cda` | turned 20° inside the model so its face looks at the raised Earth, thin spots thickened, base draped onto the terrain, simplified to 49,462 triangles with vertex colours; the page keeps its paint under a darker warm tint |

The photo slots (`assets/photos/web_*.jpg`) and the share card (`img/cover_og.jpg`) are screenshots of this page, so
they show these models.

## Fonts

No font files are bundled or downloaded. The CSS names fonts that are already installed on the viewer's device
(`-apple-system`, `SF Pro Text`, `Helvetica Neue`, `Segoe UI`, `Roboto`, `PingFang SC`, `Noto Sans`, `Arial`;
serif: `Iowan Old Style`, `Palatino Linotype`, `Palatino`, `Book Antiqua`, `Songti SC`, `Georgia`). The browser uses
the first one it finds, so no font is redistributed.

## Our own work

Everything else in this folder was made for this project: the HTML, the CSS, `js/*.js` (apart from the `NOISE` block
credited above), the icons (`img/icon.svg` and the inline SVG icons in `index.html`), the sound, which is synthesised
in the browser with no recordings, the share card and the photo slots, which `tools/web_cover.mjs` shoots from the page
itself, and the terrain and mechanism assets in `assets/terrain/` and `assets/mech/`, which `tools/web_assets.py`
converts from the project's own print files (the Earth and the watcher in `assets/props/` are Tripo-generated: see
above).

## Data (credits, not software licences)

- **Topography** (`assets/terrain/`): derived from SLDEM2015 (LOLA + SELENE/Kaguya Terrain Camera, 512 pixels per
  degree). Barker, M. K., Mazarico, E., Neumann, G. A., Zuber, M. T., Haruyama, J., & Smith, D. E. (2016). A new lunar
  digital elevation model from the Lunar Orbiter Laser Altimeter and SELENE Terrain Camera. *Icarus*, 273, 346–355.
  [doi:10.1016/j.icarus.2015.07.039](https://doi.org/10.1016/j.icarus.2015.07.039). Data: NASA LRO LOLA Science Team
  and JAXA SELENE (Kaguya), via the NASA PDS Geosciences Node.
- **Cross-check**: the terrain was registered against NASA's Scientific Visualization Studio *CGI Moon Kit* (LOLA,
  64 pixels per degree; credit: NASA's Scientific Visualization Studio, LOLA Science Team). No file from it ships here.
- **Names**: IAU/USGS Gazetteer of Planetary Nomenclature. The title refers to *Earthrise* (Bill Anders, Apollo 8,
  24 December 1968). No NASA imagery is reproduced.

## Build tools (not shipped)

The GLB files were compressed offline with gltf-transform 4.3.0 (MIT) and meshoptimizer. No code from those tools is in
this folder apart from the decoder listed above.

---

## Licence texts

### three.js

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

Source: [github.com/mrdoob/three.js](https://github.com/mrdoob/three.js) (`LICENSE`), the same file as `vendor/three/LICENSE`.

### meshoptimizer

```
MIT License

Copyright (c) 2016-2026 Arseny Kapoulkine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Source: [github.com/zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) (`LICENSE.md`).

### webgl-noise

The 3D simplex noise was written by Ian McEwan (Ashima Arts) and is maintained by Stefan Gustavson. This site uses the
2011 version of `src/noise3D.glsl`, with only the formatting changed.

```
Copyright (C) 2011 by Ashima Arts (Simplex noise)
Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

Source: [github.com/ashima/webgl-noise](https://github.com/ashima/webgl-noise) and
[github.com/stegu/webgl-noise](https://github.com/stegu/webgl-noise) (`LICENSE`, the same file in both).
