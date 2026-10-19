// Scene, camera rig, kinematics and rendering. Coordinates are DESIGN.md §1 (mm; X right, Y back, Z up), camera.up = +Z.
import * as THREE from '../vendor/three/three.module.js';
import { buildTerrain, addEarthLight, addFrontFade } from './terrain.js';
import { makeEarth } from './earth.js';
import { proceduralWatcher, proceduralMech } from './figures.js';

const D2R = Math.PI / 180;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, goal, tau, dt) => cur + (goal - cur) * (1 - Math.exp(-dt / tau));
export const FLIGHT_S = 2.6;          // table ⇄ rim camera move (s); reduced motion cuts instead (main.js)
export const FACE_S = 3.6;            // js/config.js FACE_ARC: the watcher's eye → its face, a slow arc round its head (s)
export const FACE_MAX_OFF = 12;       // the face shot: the Earth's centre at most this far (deg) off the lens axis — round, not an egg
export const FACE_MAX_STRETCH = 1.09;  // … and the watcher's head at most this stretched by the lens (1/cos of its angle off the axis)
// The Tripo watcher paints itself with vertex colours. Which candidate it is comes from the manifest
// (world.watcher.model, props/watcher/selected.json), and the two are treated differently:
//  • c3 "daedalus sprite" (v2 and v4): grey moon rock, darker in its craters and cracks — kept as Tripo painted it,
//    under a warm dark tint (WATCHER_TINT, v2's) so it stays darker than the lit terrain and its craters read from behind.
//  • c1 "hopeful moon spirit" (v3): a light body whose grey drifts warm in places (an orange-brown band round its seat
//    read as dirt on the rim), pink cheeks, a yellow crescent on its right side, dark eyes. The page repaints it once on
//    load (repaintWatcher): the body neutral moon-rock grey at its own lightness, the cheeks kept (a little richer), the
//    crescent kept (a little paler), found by colour and by where they sit relative to the eye; the body grey is then
//    scaled to `albedo`, a little darker than the lit terrain (≈ 0.2), so it never out-shines the Moon (review #5).
const WATCHER_TINT = [0.50, 0.47, 0.43];
const WATCHER_PAINT = { albedo: 0.14, cheek: 1.25, crescent: 0.7 };
// The face shot (FACE_ARC), where the watcher is the subject: the low sun turned down on it to a soft side light, a
// faint fill from the camera side so the shadowed cheek keeps its shape, and the Earth as its key light — its own term
// (earthGain) plus one weak light on the watcher alone from the Earth's direction, warmer, wrapped round to the side of
// the face the camera sees (`warm`). Only the watcher's material changes; the Moon around it stays as lit as before.
// Blended in with the camera move (Stage.faceK). Per model:
//  • c1 (v3.1): body grey up to 0.18; Earth ×1.2 + warm 1.8. Its face toward the Earth reached ≈ 235/255 (p95 of the
//    head's displayed luminance) and the cheeks washed out (review v3.1).
//  • c3 (v4): its own rock paint under the tint ×`tint`; the Earth's back-light edge (rimGain) turned down — it was
//    what burnt the face's edge toward the Earth — and the warm light up, so the lit side reads warm (face R−B ≈ 30)
//    with its craters still in it: the face's displayed luminance p95 ≈ 196, brightest channel p99 ≈ 220 of 255.
const FACE_LOOK = { albedo: 0.18, earthGain: 1.2, rimGain: 1.2, sun: 0.2, fill: [0.06, 0.06, 0.07],
  warm: 1.8, warmWrap: 0.8, warmCol: [1.0, 0.58, 0.3] };
const FACE_LOOK_C3 = { tint: 1.2, earthGain: 1.1, rimGain: 0.6, sun: 0.25, fill: [0.05, 0.05, 0.06],
  warm: 2.6, warmWrap: 0.6, warmCol: [1.0, 0.6, 0.32] };

export class Stage {
  constructor(canvas, world, q) {
    this.world = world; this.q = q; this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.dpr = Math.min(window.devicePixelRatio || 1, q.dprMax);
    r.setPixelRatio(this.dpr);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false;
    r.setClearColor(0x000000, 1); r.autoClear = false; r.info.autoReset = false;

    const scene = this.scene = new THREE.Scene();
    const cam = this.camera = new THREE.PerspectiveCamera(30, 1, 2, 9000); cam.up.set(0, 0, 1);

    // ---------------- kinematics (assembly.json: global = Translate(axis)·RotX(θ)·p_rotor)
    const K = world.kin;
    if (Math.abs(K.dir[0] - 1) > 1e-6) console.warn('[stage] axis is not +X; rotor assumes +X');
    this.REST = K.rest; this.RAISE = K.raise; this.ledOn = K.ledOn;
    this.axis = new THREE.Vector3(...K.axis);
    this.rotor = new THREE.Group(); this.rotor.matrixAutoUpdate = false; scene.add(this.rotor);
    this.theta = K.rest;

    // ---------------- shared "light from the Earth" uniforms
    // uEarthRim: the back-light edge, which needs the disc itself in view (no floor while the Earth is still hidden)
    this.earthLight = { uEarthPosV: { value: new THREE.Vector3() }, uEarthCol: { value: new THREE.Color(0, 0, 0) }, uEarthRim: { value: new THREE.Color(0, 0, 0) } };

    // ---------------- terrain
    const hm = world.hm;
    if (world.terrainObj) {
      this.terrain = world.terrainObj;
    } else {
      this.terrain = buildTerrain(hm, { step: q.terrainStep, texMax: q.texMax, maps: world.terrainMaps, aniso: q.aniso ?? 4 });
    }
    const top = this.terrain.userData.top;
    // the tile's front edge cuts two crater walls in half; lit, they read as curls of white paper (review #7):
    // fade the last few millimetres of the top surface toward the black of the painted sides
    addFrontFade(top.material, { y0: hm.y0, width: 18, floor: 0.1 });
    addEarthLight(top.material, this.earthLight, { falloff: 40, rim: 0.6 });
    this.terrain.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(this.terrain);

    // ---------------- materials for the machine: near-black matte; arm/ears/tube are unlit "no-reflection black"
    // (visual_review #5: Musou black / flocking) so the LED never paints them. The knob used to keep a soft sheen; seen
    // from the table it poked above the far right corner as a lit grey fitting (review: "a pipe joint behind the rim"),
    // so it is now unlit black too and turns warm under the mouse (main.js); the on-screen dial is the cue to turn it.
    this.MAT = {
      plinth: new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.9, metalness: 0 }),
      void: new THREE.MeshBasicMaterial({ color: 0x050506 }),
      knob: new THREE.MeshBasicMaterial({ color: 0x050506 }),     // unlit like the arm: even a black, rough PBR knob kept a grey Fresnel sheen
    };
    const matFor = (name, hint) => {
      if (hint === 'plinth' || /^(plinth|bottom_cover|usb_clamp)$/.test(name)) return this.MAT.plinth;
      if (name === 'knob') return this.MAT.knob;
      return this.MAT.void;
    };
    let meshes = world.meshes;
    if (!Object.keys(meshes).length) meshes = proceduralMech(K, world.earth.T);
    this.parts = {};
    for (const [name, m] of Object.entries(meshes)) {
      if (/earth/.test(name)) continue;
      const mat = matFor(name, m.material);
      m.obj.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = mat === this.MAT.plinth; } });
      const holder = new THREE.Group(); holder.name = name; holder.add(m.obj);
      (m.frame === 'rotor' ? this.rotor : scene).add(holder);
      this.parts[name] = holder;
    }
    this.machine = Object.values(this.parts);

    // ---------------- Earth (rides the rotor)
    this.earth = makeEarth({ diameter: world.earth.diameter, segments: q.earthSeg, mesh: world.earth.obj, mask: world.earth.mask });
    const eg = this.earth.group; eg.matrixAutoUpdate = false; eg.matrix.copy(world.earth.T);
    this.rotor.add(eg);
    this.earthLocalCentre = new THREE.Vector3();          // earth local origin = centre
    // dawn: before the first pixel of the Earth clears the ridge, its LED already lights the sky behind it, so the far
    // ridge shows as a silhouette (video script V1: "a warm glow appears behind the far ridge"). A camera-facing additive
    // sprite at the Earth's centre, depth-tested so the terrain cuts it; cool → warm white, never orange (review #4).
    const gc = document.createElement('canvas'); gc.width = gc.height = 128;
    { const c = gc.getContext('2d'), gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, 128, 128); }
    const gtex = new THREE.CanvasTexture(gc); gtex.colorSpace = THREE.SRGBColorSpace;
    this.glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, color: 0xdfe6ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false }));
    this.glowSprite.name = 'earth_glow'; this.glowSprite.scale.setScalar(this.earth.radius * 6); this.glowSprite.renderOrder = 1;
    this.glowSprite.visible = false;
    eg.add(this.glowSprite);
    this._glowCool = new THREE.Color(0xdfe6ff); this._glowWarm = new THREE.Color(0xffe6c8);

    // ---------------- watcher
    const wobj = world.watcher.obj || proceduralWatcher(world.watcher.height);
    // lit at the edges by the Earth (review #5); paint per model (WATCHER_TINT / WATCHER_PAINT above). The procedural
    // stand-in is a dark silhouette.
    let wColours = false;
    wobj.traverse(o => { if (o.isMesh && o.geometry.attributes.color) wColours = true; });
    this.watcherModel = !wColours ? 'standin' : world.watcher.model === 'hopeful-moon-spirit' ? 'c1' : 'tripo';
    const c1 = this.watcherModel === 'c1';
    // its own copy of the Earth-light colours (same position uniform): the face shot turns them up on the watcher alone
    this.watcherLight = { uEarthPosV: this.earthLight.uEarthPosV, uEarthCol: { value: new THREE.Color(0, 0, 0) }, uEarthRim: { value: new THREE.Color(0, 0, 0) } };
    this.faceLight = { uFaceSun: { value: 1 }, uFaceFill: { value: new THREE.Color(0, 0, 0) }, uFaceFillDirV: { value: new THREE.Vector3(0.35, 0.45, 0.82).normalize() },
      uFaceWarm: { value: new THREE.Color(0, 0, 0) }, uFaceWarmWrap: { value: 0.6 } };
    // the Tripo watcher's Earth light: a wider rim than the stand-in's, so the head, ears and shoulders pick up a warm
    // edge as the Earth clears the ridge (c1: a softer wrap, so its light back stays moon-grey)
    const wmat = addFaceLight(addEarthLight(new THREE.MeshStandardMaterial(wColours
      ? { color: c1 ? new THREE.Color(1, 1, 1) : new THREE.Color(...WATCHER_TINT), roughness: 0.92, metalness: 0, vertexColors: true }
      : { color: 0x2e2c29, roughness: 1, metalness: 0, vertexColors: false }),
    this.watcherLight, wColours ? { falloff: 120, wrap: c1 ? 0.2 : 0.35, rim: 2.4, rimPow: 2 } : { falloff: 120, wrap: 0.35, rim: 1.6 }), this.faceLight);
    this.faceLook = { ...(this.watcherModel === 'tripo' ? FACE_LOOK_C3 : FACE_LOOK) };
    this.watcherMat = wmat;
    wobj.traverse(o => { if (o.isMesh) { o.material = wmat; o.castShadow = true; o.receiveShadow = true; } });
    this.watcher = new THREE.Group(); this.watcher.matrixAutoUpdate = false; this.watcher.matrix.copy(world.watcher.T);
    this.watcher.add(wobj); scene.add(this.watcher);
    const wh = world.watcher.height;
    this.watcherEye = new THREE.Vector3(...(world.watcher.eye || [0, 1.2, wh * 0.74])).applyMatrix4(world.watcher.T);
    // which way its face points (baked into the model; manifest watcher.face_ccw_from_plus_y_deg, seen from above)
    const fa = (world.watcher.faceDeg || 0) * D2R;
    this.watcherFacing = new THREE.Vector3(-Math.sin(fa), Math.cos(fa), 0);
    this.watcher.updateMatrixWorld(true);
    // material colour on the table and in the face shot (c1: the repainted body grey scaled to the albedo; c3: its tint,
    // × FACE_LOOK_C3.tint in the face shot; the stand-in: lighter)
    this.watcherTint = [wmat.color.clone(), wColours ? wmat.color.clone() : new THREE.Color(0x5a554e)];
    if (c1) {
      this.watcherPaintStats = repaintWatcher(wobj, this.watcherEye, this.watcherFacing, WATCHER_PAINT);
      const g = this.watcherPaintStats.body, sc = a => g > 1e-3 ? a / g : 1;
      wmat.color.setScalar(sc(WATCHER_PAINT.albedo));
      this.watcherTint = [wmat.color.clone(), new THREE.Color().setScalar(sc(FACE_LOOK.albedo))];
    }
    this.watcherBox = new THREE.Box3().setFromObject(this.watcher);
    // the head: a sphere through the eye, centred behind it (the face shot swings the camera round this centre)
    const wb = this.watcherBox, headR = Math.min(wb.max.x - wb.min.x, wb.max.y - wb.min.y) * 0.32;
    this.watcherHead = this.watcherEye.clone().addScaledVector(this.watcherFacing, -headR);
    this.watcherHeadR = headR;

    // ---------------- lights: one low key light (one shadow map), a breath of sky, nothing else
    this.sun = new THREE.DirectionalLight(0xf3f5fa, q.sunIntensity ?? 4.6);
    this.sun.castShadow = true;
    this.sun.shadow.camera.up.set(0, 0, 1);
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.12; this.sun.shadow.radius = 2;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8c9ab8, 0x000000, 0.16); scene.add(this.hemi);
    this.setSun(world.sunAzDeg ?? -100, world.sunElDeg ?? 15);

    // ---------------- stars (very faint at the table, clear from the rim)
    this.stars = makeStars(q.stars); scene.add(this.stars);

    // ---------------- knob pick proxy (kept out of the scene; matrices synced by hand)
    const kb = new THREE.Box3();
    if (this.parts.knob) { this.parts.knob.updateMatrixWorld(true); kb.setFromObject(this.parts.knob.children[0]); }
    else kb.set(new THREE.Vector3(98, -14, -14), new THREE.Vector3(129.5, 20, 14));
    // the box above is in world coords of an un-rotated rotor at the origin, i.e. rotor frame
    this.knobBox = kb.clone();
    const kc = kb.getCenter(new THREE.Vector3()), kr = Math.max(14, Math.hypot(kb.max.y, kb.max.z, kb.min.y, kb.min.z) / 1.6);
    const proxy = this.knobProxy = new THREE.Mesh(new THREE.CylinderGeometry(kr + 6, kr + 6, (kb.max.x - kb.min.x) + 10, 32), new THREE.MeshBasicMaterial());
    proxy.rotation.z = Math.PI / 2; proxy.position.set(kc.x, 0, 0); proxy.updateMatrix();
    this.knobCentreRotor = new THREE.Vector3(kc.x, 0, 0);

    // ---------------- dial (the on-screen 3D knob, drawn with a scissor pass into the same canvas)
    this._buildDial(kb);

    // ---------------- camera rig
    this.landmarks = world.landmarks;
    this.size = { w: Math.max(1, window.innerWidth || 1), h: Math.max(1, window.innerHeight || 1) };
    const F = this._framing();
    this.view = { az: F.az, el: F.el, dist: F.dist };          // the default table pose for this screen shape
    this.target = F.target.clone();
    this.rig = {
      mode: 'table', t: 0, tGoal: 0,                    // 0 = table, 1 = rim
      az: F.az, el: F.el, dist: F.dist, azG: F.az, elG: F.el, distG: F.dist, vAz: 0, vEl: 0,
      yaw: 0, pitch: 0, yawG: 0, pitchG: 0, rimFov: 36, rimFovG: 36,
      fit: { fov: 26, ox: 0, oy: 0 }, intro: 0,
      f: 0, fGoal: 0, face: null,                       // on the rim: 0 = the watcher's eye … 1 = the face shot (FACE_ARC)
    };
    this.limits = { az: [-24, 24], el: [11, 33], dist: [340, 640] };

    this.visFrac = 0; this.glow = 0; this.led = 0; this._visKey = '';
    this.setTheta(K.rest);
    this._shadowFrames = 3;
  }

  // desktop: swap the 1k terrain maps for the 2k ones once the first frames are on screen
  async upgradeTerrainMaps() {
    const H = this.world.terrainMapsHQ, mat = this.terrain.userData.top.material;
    if (!H?.normal || !mat.normalMap) return false;
    const tl = new THREE.TextureLoader();
    const load = (u, srgb) => u ? tl.loadAsync(u).then(t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.q.aniso ?? 8; return t; }) : null;
    const [n, a, o] = await Promise.all([load(H.normal), load(H.albedo, true), load(H.ao)]);
    const swap = (key, t) => { if (!t) return; const old = mat[key]; mat[key] = t; old?.dispose(); };
    swap('normalMap', n); swap('map', a); swap('aoMap', o);
    return true;
  }

  setSun(azDeg, elDeg) {
    this.sunAz = azDeg; this.sunEl = elDeg;
    const a = azDeg * D2R, e = elDeg * D2R;
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e));
    this.sunDir = dir;
    const c = new THREE.Vector3(0, 10, 0);
    this.sun.target.position.copy(c); this.sun.position.copy(c).addScaledVector(dir, 600);
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
    // fit the ortho shadow camera to the tile + watcher in light space
    const view = new THREE.Matrix4().lookAt(this.sun.position, c, new THREE.Vector3(0, 0, 1));
    const inv = new THREE.Matrix4().makeBasis(...[0, 1, 2].map(i => new THREE.Vector3().setFromMatrixColumn(view, i))).invert();
    const pts = [];
    for (const x of [-92, 92]) for (const y of [-77, 77]) for (const z of [0, 46]) pts.push(new THREE.Vector3(x, y, z).sub(this.sun.position).applyMatrix4(inv));
    const b = new THREE.Box3().setFromPoints(pts);
    const sc = this.sun.shadow.camera;
    sc.left = b.min.x - 2; sc.right = b.max.x + 2; sc.bottom = b.min.y - 2; sc.top = b.max.y + 2;
    sc.near = Math.max(1, -b.max.z - 10); sc.far = -b.min.z + 10; sc.updateProjectionMatrix();
    this.earth?.setSunWorld(dir);
    this._shadowFrames = 3;
  }

  _buildDial(kbRotor) {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(20, 1, 1, 2000); cam.up.set(0, 0, 1);
    const g = new THREE.Group(); scene.add(g);
    // lighter than before so it reads on black, and the L-handle (everything beyond the Ø28 disc) glows faintly warm:
    // "hold here" (review #3)
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.38, metalness: 0.0 });
    const gripCol = { value: new THREE.Color(0x6a4a22) };
    mat.onBeforeCompile = sh => {
      sh.uniforms.uGripCol = gripCol;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vErP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvErP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vErP;\nuniform vec3 uGripCol;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGripCol * smoothstep(15.0, 17.0, length(vErP.yz));');
    };
    mat.customProgramCacheKey = () => 'dialgrip';
    if (this.parts.knob) {
      const k = this.parts.knob.children[0].clone(true);
      k.traverse(o => { if (o.isMesh) o.material = mat; });
      g.add(k);
    }
    // a short stub of shaft so the knob reads as mounted
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 18, 24), new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9 }));
    stub.rotation.z = Math.PI / 2; stub.position.x = kbRotor.min.x - 6; g.add(stub);
    const key = new THREE.DirectionalLight(0xffffff, 4.0); key.position.set(500, -320, 420); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd0ff, 1.6); rim.position.set(-100, 300, 200); scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const c = kbRotor.getCenter(new THREE.Vector3());
    const R = Math.max(kbRotor.max.y, -kbRotor.min.y, kbRotor.max.z, -kbRotor.min.z) + 3;
    const dir = new THREE.Vector3(1, -0.3, 0.3).normalize();
    const dist = R / Math.sin(cam.fov / 2 * D2R) * 1.3;
    cam.position.copy(c).addScaledVector(dir, dist); cam.lookAt(c.x, 0, 0); cam.updateProjectionMatrix();
    this.dial = { scene, cam, group: g, rect: null, centre: new THREE.Vector3(c.x, 0, 0), R };
  }
  setDialRect(r) { this.dial.rect = r; }
  dialCentreCss() {          // where the knob axis lands inside the dial rect (CSS px, relative to the rect)
    const d = this.dial; if (!d.rect) return null;
    const p = d.centre.clone().project(d.cam);
    return { x: (p.x + 1) / 2 * d.rect.width, y: (1 - p.y) / 2 * d.rect.height };
  }

  Trotor(th) { const m = new THREE.Matrix4().makeRotationX(th * D2R); m.setPosition(this.axis); return m; }
  setTheta(th) {
    this.theta = th;
    this.rotor.matrix.copy(this.Trotor(th)); this.rotor.matrixWorldNeedsUpdate = true;
    this.dial.group.rotation.x = th * D2R;
  }
  earthCentre(th = this.theta, out = new THREE.Vector3()) {
    return out.setFromMatrixPosition(this.Trotor(th).multiply(this.world.earth.T));
  }

  // fraction of the Earth's disc that a straight line from `eye` reaches without passing under the terrain surface
  earthVisible(eye) { return this.earthVisibleAt(eye, this.theta); }
  earthVisibleAt(eye, th) {
    const hm = this.world.hm, c = this.earthCentre(th), R = this.earth.radius;
    const f = c.clone().sub(eye).normalize();
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 0, 1)).normalize(), u = new THREE.Vector3().crossVectors(r, f);
    let n = 0, vis = 0;
    const p = new THREE.Vector3();
    for (const rr of [0, 0.45, 0.8, 0.98]) for (let k = 0; k < (rr ? 12 : 1); k++) {
      const a = 2 * Math.PI * (k + (rr === 0.8 ? 0.5 : 0)) / 12;
      p.copy(c).addScaledVector(r, rr * R * Math.cos(a)).addScaledVector(u, rr * R * Math.sin(a));
      n++; if (segmentClear(hm, eye, p)) vis++;
    }
    return vis / n;
  }

  // ---------------- camera
  resize(w, h) {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._fit();
  }
  // Default table framing per screen shape (review #7): the pose, the points that must be in the picture, and the NDC
  // box they go into. The lens (FOV + view offset) is fitted to that box, so the plinth runs off the bottom of the
  // frame instead of filling it, and the raised Earth comes out larger:
  //   wide screens   same pose as before (az −6°, 17° down, 470 mm); only the tile, the raised Earth and the top band
  //                  of the plinth are fitted, the box is taller — Earth ≈ 1.5× its old size, plinth mostly cropped
  //   phones upright a closer, lower eye (14° down, 400 mm, from the right-front: az +12°) aimed at the far rim and
  //                  framed on the far half of the tile, so the watcher stands in the foreground looking at the Earth;
  //                  horizon and Earth in the upper middle, crater floor below; the tile's sides and the plinth leave
  //                  the frame (Earth ≈ 2.3× its old 50 px)
  //   phones sideways a column on the left for the closing lines; the model takes the right (review #2)
  _framing() {
    const { w, h } = this.size, portrait = h > w * 1.05, short = !portrait && h < 520;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const earth = [[0, 114, 46], [-18, 114, 29], [18, 114, 29]];          // raised Earth: top and sides (+2 mm air)
    // every shape orbits about the same point (0, 14, 4): the orbit envelope (az ±24°, el 11–33°, 340–640 mm) is the one
    // the occlusion check proves at rest — a pivot further back let one corner of it see past the tile's side
    if (portrait) return { portrait, short, az: 12, el: 14, dist: 400, target: V(0, 14, 4), rimFov: 54,
      pts: [...earth, [44, -27, 17], [58, -27, 17], [51, -25, 42], [10, -60, 10], [-45, 75, 18]],     // + the watcher, near ground, left ridge
      box: { fx: 0.94, fy: 0.60, cx: 0, cy: -0.05 } };
    if (short) return { portrait, short, az: -6, el: 17, dist: 470, target: V(0, 14, 4), rimFov: 40,
      pts: [...earth, [-90, 75, 18], [90, 75, 18], [-90, -75, 10], [90, -75, 10], [0, -81, -10]],
      box: { fx: 0.62, fy: 0.80, cx: 0.18, cy: -0.06 } };
    return { portrait, short, az: -6, el: 17, dist: 470, target: V(0, 14, 4), rimFov: 34,
      pts: [...earth, [-90, 75, 18], [90, 75, 18], [-90, -75, 10], [90, -75, 10], [0, -81, -10]],
      box: { fx: 0.90, fy: 0.80, cx: 0.04, cy: -0.10 } };
  }
  _tablePose(az, el, dist) {
    const a = az * D2R, e = el * D2R;
    return this.target.clone().add(new THREE.Vector3(Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e)).multiplyScalar(dist));
  }
  _fit() {
    // choose the lens (FOV + view offset) for the default table pose so the framing points fill the layout box
    const F = this._framing(), L = F.box, R = this.rig;
    // a new screen shape brings its own default pose; follow it unless the visitor has moved the camera
    const atDefault = Math.abs(R.azG - this.view.az) < 1e-6 && Math.abs(R.elG - this.view.el) < 1e-6 && Math.abs(R.distG - this.view.dist) < 1e-6;
    this.view = { az: F.az, el: F.el, dist: F.dist }; this.target.copy(F.target);
    if (atDefault) Object.assign(R, { azG: F.az, elG: F.el, distG: F.dist });
    const eye = this._tablePose(F.az, F.el, F.dist);
    const m = new THREE.Matrix4().lookAt(eye, this.target, new THREE.Vector3(0, 0, 1));
    const inv = new THREE.Matrix4().makeBasis(...[0, 1, 2].map(i => new THREE.Vector3().setFromMatrixColumn(m, i))).invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of F.pts) {
      const v = new THREE.Vector3(...p).sub(eye).applyMatrix4(inv);   // camera space: −z forward
      const tx = v.x / -v.z, ty = v.y / -v.z;
      x0 = Math.min(x0, tx); x1 = Math.max(x1, tx); y0 = Math.min(y0, ty); y1 = Math.max(y1, ty);
    }
    const asp = this.size.w / this.size.h;
    const hv = Math.max((y1 - y0) / 2 / L.fy, (x1 - x0) / 2 / L.fx / asp);
    const fov = 2 * Math.atan(hv) / D2R;
    const ccx = (x0 + x1) / 2 / (hv * asp), ccy = (y0 + y1) / 2 / hv;
    R.fit = { fov, ox: -(L.cx - ccx) * this.size.w / 2, oy: (L.cy - ccy) * this.size.h / 2 };
    R.rimFovG = R.rimFov = this._rimFov0 = F.rimFov;
    this.portrait = F.portrait;
    R.face = this._facePose();
  }

  // The face shot (js/config.js FACE_ARC; main.js: after the first climax, after every later rise on the rim, and on
  // "See the watcher"): the watcher in profile from
  // its left, its face lit by the Earth it is looking at, the risen Earth over the far rim on the other side of the
  // frame. A camera that sees a face and the far thing that face looks at must stand off their line, and the nearer it
  // stands the wider the two are apart (52° from 140 mm in v3.1: the watcher at the lens's edge, stretched 1.29×). So
  // the camera stands farther out on the watcher's left — 200–230 mm, past the tile's edge (the tile floats in the dark
  // on the rim, with the plinth hidden) and a little higher, where the two are 29–33° apart: the Earth ≤ 12° off the
  // lens axis (round) and the watcher's head ≤ FACE_MAX_STRETCH; never so high that it would see over the far ridge to
  // the Earth at rest. The lens and its shift are solved at run time (_facePose) for the screen and the page's text.
  // Whether there is a shot depends on the screen's proportions, not its pixel count (review v3.1: a 1366×657 laptop
  // window, whose framing was as large in proportion as a 1600×900 one's, was skipped by fixed 160 / 80 px floors):
  // sideways screens need a round Earth ≥ 17 % of the height and a face ≥ 7.5 % (and ≥ 80 / 36 px). Upright screens
  // (v4.1; v4 had no shot there: side by side, the Earth would be ≈ 6 % of the height) stack the two instead: the
  // camera stands behind the watcher's left shoulder (az 160°), a little above it, so the risen Earth is in the upper
  // part of the tall frame and the watcher below it, seen from behind and the side, turned to its Earth — the Earth
  // ≥ 18 % of the width (≥ 70 px), the watcher from its knees up in the frame.
  _faceFraming() {
    const { w, h } = this.size, portrait = h > w * 1.05, short = !portrait && h < 520;
    const T = this.faceTune;                              // dev / tooling override (tools/web_variant_shoot.mjs)
    const shape = portrait ? 'portrait' : short ? 'short' : 'wide';
    // cams: where the camera may stand, round the eye (az: degrees from straight ahead toward its left, el: degrees up,
    // dist: mm); the first that fits this screen and its free space is used (or the best miss)
    // v4 review: az 86° first — 12° further round toward its face than 98°, so c3's eye socket is in the shot (the
    // head ≈ 1.08 stretched, under FACE_MAX_STRETCH); where that does not fit (e.g. an iPad held sideways), 98° and the rest
    const cams = [{ az: 86, el: 12, dist: 230 }, { az: 98, el: 16, dist: 230 }, { az: 92, el: 13, dist: 230 }, { az: 104, el: 13, dist: 200 }, { az: 104, el: 10, dist: 200 }];
    // short screens (phones held sideways): the watcher's whole box, down to its knees (body: the share of its height
    // left out at the bottom), must be in the frame too, not just its head (v4 review: 844×390 kept only its head and
    // face, 932×430 80 % of its box); no such framing → no shot, the camera stays at the eye (as at 780×360)
    const camsUp = [{ az: 160, el: 16, dist: 130 }, { az: 160, el: 16, dist: 180 }, { az: 170, el: 24, dist: 130 }, { az: 150, el: 16, dist: 130 }];
    const F = portrait ? { cams: camsUp, room: 1.06, minEarth: Math.max(70, Math.round(0.18 * w)), minFace: Math.max(36, Math.round(0.1 * w)), body: 0.25 }
      : { cams, room: short ? 1.06 : 1.08, minEarth: Math.max(80, Math.round(0.17 * h)), minFace: Math.max(36, Math.round(0.075 * h)), ...(short ? { body: 0.25 } : {}) };
    return { shape, maxOff: FACE_MAX_OFF, maxStretch: FACE_MAX_STRETCH, ...F, ...(T?.[shape] || {}) };
  }
  // The screen space the face shot may use (CSS px): the frame minus the page's text and controls, which main.js measures
  // (setFaceUI). Without it: the whole frame less a margin.
  setFaceUI(ui) { this.faceUI = ui; this.rig.face = this._facePose(); }
  // The face shot's camera, lens and lens shift. A sphere drawn away from the middle of a wide lens stretches into an
  // egg (1/cos of its angle off the lens axis: 1.14 at the old 30°), and the face and the Earth it looks at are 45–60°
  // apart from any spot over the tile — so the lens axis goes through the Earth (at most `maxOff`° off it, toward the
  // watcher), and the lens is shifted (an off-centre frustum, like a view camera's rising front) to put the two where
  // the free space is: the Earth stays round wherever it lands on screen, the watcher takes the edge of the lens (a head
  // stretched by a few per cent reads as a head; an egg-shaped Earth does not). Per camera position (F.cams) and axis
  // offset: the Earth's silhouette (24 points on its tangent circle, +6 %) and a box round the head (ears and chin) in
  // the lens's tangent plane; the largest scale at which both boxes fit the free space clear of `avoid` (bisection; the
  // shift by a grid search), less `room`. Per camera: the axis offset with the biggest Earth whose face box is ≥ minFace;
  // the first camera (F.cams, in order) that reaches minEarth and minFace is used. ≈ 5 ms a camera, on resize and when
  // the shot starts. Returns the pose found (else the best miss, fits false: no shot).
  _facePose(F = this._faceFraming()) {
    const f = this.watcherFacing, l = new THREE.Vector3(-f.y, f.x, 0), up = new THREE.Vector3(0, 0, 1), hm = this.world.hm;
    const P = this.watcherEye, E = this.earthCentre(this.RAISE), hR = this.watcherHeadR;
    const { w, h } = this.size, m = 12;
    const ui = this.faceUI || {}, safe = ui.safe || [m, m, w - m, h - m], avoid = ui.avoid || [];
    const Rr = this.earth.radius * 1.06, hr = hR * 1.45;
    const Hc = this.watcherHead.clone().add(new THREE.Vector3(0, 0, hr * 0.25));
    const pH = []; for (const dx of [-hr, hr]) for (const dy of [-hr, hr]) for (const dz of [-hr, hr]) pH.push(Hc.clone().add(new THREE.Vector3(dx, dy, dz)));
    // the face box (eyes, cheeks, mouth), as the checks measure it (tools/web_integrate_check.mjs faceMeasure)
    const fr = hR * 0.7, fc = P.clone().addScaledVector(f, -hR * 0.35), pF = [];
    for (const dx of [-fr, fr]) for (const dy of [-fr, fr]) for (const dz of [-fr, fr * 0.5]) pF.push(fc.clone().add(new THREE.Vector3(dx, dy, dz)));
    // the watcher's box from F.body of its height up (short screens: its knees and up must be in the frame as well)
    const wb = this.watcherBox, pB = [];
    if (F.body != null) for (const x of [wb.min.x, wb.max.x]) for (const y of [wb.min.y, wb.max.y]) for (const z of [wb.min.z + F.body * (wb.max.z - wb.min.z), wb.max.z]) pB.push(new THREE.Vector3(x, y, z));
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4(), v = new THREE.Vector3();
    const bbox = (C, pts) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pts) { v.copy(p).sub(C); const z = -v.dot(Z); if (z < 0.5) return null; const x = v.dot(X) / z, y = v.dot(Y) / z;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return [x0, y0, x1, y1]; };
    // a box in the tangent plane → screen (CSS px, y down) at scale s (px per unit tangent) with the lens axis at (cx, cy)
    const scr = (b, s, cx, cy) => [cx + s * b[0], cy - s * b[3], cx + s * b[2], cy - s * b[1]];
    const marg = b => { let mg = Math.min(b[0] - safe[0], b[1] - safe[1], safe[2] - b[2], safe[3] - b[3]);
      for (const r of avoid) mg = Math.min(mg, Math.max(r[0] - b[2], b[0] - r[2], r[1] - b[3], b[1] - r[3]));
      return mg; };
    const place = (bE, bH, s, n = 28) => {                       // the lens-axis position with the most margin at scale s
      const x0 = Math.min(bE[0], bH[0]), x1 = Math.max(bE[2], bH[2]), y0 = Math.min(bE[1], bH[1]), y1 = Math.max(bE[3], bH[3]);
      const ca = safe[0] - s * x0, cb = safe[2] - s * x1, ya = safe[1] + s * y1, yb = safe[3] + s * y0;
      if (ca > cb || ya > yb) return null;
      // rows in proportion to the free height over the free width, capped: when the two only just fit across (cb − ca
      // → 0), an uncapped grid grew to ~10⁴ rows a call: 55–87 ms a solve on 1024×768 and an iPad held sideways, now ≈ 2
      const ny = Math.min(3 * n, Math.max(4, Math.round(n * (yb - ya) / Math.max(1, cb - ca)))); let B = null;
      for (let i = 0; i <= n; i++) for (let j = 0; j <= ny; j++) {
        const cx = ca + (cb - ca) * i / n, cy = ya + (yb - ya) * j / ny, mg = Math.min(marg(scr(bE, s, cx, cy)), marg(scr(bH, s, cx, cy)));
        if (!B || mg > B.mg) B = { mg, cx, cy };
      }
      return B;
    };
    let best = null;
    for (const cam of F.cams) {
      if (best && best.earthPx >= F.minEarth && best.facePx >= F.minFace) break;          // the preferred camera fits
      let bestCam = null;
      const a = cam.az * D2R, e = cam.el * D2R;
      const C = P.clone().addScaledVector(f, Math.cos(a) * Math.cos(e) * cam.dist).addScaledVector(l, Math.sin(a) * Math.cos(e) * cam.dist).addScaledVector(up, Math.sin(e) * cam.dist);
      if (hm) {                                                   // clear of the ground (off the tile: above its nearest edge), seeing the Earth and the face
        if (C.z < hm.sample(clamp(C.x, hm.x0, hm.x1), clamp(C.y, hm.y0, hm.y1)) + 4) continue;
        if (this.earthVisibleAt(C, this.RAISE) < 0.99 || !segmentClear(hm, C, fc) || !segmentClear(hm, C, P)) continue;
        if (this.earthVisibleAt(C, this.REST + 2) > 0) continue;  // never a spot that sees over the ridge to the Earth at rest (2° to spare)
      }
      const vE = E.clone().sub(C), DE = vE.length(); vE.normalize();
      const vH = this.watcherHead.clone().sub(C).normalize(), turn = new THREE.Vector3().crossVectors(vE, vH).normalize();
      // the Earth's silhouette: its tangent circle seen from C
      const a1 = new THREE.Vector3().crossVectors(vE, up).normalize(), a2 = new THREE.Vector3().crossVectors(a1, vE);
      const cc = E.clone().addScaledVector(vE, -Rr * Rr / DE), rr = Rr * Math.sqrt(1 - Rr * Rr / (DE * DE)), pE = [];
      for (let k = 0; k < 24; k++) { const t = 2 * Math.PI * k / 24; pE.push(cc.clone().addScaledVector(a1, rr * Math.cos(t)).addScaledVector(a2, rr * Math.sin(t))); }
      for (let off = F.maxOff; off >= 0; off -= 2) {
        const d = vE.clone().applyAxisAngle(turn, off * D2R);
        // the watcher at the edge of the lens is stretched by 1/cos of its angle off the axis: its head ≤ maxStretch
        const stretch = 1 / Math.cos(Math.acos(clamp(d.dot(vH), -1, 1)));
        if (stretch > F.maxStretch) continue;
        M.lookAt(C, v.copy(C).add(d), up); X.setFromMatrixColumn(M, 0); Y.setFromMatrixColumn(M, 1); Z.setFromMatrixColumn(M, 2);
        const bE = bbox(C, pE), bF = bbox(C, pF), bH0 = bbox(C, pH), bB = pB.length ? bbox(C, pB) : null;
        if (!bE || !bH0 || !bF || (pB.length && !bB)) continue;
        const apart = (a, b) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1];
        if (!apart(bE, bH0) || (bB && !apart(bE, bB))) continue;   // the head (or its body) would cover the Earth
        const bH = bB ? [Math.min(bH0[0], bB[0]), Math.min(bH0[1], bB[1]), Math.max(bH0[2], bB[2]), Math.max(bH0[3], bB[3])] : bH0;
        let lo = 20, hi = 20000;
        if (!(place(bE, bH, lo)?.mg >= 0)) continue;
        for (let i = 0; i < 14; i++) { const mid = Math.sqrt(lo * hi); if (place(bE, bH, mid)?.mg >= 0) lo = mid; else hi = mid; }
        const s = lo / (F.room || 1), at = place(bE, bH, s, 40);
        const earthPx = s * (bE[2] - bE[0]) / 1.06, facePx = s * Math.min(bF[2] - bF[0], bF[3] - bF[1]);
        const score = earthPx * Math.min(1, facePx / F.minFace);
        if (!bestCam || score > bestCam.score + 1e-6) bestCam = { score, eye: C, dir: d, s, cx: at.cx, cy: at.cy, margin: Math.round(at.mg), off, cam, earthPx, facePx,
          psi: Math.acos(clamp(vE.dot(vH), -1, 1)) / D2R, stretch };
      }
      const ok = c => c && c.earthPx >= F.minEarth && c.facePx >= F.minFace;
      if (bestCam && (!best || (ok(bestCam) && !ok(best)) || (!ok(best) && bestCam.score > best.score))) best = bestCam;
    }
    if (!best) return { eye: P.clone(), dir: E.clone().sub(P).normalize(), fov: this._rimFov0 || 36, ox: 0, oy: 0, F, fits: false };
    return { eye: best.eye, dir: best.dir, fov: 2 * Math.atan(h / 2 / best.s) / D2R, ox: w / 2 - best.cx, oy: h / 2 - best.cy, F,
      fits: best.earthPx >= F.minEarth && best.facePx >= F.minFace, margin: best.margin, offAxis: best.off, cam: best.cam,
      earthPx: Math.round(best.earthPx), facePx: Math.round(best.facePx), psi: +best.psi.toFixed(1), stretch: +best.stretch.toFixed(3) };
  }
  // to / from the face shot (only while on the rim); cut: jump there (reduced motion hides it behind a fade, main.js)
  setFace(on, { cut = false } = {}) {
    const R = this.rig; if (R.mode !== 'rim') return;
    R.fGoal = on ? 1 : 0; R.yawG = R.pitchG = 0; R.rimFovG = this._rimFov0;
    if (cut) { R.f = R.fGoal; R.yaw = R.pitch = 0; R.rimFov = R.rimFovG; }
  }
  orbit(dxPx, dyPx) {
    const R = this.rig;
    // on the rim: look round from the eye; in the face shot only a little (v4.1: a full drag there pushed the Earth out of
    // the frame, and it did not come back)
    if (R.mode === 'rim') { const k = R.fGoal > 0 ? 0.25 : 1; R.yawG = clamp(R.yawG - dxPx * 0.12, -28 * k, 28 * k); R.pitchG = clamp(R.pitchG + dyPx * 0.1, -14 * k, 12 * k); return; }
    R.azG = clamp(R.azG - dxPx * 0.16, ...this.limits.az); R.elG = clamp(R.elG + dyPx * 0.12, ...this.limits.el);
  }
  fling(vx, vy) { this.rig.vAz = -vx * 0.16; this.rig.vEl = vy * 0.12; }
  zoom(f) {
    const R = this.rig;
    if (R.mode === 'rim') R.rimFovG = clamp(R.rimFovG * f, 20, 64);
    else R.distG = clamp(R.distG * f, ...this.limits.dist);
  }
  // cut: jump straight to the end of the move (prefers-reduced-motion: main.js hides the cut behind a short fade)
  // Going to the rim always means the watcher's eye (the face shot is the first climax's, main.js); leaving it, the
  // flight back starts from wherever the camera is on the rim — eye or face — and the face is let go once on the table.
  setMode(m, { cut = false } = {}) {
    const R = this.rig; R.mode = m; R.tGoal = m === 'rim' ? 1 : 0; R.yawG = R.pitchG = 0;
    R.fGoal = m === 'rim' ? 0 : R.f;
    if (cut) { R.t = R.tGoal; R.yaw = R.pitch = 0; R.rimFov = R.rimFovG; R.f = R.fGoal; }
  }
  // double-click / double-tap: the default view (v4.1: on the rim too — the look straight ahead and the lens)
  resetView() { Object.assign(this.rig, { azG: this.view.az, elG: this.view.el, distG: this.view.dist, vAz: 0, vEl: 0, yawG: 0, pitchG: 0, rimFovG: this._rimFov0 ?? this.rig.rimFovG }); }
  startIntro() { if (this.q.reducedMotion) return; const R = this.rig; R.intro = 1; R.az = 7; R.el = R.elG + 7; R.dist = R.distG * 1.32; }

  _updateCamera(dt) {
    const R = this.rig, cam = this.camera;
    if (!R.dragging) {
      if (Math.abs(R.vAz) > 0.01 || Math.abs(R.vEl) > 0.01) {
        R.azG = clamp(R.azG + R.vAz * dt * 60, ...this.limits.az); R.elG = clamp(R.elG + R.vEl * dt * 60, ...this.limits.el);
        R.vAz *= Math.exp(-dt / 0.18); R.vEl *= Math.exp(-dt / 0.18);
      }
    }
    const tau = R.intro > 0 ? 0.9 : 0.12;
    if (R.intro > 0) R.intro = Math.max(0, R.intro - dt / 3.2);
    R.az = damp(R.az, R.azG, tau, dt); R.el = damp(R.el, R.elG, tau, dt); R.dist = damp(R.dist, R.distG, tau, dt);
    R.yaw = damp(R.yaw, R.yawG, 0.15, dt); R.pitch = damp(R.pitch, R.pitchG, 0.15, dt); R.rimFov = damp(R.rimFov, R.rimFovG, 0.15, dt);
    // mode blend: table ⇄ the watcher's eye, FLIGHT_S long, eased at both ends (the climax flight, review #6)
    const speed = dt / FLIGHT_S;
    R.t = R.tGoal > R.t ? Math.min(R.tGoal, R.t + speed) : Math.max(R.tGoal, R.t - speed);
    if (R.t <= 0) R.f = R.fGoal = 0;                            // back on the table: the next visit to the rim is the eye
    const fs = dt / FACE_S;
    R.f = R.fGoal > R.f ? Math.min(R.fGoal, R.f + fs) : Math.max(R.fGoal, R.f - fs);
    const k = ease(R.t);
    const { eye, tgt, fov: rimFov, ox: fox, oy: foy } = this._poseAt(k);
    cam.position.copy(eye); cam.up.set(0, 0, 1); cam.lookAt(tgt);
    cam.fov = R.fit.fov + (rimFov - R.fit.fov) * k;
    cam.near = k > 0.5 ? 0.6 : 2;
    const { w, h } = this.size;
    // lens shift: the table framing's (fades out on the way to the rim) and the face shot's (fades in along its arc)
    const ox = R.fit.ox * (1 - k) + fox * k, oy = R.fit.oy * (1 - k) + foy * k;
    if (Math.abs(ox) > 0.01 || Math.abs(oy) > 0.01) cam.setViewOffset(w, h, ox, oy, w, h); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    // what to show
    const inRim = k > 0.55;
    for (const p of this.machine) p.visible = !inRim;
    // the camera sits in the watcher's head at its eye; once the face shot has taken it out of the head, the watcher shows
    this.watcher.visible = k < 0.9 || (R.f > 0 && this.watcherClear(eye));
    this.faceK = R.f > 0 ? k * smoother(R.f) : 0;
    this.stars.material.uniforms.uOpacity.value = 0.38 + 0.62 * k;
    return k;
  }
  // is a camera at `p` far enough out of the watcher to draw it (outside its box, or well outside its head)
  watcherClear(p) {
    return !this.watcherBox.containsPoint(p) || p.distanceTo(this.watcherHead) > this.watcherHeadR * 2.2;
  }

  // camera eye + look target (+ the rim end's lens) at blend k (0 table … 1 rim, already eased), from the rig's current
  // table pose and rim look; on the rim, rig.f blends the watcher's eye into the face shot along an arc round its head
  _poseAt(k, R = this.rig) {
    const eyeT = this._tablePose(R.az, R.el, R.dist), tgtT = this.target;
    let eyeR = this.watcherEye, rimFov = R.rimFov;
    const ecR = this.earthCentre(this.RAISE).add(new THREE.Vector3(0, 0, this.portrait ? -5 : 4));   // portrait: tilt down so the rim fills the tall frame
    const look = ecR.distanceTo(eyeR);                          // the eye looks at the Earth: keep that target distance
    let fwd = ecR.clone().sub(eyeR).normalize(), ox = 0, oy = 0;
    if (R.f > 0 && R.face) {
      // position: round the head from the eye to the face camera — the radius opens and the direction swings from
      // straight ahead to front-left-above, so the camera steps out through the face (looking away from it, so the
      // watcher appears behind the camera) and turns back. Aim: from the Earth to the face shot's aim, starting a little
      // later than the move, so the watcher enters from the frame's edge once the camera is clear of it.
      const s = smoother(R.f), H = this.watcherHead;
      const a0 = eyeR.clone().sub(H), a1 = R.face.eye.clone().sub(H), r0 = a0.length(), r1 = a1.length();
      const q = new THREE.Quaternion().setFromUnitVectors(a0.normalize(), a1.normalize()), qs = new THREE.Quaternion().slerp(q, s);
      eyeR = H.clone().add(a0.applyQuaternion(qs).multiplyScalar(r0 + (r1 - r0) * s));
      const sa = smoother(clamp((R.f - 0.12) / 0.88, 0, 1));
      // the aim starts from the Earth as seen from where the camera is now (not from the eye), so the Earth stays near
      // the lens axis all the way round — off the axis, a wide lens would swell it again
      fwd = ecR.clone().sub(eyeR).normalize();
      const qa = new THREE.Quaternion().setFromUnitVectors(fwd, R.face.dir.clone().normalize());
      fwd = fwd.clone().applyQuaternion(new THREE.Quaternion().slerp(qa, sa));
      const zoom = R.rimFov / this._rimFov0;                     // the visitor's pinch / wheel on the rim, kept
      const fovFace = clamp(R.face.fov * zoom, 12, 118);
      // The Earth's size on screen goes from its size at the eye to its size in the face shot steadily (smootherstep in
      // f), wherever the camera is on the way: the lens follows the distance (a dolly zoom). The arc first steps out
      // through the face, toward the Earth; with the lens simply blended, the Earth swelled by ≈ 30 % mid-arc and shrank
      // again (review v3.1). tanA: the tangent of the Earth's angular radius from a point.
      const E = this.earthCentre(this.RAISE), rE = this.earth.radius;
      const tanA = p => { const D2 = Math.max(p.distanceToSquared(E), rE * rE * 1.0001); return rE / Math.sqrt(D2 - rE * rE); };
      const k0 = tanA(this.watcherEye) / Math.tan(R.rimFov * D2R / 2), k1 = tanA(R.face.eye) / Math.tan(fovFace * D2R / 2);
      rimFov = clamp(2 * Math.atan(tanA(eyeR) / (k0 + (k1 - k0) * s)) / D2R, 12, 118);
      ox = (R.face.ox || 0) * sa; oy = (R.face.oy || 0) * sa;   // the lens shift comes in with the aim
    }
    fwd.applyMatrix4(new THREE.Matrix4().makeRotationZ(R.yaw * D2R));
    const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 0, 1)).normalize();
    fwd.applyAxisAngle(side, R.pitch * D2R);
    const tgtR = eyeR.clone().add(fwd.multiplyScalar(look));
    const eye = eyeT.clone().lerp(eyeR, k), tgt = tgtT.clone().lerp(tgtR, k);
    eye.z += Math.sin(Math.PI * k) * 18;                        // a slight lift so the move arcs over the rim
    return { eye, tgt, fov: rimFov, ox, oy };
  }
  // The climax flight leaves the table once the Earth has begun to clear the far ridge (main.js CLIMAX_VIS). On the way
  // the camera first climbs a little (it sees more of the disc) and then comes down to the watcher's eye, where the
  // ridge stands higher: with the crank held, the Earth would sink back behind it before the landing. So the crank
  // follows this schedule: at each of n points of the flight (rig.t, linear in time; ≈ every 3 frames), the smallest
  // angle — never lower than the one before — at which the camera there sees at least as much of the disc as it has
  // seen so far. Heightmap ray tests (≈ 0.06–0.1 ms each, ≈ 15–30 ms in all, once). Returns [{ t, th }], t = 0 … 1.
  flightRiseSchedule(v0, th0, n = 48) {
    const out = [{ t: 0, th: th0 }];
    let th = th0, vmax = v0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, eye = this._poseAt(ease(t)).eye;
      let v = this.earthVisibleAt(eye, th);
      if (v < vmax) { th = this.thetaForVis(eye, vmax, th, th + 10); v = this.earthVisibleAt(eye, th); }
      vmax = Math.max(vmax, v);
      out.push({ t, th });
    }
    return out;
  }
  // the smallest crank angle in [lo, RAISE] at which `eye` sees at least the fraction v of the Earth's disc (searched
  // in [lo, hi] first)
  thetaForVis(eye, v, lo = this.REST, hi = this.RAISE) {
    if (this.earthVisibleAt(eye, lo) >= v) return lo;
    hi = Math.min(this.RAISE, hi);
    if (this.earthVisibleAt(eye, hi) < v) { lo = hi; hi = this.RAISE; }
    for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; if (this.earthVisibleAt(eye, m) >= v) hi = m; else lo = m; }
    return hi;
  }

  // screen-space (CSS px) direction a knob surface point moves per radian of θ — for direct-drive dragging
  knobPick(raycaster) {
    const m = this.Trotor(this.theta);
    this.knobProxy.matrixWorld.multiplyMatrices(m, this.knobProxy.matrix);
    const hit = raycaster.intersectObject(this.knobProxy, false)[0];
    if (!hit) return null;
    return { rotorPoint: hit.point.clone().applyMatrix4(m.clone().invert()) };
  }
  knobScreenTangent(rotorPoint) {
    const m = this.Trotor(this.theta), P = rotorPoint.clone().applyMatrix4(m);
    const eps = 0.02, P2 = rotorPoint.clone().applyMatrix4(this.Trotor(this.theta + eps / D2R));
    const a = this.toScreen(P), b = this.toScreen(P2);
    return { x: (b.x - a.x) / eps, y: (b.y - a.y) / eps };
  }
  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.size.w, y: (1 - p.y) / 2 * this.size.h, z: p.z };
  }

  setPixelRatio(p) { this.dpr = p; this.renderer.setPixelRatio(p); this.renderer.setSize(this.size.w, this.size.h, false); }

  render(dt, time) {
    const k = this._updateCamera(dt);
    this.camera.updateMatrixWorld();
    this.earth.tick(time);
    this.scene.updateMatrixWorld();
    // Earth light: LED switch (assembly optional_switch) + how much of the disc clears the horizon from this eye
    const fromRest = this.theta - this.REST;
    const ledGoal = fromRest >= (this.ledOn[0] ?? 2) ? 1 : 0;
    this.led = damp(this.led, ledGoal, 0.12, dt);
    const key = `${this.theta.toFixed(2)}|${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)}`;
    if (key !== this._visKey) { this._visKey = key; this.visFrac = this.world.hm ? this.earthVisible(this.camera.position) : 1; }
    const vis = this.visFrac;
    const glowGoal = this.led * (0.22 + 0.78 * (vis * vis * (3 - 2 * vis)));
    this.glow = damp(this.glow, glowGoal, 0.22, dt);
    this.earth.setGlow(this.glow);
    // dawn glow behind the ridge: only while the disc is (mostly) hidden, fading in over the first part of the travel
    const prog = clamp((this.theta - this.REST) / (this.RAISE - this.REST), 0, 1);
    const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const dawn = this.led * (1 - vis) * ss(0.03, 0.30, prog);
    this.dawn = dawn;
    this.glowSprite.visible = dawn > 0.002;
    this.glowSprite.material.opacity = 0.42 * dawn;
    this.glowSprite.material.color.copy(this._glowCool).lerp(this._glowWarm, ss(0.05, 0.6, prog));
    this.earth.uniforms.uDay.value = 0.62 + 0.38 * Math.min(1, this.glow / 0.9);
    const ec = this.earthCentre();
    this.earthLight.uEarthPosV.value.copy(ec).applyMatrix4(this.camera.matrixWorldInverse);
    const s = this.led * (0.35 + 0.65 * vis) * 1.25;
    this.earthLight.uEarthCol.value.setRGB(1.0 * s, 0.80 * s, 0.60 * s);
    const sr = this.led * vis * 1.25;
    this.earthLight.uEarthRim.value.setRGB(1.0 * sr, 0.80 * sr, 0.60 * sr);
    // the watcher: lit as the terrain is, until the face shot makes it the subject (FACE_LOOK, blended with the move)
    const fk = this.faceK || 0, FL = this.faceLook;
    this.watcherMat.color.copy(this.watcherTint[0]).lerp(this.watcherTint[1], fk);
    if (this.watcherModel === 'tripo') this.watcherMat.color.multiplyScalar(1 + ((FL.tint ?? 1) - 1) * fk);
    this.watcherLight.uEarthCol.value.copy(this.earthLight.uEarthCol.value).multiplyScalar(1 + (FL.earthGain - 1) * fk);
    this.watcherLight.uEarthRim.value.copy(this.earthLight.uEarthRim.value).multiplyScalar(1 + (FL.rimGain - 1) * fk);
    this.faceLight.uFaceSun.value = 1 + (FL.sun - 1) * fk;
    this.faceLight.uFaceFill.value.setRGB(FL.fill[0] * fk, FL.fill[1] * fk, FL.fill[2] * fk);
    // the warm light from the Earth: only as much as the Earth itself is lit and in view (LED on, over the ridge)
    const wk = fk * FL.warm * this.led * (0.35 + 0.65 * vis);
    this.faceLight.uFaceWarm.value.setRGB(FL.warmCol[0] * wk, FL.warmCol[1] * wk, FL.warmCol[2] * wk);
    this.faceLight.uFaceWarmWrap.value = FL.warmWrap;
    this.stars.material.uniforms.uTime.value = time;
    if (this._shadowFrames > 0) { this.renderer.shadowMap.needsUpdate = true; this._shadowFrames--; }

    const r = this.renderer, { w, h } = this.size;
    r.info.reset();
    r.setScissorTest(false); r.setViewport(0, 0, w, h);
    r.clear(); r.render(this.scene, this.camera);
    this.mainInfo = { tris: r.info.render.triangles, calls: r.info.render.calls };
    const d = this.dial;
    if (d.rect && d.rect.width > 0) {
      const x = d.rect.left, y = h - d.rect.top - d.rect.height;
      r.setScissorTest(true); r.setScissor(x, y, d.rect.width, d.rect.height); r.setViewport(x, y, d.rect.width, d.rect.height);
      d.cam.aspect = d.rect.width / d.rect.height; d.cam.updateProjectionMatrix();
      r.clearDepth(); r.render(d.scene, d.cam);
      r.setScissorTest(false); r.setViewport(0, 0, w, h);
    }
    return k;
  }
}

function smoother(f) { return f * f * f * (f * (f * 6 - 15) + 10); }   // smootherstep: a slow start and a long settle

// The watcher's own light for the face shot (uniforms in `u`, driven by Stage.render): the sun's direct light scaled by
// uFaceSun, plus a soft fill from a fixed direction in view space (from the camera's upper right), so the side the Earth
// does not reach keeps its shape, plus a weak warm light from the Earth's direction (uFaceWarm, wrapped by uFaceWarmWrap;
// uEarthPosV comes from addEarthLight, which this wraps). Only the watcher's material gets this; the terrain is not touched.
function addFaceLight(mat, u) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFaceSun;\nuniform vec3 uFaceFill;\nuniform vec3 uFaceFillDirV;\nuniform vec3 uFaceWarm;\nuniform float uFaceWarmWrap;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.directDiffuse *= uFaceSun; reflectedLight.directSpecular *= uFaceSun;
      reflectedLight.indirectDiffuse += diffuseColor.rgb * uFaceFill * (0.3 + 0.7 * max(dot(normal, uFaceFillDirV), 0.0));
      { vec3 Lw = normalize(uEarthPosV + vViewPosition);           // toward the Earth, view space
        reflectedLight.directDiffuse += diffuseColor.rgb * uFaceWarm * max((dot(normal, Lw) + uFaceWarmWrap) / (1.0 + uFaceWarmWrap), 0.0); }`);
  };
  mat.customProgramCacheKey = () => prevKey() + '|facelight';
  return mat;
}

// The watcher's paint (WATCHER_PAINT, see the top of this file), rewritten in its vertex colours once. Colours are
// judged in sRGB terms (hue, saturation, value), positions relative to the eye: `fwd` along the facing, `side` to the
// watcher's left, `up`. Cheeks: pink-to-salmon, a little saturated, under and beside the eyes on the face. Crescent:
// gold, saturated, on its right side. Dark marks (eyes, mouth) keep their darkness, as grey. Everything else becomes
// the neutral grey of its own luminance. Returns the body's mean luminance (what the albedo is scaled against) and counts.
function repaintWatcher(obj, eye, facing, W) {
  const enc = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const v = new THREE.Vector3(), out = { body: 0, n: 0, cheek: 0, crescent: 0 };
  let bodySum = 0, bodyN = 0;
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    const C = o.isMesh && o.geometry.attributes.color, P = o.isMesh && o.geometry.attributes.position; if (!C || !P) return;
    for (let i = 0; i < C.count; i++) {
      const r = C.getX(i), g = C.getY(i), b = C.getZ(i), L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const R = enc(r), G = enc(g), B = enc(b), mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx > 1e-3 ? (mx - mn) / mx : 0;
      let h = 0; if (mx > mn) { h = mx === R ? ((G - B) / (mx - mn)) % 6 : mx === G ? (B - R) / (mx - mn) + 2 : (R - G) / (mx - mn) + 4; h *= 60; if (h < 0) h += 360; }
      v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld).sub(eye);
      const fwd = v.x * facing.x + v.y * facing.y, side = v.x * -facing.y + v.y * facing.x, up = v.z;
      const onFace = fwd > -2 && up > -7 && up < 1.5, cheekHue = h >= 330 || h <= 32, goldHue = h >= 26 && h <= 62;
      const kCheek = onFace && cheekHue ? ss(0.08, 0.2, sat) : 0;
      const kMoon = !onFace && goldHue && side < -3 ? ss(0.2, 0.32, sat) * ss(0.35, 0.5, mx) : 0;
      const k = Math.max(kCheek * W.cheek, kMoon * W.crescent);
      C.setXYZ(i, Math.max(0, L + (r - L) * k), Math.max(0, L + (g - L) * k), Math.max(0, L + (b - L) * k));
      if (kCheek > 0.5) out.cheek++; else if (kMoon > 0.5) out.crescent++; else if (mx > 0.3) { bodySum += L; bodyN++; }
      out.n++;
    }
    C.needsUpdate = true;
  });
  out.body = bodyN ? bodySum / bodyN : 0;
  return out;
}

function segmentClear(hm, a, b) {
  // march only across the tile's XY box; one sample per ~0.6 grid cells
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[a.x, dx, hm.x0, hm.x1], [a.y, dy, hm.y0, hm.y1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return true; continue; }
    let u0 = (lo - p) / d, u1 = (hi - p) / d; if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
  }
  if (t0 >= t1) return true;
  const len = Math.hypot(dx, dy) * (t1 - t0), n = Math.max(2, Math.ceil(len / (hm.dx * 1.5)));
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * i / n;
    if (t >= 0.999) break;
    const x = a.x + dx * t, y = a.y + dy * t, z = a.z + (b.z - a.z) * t;
    if (z < hm.sample(x, y)) return false;
  }
  return true;
}

function makeStars(n) {
  const pos = new Float32Array(n * 3), mag = new Float32Array(n);
  let s = 1234567;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    let x, y, z, l;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = Math.hypot(x, y, z); } while (l > 1 || l < 0.1 || z / l < -0.25);
    pos.set([x / l * 4000, y / l * 4000 + 10, z / l * 4000], i * 3);
    mag[i] = Math.pow(rnd(), 3.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.4 }, uTime: { value: 0 }, uPx: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    vertexShader: `attribute float mag; varying float vM; uniform float uPx; uniform float uTime;
      void main(){ vM = mag * (0.85 + 0.15 * sin(uTime * (0.6 + mag * 2.0) + position.x));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = (0.9 + 1.6 * mag) * uPx; }`,
    fragmentShader: `uniform float uOpacity; varying float vM;
      void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(d));
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * (0.12 + 0.88 * vM) * a * uOpacity, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -1;
  return p;
}
