// Procedural stand-ins, used only when the manifest / module files are missing.
import * as THREE from '../vendor/three/three.module.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';

// A seated moon sprite hugging its knees, ~22 mm tall, local origin = seat contact centre, facing +Y.
export function proceduralWatcher(height = 22) {
  const s = height / 22, parts = [];
  const put = (g, { x = 0, y = 0, z = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) => {
    g.scale(sx, sy, sz); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.scale(s, s, s); g.translate(x * s, y * s, z * s); parts.push(g);
  };
  // body: one smooth lathe, wide where it sits, narrowing to the shoulders (a cloaked, hunched silhouette from behind)
  const prof = [[0, 0], [4.4, 0.15], [5.7, 1.3], [6.0, 3.0], [5.7, 5.4], [5.1, 8.0], [4.4, 10.4], [3.7, 12.4], [3.0, 13.8], [0.01, 14.6]]
    .map(([r, z]) => new THREE.Vector2(r, z));
  put(new THREE.LatheGeometry(prof, 40), { rx: Math.PI / 2, y: -0.6, sy: 0.88 });
  for (const x of [-2.3, 2.3])                                                                         // shins, knees up
    put(new THREE.CapsuleGeometry(2.0, 6.8, 6, 14), { x, y: 4.0, z: 5.6, rx: Math.PI / 2 + 0.16 });
  const arc = Math.PI * 1.2;
  put(new THREE.TorusGeometry(3.9, 1.05, 10, 30, arc), { y: 2.4, z: 8.6, rz: Math.PI / 2 - arc / 2 });   // arms around the knees
  put(new THREE.SphereGeometry(4.3, 32, 22), { y: 0.8, z: 16.7, sy: 0.96 });                             // head
  const g = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p), false);   // per-primitive normals kept (smooth)
  return new THREE.Mesh(g);
}

// Plinth + mechanism stand-ins (DESIGN §3 numbers), rotor parts in the assembly rotor frame.
export function proceduralMech(kin, earthT) {
  const out = {};
  const plinth = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(192, 162, 43)); body.position.set(0, 0, -18.5);
  plinth.add(body);
  for (const x of [-34, 34]) { const ear = new THREE.Mesh(new THREE.BoxGeometry(8, 22, 18)); ear.position.set(x, 90, 3); plinth.add(ear); }
  out.plinth = { obj: plinth, frame: 'global' };
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 56.6, 32)); hub.rotation.z = Math.PI / 2;
  const ep = new THREE.Vector3().setFromMatrixPosition(earthT);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -6), new THREE.Vector3(0, ep.y * 0.4, ep.z - 10), new THREE.Vector3(0, ep.y - 6, ep.z - 12)]);
  const arm = new THREE.Group(); arm.add(hub, new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 3.85, 12)));
  out.arm = { obj: arm, frame: 'rotor' };
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 146, 24)); tube.rotation.z = Math.PI / 2; tube.position.x = 32.5;
  out.ref_shaft_tube = { obj: tube, frame: 'rotor' };
  const knob = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 12, 48)); disc.rotation.z = Math.PI / 2; disc.position.x = 104;
  const a = THREE.MathUtils.degToRad(-26.5), hx = 116;
  const lever = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 20)); lever.position.set(hx, Math.cos(a) * 10, Math.sin(a) * 10); lever.rotation.x = a - Math.PI / 2;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 16, 20)); grip.rotation.z = Math.PI / 2; grip.position.set(hx + 7, Math.cos(a) * 18, Math.sin(a) * 18);
  knob.add(disc, lever, grip);
  out.knob = { obj: knob, frame: 'rotor' };
  return out;
}
