// Terrain tile: grid mesh resampled from the heightmap + object-space normal map + painted-look albedo
// (dark wash in hollows, dry-brushed crests — docs/visual_review.md B2), sides in matte black (B2: tile sides painted black).
import * as THREE from '../vendor/three/three.module.js';

export function buildTerrain(hm, { step = 0.3, texMax = 2048, maps = null, aniso = 4 } = {}) {
  const W = hm.x1 - hm.x0, H = hm.y1 - hm.y0;
  const gx = Math.max(2, Math.round(W / step) + 1), gy = Math.max(2, Math.round(H / step) + 1);
  const sx = W / (gx - 1), sy = H / (gy - 1);
  const pos = new Float32Array(gx * gy * 3), uv = new Float32Array(gx * gy * 2), nrm = new Float32Array(gx * gy * 3);
  const e = Math.max(hm.dx, Math.min(sx, sy));                     // normal stencil ≈ grid spacing
  const S = hm.sample;
  const zc = (x, y) => { const v = S(Math.min(Math.max(x, hm.x0), hm.x1), Math.min(Math.max(y, hm.y0), hm.y1)); return v; };
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const k = j * gx + i, x = hm.x0 + i * sx, y = hm.y0 + j * sy;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = zc(x, y);
    uv[k * 2] = i / (gx - 1); uv[k * 2 + 1] = j / (gy - 1);
    const dzx = (zc(x + e, y) - zc(x - e, y)) / (2 * e), dzy = (zc(x, y + e) - zc(x, y - e)) / (2 * e);
    const l = Math.hypot(dzx, dzy, 1);
    nrm[k * 3] = -dzx / l; nrm[k * 3 + 1] = -dzy / l; nrm[k * 3 + 2] = 1 / l;
  }
  const idx = new Uint32Array((gx - 1) * (gy - 1) * 6);
  let t = 0;
  for (let j = 0; j < gy - 1; j++) for (let i = 0; i < gx - 1; i++) {
    const a = j * gx + i, b = a + 1, c = a + gx + 1, d = a + gx;
    idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = a; idx[t++] = c; idx[t++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();

  // ---- textures: from the asset module when present, else computed here at heightmap resolution (capped)
  let mat;
  if (maps?.normal) {
    for (const t of [maps.normal, maps.albedo, maps.ao]) if (t) { t.anisotropy = aniso; t.needsUpdate = true; }
    mat = new THREE.MeshStandardMaterial({ color: maps.albedo ? 0xffffff : 0x8e8e8c, map: maps.albedo || null, aoMap: maps.ao || null, aoMapIntensity: 1.0,
      roughness: 0.97, metalness: 0, normalMap: maps.normal, normalMapType: THREE.ObjectSpaceNormalMap });
  } else {
  const tw = Math.min(texMax, hm.nx), th = Math.max(2, Math.round(tw * H / W));
  const tx = W / (tw - 1), ty = H / (th - 1), te = Math.max(hm.dx, tx);
  const nData = new Uint8Array(tw * th * 4), cData = new Uint8Array(tw * th * 4);
  const Z = new Float32Array(tw * th);
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) Z[j * tw + i] = zc(hm.x0 + i * tx, hm.y0 + j * ty);
  // box-blurred height (radius ≈ 1.2 mm) → cavity = z − blur
  const rad = Math.max(1, Math.round(1.2 / tx)), tmp = new Float32Array(tw * th), blur = new Float32Array(tw * th);
  for (let j = 0; j < th; j++) {
    let acc = 0; const row = j * tw;
    for (let i = -rad; i <= rad; i++) acc += Z[row + Math.min(Math.max(i, 0), tw - 1)];
    for (let i = 0; i < tw; i++) {
      tmp[row + i] = acc / (2 * rad + 1);
      acc += Z[row + Math.min(i + rad + 1, tw - 1)] - Z[row + Math.max(i - rad, 0)];
    }
  }
  for (let i = 0; i < tw; i++) {
    let acc = 0;
    for (let j = -rad; j <= rad; j++) acc += tmp[Math.min(Math.max(j, 0), th - 1) * tw + i];
    for (let j = 0; j < th; j++) {
      blur[j * tw + i] = acc / (2 * rad + 1);
      acc += tmp[Math.min(j + rad + 1, th - 1) * tw + i] - tmp[Math.max(j - rad, 0) * tw + i];
    }
  }
  const zAt = (i, j) => Z[Math.min(Math.max(j, 0), th - 1) * tw + Math.min(Math.max(i, 0), tw - 1)];
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const k = j * tw + i;
    const dzx = (zAt(i + 1, j) - zAt(i - 1, j)) / (2 * tx), dzy = (zAt(i, j + 1) - zAt(i, j - 1)) / (2 * ty);
    const l = Math.hypot(dzx, dzy, 1);
    nData[k * 4] = Math.round((-dzx / l * 0.5 + 0.5) * 255);
    nData[k * 4 + 1] = Math.round((-dzy / l * 0.5 + 0.5) * 255);
    nData[k * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    nData[k * 4 + 3] = 255;
    const cav = Z[k] - blur[k];                                      // mm; + on crests, − in hollows
    const f = 1 + Math.max(-0.32, Math.min(0.2, cav * 0.55));
    const v = Math.round(Math.min(255, 124 * f));                    // ~#7c7c7a neutral grey, sRGB
    cData[k * 4] = v; cData[k * 4 + 1] = v; cData[k * 4 + 2] = Math.max(0, v - 2); cData[k * 4 + 3] = 255;
  }
  const normalMap = new THREE.DataTexture(nData, tw, th, THREE.RGBAFormat);
  normalMap.needsUpdate = true; normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter; normalMap.magFilter = THREE.LinearFilter; normalMap.anisotropy = 4;
  const albedo = new THREE.DataTexture(cData, tw, th, THREE.RGBAFormat);
  albedo.colorSpace = THREE.SRGBColorSpace; albedo.needsUpdate = true; albedo.generateMipmaps = true;
  albedo.minFilter = THREE.LinearMipmapLinearFilter; albedo.magFilter = THREE.LinearFilter; albedo.anisotropy = 4;

  mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: albedo, roughness: 0.96, metalness: 0,
    normalMap, normalMapType: THREE.ObjectSpaceNormalMap,
  });
  }
  const top = new THREE.Mesh(g, mat);
  top.name = 'terrain_top';

  // ---- sides + bottom (matte black, like the painted tile sides)
  const ring = [];
  for (let i = 0; i < gx; i++) ring.push([i, 0]);
  for (let j = 1; j < gy; j++) ring.push([gx - 1, j]);
  for (let i = gx - 2; i >= 0; i--) ring.push([i, gy - 1]);
  for (let j = gy - 2; j > 0; j--) ring.push([0, j]);
  const wp = [];
  const P = (i, j) => { const k = (j * gx + i) * 3; return [pos[k], pos[k + 1], pos[k + 2]]; };
  for (let k = 0; k < ring.length; k++) {
    const p0 = P(...ring[k]), p1 = P(...ring[(k + 1) % ring.length]);
    wp.push(p0[0], p0[1], p0[2], p0[0], p0[1], 0, p1[0], p1[1], 0, p0[0], p0[1], p0[2], p1[0], p1[1], 0, p1[0], p1[1], p1[2]);
  }
  wp.push(hm.x0, hm.y0, 0, hm.x1, hm.y1, 0, hm.x1, hm.y0, 0, hm.x0, hm.y0, 0, hm.x0, hm.y1, 0, hm.x1, hm.y1, 0);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  wg.computeVertexNormals();
  const side = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }));
  side.name = 'terrain_side';

  const grp = new THREE.Group(); grp.name = 'terrain'; grp.add(top, side);
  grp.userData = { top, side, tris: idx.length / 3, grid: [gx, gy] };
  return grp;
}

// Adds a soft, unshadowed "light from the Earth" term to a MeshStandardMaterial without a three.js light, so only the
// materials we choose (terrain, watcher) receive it — the near-black mechanism never turns into a lit "lollipop stick".
// rim > 0 adds a back-light edge: when the Earth is behind a surface (farther from the camera), the surface's silhouette
// picks up a thin warm line — the first touch of Earth light that the camera can actually see (review #5).
export function addEarthLight(mat, shared, { falloff = 34, wrap = 0.0, rim = 0.0, rimPow = 3 } = {}) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.bind(mat);    // chain (addFrontFade may come first)
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uEarthPosV = shared.uEarthPosV;
    sh.uniforms.uEarthCol = shared.uEarthCol;
    sh.uniforms.uEarthRim = shared.uEarthRim;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEarthPosV;\nuniform vec3 uEarthCol;\nuniform vec3 uEarthRim;')
      .replace('#include <opaque_fragment>', `{
        vec3 Lv = uEarthPosV + vViewPosition;            // view-space vector fragment → earth centre
        float dE = length(Lv);
        float ndlE = (dot(normal, Lv / dE) + ${wrap.toFixed(3)}) / ${(1 + wrap).toFixed(3)};
        float fall = 1.0 / (1.0 + pow(dE / ${falloff.toFixed(1)}, 2.0));
        outgoingLight += diffuseColor.rgb * uEarthCol * max(ndlE, 0.0) * fall;
        ${rim > 0 ? `float back = smoothstep(0.0, 0.6, -Lv.z / dE);                   // Earth behind the surface
        float edge = pow(1.0 - max(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0), ${rimPow.toFixed(1)}); // grazing to the view
        float nl = length(normal.xy), ll = length(Lv.xy);                       // on the side that faces the Earth on screen
        float side = (nl > 1e-3 && ll > 1e-3) ? max(dot(normal.xy / nl, Lv.xy / ll), 0.0) : 0.0;
        outgoingLight += uEarthRim * edge * back * fall * (0.15 + 0.85 * side) * ${rim.toFixed(3)};` : ''}
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => prevKey() + '|earthlight' + falloff + '|' + wrap + '|' + rim + '|' + rimPow;
  return mat;
}

// Darkens the last `width` mm of the top surface before the tile's front edge (world Y = y0) down to `floor` × albedo:
// the edge cuts two crater walls in half, and the key light turned them into white curls (review #7). Web look only —
// the heightmap and the print files are untouched. The terrain group sits at the world origin, so local Y = world Y.
export function addFrontFade(mat, { y0 = -75, width = 9, floor = 0.22 } = {}) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.bind(mat);
  const u = { value: new THREE.Vector3(y0, width, floor) };
  mat.userData.frontFade = u;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uFrontFade = u;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vErY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvErY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vErY;\nuniform vec3 uFrontFade;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      { float f = smoothstep(uFrontFade.x, uFrontFade.x + uFrontFade.y, vErY); diffuseColor.rgb *= mix(uFrontFade.z, 1.0, f * f); }`);
  };
  mat.customProgramCacheKey = () => prevKey() + '|frontfade';
  return mat;
}
