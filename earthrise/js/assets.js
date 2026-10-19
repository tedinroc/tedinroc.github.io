// EARTHRISE web — asset loading.
// The site is self-contained: everything comes from web/assets/manifest.json (contract in docs/web.progress.md) and the
// files it lists, all under web/. Nothing is read from outside web/ (no ../terrain, ../mech, ../render) and nothing from
// a CDN. If the manifest cannot be loaded, loadWorld() throws and the page shows its render fallback — it never invents
// terrain. `?src=procedural` builds an all-procedural stand-in world on purpose (development / smoke tests only).
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/three/addons/libs/meshopt_decoder.module.js';
import { TRIPO_USED } from './config.js';

const WEB_ROOT = new URL('../', import.meta.url);          // web/ (the deployed site root)
const MANIFEST_URL = new URL('assets/manifest.json', WEB_ROOT);

export const M4 = rows => new THREE.Matrix4().set(...rows.flat());

// Defaults below are copies of mech/assembly.json, props/placement.json, terrain/terrain_meta.json and
// docs/copy_numbers.json (2026-10-04). The manifest path overrides every one it carries; ?src=procedural uses them as is.
const DEFAULTS = {
  kin: { axis: [0, 90, 5.5], dir: [1, 0, 0], rest: -35.5, raise: 68.0, ledOn: [2, 14] },
  earthT: [[1, 0, 0, 0], [0, 0.374607, 0.927184, 30.663], [0, -0.927184, 0.374607, -13.627], [0, 0, 0, 1]],
  watcherT: [[1, 0, 0, 51], [0, 1, 0, -25], [0, 0, 1, 18.725], [0, 0, 0, 1]],
  landmarks: { crater_centre_mm: [-0.717, -5.271, 5.555], far_horizon_point_mm: [-11.6, 74.4, 19.79], tile_top_centre_mm: [0, 0, 7.1186] },
  numbers: {
    scale_den: 1000000, ve: 3.0, tile_mm: [180, 150], plinth_mm: [192, 162], plinth_height_mm: 43, earth_d: 32, watcher_h: 22,
    crater_contract: { lat: -5.9, lon_e: 179.4, diam_km: 93 }, earth_mean_radius_km: 6371.0, moon_mean_distance_km: 384400.0,
    true_scale_earth_m: 12.74, true_scale_earth_distance_m: 384.4, earth_undersize_factor: 398, terrain_relief_m: 5798.18,
    terrain_source_px_m: 59, sightline_sweep_deg: 103.5,
  },
  credit: 'Topography: SLDEM2015 (LOLA + SELENE/Kaguya Terrain Camera merged DEM, 512 ppd), Barker, M.K., Mazarico, E., Neumann, G.A., Zuber, M.T., Haruyama, J., Smith, D.E. (2016), Icarus 273, 346–355. Data: NASA LRO LOLA team / JAXA SELENE, via NASA PDS Geosciences Node.',
};

async function getJSON(url, tries = 2) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${url} → ${r.status}`);
      return await r.json();
    } catch (e) { if (i >= tries) throw e; await new Promise(res => setTimeout(res, 600)); }
  }
}
async function getBuf(url, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  if (!onBytes || !r.body) return r.arrayBuffer();
  const total = +r.headers.get('content-length') || 0, reader = r.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onBytes(got, total);
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
function resolveAsset(p) {               // manifest paths: relative to web/assets/, or "assets/..." relative to web/
  return /^assets\//.test(p) ? new URL(p, WEB_ROOT) : new URL(p, MANIFEST_URL);
}

let _gltf = null;
function gltfLoader() {                  // meshopt is what the asset module writes; Draco / STL load lazily if a manifest ever lists them
  if (_gltf) return _gltf;
  _gltf = new GLTFLoader(); _gltf.setMeshoptDecoder(MeshoptDecoder);
  return _gltf;
}
async function loadMesh(url) {           // → Object3D (meshes keep their own geometry; materials are replaced by the stage)
  const s = String(url), buf = await getBuf(url);
  if (/\.stl(\?|$)/i.test(s)) {
    const { STLLoader } = await import('../vendor/three/addons/loaders/STLLoader.js');
    const g = new STLLoader().parse(buf);
    if (!g.attributes.normal) g.computeVertexNormals();
    return new THREE.Mesh(g);
  }
  const L = gltfLoader();
  if (!L.dracoLoader && glbUses(buf, 'KHR_draco_mesh_compression')) {
    const { DRACOLoader } = await import('../vendor/three/addons/loaders/DRACOLoader.js');
    const d = new DRACOLoader(); d.setDecoderPath(new URL('vendor/three/addons/libs/draco/gltf/', WEB_ROOT).href); L.setDRACOLoader(d);
  }
  return (await L.parseAsync(buf, new URL('./', url).href)).scene;
}
function glbUses(buf, ext) {             // GLB: 12-byte header, then the JSON chunk (length, type, bytes)
  const dv = new DataView(buf);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546C67) return false;
  const n = Math.min(dv.getUint32(12, true), buf.byteLength - 20);
  return new TextDecoder().decode(new Uint8Array(buf, 20, n)).includes(ext);
}

// ---------------------------------------------------------------- heightmap helpers
export function makeHeightmap(z, nx, ny, x0, y0, dx) {
  const hm = { z, nx, ny, x0, y0, dx, x1: x0 + (nx - 1) * dx, y1: y0 + (ny - 1) * dx, zmin: Infinity, zmax: -Infinity };
  for (let i = 0; i < z.length; i++) { const v = z[i]; if (v < hm.zmin) hm.zmin = v; if (v > hm.zmax) hm.zmax = v; }
  hm.sample = (x, y) => {                                       // bilinear, −Infinity outside the tile
    const fx = (x - x0) / dx, fy = (y - y0) / dx;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return -Infinity;
    const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fy), ny - 2), tx = fx - i, ty = fy - j, k = j * nx + i;
    return (z[k] * (1 - tx) + z[k + 1] * tx) * (1 - ty) + (z[k + nx] * (1 - tx) + z[k + nx + 1] * tx) * ty;
  };
  return hm;
}

// ---------------------------------------------------------------- 1. manifest
const QS = new URLSearchParams(location.search);
async function fromManifest(man, onProgress, opts) {
  const T = man.terrain.heightmap;
  const buf = await getBuf(resolveAsset(T.file), (g, t) => onProgress?.('terrain', t ? g / t : 0));
  let z;
  if ((T.encoding || 'uint16') === 'float32') z = new Float32Array(buf);
  else {
    const u = new Uint16Array(buf), a = T.z_min_mm, k = (T.z_max_mm - T.z_min_mm) / 65535;
    z = new Float32Array(u.length); for (let i = 0; i < u.length; i++) z[i] = a + u[i] * k;
  }
  if (T.row0 === 'back') {                                       // normalise to row 0 = front (Y = y0)
    const f = new Float32Array(z.length);
    for (let j = 0; j < T.ny; j++) f.set(z.subarray((T.ny - 1 - j) * T.nx, (T.ny - j) * T.nx), j * T.nx);
    z = f;
  }
  const hm = makeHeightmap(z, T.nx, T.ny, T.x0_mm, T.y0_mm, T.dx_mm);
  const K = man.kinematics;
  const world = baseWorld('manifest');
  world.hm = hm;
  world.kin = { axis: K.axis_point, dir: K.axis_dir || [1, 0, 0], rest: K.rest_deg, raise: K.raise_deg, ledOn: K.led_on_after_deg_from_rest || DEFAULTS.kin.ledOn };
  const jobs = [];
  // terrain maps (first-screen 1k; the stage swaps in the 2k ones later on desktop)
  const tl = new THREE.TextureLoader();
  const tex = (f, srgb) => f ? tl.loadAsync(resolveAsset(f).href).then(t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }) : Promise.resolve(null);
  const TM = man.terrain;
  jobs.push(Promise.all([tex(TM.normal_map?.file), tex(TM.albedo_map?.file, true), tex(TM.ao_map?.file)])
    .then(([normal, albedo, ao]) => { if (normal) world.terrainMaps = { normal, albedo, ao }; })
    .catch(e => console.warn('[assets] terrain maps', e.message)));
  const hq = f => f ? resolveAsset(f).href : null;
  world.terrainMapsHQ = { normal: hq(TM.normal_map?.hq_file), albedo: hq(TM.albedo_map?.hq_file), ao: hq(TM.ao_map?.hq_file) };
  for (const [name, m] of Object.entries(man.meshes || {})) {
    if (m.first_screen === false) continue;                      // under the plinth / not visible
    jobs.push(loadMesh(resolveAsset(m.file)).then(obj => {
      if (m.matrix) { obj.applyMatrix4(M4(m.matrix)); }
      world.meshes[name] = { obj, frame: m.frame || 'global', material: m.material };
    }).catch(e => console.warn('[assets] mesh', name, e.message)));
  }
  // props: placeholder props are replaced by the app's own procedural ones unless ?props=mesh; Tripo props are shown as
  // made — but only when js/config.js says TRIPO_USED, so the page never shows a model it does not declare
  const kindOf = x => (x?.source?.kind || x?.source || '').toString();
  const useMesh = x => x?.file && (QS.get('props') === 'mesh' || (QS.get('props') !== 'procedural' && !/placeholder/i.test(kindOf(x))
    && (TRIPO_USED || !/tripo/i.test(kindOf(x)))));
  const E = man.earth || {};
  world.earth.T = M4(E.T_local_to_rotor || DEFAULTS.earthT);
  world.earth.diameter = E.diameter_mm || 32;
  world.earth.source = useMesh(E) ? (kindOf(E) || 'mesh') : 'procedural';
  if (useMesh(E)) jobs.push(loadMesh(resolveAsset(E.file)).then(o => { world.earth.obj = o; }).catch(e => console.warn('[assets] earth', e.message)));
  // the Tripo Earth's continents as a mask (R land, G shelf, B painted windows) for the web's own day/night shader (earth.js)
  if (useMesh(E) && E.mask_file) jobs.push(new THREE.TextureLoader().loadAsync(resolveAsset(E.mask_file).href)
    .then(t => { world.earth.mask = t; }).catch(e => console.warn('[assets] earth mask', e.message)));
  if (E.sun_dir_local) {                                          // earth local = world axes at the raised pose
    const [x, y, zz] = E.sun_dir_local;
    world.sunAzDeg = Math.atan2(x, y) * 180 / Math.PI; world.sunElDeg = Math.asin(zz / Math.hypot(x, y, zz)) * 180 / Math.PI;
  }
  const W = man.watcher || {};
  world.watcher.T = M4(W.transform_4x4 || DEFAULTS.watcherT);
  world.watcher.height = W.height_mm || 22;
  if (W.eye_local_mm) world.watcher.eye = W.eye_local_mm;
  world.watcher.source = useMesh(W) ? (kindOf(W) || 'mesh') : 'procedural';
  // which way the model's face points (degrees from +Y, counter-clockwise seen from above; baked into the mesh — the
  // placement is a pure translation). The procedural stand-in faces +Y.
  world.watcher.faceDeg = useMesh(W) ? (+W.face_ccw_from_plus_y_deg || 0) : 0;
  // which Tripo candidate (props/watcher/selected.json via the manifest): c1 "hopeful moon spirit" is repainted on load,
  // any other (c3 "daedalus sprite") keeps its own moon-rock paint (js/stage.js)
  world.watcher.model = useMesh(W) ? (W.source?.variant || null) : null;
  if (useMesh(W)) jobs.push(loadMesh(resolveAsset(W.file)).then(o => { world.watcher.obj = o; }).catch(e => console.warn('[assets] watcher', e.message)));
  let done = 0; const n = jobs.length;
  jobs.forEach(j => j.then(() => onProgress?.('meshes', ++done / n)));
  await Promise.all(jobs);
  const L = man.landmarks || {};
  for (const k of Object.keys(world.landmarks)) if (L[k]) world.landmarks[k] = L[k];
  Object.assign(world.numbers, man.numbers || {});
  if (K.sweep_deg) world.numbers.sightline_sweep_deg = K.sweep_deg;
  if (man.terrain.source?.VE) world.numbers.ve = man.terrain.source.VE;
  const credit = man.credits?.terrain || man.terrain.source?.credit;
  if (credit) world.credit = credit;
  if (Array.isArray(man.photos) && man.photos.length) world.photos = man.photos.map(p => ({ ...p, url: resolveAsset(p.file).href }));
  return world;
}

function baseWorld(source) {
  return {
    source, hm: null, terrainMaps: null, terrainMapsHQ: null, meshes: {},
    kin: { ...DEFAULTS.kin },
    earth: { T: M4(DEFAULTS.earthT), diameter: 32, obj: null, mask: null, source: 'procedural' },
    watcher: { T: M4(DEFAULTS.watcherT), height: 22, eye: null, obj: null, source: 'procedural', faceDeg: 0, model: null },
    landmarks: { ...DEFAULTS.landmarks }, numbers: { ...DEFAULTS.numbers }, credit: DEFAULTS.credit,
    photos: [{ url: new URL('img/cover_og.jpg', WEB_ROOT).href, kind: 'web', caption: "Seen from the watcher's seat. Photos of the printed piece go here when they arrive." }],
  };
}

// ---------------------------------------------------------------- 2. procedural stand-ins (?src=procedural only)
function proceduralWorld() {
  const world = baseWorld('procedural');
  const dx = 0.4, x0 = -90, y0 = -75, nx = 451, ny = 376, z = new Float32Array(nx * ny);
  const cx = -0.7, cy = -5.3, R = 49;
  const h = (x, y) => Math.sin(x * 0.13 + Math.sin(y * 0.07)) * 0.6 + Math.sin(y * 0.11 - x * 0.05) * 0.5 + Math.sin(x * 0.41 + y * 0.37) * 0.15;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * dx, y = y0 + j * dx, r = Math.hypot(x - cx, y - cy) / R;
    let v = 11 + h(x, y) + (y > 40 ? (y - 40) * 0.14 : 0);
    if (r < 1) v = 5.5 + 9 * Math.pow(r, 3.2) + (r < 0.18 ? 3.2 * Math.cos(r / 0.18 * Math.PI / 2) : 0) + h(x, y) * 0.3;
    else v += 7 * Math.exp(-Math.pow((r - 1) / 0.12, 2));
    z[j * nx + i] = Math.max(4, v);
  }
  world.hm = makeHeightmap(z, nx, ny, x0, y0, dx);
  return world;
}

export async function loadWorld({ onProgress, prefer } = {}) {
  const w = prefer === 'procedural' ? proceduralWorld() : await fromManifest(await getJSON(MANIFEST_URL), onProgress, {});
  console.info('[assets] source:', w.source);
  return w;
}
