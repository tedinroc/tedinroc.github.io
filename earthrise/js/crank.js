// Crank physics. Direct drive: knob angle == arm angle θ (assembly.json theta convention, degrees).
// The real crank has an O-ring brake — it stops wherever you let go — and two hard stops. So: a stiff spring toward the
// hand (slight weight), quick friction when released, a soft 1° rubber band past each stop, and a "hit" event.
export class Crank {
  constructor(rest, raise, theta0 = rest) {
    this.rest = rest; this.raise = raise;
    this.theta = theta0; this.omega = 0;           // deg, deg/s
    this.dragging = false; this.target = theta0;   // raw (unclamped) hand angle
    this.keyDir = 0; this.auto = null;             // auto: { to, speed }
    this.listeners = { stop: [], change: [] };
    this._atStop = 0;                              // −1 rest, +1 raise, 0 between
  }
  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, ...a) { for (const f of this.listeners[ev]) f(...a); }
  get progress() { return (this.theta - this.rest) / (this.raise - this.rest); }

  beginDrag() { this.dragging = true; this.auto = null; this.target = this.theta; }
  dragBy(dDeg) { this.target += dDeg; }
  endDrag() { this.dragging = false; }
  setKeyDir(d) { this.keyDir = d; if (d) this.auto = null; }
  nudge(dDeg) { this.auto = { to: Math.min(this.raise, Math.max(this.rest, (this.auto?.to ?? this.theta) + dDeg)), speed: 70, t0: this.auto?.t0 ?? this.theta }; }
  // pace (optional): () => deg/s, re-read every sub-step (e.g. slower while the Earth clears the horizon); changes are eased
  turnTo(deg, speed = 16, pace = null) { this.auto = { to: Math.min(this.raise, Math.max(this.rest, deg)), speed, t0: this.theta, pace }; }
  jump(deg) { this.theta = this.target = Math.min(this.raise, Math.max(this.rest, deg)); this.omega = 0; this.auto = null; this.emit('change', this.theta); }

  step(dt) {
    dt = Math.min(dt, 0.05);
    const th0 = this.theta, n = Math.max(1, Math.ceil(dt * 240));
    for (let i = 0; i < n; i++) this._sub(dt / n);
    const lo = this.rest, hi = this.raise;
    // stop events (once per arrival)
    const at = this.theta >= hi - 0.05 ? 1 : this.theta <= lo + 0.05 ? -1 : 0;
    if (at && at !== this._atStop) {
      const speed = Math.abs((this.theta - th0) / dt);
      this.emit('stop', at, speed);
      if (this.keyDir === at) this.omega = 0;
    }
    this._atStop = at;
    if (this.theta !== th0) this.emit('change', this.theta);
  }

  _sub(dt) {
    const lo = this.rest, hi = this.raise, OVER = 1.0;
    const soft = v => {                                  // rubber band past a stop
      if (v > hi) return hi + OVER * (1 - Math.exp(-(v - hi) / OVER));
      if (v < lo) return lo - OVER * (1 - Math.exp(-(lo - v) / OVER));
      return v;
    };
    if (this.dragging) {
      // keep the hand target from running away beyond the stops (so reversing feels immediate)
      this.target = Math.min(hi + 6, Math.max(lo - 6, this.target));
      const goal = soft(this.target), k = 900, c = 2 * Math.sqrt(k);   // critically damped, ~35 ms lag
      const acc = k * (goal - this.theta) - c * this.omega;
      this.omega += acc * dt; this.theta += this.omega * dt;
    } else if (this.keyDir) {
      const vT = this.keyDir * 46;                        // deg/s while an arrow key is held
      this.omega += (vT - this.omega) * Math.min(1, dt / 0.18);
      this.theta += this.omega * dt;
    } else if (this.auto?.follow) {
      // driven by the page (main.js, the climax flight): toward follow()'s angle, upward only, ≤ 60°/s
      const g = Math.min(hi, this.auto.follow()), stepD = Math.max(0, Math.min(g - this.theta, 60 * dt));
      this.omega = dt > 0 ? stepD / dt : 0; this.theta += stepD;
    } else if (this.auto) {
      const d = this.auto.to - this.theta, dir = Math.sign(d);
      // ease in/out: speed rises over the first 6°, falls over the last 10°
      const from = Math.abs(this.theta - (this.auto.t0 ?? this.theta));
      if (this.auto.pace) this.auto.speed += (this.auto.pace() - this.auto.speed) * Math.min(1, dt / 0.35);
      const v = this.auto.speed * Math.min(1, 0.25 + from / 6) * Math.min(1, 0.12 + Math.abs(d) / 10);
      const stepD = dir * Math.min(Math.abs(d), v * dt);
      this.omega = dt > 0 ? stepD / dt : 0; this.theta += stepD;
      if (Math.abs(d) < 0.02) { this.theta = this.auto.to; this.omega = 0; this.auto = null; }
    } else {
      // released: O-ring friction; anything past a stop springs back
      if (this.theta > hi || this.theta < lo) {
        const lim = this.theta > hi ? hi : lo, k = 600, c = 2 * Math.sqrt(k);
        this.omega += (k * (lim - this.theta) - c * this.omega) * dt; this.theta += this.omega * dt;
        if (Math.abs(this.theta - lim) < 0.01 && Math.abs(this.omega) < 0.5) { this.theta = lim; this.omega = 0; }
      } else {
        this.omega *= Math.exp(-dt / 0.07);
        if (Math.abs(this.omega) < 0.05) this.omega = 0;
        this.theta += this.omega * dt;
      }
    }
    if (!this.dragging) {                                  // hard clamp except the elastic overshoot handled above
      if (this.keyDir || this.auto) this.theta = Math.min(hi, Math.max(lo, this.theta));
      else this.theta = Math.min(hi + OVER, Math.max(lo - OVER, this.theta));
    }
  }
}
