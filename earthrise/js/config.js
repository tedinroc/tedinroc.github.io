// EARTHRISE for Daedalus — site configuration. The one place that says how this entry was made, which track it is
// entered in and where it lives. Every sentence on the page that mentions Tripo or the competition track is written
// from here: index.html leaves those spots empty and main.js fills them; the photo captions in assets/manifest.json are
// neutral and get their sentence about the Earth and the watcher from photoCaption() below.
//
// While TRIPO_USED is false the page shows no Tripo mesh (js/assets.js) and says nothing about Tripo.

export const TRIPO_USED = true;

// Direction track on the entry form: 'Game' | 'Film / VFX' | 'VR / XR / AR' | 'App' | 'Physical Design'
export const TRACK = 'App';

// "Earthrise no. 1,284 for Daedalus. This one was yours." under the closing lines: a global counter served by the
// original deployment. false: js/lights.js is never loaded and the site makes no request beyond its own files. This
// static copy has no counter endpoint, so it is off; with it on and no answer, the page just leaves the line out.
export const COUNTER_ENABLED = false;

// The face shot after the first climax (js/main.js, js/stage.js FACE_S): once the Earth is up and the closing lines
// have started, the camera arcs from the watcher's eye round to its left, its face lit by the Earth, the Earth on the
// other side of the frame.
export const FACE_ARC = true;

// Where the site is deployed. The share-card tags in index.html (og:url, og:image, twitter:image) start with this —
// crawlers do not run JavaScript, so those stay literal.
export const SITE_URL = 'https://tedinroc.github.io/earthrise/';

export const EVENT = 'Tripothon S1';

// ---------------------------------------------------------------- page text

// 'procedural' | 'tripo' | 'placeholder' from a prop source (world.earth.source: 'procedural' or the manifest's kind)
export const propsKind = source => source === 'procedural' ? 'procedural' : /tripo/i.test(source || '') ? 'tripo' : 'placeholder';

const ONE = {
  procedural: 'generated procedurally in the browser',
  tripo: 'the Tripo model',
  placeholder: 'a simple placeholder mesh',
};
function propsClause(earth, watcher) {
  const e = propsKind(earth), w = propsKind(watcher);
  if (e !== w) return `the Earth is ${ONE[e]} and the watcher is ${ONE[w]}`;
  if (e === 'procedural') return TRIPO_USED ? 'the Earth and the watcher are procedural stand-ins for the Tripo models'
    : 'the Earth and the watcher are generated procedurally in the browser';
  if (e === 'tripo') return 'the Earth and the watcher are the Tripo models';
  return 'the Earth and the watcher are simple placeholder meshes';
}
const sentence = s => s[0].toUpperCase() + s.slice(1) + '.';

// "This web version": what is on screen right now (the sources the page actually rendered)
export const onScreenText = (earth, watcher) => sentence(propsClause(earth, watcher));

// a manifest photo: its neutral caption, plus what the Earth and the watcher were when it was shot (photo.props,
// recorded by tools/web_assets.py); real photos of the print carry no props and keep their caption as written
export function photoCaption(p) {
  const base = (p.caption || '').trim();
  if (!p.props) return base;
  return `${base.replace(/[.\s]+$/, '')}; ${propsClause(p.props.earth, p.props.watcher)}.`;
}

// the boxed paragraph after the credits: a badge (only when there is something to badge) or a bold lead, then the text
export const madeWith = () => TRIPO_USED
  ? { badge: 'Made with Tripo', lead: null, text: 'The Earth and the watcher are generated with Tripo. Terrain comes from NASA and JAXA data; the plinth and crank were modelled in CAD.' }
  : { badge: null, lead: 'How it was made.', text: 'Terrain comes from NASA and JAXA data; the plinth and crank were modelled in CAD; the Earth is a real-time shader and the watcher a procedural figure.' };

// the last line of the info panel
export const trackLine = () => [EVENT, TRACK, TRIPO_USED ? 'Tool track: Tripo' : null].filter(Boolean).join(' · ');

export const CONFIG = { TRIPO_USED, TRACK, COUNTER_ENABLED, FACE_ARC, SITE_URL, EVENT };
