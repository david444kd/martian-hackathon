// What you hear inside the helmet, all synthesised with Web Audio (no recordings): the life-support
// fan, your own breathing (its rate follows the suit model), muffled footsteps carried through the
// suit, wind in a dust storm, radio tones before a call, the master alarm, and the call itself read
// out: a recorded human voice from public/voice/ when there is one, else speech synthesis (Russian). Browsers allow sound only after a user gesture: `start()` is called from
// the "Begin EVA" / "Enter VR" buttons. Mars' thin air carries almost no sound; this is the suit.

export type Tone = "info" | "warning" | "critical";

/**
 * The most human-sounding Russian voice the system has: neural "Natural"/"Online" voices (Microsoft
 * Svetlana / Dmitry in Edge and Windows 11), then Google's, then Apple's (Milena / Yuri), and only then
 * the plain default; with no Russian voice at all, the best English one.
 */
let chosen: SpeechSynthesisVoice | null | undefined;
function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen) return chosen;
  const all = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  const ru = all.filter((v) => v.lang.toLowerCase().startsWith("ru"));
  const pool = ru.length ? ru : all.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (!pool.length) return null; // voices load asynchronously: try again next time
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural|online/.test(n)) s += 50;
    if (/premium|enhanced/.test(n)) s += 35;
    if (n.includes("google")) s += 25;
    if (/dmitry|дмитрий|yuri|юрий|svetlana|светлана|milena|милена/.test(n)) s += 10;
    if (/irina|ирина|pavel|павел|desktop/.test(n)) s -= 10; // the old robotic SAPI voices
    return s;
  };
  chosen = [...pool].sort((a, b) => score(b) - score(a))[0];
  return chosen;
}
if (typeof speechSynthesis !== "undefined") speechSynthesis.addEventListener?.("voiceschanged", () => { chosen = undefined; });

/** recordings in public/voice/<key>.mp3: null = there is none (checked once per key) */
const recordings = new Map<string, Promise<AudioBuffer | null>>();

export class SuitAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private fan!: GainNode;
  private breath!: GainNode;
  private breathFilter!: BiquadFilterNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private nextBreath = 0;
  private inhale = true;
  private nextStep = 0;
  muted = false;
  speaking = false;

  get running() { return this.ctx?.state === "running"; }

  start() {
    try {
      if (!this.ctx) this.build();
      void this.ctx!.resume();
    } catch { /* no audio: the panels still show everything */ }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
    if (m) window.speechSynthesis?.cancel();
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    // 4 s of brown-ish noise, looped by every continuous sound
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    this.noise = buf;

    const loop = (filter: BiquadFilterNode, gain: GainNode) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true; src.loopStart = Math.random();
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
    };
    // life-support fan: low steady hum + a faint motor tone
    const fanF = ctx.createBiquadFilter(); fanF.type = "lowpass"; fanF.frequency.value = 420;
    this.fan = ctx.createGain(); this.fan.gain.value = 0.16;
    loop(fanF, this.fan);
    const motor = ctx.createOscillator(), mg = ctx.createGain();
    motor.frequency.value = 118; motor.type = "triangle"; mg.gain.value = 0.006;
    motor.connect(mg).connect(this.master); motor.start();
    // breathing: band-passed noise, swelled in and out by `update`
    this.breathFilter = ctx.createBiquadFilter(); this.breathFilter.type = "bandpass"; this.breathFilter.frequency.value = 900; this.breathFilter.Q.value = 0.7;
    this.breath = ctx.createGain(); this.breath.gain.value = 0;
    loop(this.breathFilter, this.breath);
    // wind on the suit in a storm
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = "bandpass"; this.windFilter.frequency.value = 380; this.windFilter.Q.value = 0.9;
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    loop(this.windFilter, this.wind);
  }

  /** every frame or so: breathing paced by the suit, footsteps while walking, wind with the storm */
  update(respPerMin: number, exertion: number, moving: boolean, speed: number, storm: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    if (t >= this.nextBreath) {
      const period = 60 / Math.max(8, respPerMin), half = this.inhale ? period * 0.42 : period * 0.58;
      const peak = (this.inhale ? 0.05 : 0.075) * (0.55 + exertion * 0.9);
      const g = this.breath.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(peak, t + half * 0.35);
      g.linearRampToValueAtTime(0.0005, t + half * 0.95);
      this.breathFilter.frequency.setValueAtTime(this.inhale ? 1100 : 750, t);
      this.inhale = !this.inhale;
      this.nextBreath = t + half;
    }
    if (moving && speed > 0.25 && t >= this.nextStep) {
      this.step(Math.min(1, speed / 2));
      this.nextStep = t + Math.max(0.28, 0.62 / Math.max(0.6, Math.min(2.2, speed)));
    }
    this.wind.gain.setTargetAtTime(storm * 0.5, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(300 + storm * 260 + Math.sin(t * 0.7) * 90 * storm, t, 0.5);
    this.fan.gain.setTargetAtTime(0.14 + exertion * 0.05, t, 1);
  }

  private burst(at: number, dur: number, type: BiquadFilterType, freq: number, gain: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at, Math.random() * 3, dur + 0.05);
  }

  private beep(at: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine") {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
    g.gain.setValueAtTime(gain, at + dur - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at); o.stop(at + dur + 0.02);
  }

  /** a boot on regolith, heard through the suit: a dull thump and a little crunch */
  private step(weight: number) {
    const t = this.ctx!.currentTime;
    this.burst(t, 0.16, "lowpass", 260, 0.28 * (0.6 + weight));
    this.burst(t + 0.02, 0.09, "bandpass", 1400, 0.05 * (0.5 + weight));
  }

  /** radio: squelch and the two-tone call signal, before mission control speaks */
  radio() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    this.burst(t, 0.08, "highpass", 2500, 0.12);
    this.beep(t + 0.1, 2525, 0.22, 0.08);
    this.beep(t + 0.36, 2475, 0.22, 0.08);
  }

  /** caution / master alarm */
  alarm(level: Tone) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    if (level === "critical") {
      for (let k = 0; k < 6; k++) this.beep(t + k * 0.32, k % 2 ? 1046 : 784, 0.28, 0.16, "square");
    } else if (level === "warning") {
      for (let k = 0; k < 3; k++) this.beep(t + k * 0.38, 880, 0.24, 0.12, "triangle");
    } else {
      this.beep(t, 660, 0.14, 0.08); this.beep(t + 0.18, 990, 0.18, 0.08);
    }
  }

  /**
   * A fixed call: a human recording from public/voice/<key>.mp3 when there is one (played through a
   * radio filter: band-limited, a little crackle), otherwise the same text by speech synthesis.
   */
  line(key: string, text: string, urgent = false) {
    const ctx = this.ctx;
    if (this.muted) return;
    if (!ctx) { this.say(text, urgent); return; }
    let rec = recordings.get(key);
    if (!rec) {
      rec = fetch(`/voice/${key}.mp3`)
        .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("audio") ? r.arrayBuffer() : null))
        .then((b) => (b ? ctx.decodeAudioData(b) : null))
        .catch(() => null);
      recordings.set(key, rec);
    }
    void rec.then((buf) => {
      if (!buf || ctx.state !== "running") { this.say(text, urgent); return; }
      const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), sh = ctx.createWaveShaper();
      src.buffer = buf; hp.type = "highpass"; hp.frequency.value = 320; lp.type = "lowpass"; lp.frequency.value = 3200;
      const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 1.8); }
      sh.curve = curve; g.gain.value = 1.1;
      src.connect(hp).connect(lp).connect(sh).connect(g).connect(this.master);
      const t = ctx.currentTime;
      this.burst(t, 0.06, "highpass", 2500, 0.08);
      src.start(t + 0.05);
      src.onended = () => this.burst(ctx.currentTime, 0.09, "highpass", 2200, 0.1); // squelch tail
    });
  }

  /** read a call out loud (after the radio tones) */
  say(text: string, urgent = false) {
    if (this.muted || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "ru-RU";
    // spoken plainly, like on the radio: natural pitch, a little quicker when it matters
    u.rate = urgent ? 1.1 : 1.0; u.pitch = 1; u.volume = 1;
    u.onstart = () => { this.speaking = true; };
    u.onend = u.onerror = () => { this.speaking = false; };
    if (urgent) window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  dispose() {
    window.speechSynthesis?.cancel();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
