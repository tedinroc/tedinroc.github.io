// EARTHRISE for Daedalus — web twin. Boot, input, UI.
import { loadWorld } from './assets.js';
import { Stage } from './stage.js';
import { Crank } from './crank.js';
import { Sound } from './audio.js';
import { CONFIG, onScreenText, photoCaption, madeWith, trackLine } from './config.js';
import { Raycaster } from '../vendor/three/three.module.js';

const qs = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const body = document.body;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);     // iPadOS reports itself as a Mac
const small = Math.min(window.innerWidth, window.innerHeight) < 600;
const tier = qs.get('q') || (mobileUA || (coarse && small) ? 'low' : 'high');
// (the default camera pose per screen shape lives in stage.js _framing())
const Q = tier === 'low'
  ? { dprMax: 2, terrainStep: 0.6, texMax: 1024, shadow: 1024, earthSeg: 64, stars: 700, reducedMotion: reduced, aniso: 4, hq: false }
  : { dprMax: 2, terrainStep: 0.3, texMax: 2048, shadow: 2048, earthSeg: 128, stars: 1600, reducedMotion: reduced, aniso: 8, hq: true };

// ---------------------------------------------------------------- intro (≤ 3.5 s; click / tap / any key enters — with sound)
const intro = $('#intro');
let entered = false, ready = false, wantEnter = false, gestureSound = false;
const timeline = { enteredAt: null, hintAt: null, soundBy: null };      // performance.now() stamps, for the checks
// The climax (review #6, final_review #5): the first time a visitor raises the Earth — by hand, by key, or with "Turn it
// for me" — it first clears the far ridge as seen from the table; once CLIMAX_VIS of its disc is in view, the camera
// flies from the table to the watcher's eye on the rim (stage.js FLIGHT_S, eased) and the page takes the crank: during
// the flight the Earth goes on rising just enough that, seen from the moving camera, it never sinks back (the camera
// comes down to the rim, where the ridge stands higher: stage.js flightRiseSchedule), and the rest of the rise happens in
// front of the watcher; the closing lines come up there at the top. Only once; afterwards "Back to the table" / "Sit on
// the rim" are the visitor's to use, and the crank is theirs again once the camera has landed. With
// prefers-reduced-motion the move is a short fade to black and a cut. URL ?climax=0 turns it off (tooling); the dev
// parameters ?theta / ?progress / ?mode=rim count as already done.
const veil = $('#veil');                 // reduced motion: the fade that hides a camera cut
let veilTimer = null;
const climax = { enabled: qs.get('climax') !== '0', armed: false, done: qs.has('theta') || qs.has('progress') || qs.get('mode') === 'rim',
  phase: null, by: null, startedAt: null, arrivedAt: null, trig: null, sched: null, rmTheta: null, endingAt: null, cut: false,
  face: null, faceDue: null, faceAt: null, faceArrivedAt: null, faceCut: false, faceSkip: null, faceHeldAt: null, lightFullAt: null,
  again: null, agains: 0, button: 0 };      // v4.1: the later arcs (state, due) and how many; "See the watcher" presses
const CLIMAX_VIS = 0.28;                 // the flight starts once this much of the Earth's disc clears the ridge (from the table)
// The face (js/config.js FACE_ARC, off by default): that first climax ends on the watcher itself. Once the closing
// lines are up — and, with the counter on, FACE_AFTER_LIGHT_S after its line ("… This one was yours.") has fully faded
// in, so it is read on the still view from the eye; never sooner than FACE_HOLD_S after the lines; counter off or
// failed: FACE_HOLD_S after the lines — the camera leaves the eye in a slow arc (stage.js FACE_S) to the watcher's left:
// the watcher in profile, its face lit by the Earth it is looking at, the risen Earth on the other side of the frame,
// round (stage.js _facePose) — the first time it sees Earth. It stays there until the visitor goes back to the table, or
// starts lowering the Earth (then it arcs back to the eye, so the Earth sets behind the ridge as the watcher sees it).
// "Sit on the rim" is always the eye. v4.1: every later time the Earth comes to the top while the camera is on the rim,
// the same arc follows the closing lines again (climax.again); and once the Earth is up, "See the watcher" (#btn-face, F)
// goes there at any time — from the table it first flies to the rim (the eye), then arcs round. Skipped if the visitor
// has left the rim, lowered the Earth or opened the info panel by then, and where the screen has no framing for it
// (a small phone held sideways: the camera stays at the eye). Held upright (v4.1): the camera stays at the eye too (v4)
// and the shot — over its shoulder — comes only on "See the watcher" (faceAuto, climax.face 'held');
// reduced motion: fade, cut, fade.
const FACE_HOLD_S = 3.0, FACE_AFTER_LIGHT_S = 0.75, FACE_LIGHT_WAIT_S = 9;
let facePending = null;                  // reduced motion: the face cut waiting behind the veil
let faceAfterLand = false;               // "See the watcher" pressed on the table: arc round once the camera is on the rim
function requestEnter() {
  wantEnter = true;
  if (ready && !entered) doEnter();
}
// A click / tap / key on the intro is a user gesture: the AudioContext can start inside it (iOS needs exactly that),
// so entering that way turns the sound on. The automatic entry after 3.5 s stays silent.
function enterByGesture() {
  if (!gestureSound) { gestureSound = true; if (sound.muted) { toggleSound(); timeline.soundBy = 'intro gesture'; } }
  else wakeSound();
  requestEnter();
}
function doEnter() {
  entered = true; timeline.enteredAt = performance.now();
  intro.classList.add('done');
  body.classList.remove('is-intro');
  stage?.startIntro();
  if (Q.hq && !qs.has('nohq')) setTimeout(() => stage.upgradeTerrainMaps().catch(e => console.warn('[hq]', e.message)), 2600);
  setTimeout(() => { if (!userTurned) { $('#dial-hint').classList.remove('gone'); timeline.hintAt = performance.now(); } }, reduced ? 0 : 700);
}
intro.addEventListener('pointerup', enterByGesture);
intro.addEventListener('click', enterByGesture);
const AUTO_ENTER_MS = qs.has('skipintro') ? 0 : 3500;
setTimeout(requestEnter, AUTO_ENTER_MS);
$('#dial-hint').classList.add('gone');

// ---------------------------------------------------------------- load
const bar = $('#load-bar');
let pT = 0, pM = 0;
const onProgress = (what, f) => { if (what === 'terrain') pT = f; else pM = f; bar.style.width = `${Math.round((pT * 0.6 + pM * 0.4) * 100)}%`; };
let stage, crank, sound = new Sound(), world;
const canvas = $('#gl');

try {
  world = await loadWorld({ onProgress, prefer: qs.get('src') || undefined });
} catch (e) {                                   // the model files did not arrive: say so, show the render, offer a retry
  console.warn('[boot] model files could not be loaded:', e.message);
  showFail('The model files could not be loaded. Here is a render of the piece instead.', true);
  await new Promise(() => {});                  // stop booting here, quietly (a module cannot `return` at top level)
}
try {
  stage = new Stage(canvas, world, Q);
  // iOS drops the GL context when the app is backgrounded under memory pressure; three rebuilds its state on restore,
  // but the shadow map is only drawn on demand — ask for it again.
  canvas.addEventListener('webglcontextrestored', () => { stage._shadowFrames = 3; });
} catch (e) {                                   // no WebGL (or it failed to start)
  console.warn('[boot] WebGL could not start:', e.message);
  showFail('This page needs WebGL to show the model. Here is a render of the piece instead.', false);
  await new Promise(() => {});
}
function showFail(msg, retry) {
  $('#fail-msg').textContent = msg; $('#fail-retry').hidden = !retry;
  $('#fail').hidden = false; intro.classList.add('done'); body.classList.remove('is-intro'); body.classList.add('failed');
}
bar.style.width = '100%';
crank = new Crank(stage.REST, stage.RAISE, stage.REST);
if (qs.has('theta')) crank.jump(parseFloat(qs.get('theta')));
if (qs.has('progress')) crank.jump(stage.REST + parseFloat(qs.get('progress')) * (stage.RAISE - stage.REST));
fillNumbers(world);

// ---------------------------------------------------------------- dial overlay (travel arc; handle angle = θ + crank λ)
const CRANK_LAMBDA = -26.5;   // assembly.json knob.crank_lambda_deg (handle direction in the rotor frame)
const arcPt = (deg, r = 45) => [50 + r * Math.cos(deg * Math.PI / 180), 50 - r * Math.sin(deg * Math.PI / 180)];
const arcD = (a0, a1, r = 45) => {
  const [x0, y0] = arcPt(a0, r), [x1, y1] = arcPt(a1, r), large = Math.abs(a1 - a0) > 180 ? 1 : 0, sweep = a1 > a0 ? 0 : 1;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
function drawDialTrack() {
  const a0 = stage.REST + CRANK_LAMBDA, a1 = stage.RAISE + CRANK_LAMBDA;
  $('#dial-track').setAttribute('d', arcD(a0, a1));
  const [ex, ey] = arcPt(a1); const e = $('#dial-end'); e.setAttribute('cx', ex); e.setAttribute('cy', ey);
  const [sx0, sy0] = arcPt(a0, 42), [sx1, sy1] = arcPt(a0, 48); const s = $('#dial-start');
  s.setAttribute('x1', sx0); s.setAttribute('y1', sy0); s.setAttribute('x2', sx1); s.setAttribute('y2', sy1);
}
// ---------------------------------------------------------------- layout
function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!(w > 0 && h > 0)) return;                 // a hidden / collapsed window: keep the last size
  stage.resize(w, h);
  const r = $('#dial').getBoundingClientRect();
  stage.setDialRect({ left: r.left, top: r.top, width: r.width, height: r.height });
  drawDialTrack();
  if (CONFIG.FACE_ARC) {
    stage.setFaceUI(faceUI());
    if (stage.rig.fGoal > 0 && !stage.rig.face?.fits) { faceTo(false); if (climax.face === 'moving') climax.face = 'left'; }   // e.g. turned upright
  }
}
window.addEventListener('resize', layout);
new ResizeObserver(layout).observe($('#dial'));
layout();
if (qs.get('mode') === 'rim') setRim(true, { instant: true });

let lastDialTheta = null;
function updateDial() {
  if (lastDialTheta !== null && Math.abs(lastDialTheta - crank.theta) < 0.02) return;
  lastDialTheta = crank.theta;
  const a0 = stage.REST + CRANK_LAMBDA, a = Math.max(stage.REST, Math.min(stage.RAISE, crank.theta)) + CRANK_LAMBDA;
  $('#dial-prog').setAttribute('d', a - a0 > 0.05 ? arcD(a0, a) : '');
  const pct = Math.round(Math.max(0, Math.min(1, crank.progress)) * 100);
  const dial = $('#dial');
  dial.setAttribute('aria-valuenow', pct);
  const v = stage.visFrac;
  dial.setAttribute('aria-valuetext', pct >= 100 ? 'Earth fully risen' : v <= 0.001 ? `Earth hidden behind the far rim, crank ${pct}%` : `Earth rising, ${Math.round(v * 100)}% visible`);
  $('#dial-end').classList.toggle('lit', pct >= 99);
  $('#btn-auto').textContent = crank.progress > 0.97 ? 'Lower it' : 'Turn it for me';
}

// ---------------------------------------------------------------- input: dial (angular drag, direct drive)
let userTurned = false;
const crankLocked = () => climax.phase === 'rising';       // the climax flight: the page has the crank until the landing
function markTurned() { climax.armed = true; if (!userTurned) { userTurned = true; $('#dial-hint').classList.add('gone'); body.classList.add('turned'); } }
{
  const dial = $('#dial');
  let prevA = null, pid = null, lastY = 0;
  const angleAt = e => {
    const r = dial.getBoundingClientRect(), c = stage.dialCentreCss() || { x: r.width / 2, y: r.height / 2 };
    const dx = e.clientX - r.left - c.x, dy = e.clientY - r.top - c.y;
    return { a: Math.atan2(-dy, dx) * 180 / Math.PI, r: Math.hypot(dx, dy) };
  };
  dial.addEventListener('pointerdown', e => {
    if (pid !== null || crankLocked()) return;
    pid = e.pointerId; dial.setPointerCapture(pid); dial.classList.add('dragging');
    const p = angleAt(e); prevA = p.r > 10 ? p.a : null; lastY = e.clientY;
    crank.beginDrag(); markTurned(); e.preventDefault();
  });
  dial.addEventListener('pointermove', e => {
    if (e.pointerId !== pid) return;
    const p = angleAt(e);
    if (p.r > 10) {
      if (prevA !== null) { let d = p.a - prevA; if (d > 180) d -= 360; if (d < -180) d += 360; crank.dragBy(d); }
      prevA = p.a;
    } else { crank.dragBy(-(e.clientY - lastY) * 0.8); prevA = null; }
    lastY = e.clientY;
  });
  const end = e => { if (e.pointerId !== pid) return; pid = null; crank.endDrag(); dial.classList.remove('dragging'); };
  dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
  dial.addEventListener('keydown', e => {             // Space is handled once, by the document listener below
    if (e.key === 'Enter') { e.preventDefault(); autoTurn(); }
  });
}

// ---------------------------------------------------------------- input: canvas (knob drag in 3D, orbit, pinch, wheel)
{
  const ray = new Raycaster();
  const ndc = (e) => ({ x: e.clientX / window.innerWidth * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 });
  const pointers = new Map();
  let knobDrag = null, last = null, vel = { x: 0, y: 0 }, pinch0 = 0;
  canvas.addEventListener('pointerdown', e => {
    if (!entered) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      knobDrag = null; crank.endDrag();
      const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); stage.rig.dragging = false; return;
    }
    const n = ndc(e); ray.setFromCamera(n, stage.camera);
    const hit = stage.rig.mode === 'table' && !crankLocked() ? stage.knobPick(ray) : null;
    if (hit) { knobDrag = hit; crank.beginDrag(); markTurned(); canvas.style.cursor = 'grabbing'; }
    else { stage.rig.dragging = true; vel = { x: 0, y: 0 }; }
    last = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointermove', e => {
    if (!entered) return;
    if (!pointers.has(e.pointerId)) {                 // hover: show that the knob can be grabbed
      if (e.pointerType === 'mouse' && stage.rig.mode === 'table') {
        const n = ndc(e); ray.setFromCamera(n, stage.camera);
        const over = !!stage.knobPick(ray);
        canvas.style.cursor = over ? 'grab' : '';
        stage.MAT.knob.color.setHex(over ? 0x3a2d1c : 0x050506);
      }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) stage.zoom(pinch0 / d); pinch0 = d; return;
    }
    const dx = e.clientX - last.x, dy = e.clientY - last.y, now = performance.now();
    if (knobDrag) {
      const s = stage.knobScreenTangent(knobDrag.rotorPoint), s2 = s.x * s.x + s.y * s.y;
      if (s2 > 900) crank.dragBy((dx * s.x + dy * s.y) / s2 * 180 / Math.PI);
      else crank.dragBy(-dy * 0.6);
    } else if (stage.rig.dragging) {
      stage.orbit(dx, dy);
      const dt = Math.max(1, now - last.t); vel = { x: dx / dt * 16, y: dy / dt * 16 };
    }
    last = { x: e.clientX, y: e.clientY, t: now };
  });
  let lastTap = null;
  const up = e => {
    if (e.pointerType === 'touch' && pointers.size === 1 && !knobDrag) {
      const now = performance.now(), p = { x: e.clientX, y: e.clientY, t: now };
      if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 20) { stage.resetView(); lastTap = null; } else lastTap = p;
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = 0;
    if (knobDrag && pointers.size === 0) { knobDrag = null; crank.endDrag(); canvas.style.cursor = ''; }
    if (stage.rig.dragging && pointers.size === 0) {
      stage.rig.dragging = false;
      if (stage.rig.mode === 'table' && performance.now() - last.t < 80) stage.fling(vel.x, vel.y);
    }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { if (!entered) return; e.preventDefault(); stage.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  canvas.addEventListener('dblclick', () => stage.resetView());
}

// ---------------------------------------------------------------- keyboard
const keysHeld = new Set();
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!entered) { if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(e.key)) { e.preventDefault(); enterByGesture(); } return; }
  if (!$('#info').hidden) { if (e.key === 'Escape') closeInfo(); return; }
  const tag = document.activeElement?.tagName;
  const onButton = tag === 'BUTTON' || tag === 'A';
  if (crankLocked() && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) { if (e.key !== ' ' || !onButton) e.preventDefault(); return; }
  switch (e.key) {
    case 'ArrowUp': case 'ArrowRight': e.preventDefault(); keysHeld.add(e.key); crank.setKeyDir(1); markTurned(); break;
    case 'ArrowDown': case 'ArrowLeft': e.preventDefault(); keysHeld.add(e.key); crank.setKeyDir(-1); markTurned(); break;
    case 'PageUp': e.preventDefault(); markTurned(); crank.nudge(10); break;
    case 'PageDown': e.preventDefault(); markTurned(); crank.nudge(-10); break;
    case 'Home': e.preventDefault(); markTurned(); crank.turnTo(stage.REST, 30); break;
    case 'End': e.preventDefault(); markTurned(); crank.turnTo(stage.RAISE, 18); break;
    case ' ': if (!onButton) { e.preventDefault(); autoTurn(); } break;
    case 'r': case 'R': setRim(stage.rig.mode !== 'rim'); break;
    case 'm': case 'M': toggleSound(); break;
    case 'i': case 'I': openInfo(); break;
    case 'f': case 'F': seeWatcher(); break;
    case 'Escape': if (stage.rig.mode === 'rim') setRim(false); break;
  }
});
document.addEventListener('keyup', e => {
  if (!keysHeld.delete(e.key)) return;
  const up = keysHeld.has('ArrowUp') || keysHeld.has('ArrowRight'), down = keysHeld.has('ArrowDown') || keysHeld.has('ArrowLeft');
  crank.setKeyDir(up && !down ? 1 : down && !up ? -1 : 0);
});
window.addEventListener('blur', () => { keysHeld.clear(); crank.setKeyDir(0); });

// ---------------------------------------------------------------- buttons
// "Turn it for me": quick through the dead travel while the Earth is still behind the ridge (the dawn glow carries it),
// slow while it clears the horizon, then a gentle finish (review #4). Lowering is one even move.
const PACE = { hidden: 26, rising: 12, risen: 14, flight: 11 };
const autoPace = () => { const v = stage.visFrac; return v <= 0.002 ? PACE.hidden : v < 0.995 ? PACE.rising : PACE.risen; };
function autoTurn() {
  if (crankLocked()) return;
  markTurned();
  if (crank.progress > 0.97) { crank.turnTo(stage.REST, 24); return; }
  crank.turnTo(stage.RAISE, PACE.hidden, autoPace); crank.auto.byButton = true;     // the climax takes over on the way (frame)
}
// The first rise, once CLIMAX_VIS of the disc is over the ridge from the table: fly to the watcher; the page takes the
// crank (the visitor's drag or key ends here) and follows the flight's rise schedule, so the Earth never sinks back
// from the moving camera. Reduced motion: the crank waits behind the veil and, at the cut, steps to the angle at which
// the watcher sees as much of the disc as the table did (hidden by the veil), then rises.
function startEarlyClimax() {
  const v0 = stage.visFrac, by = crank.auto?.byButton ? 'turn it for me' : crank.auto && !crank.dragging && !crank.keyDir ? 'auto' : 'hand';
  crank.endDrag(); crank.setKeyDir(0); keysHeld.clear();
  climax.trig = { vis: +v0.toFixed(3), theta: +crank.theta.toFixed(2), at: performance.now() };
  askLight();
  startClimax(by);
  climax.phase = 'rising';
  if (Q.reducedMotion) { crank.auto = null; crank.omega = 0; climax.rmTheta = stage.thetaForVis(stage.watcherEye, v0, crank.theta); return; }
  const S = climax.sched = stage.flightRiseSchedule(v0, crank.theta);
  crank.auto = { climax: true, follow: () => {
    const x = Math.min(1, Math.max(0, stage.rig.t + 0.01)) * (S.length - 1), i = Math.min(S.length - 2, Math.floor(x));   // a frame ahead of the camera
    return S[i].th + (S[i + 1].th - S[i].th) * (x - i);
  } };
}
// after the landing: the crank goes on to the top at the usual pace (an eased start from the schedule's slow climb)
function resumeAfterFlight() {
  climax.phase = 'landed';
  if (crank.auto?.climax) crank.auto = { to: stage.RAISE, speed: PACE.rising, t0: crank.theta, pace: autoPace, climax: true };
  else if (!crank.dragging && !crank.keyDir && crank.progress < 0.97 && !crank.auto) crank.turnTo(stage.RAISE, PACE.hidden, autoPace);
}
const climaxDue = () => climax.enabled && climax.armed && !climax.done && entered;
function startClimax(by) {
  climax.done = true; climax.by = by; climax.startedAt = performance.now(); climax.phase = 'flight';
  setRim(true, { climax: true });
}
function startFace() {
  climax.faceAt = performance.now();
  if (!faceAuto()) { climax.face = 'held'; climax.faceHeldAt = climax.faceAt; climax.faceSkip = 'upright screen: over the shoulder on "See the watcher" only'; return; }
  if (faceTo(true)) climax.face = 'moving';
  else { climax.face = 'skipped'; climax.faceSkip = 'no framing on this screen'; }   // e.g. a small phone held sideways: stay at the eye
}
// to / from the face shot (on the rim only); reduced motion: behind the veil. Going to it only where the screen has a
// framing for it (stage.js _facePose fits), measured with the face shot's caption in place. Returns whether it goes.
function faceTo(on) {
  if (stage.rig.mode !== 'rim' || facePending === on) return false;
  if (on && !faceFits()) return false;
  // the caption changes with the shot, so the free space is measured after it (stage.js _facePose)
  const go = cut => { stage.setFace(on, { cut }); updateCaption(); if (on) stage.setFaceUI(faceUI()); };
  if (Q.reducedMotion) {
    clearTimeout(veilTimer); veil.classList.add('on'); facePending = on;
    veilTimer = setTimeout(() => { facePending = null; go(true); if (on) climax.faceCut = true;
      requestAnimationFrame(() => requestAnimationFrame(() => veil.classList.remove('on'))); }, 240);
  } else go(false);
  return true;
}
function faceFits() {
  const R = stage.rig, g = R.fGoal;
  R.fGoal = 1; updateCaption(); stage.setFaceUI(faceUI()); R.fGoal = g; updateCaption();
  return !!R.face?.fits;
}
// what the face shot must keep clear (CSS px): the closing lines (with room for the counter line before it arrives), the
// caption, the crank and its button, the brand mark and the top buttons — the text itself, not its boxes
function faceUI() {
  const w = window.innerWidth, h = window.innerHeight, pad = 8, avoid = [];
  const add = (r, grow = pad) => { if (r && r.width > 0 && r.height > 0) avoid.push([r.left - grow, r.top - grow, r.right + grow, r.bottom + grow]); };
  const textRect = el => { if (!el || el.hidden || getComputedStyle(el).display === 'none') return null; const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); };
  const lines = [...document.querySelectorAll('#ending p')].map(textRect).filter(r => r && r.width > 0);
  if (lines.length) {
    const r = { left: Math.min(...lines.map(x => x.left)), top: Math.min(...lines.map(x => x.top)), right: Math.max(...lines.map(x => x.right)), bottom: Math.max(...lines.map(x => x.bottom)) };
    if (CONFIG.COUNTER_ENABLED && $('#lights').hidden) { r.bottom += 44; r.right = Math.max(r.right, r.left + Math.min(w * 0.9, 380)); }  // the counter line, not yet in
    add({ ...r, width: r.right - r.left, height: r.bottom - r.top }, 14);
  }
  add(textRect($('#caption'))); add($('#crank').getBoundingClientRect()); add($('.mark').getBoundingClientRect());
  // the top buttons — not "See the watcher", which is hidden during the shot (v4.1; the others do not move with it)
  { const r = [...document.querySelectorAll('.tools > :not(#btn-face)')].map(b => b.getBoundingClientRect()).filter(r => r.width > 0);
    if (r.length) add({ left: Math.min(...r.map(x => x.left)), top: Math.min(...r.map(x => x.top)), right: Math.max(...r.map(x => x.right)), bottom: Math.max(...r.map(x => x.bottom)), width: 1, height: 1 }); }
  return { safe: [pad, pad, w - pad, h - pad], avoid };
}
$('#btn-auto').addEventListener('click', autoTurn);
// "See the watcher" (v4.1): with the Earth up, the face shot at any time — on the rim from the eye; from the table the
// camera first flies to the rim (as "Sit on the rim" does: to the eye) and arcs round once it has landed
const btnFace = $('#btn-face');
function seeWatcher() {
  if (!CONFIG.FACE_ARC || !faceReady()) return;
  climax.button++;
  if (stage.rig.mode !== 'rim') { setRim(true); faceAfterLand = true; return; }
  goFace();
}
// v4.1 review: the arc comes by itself only on wide screens (as the submitted description says); on upright screens the
// camera stays at the eye (v4) and the over-the-shoulder shot is there on "See the watcher" (F) — climax.face 'held'
function faceAuto() { return stage.rig.face?.F?.shape !== 'portrait'; }
function goFace() {
  if (!faceTo(true)) return false;
  if (climax.face === 'wait' || climax.face === 'held') { climax.face = 'moving'; climax.faceAt = performance.now(); }
  if (climax.again?.state === 'wait') climax.again.state = 'moving';
  return true;
}
// shown (cheap, every frame): the arc is on, the Earth at the top and at rest, nothing else moving the camera, and this
// screen has a framing for the face shot (stage.rig.face, solved on resize)
function faceReady() {
  const R = stage.rig;
  return entered && !crankLocked() && climax.phase !== 'flight' && crank.theta >= stage.RAISE - 0.6 && !crank.dragging && !crank.keyDir
    && R.fGoal === 0 && facePending == null && !faceAfterLand && !!R.face?.fits && !(R.mode === 'rim' && R.t < 0.999) && !(R.mode === 'table' && R.t > 0.001);
}
let faceBtnOn = false;
function updateFaceButton() {
  const on = CONFIG.FACE_ARC && faceReady();
  if (on === faceBtnOn) return;
  faceBtnOn = on; btnFace.hidden = !on;
}
btnFace.addEventListener('click', seeWatcher);
// prefers-reduced-motion: no camera travel — the view fades to black, cuts, and fades back (#veil, ~0.2 s each way)
function setRim(on, { climax: isClimax = false, instant = false } = {}) {
  facePending = null;                           // a face cut still behind the veil is replaced by this move
  if (instant) stage.setMode(on ? 'rim' : 'table', { cut: true });
  else if (Q.reducedMotion) {
    clearTimeout(veilTimer); veil.classList.add('on');
    stage.rig.mode = on ? 'rim' : 'table';                                    // the state (and label) change now; the picture at the cut
    veilTimer = setTimeout(() => { stage.setMode(on ? 'rim' : 'table', { cut: true }); if (isClimax) climax.cut = true;
      requestAnimationFrame(() => requestAnimationFrame(() => veil.classList.remove('on'))); }, 240);
  } else stage.setMode(on ? 'rim' : 'table');
  const b = $('#btn-rim');                      // the label names the action, so no aria-pressed (it would say the state twice)
  b.querySelector('.lbl-long').textContent = on ? 'Back to the table' : 'Sit on the rim';
  b.querySelector('.lbl-short').textContent = on ? 'Table' : 'On the rim';
  updateCaption();
}
$('#btn-rim').addEventListener('click', () => setRim(stage.rig.mode !== 'rim'));
function toggleSound() {
  const on = sound.muted; sound.setMuted(!on);
  $('#btn-sound').setAttribute('aria-pressed', on);        // fixed name "Sound"; the state is aria-pressed only
}
$('#btn-sound').addEventListener('click', toggleSound);
// after a phone call / app switch the context is "interrupted" or "suspended": wake it on the next gesture
function wakeSound() { if (!sound.muted && sound.ctx && sound.ctx.state !== 'running') sound.ctx.resume().catch(() => {}); }
document.addEventListener('pointerdown', wakeSound, true);
document.addEventListener('keydown', wakeSound, true);
let lastFocus = null, infoTimer = null;
const BEHIND = ['#top', '#crank', '#foot', '#gl', '#ending', '#intro'];    // made inert while the dialog is open (focus stays inside)
function openInfo() {
  const p = $('#info'), s = $('#scrim'); lastFocus = document.activeElement;
  clearTimeout(infoTimer); infoTimer = null;     // a close still fading out must not hide it again (touch: the page stayed inert)
  for (const q of BEHIND) $(q).inert = true;
  p.hidden = false; s.hidden = false;
  requestAnimationFrame(() => { p.classList.add('open'); s.classList.add('open'); $('#btn-close').focus(); });
}
function closeInfo() {
  const p = $('#info'), s = $('#scrim'); p.classList.remove('open'); s.classList.remove('open');
  clearTimeout(infoTimer); infoTimer = setTimeout(() => { infoTimer = null; p.hidden = true; s.hidden = true; }, 450);
  for (const q of BEHIND) $(q).inert = false;                // before focus(): inert elements cannot take focus
  (lastFocus || $('#btn-info')).focus?.();
}
$('#btn-info').addEventListener('click', openInfo);
$('#btn-close').addEventListener('click', closeInfo);
$('#scrim').addEventListener('click', closeInfo);
crank.on('stop', (which, speed) => {
  if (speed > 4) { sound.knock(Math.min(1, speed / 60)); if (navigator.vibrate && coarse && navigator.userActivation?.hasBeenActive) try { navigator.vibrate(12); } catch (e) {} }
});

// ---------------------------------------------------------------- captions
function updateCaption() {
  const N = world.numbers, cap = $('#caption');
  body.classList.toggle('rim', stage.rig.mode === 'rim');
  body.classList.toggle('face', stage.rig.mode === 'rim' && stage.rig.fGoal > 0);
  if (stage.rig.mode === 'rim' && stage.rig.fGoal > 0) {
    cap.innerHTML = window.innerWidth < 560
      ? `The watcher, seeing Earth for the first time <i>·</i> mechanism hidden`
      : `The watcher on the rim of Daedalus, seeing Earth for the first time <i>·</i> plinth and mechanism hidden.`;
  } else if (stage.rig.mode === 'rim') {
    const eye = stage.watcherEye, d = stage.earthCentre(stage.RAISE).distanceTo(eye);
    const here = 2 * Math.asin(stage.earth.radius / d) * 180 / Math.PI;
    const real = 2 * Math.atan(N.earth_mean_radius_km / N.moon_mean_distance_km) * 180 / Math.PI;
    cap.innerHTML = window.innerWidth < 560
      ? `The watcher's view <i>·</i> mechanism hidden<br>This Earth spans <b>${here.toFixed(0)}°</b>; a true-scale one would span <b>${real.toFixed(1)}°</b>.`
      : `From the watcher's seat <i>·</i> this Earth spans <b>${here.toFixed(0)}°</b>; a true-scale Earth seen from the Moon would span <b>${real.toFixed(1)}°</b> — and from Daedalus it is always on the other side of the Moon. <i>·</i> Plinth and mechanism hidden.`;
  } else {
    cap.innerHTML = `Daedalus crater, far side of the Moon <i>·</i> 1&nbsp;mm = 1&nbsp;km <i>·</i> height ×${fmt(N.ve)} <i>·</i> real SLDEM2015 terrain`;
  }
}
function fmt(v, d = 1) { return Number.isInteger(v) ? String(v) : (+v).toFixed(d).replace(/\.0$/, ''); }
function fillNumbers(w) {
  const N = w.numbers, set = (k, s) => document.querySelectorAll(`[data-num="${k}"]`).forEach(n => n.textContent = s);
  const mmPerKm = 1e6 / N.scale_den;
  set('scale', `${fmt(mmPerKm)} mm = 1 km`);
  set('ve', `×${fmt(N.ve)}`); set('ve_mm', `${fmt(N.ve * mmPerKm)} mm`);
  set('tile', `${fmt(N.tile_mm[0])} × ${fmt(N.tile_mm[1])} mm`);
  set('plinth', `${fmt(N.plinth_mm[0])} × ${fmt(N.plinth_mm[1])} × ${fmt(N.plinth_height_mm)} mm`);
  set('travel', `${fmt(+(stage.RAISE - stage.REST).toFixed(1))}°`);
  set('earth', `${fmt(N.earth_d)} mm`); set('watcher', `${fmt(N.watcher_h)} mm`); set('watcher_km', `${fmt(N.watcher_h / mmPerKm)} km`);
  set('true_earth', `${fmt(N.true_scale_earth_m, 2)} m`); set('true_dist', `${fmt(N.true_scale_earth_distance_m)} m`);
  const KIND = { photo: 'Photo', web: 'Web', render: 'Render' }, kindOf = p => KIND[p.kind] || 'Render';
  const showPhoto = p => {
    $('#photo').src = p.url; $('#photo-kind').textContent = kindOf(p);
    $('#photo-cap').textContent = photoCaption(p);
    document.querySelectorAll('#thumbs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.url === p.url));
  };
  if (w.photos?.length) {
    showPhoto(w.photos[0]);
    const th = $('#thumbs'); th.innerHTML = '';
    if (w.photos.length > 1) for (const p of w.photos) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.url = p.url;
      b.setAttribute('aria-label', `Show ${kindOf(p).toLowerCase()} image: ${photoCaption(p)}`);
      b.innerHTML = `<img src="${p.url}" alt="" loading="lazy">`; b.addEventListener('click', () => showPhoto(p)); th.appendChild(b);
    }
    showPhoto(w.photos[0]);
  }
  // everything about Tripo and the track comes from js/config.js; the props sentence follows what is actually on screen
  $('#standins').textContent = onScreenText(w.earth.source, w.watcher.source);
  const made = madeWith(), mp = $('#made'); mp.textContent = '';
  if (made.badge || made.lead) { const t = document.createElement(made.badge ? 'span' : 'b'); if (made.badge) t.className = 'badge'; t.textContent = made.badge || made.lead; mp.append(t, ' '); }
  mp.append(made.text);
  $('#track').textContent = trackLine();
  updateCaption();
}

// ---------------------------------------------------------------- loop
const ending = $('#ending'), endingSr = $('#ending-sr');
const ENDING_TEXT = "It wants quiet, so we didn't send a signal. We sent it a light. A gift for the far side of the Moon.";
let last = performance.now(), settled = 0, shown = false, lastCell = null;
// "Earthrise no. 1,284 for Daedalus. This one was yours." — the global counter, js/config.js COUNTER_ENABLED (off by default). Off: js/lights.js
// is never loaded and nothing is requested. On: the first time a visitor brings the Earth to the top with real input
// (not ?progress / ?theta / the tooling), js/lights.js POSTs once per browser session; the line fades in under the
// closing lines after they are up, and leaves with them. If the counter cannot answer, the line never appears.
const lightEl = $('#lights'), LIGHT_AFTER_S = 4.4;            // the last closing line starts at 3.0 s (style.css .end-to)
let lightAsked = false, lightText = null, lightFailedAt = null, lightFullAt = null, endingAt = 0;
function askLight() {
  if (lightAsked || !CONFIG.COUNTER_ENABLED || !userTurned) return;
  lightAsked = true;
  const failed = () => { lightFailedAt = performance.now(); };
  import('./lights.js')
    .then(m => m.myLight().then(n => { if (n) { lightText = m.lightLine(n); showLight(); } else failed(); }))
    .catch(failed);
}
function showLight() {
  if (!lightText || !shown) return;
  if (lightEl.hidden) { lightEl.textContent = lightText; lightEl.hidden = false; void lightEl.offsetWidth; }   // start from transparent
  lightEl.style.transitionDelay = `${Math.max(0, LIGHT_AFTER_S - (performance.now() - endingAt) / 1000).toFixed(2)}s`;
  lightEl.classList.add('on');
  endingSr.textContent = `${ENDING_TEXT} ${lightText}`;
  // when it is fully in: its opacity transition's delay + duration as computed (reduced motion shortens both)
  const cs = getComputedStyle(lightEl), props = cs.transitionProperty.split(',').map(x => x.trim());
  const sec = (list, i) => { const a = list.split(','), x = (a[i] ?? a[a.length - 1]).trim(); return parseFloat(x) * (x.endsWith('ms') ? 0.001 : 1) || 0; };
  const i = Math.max(0, props.indexOf('opacity'));
  climax.lightFullAt = lightFullAt = performance.now() + (sec(cs.transitionDelay, i) + sec(cs.transitionDuration, i)) * 1000;
}
function hideLight() { lightEl.style.transitionDelay = '0s'; lightEl.classList.remove('on'); climax.lightFullAt = lightFullAt = null; }
// when the face shot leaves the eye (see FACE_HOLD_S above)
function faceDueAt() {
  const base = endingAt + FACE_HOLD_S * 1000;
  if (!CONFIG.COUNTER_ENABLED || !lightAsked || lightFailedAt != null) return Math.max(base, lightFailedAt ?? 0);
  if (lightFullAt != null) return Math.max(base, lightFullAt + FACE_AFTER_LIGHT_S * 1000);
  return endingAt + FACE_LIGHT_WAIT_S * 1000;                   // the counter has not answered yet: not forever
}
const ft = []; let lastAdapt = performance.now(), dprStep = 0;
function frame(now) {
  requestAnimationFrame(frame);                 // first: an exception below costs one frame, never the loop
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  crank.step(dt);
  stage.setTheta(crank.theta);
  stage.render(dt, now / 1000);
  updateDial();
  // the climax: the first rise, as soon as the Earth clears the far ridge from the table
  if (climaxDue() && stage.rig.mode === 'table' && stage.visFrac >= CLIMAX_VIS && crank.theta < stage.RAISE - 3) startEarlyClimax();
  // ending text: Earth at the top and at rest
  const atTop = crank.theta >= stage.RAISE - 0.6 && Math.abs(crank.omega) < 3 && !crank.dragging;
  settled = atTop ? settled + dt : 0;
  // the climax, otherwise (the Earth never reached CLIMAX_VIS from this view on the way): at the first arrival at the top
  if (settled > 0.45 && climaxDue()) {
    if (stage.rig.mode === 'table') startClimax(crank.auto ? 'auto' : 'hand');
    else { climax.done = true; climax.by = 'already on the rim'; }               // it rose in front of the watcher anyway
  }
  if (climax.phase === 'flight' || climax.phase === 'rising') {
    const R = stage.rig, landed = R.mode !== 'rim' || R.t >= 0.999;
    if (landed && climax.arrivedAt == null) climax.arrivedAt = performance.now();
    if (climax.phase === 'rising' && landed) {                  // landed (or sent back to the table on the way)
      if (climax.rmTheta != null && R.mode === 'rim' && crank.theta < climax.rmTheta) crank.jump(climax.rmTheta);   // reduced motion: behind the veil
      resumeAfterFlight();
    } else if (climax.phase === 'flight' && landed) climax.phase = 'landed';
  }
  if (settled > 0.45) askLight();                               // the counter: asked at the climax's start (startEarlyClimax) or here, at the top
  // the closing lines: Earth at the top and at rest — during the climax, only once the camera has (nearly) landed on the rim
  const inFlight = stage.rig.mode === 'rim' && stage.rig.t < 0.9;
  if (!shown && settled > 0.45 && entered && !inFlight) {
    shown = true; ending.classList.add('show'); endingSr.textContent = ENDING_TEXT; endingAt = performance.now(); showLight();
    if (climax.endingAt == null && climax.startedAt != null) climax.endingAt = performance.now();
    if (CONFIG.FACE_ARC && climax.face == null && climax.by) {     // the first closing lines after the first arrival at the top
      if (stage.rig.mode === 'rim' && climax.enabled) { climax.face = 'wait'; climax.faceDue = faceDueAt(); }
      else climax.face = 'skipped';
    } else if (CONFIG.FACE_ARC && climax.face != null && climax.face !== 'wait' && climax.enabled && stage.rig.mode === 'rim' && stage.rig.fGoal === 0 && !faceAfterLand) {
      climax.again = { state: 'wait', due: faceDueAt(), n: ++climax.agains };   // v4.1: risen again in front of the watcher
    }
  }
  if (climax.face === 'wait') {
    if (stage.rig.mode !== 'rim' || !shown || !$('#info').hidden) climax.face = 'skipped';   // back on the table, lowered, reading
    else { climax.faceDue = faceDueAt(); if (now >= climax.faceDue && !stage.rig.dragging && !crank.dragging && !crank.keyDir) startFace(); }
  }
  if (climax.face === 'moving') {
    if (stage.rig.f >= 1 && stage.rig.t >= 1) { climax.face = 'done'; climax.faceArrivedAt = performance.now(); }
    else if (stage.rig.mode !== 'rim') climax.face = 'left';                             // "Back to the table" on the way
  }
  const A = climax.again;                                       // the later arcs: the same rules as the first
  if (A?.state === 'wait') {
    if (stage.rig.mode !== 'rim' || !shown || !$('#info').hidden || stage.rig.fGoal > 0) A.state = 'skipped';
    else { A.due = faceDueAt(); if (now >= A.due && !stage.rig.dragging && !crank.dragging && !crank.keyDir) A.state = faceAuto() && faceTo(true) ? 'moving' : 'skipped'; }
  }
  if (A?.state === 'moving') {
    if (stage.rig.f >= 1 && stage.rig.t >= 1) A.state = 'done';
    else if (stage.rig.mode !== 'rim' || stage.rig.fGoal === 0) A.state = 'left';
  }
  if (faceAfterLand) {                                          // "See the watcher" from the table: once landed on the rim
    if (stage.rig.mode !== 'rim' || crank.theta < stage.RAISE - 1.5) faceAfterLand = false;
    else if (stage.rig.t >= 0.999 && facePending == null) { faceAfterLand = false; goFace(); }
  }
  updateFaceButton();
  // lowering the Earth from the face shot: back to the eye, so it sets behind the ridge as the watcher sees it
  if ((stage.rig.fGoal > 0 || facePending) && crank.theta < stage.RAISE - 1.5) { faceTo(false); if (climax.face === 'moving') climax.face = 'left'; }
  if (shown && crank.theta < stage.RAISE - 6) { shown = false; ending.classList.remove('show'); endingSr.textContent = ''; hideLight(); }
  sound.update(crank.omega, stage.glow);
  // a faint O-ring tick every 6° of crank — the touch feedback iOS cannot give with vibration
  const cell = Math.floor((crank.theta - stage.REST) / 6);
  if (cell !== lastCell) { if (lastCell !== null && Math.abs(crank.omega) > 2) sound.tick(Math.min(1, Math.abs(crank.omega) / 40)); lastCell = cell; }
  // frame stats + adaptive resolution
  ft.push(dt); if (ft.length > 240) ft.shift();
  if (now - lastAdapt > 2500 && ft.length > 90 && entered && !qs.has('fixdpr')) {
    lastAdapt = now;
    const avg = ft.slice(-90).reduce((a, b) => a + b, 0) / 90;
    if (avg > 1 / 42 && stage.dpr > 1) { stage.setPixelRatio(Math.max(1, stage.dpr - 0.25)); dprStep++; }
  }
}
ready = true;
if (wantEnter) doEnter();
requestAnimationFrame(t => { last = t; frame(t); });

// ---------------------------------------------------------------- test hooks (read-only use by tools/web_app_shoot.mjs)
window.__er = {
  stage, crank, world, sound, config: CONFIG, climax, faceTo: on => faceTo(on), faceUI: () => faceUI(),
  get entered() { return entered; },
  get light() { return { asked: lightAsked, text: lightText }; },
  timeline,
  autoTurn: () => autoTurn(),
  enter: () => requestEnter(),
  setProgress: f => crank.jump(stage.REST + f * (stage.RAISE - stage.REST)),
  rim: on => setRim(on),
  seeWatcher: () => seeWatcher(),
  get faceButton() { return faceBtnOn; },
  stats() {
    const a = ft.slice(-120), avg = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const sorted = [...a].sort((x, y) => x - y), p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const ti = stage.mainInfo || {};
    return { fps: 1 / avg, p95ms: p95 * 1000, dpr: stage.dpr, dprSteps: dprStep, tris: ti.tris, calls: ti.calls, source: world.source,
      theta: crank.theta, visFrac: stage.visFrac, glow: stage.glow, ending: shown, tier };
  },
};
