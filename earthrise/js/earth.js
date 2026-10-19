// The small lit Earth. Three looks share one interface:
//  • procedural (default when the manifest has no earth GLB): day/night shader — blue oceans, low-saturation land
//    (one colour, no borders), white cloud swirls, warm window lights on the night side, faint warm translucency from
//    the LED inside, thin blue atmospheric limb. No orange halo (docs/visual_review.md #7).
//  • mesh + mask (the Tripo Earth): the same day/night shader on the Tripo model itself. Its geometry (continents
//    raised 0.4 mm over the oceans, as printed) gives the relief shading, softened toward the sphere by uRelief — the
//    relief is in the shading only: the outline is the round sphere at the continents' radius (v4.1, see VERT); its
//    continents come from the asset module's mask (props/earth_mask.png: R land, G shallow shelf, B the windows Tripo
//    painted), so the coastlines are Tripo's while the paint — oceans, clouds, terminator, city lights, limb — is the
//    web's. The GLB's baked colours are not used in this mode.
//  • mesh only: the asset module's GLB (painted look baked into baseColor, LED light in emissive) — we drive its emissive.
import * as THREE from '../vendor/three/three.module.js';

// NOISE (mod289, permute, taylorInvSqrt, snoise) is the 3D simplex noise of webgl-noise, src/noise3D.glsl
// ("Array and textureless GLSL 2D/3D/4D simplex noise functions"), author Ian McEwan, Ashima Arts; maintainer Stefan
// Gustavson (stegu). It is the 2011 version (Lastmod 20110822, ijm; unchanged through 2016): kernel 0.6 − r², scale
// 42.0 and permutation ((x*34.0)+1.0)*x — upstream later moved to 0.5 / 105.0 (2020) and a new permutation (2021).
// Only the formatting is ours (fewer lines, comments dropped); fbm() below it is ours. Sources:
// https://github.com/ashima/webgl-noise and https://github.com/stegu/webgl-noise (LICENSE, the same file in both).
// Licence text, which the licence requires to travel with the code:
//
//   Copyright (C) 2011 by Ashima Arts (Simplex noise)
//   Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//   THE SOFTWARE.
const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int k=0;k<5;k++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
`;

const VERT = /* glsl */`
varying vec3 vObj; varying vec3 vN; varying vec3 vSN; varying vec3 vW;
uniform float uRound;     // 1: drawn round on screen wherever it is in the frame (see below); 0: the plain perspective
#ifdef USE_MASK
uniform mat4 uLocal;      // mesh -> earth local: the GLB's own node transform (meshopt dequantisation), constant
uniform mat4 uLocalInv;
uniform float uRland;     // the continents' radius (earth local, mm): the whole outline sits on it (v4.1)
varying vec2 vUv;
${NOISE}
#endif
void main(){
#ifdef USE_MASK
  // v4.1: the Tripo model's seas sit 0.4 mm below its land, so its outline was 2–3 % out of round wherever a sea met
  // the edge (and cut flat at the poles, review #4). Every vertex now sits on the sphere at the land's radius along its
  // own direction (the web mesh is an icosphere resampled from the model, so the directions are smooth): the outline is
  // the round sphere; the continents keep their relief in the shading (vN, the model's own normals) and their
  // coastlines in the mask. The polar ice is shaded as the round sphere (the same field as the fragment shader's).
  vec3 lp = (uLocal * vec4(position, 1.0)).xyz;
  vec3 n = normalize(lp);
  float ice = smoothstep(0.80, 0.90, abs(n.z) + 0.05 * snoise(n * 9.0));
  vec4 wp = modelMatrix * (uLocalInv * vec4(n * uRland, 1.0));
  vec3 ctr = (modelMatrix * (uLocalInv * vec4(0.0, 0.0, 0.0, 1.0))).xyz;
  vObj = n;
  vSN = normalize(mat3(modelMatrix * uLocalInv) * n);   // the round sphere's normal, world
  vN = normalize(mix(normalize(mat3(modelMatrix) * normal), vSN, ice));
  vUv = uv;
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 ctr = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vObj = normalize(position); vSN = vN;
#endif
  vW = wp.xyz;
  // v4.1: round on screen. A sphere seen off the lens axis projects to an ellipse stretched away from the axis
  // (≈ 1/cos of its angle off it: 1.02 at 12°, more while the visitor drags the view). Each vertex's direction from the
  // camera is turned with the rotation that brings the Earth's centre onto the axis, where the sphere's image is a
  // circle, and that circle is drawn where the true ellipse is: centred on the ellipse's centre, with its short
  // semi-axis as radius (the circle inscribed in it, so it never shows more of the Earth than the true sphere would —
  // it stays hidden behind the ridge exactly where the sphere is). Depth is the vertex's own.
  vec3 vp = (viewMatrix * wp).xyz, cv = (viewMatrix * vec4(ctr, 1.0)).xyz;
  float D = length(cv), Rw = length(wp.xyz - ctr), sa = Rw / max(D, 1e-4);
  vec3 ch = cv / max(D, 1e-4);
  float th = acos(clamp(-ch.z, -1.0, 1.0)), al = asin(clamp(sa, 0.0, 0.999));
  if (uRound > 0.5 && sa < 0.95 && th + al < 1.45 && vp.z < -1e-3) {
    vec3 ax = vec3(-ch.y, ch.x, 0.0);                    // ch × (0, 0, −1)
    float s = length(ax), c = -ch.z;
    vec3 dv = normalize(vp), rv = dv;
    if (s > 1e-6) { vec3 k = ax / s; rv = dv * c + cross(k, dv) * s + k * dot(k, dv) * (1.0 - c); }
    if (rv.z < -1e-4) {
      vec2 q = rv.xy / -rv.z;                            // the image with the centre on the axis: a circle of radius tan(al)
      vec2 rad = s > 1e-6 ? cv.xy / length(cv.xy) : vec2(0.0);
      float ct = cos(th), tc = 0.5 * (tan(th + al) + tan(th - al));
      float b = sa / sqrt(max(ct * ct - sa * sa, 1e-6)), ta = sa / sqrt(1.0 - sa * sa);
      vp.xy = (rad * tc + q * (b / ta)) * -vp.z;
    }
  }
  gl_Position = projectionMatrix * vec4(vp, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3 uSun;      // world, toward the key light
uniform float uGlow;    // 0..1  LED inside
uniform float uDay;     // how strongly the key light paints the day side
uniform float uTime;
uniform vec4 uFlat;     // a > 0.5: one flat colour, unlit (the checks' masks), same geometry
varying vec3 vObj; varying vec3 vN; varying vec3 vSN; varying vec3 vW;
#ifdef USE_MASK
uniform sampler2D uMask;  // R land, G shallow shelf (wide blur of land), B windows painted on the Tripo model
uniform float uRelief;    // 0 = round sphere shading, 1 = the model's full relief
uniform float uWindows;   // how strongly the painted windows light up on the night side
varying vec2 vUv;
#endif
${NOISE}
void main(){
  vec3 p = vObj;                                   // earth local: −Y = front (toward the viewer when raised)
  vec3 V = normalize(cameraPosition - vW);
  vec3 S = normalize(vSN);                         // round: limb, glint
  vec3 N = normalize(mix(S, normalize(vN), USE_RELIEF));   // relief: sunlight
  float ndv = max(dot(S, V), 0.0);
#ifdef USE_MASK
  vec3 mk = texture2D(uMask, vUv).rgb;
  float land = smoothstep(0.30, 0.70, mk.r);
  float coast = smoothstep(0.05, 0.75, mk.g) * (1.0 - land);
  float wnd = mk.b;
#else
  // continents (biased so the front face carries land)
  float c = fbm(p * 1.35 + vec3(0.3, 2.1, 5.7)) + 0.16 * (-p.y) + 0.06 * fbm(p * 6.0);
  float land = smoothstep(0.03, 0.075, c);
  float coast = smoothstep(0.10, 0.0, abs(c - 0.05));
  float wnd = 0.0;
#endif
  float ice = smoothstep(0.80, 0.90, abs(p.z) + 0.05 * snoise(p * 9.0));
  vec3 ocean = mix(vec3(0.010, 0.040, 0.120), vec3(0.020, 0.105, 0.240), coast * (1.0 - land));
  float tint = fbm(p * 3.1 + 7.0);
  vec3 ground = mix(vec3(0.200, 0.175, 0.105), vec3(0.135, 0.150, 0.085), smoothstep(-0.2, 0.3, tint));
  vec3 albedo = mix(ocean, ground, land);
  albedo = mix(albedo, vec3(0.80, 0.82, 0.86), ice);
  // clouds: domain-warped swirls, slow drift
  vec3 q = p * 2.2 + vec3(0.0, 0.0, uTime * 0.004);
  q += 0.55 * vec3(snoise(q + 3.0), snoise(q + 11.0), snoise(q + 19.0));
  float cl = smoothstep(0.08, 0.55, fbm(q) + 0.08) * 0.85;
  albedo = mix(albedo, vec3(0.86, 0.88, 0.92), cl);
  // key light: soft terminator
  // (terminator from the round sphere; brightness from the relief, which clouds smooth over)
  float day = smoothstep(-0.10, 0.30, dot(S, normalize(uSun)));
  float ndl = dot(normalize(mix(N, S, cl)), normalize(uSun));
  vec3 col = albedo * (0.012 + 1.6 * max(ndl, 0.0) + 0.10 * day) * uDay;
  // specular glint on oceans
  vec3 H = normalize(normalize(uSun) + V);
  col += (1.0 - land) * (1.0 - cl) * pow(max(dot(S, H), 0.0), 60.0) * 0.35 * day * uDay;
  // night side (review #4): the shell is thinner over the seas, so the LED inside shows the seas faintly and the land
  // darker still; city lights only on land, in clusters near the coasts, as small points (not confetti over the deserts)
  float night = 1.0 - day;
#ifdef USE_MASK
  float inland = texture2D(uMask, vUv, 4.5).r;     // the land blurred over a few degrees (mipmap): below 1 near a coast
#else
  float inland = smoothstep(0.03, 0.16, c);
#endif
  float coastal = land * (1.0 - smoothstep(0.72, 0.99, inland));
  float clump = smoothstep(-0.15, 0.45, snoise(p * 4.0 + vec3(4.0, 1.0, 7.0)));
  // The windows Tripo painted on the model (mask B) are blobs a few degrees across: even cut down to their cores
  // (v3.1) three or four stayed as single large spots inland (central Africa, Arabia: "a lamp in the desert", review
  // v3.1). They now only make the small coastal points a little denser where they are, never a spot of their own.
  float city = smoothstep(0.58, 0.88, snoise(p * 52.0)) * clump * coastal * (1.0 + WINDOWS * smoothstep(0.5, 1.0, wnd));
  col += vec3(1.00, 0.72, 0.40) * min(city, 1.0) * land * (1.0 - cl * 0.7) * night * uGlow * 3.2;
  // the LED through the shell: the seas brighter (thinner shell), the land darker but not black (×0.45: v3.1's ×0.3
  // left Africa a black cut-out on the cover, review v3.1)
  vec3 trans = mix(vec3(0.50, 0.58, 0.78), vec3(0.62, 0.50, 0.36) * 0.45, land) * (1.0 - 0.6 * cl);
  col += trans * uGlow * (0.012 + 0.032 * pow(ndv, 1.5)) * (0.35 + 0.65 * night);
  // thin blue limb (Earth has an atmosphere; the Moon does not — so blue, never orange)
  float fres = pow(1.0 - ndv, 3.0);
  col += vec3(0.20, 0.42, 1.00) * fres * (0.55 * day * uDay + 0.25 * uGlow);
  gl_FragColor = uFlat.a > 0.5 ? vec4(uFlat.rgb, 1.0) : vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ATMO_FRAG = /* glsl */`
uniform float uGlow; uniform float uDay; uniform vec3 uSun;
varying vec3 vObj; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
  float r = 1.0 - abs(dot(N, V));
  float a = pow(smoothstep(0.0, 1.0, 1.0 - r), 6.0);           // fades out quickly away from the limb
  float lit = 0.35 + 0.65 * smoothstep(-0.3, 0.4, dot(N, normalize(uSun)));
  vec3 col = vec3(0.18, 0.38, 1.0) * a * (0.35 * uDay * lit + 0.22 * uGlow);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// relief and window strength for the Tripo Earth (mesh + mask): tuned against the procedural Earth from the table and
// from the rim (docs/final_earth_compare.png, tools/web_earth_compare.mjs)
export const TRIPO_LOOK = { relief: 0.5, windows: 0.4 };

export function makeEarth({ diameter = 32, segments = 128, mesh = null, mask = null } = {}) {
  const R = diameter / 2;
  const grp = new THREE.Group(); grp.name = 'earth';
  const uniforms = { uSun: { value: new THREE.Vector3(-1, -0.3, 0.2) }, uGlow: { value: 0 }, uDay: { value: 1 }, uTime: { value: 0 },
    uFlat: { value: new THREE.Vector4(0, 0, 0, 0) }, uRound: { value: 1 } };
  const ROUND = { USE_RELIEF: '0.0', WINDOWS: '0.0' };
  let glowMats = [];
  let body;
  if (mesh && mask) {
    body = mesh;
    mask.flipY = false; mask.colorSpace = THREE.NoColorSpace;           // glTF UV convention; data, not colour
    mask.anisotropy = 4; mask.needsUpdate = true;
    body.updateMatrix();
    body.traverse(o => {
      if (!o.isMesh) return;
      const rel = new THREE.Matrix4();                                   // this mesh -> earth local (body sits at the origin)
      for (let n = o; n; n = n.parent) { n.updateMatrix(); rel.premultiply(n.matrix); if (n === body) break; }
      const u = { ...uniforms, uMask: { value: mask }, uRelief: { value: TRIPO_LOOK.relief }, uWindows: { value: TRIPO_LOOK.windows },
        uLocal: { value: rel }, uLocalInv: { value: rel.clone().invert() }, uRland: { value: R } };
      o.material = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG,
        defines: { USE_MASK: '', USE_RELIEF: 'uRelief', WINDOWS: 'uWindows' } });
      o.castShadow = false; o.receiveShadow = false;
    });
  } else if (mesh) {
    body = mesh;
    body.traverse(o => {
      if (!o.isMesh) return;
      const m0 = Array.isArray(o.material) ? o.material[0] : o.material;
      const m = new THREE.MeshStandardMaterial({
        map: m0?.map || null, color: m0?.color?.clone() || new THREE.Color(1, 1, 1), roughness: 0.75, metalness: 0,
        emissiveMap: m0?.emissiveMap || null, emissive: m0?.emissive?.clone() || new THREE.Color(1, 0.86, 0.7),
      });
      m.userData.emissive0 = m.emissive.clone();
      if (!m.emissiveMap && m0?.map) { m.emissiveMap = m0.map; }
      o.material = m; o.castShadow = false; o.receiveShadow = false;
      glowMats.push(m);
    });
  } else {
    const g = new THREE.SphereGeometry(R, segments, Math.round(segments * 0.75));
    g.rotateX(Math.PI / 2);                                              // poles on ±Z (earth local Z is up)
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, defines: ROUND });
    body = new THREE.Mesh(g, mat);
  }
  body.name = 'earth_body';
  grp.add(body);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 64, 48), new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  atmo.name = 'earth_atmo'; atmo.renderOrder = 2;
  grp.add(atmo);
  const api = {
    group: grp, radius: R, uniforms, look: mesh ? (mask ? 'mesh+mask' : 'mesh') : 'procedural',
    setGlow(g) {
      uniforms.uGlow.value = g;
      for (const m of glowMats) m.emissiveIntensity = 0.55 * g;
    },
    setSunWorld(v) { uniforms.uSun.value.copy(v); },
    // tooling (GPU masks): draw the body in one flat colour with its real (shader-lifted) outline; null = normal
    // tooling: 1 = drawn round wherever it is on screen (the default, v4.1), 0 = the plain perspective
    setRound(on) { uniforms.uRound.value = on ? 1 : 0; },
    setFlat(rgb) { if (rgb) uniforms.uFlat.value.set(rgb[0], rgb[1], rgb[2], 1); else uniforms.uFlat.value.set(0, 0, 0, 0); },
    tick(t) { uniforms.uTime.value = t; },
  };
  return api;
}
