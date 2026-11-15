// What you hear inside the helmet, all synthesised with Web Audio (no recordings): the life-support
// fan, your own breathing (its rate follows the suit model), muffled footsteps carried through the
// suit, wind in a dust storm, radio tones before a call, the master alarm, and the call itself read
// out in the interface language (English by default): a recorded human voice from public/voice/<lang>/ when there is one, else speech synthesis. Browsers allow sound only after a user gesture: `start()` is called from
// the "Begin EVA" / "Enter VR" buttons. Mars' thin air carries almost no sound; this is the suit.
// In a dust storm (wind.ts, written by the scene every frame) the helmet fills with it: a low rumble,
// a howl and a thin whistle that rise with each gust, sand hissing and pattering on the visor, a thud
// when a squall hits, the crackle of static discharges in the dust (Perseverance's microphone recorded
// such discharges in dust devils and storm fronts), interference on the radio, harder breathing and
// your own pulse. Loudness and character are dramatised for the demonstration, not measured.
// Alerts are soft chimes at about a third of the level they had as square-wave beeps.

import i18n from "../i18n";
import { wind } from "./wind";

export type Tone = "info" | "warning" | "critical";

type VoiceLang = "en" | "ru" | "kk";
/** the language the helmet speaks: the interface language */
const voiceLang = (): VoiceLang => (i18n.language === "ru" || i18n.language === "kk" ? i18n.language : "en");
const BCP: Record<VoiceLang, string> = { en: "en-US", ru: "ru-RU", kk: "kk-KZ" };
/** voices to try, in order: the language itself, then (few systems speak Kazakh) Russian, then English */
const FALLBACK: Record<VoiceLang, string[]> = { en: ["en"], ru: ["ru", "en"], kk: ["kk", "ru", "en"] };

/**
 * The most human-sounding voice the system has for the helmet's language: neural "Natural"/"Online"
 * voices (Microsoft Aria / Jenny / Guy, Svetlana / Dmitry in Edge and Windows 11), then Google's, then
 * Apple's (Samantha, Milena / Yuri), and only then the plain default.
 */
const chosen = new Map<VoiceLang, SpeechSynthesisVoice>();
function pickVoice(lang: VoiceLang): SpeechSynthesisVoice | null {
  const hit = chosen.get(lang);
  if (hit) return hit;
  const all = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  const pool = FALLBACK[lang].map((l) => all.filter((v) => v.lang.toLowerCase().startsWith(l))).find((p) => p.length);
  if (!pool) return null; // voices load asynchronously: try again next time
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural|online/.test(n)) s += 50;
    if (/premium|enhanced/.test(n)) s += 35;
    if (n.includes("google")) s += 25;
    if (/aria|jenny|guy|ava|andrew|emma|brian|samantha|dmitry|дмитрий|yuri|юрий|svetlana|светлана|milena|милена|daulet|aigul/.test(n)) s += 10;
    if (/irina|ирина|pavel|павел|david|zira|desktop/.test(n)) s -= 10; // the old robotic SAPI voices
    return s;
  };
  const best = [...pool].sort((a, b) => score(b) - score(a))[0];
  chosen.set(lang, best);
  return best;
}
if (typeof speechSynthesis !== "undefined") speechSynthesis.addEventListener?.("voiceschanged", () => { chosen.clear(); });

/** recordings in public/voice/<lang>/<key>.mp3: null = there is none (checked once per language and key) */
const recordings = new Map<string, Promise<AudioBuffer | null>>();

export class SuitAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private fan!: GainNode;
  private breath!: GainNode;
  private breathFilter!: BiquadFilterNode;
  private white!: AudioBuffer;
  private motor!: OscillatorNode;
  // the storm: rumble, howl, whistle, sand hiss, grit patter
  private rumble!: GainNode;
  private howl!: GainNode;
  private howlFilter!: BiquadFilterNode;
  private whistle!: GainNode;
  private whistleFilter!: BiquadFilterNode;
  private hiss!: GainNode;
  private grit!: GainNode;
  private gritSrc!: AudioBufferSourceNode;
  private timer = 0;
  private zaps = 0;
  private inSquall = false;
  private nextBeat = 0;
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
    // a limiter: the storm, an alarm and a call can all sound at once
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12; limiter.knee.value = 8; limiter.ratio.value = 8; limiter.attack.value = 0.004; limiter.release.value = 0.2;
    this.master.connect(limiter).connect(ctx.destination);
    // 4 s of brown-ish noise, looped by every continuous sound
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    this.noise = buf;

    // 2 s of white noise (hiss, clicks), and 3 s of separate grains striking the visor
    const wlen = ctx.sampleRate * 2, white = ctx.createBuffer(1, wlen, ctx.sampleRate), w = white.getChannelData(0);
    for (let i = 0; i < wlen; i++) w[i] = Math.random() * 2 - 1;
    this.white = white;
    const plen = ctx.sampleRate * 3, patter = ctx.createBuffer(1, plen, ctx.sampleRate), pd = patter.getChannelData(0);
    for (let k = 0; k < 420; k++) {
      const at = Math.floor(Math.random() * (plen - 600)), n = Math.floor(ctx.sampleRate * (0.0015 + Math.random() * 0.006)), amp = Math.random() ** 2.2;
      for (let i = 0; i < n; i++) pd[at + i] += (Math.random() * 2 - 1) * amp * Math.exp((-5 * i) / n);
    }

    const loop = (filter: BiquadFilterNode, gain: GainNode, buffer: AudioBuffer = buf) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer; src.loop = true; src.loopStart = Math.random();
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      return src;
    };
    const filter = (type: BiquadFilterType, freq: number, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
    const silent = () => { const g = ctx.createGain(); g.gain.value = 0; return g; };
    // life-support fan: low steady hum + a faint motor tone
    const fanF = ctx.createBiquadFilter(); fanF.type = "lowpass"; fanF.frequency.value = 420;
    this.fan = ctx.createGain(); this.fan.gain.value = 0.16;
    loop(fanF, this.fan);
    const motor = ctx.createOscillator(), mg = ctx.createGain();
    motor.frequency.value = 118; motor.type = "triangle"; mg.gain.value = 0.006;
    motor.connect(mg).connect(this.master); motor.start();
    this.motor = motor;
    // breathing: band-passed noise, swelled in and out by `update`
    this.breathFilter = ctx.createBiquadFilter(); this.breathFilter.type = "bandpass"; this.breathFilter.frequency.value = 900; this.breathFilter.Q.value = 0.7;
    this.breath = ctx.createGain(); this.breath.gain.value = 0;
    loop(this.breathFilter, this.breath);
    // the storm on the suit (levels set by weather())
    loop(filter("lowpass", 95), (this.rumble = silent()));
    loop((this.howlFilter = filter("bandpass", 300, 4.5)), (this.howl = silent()));
    loop((this.whistleFilter = filter("bandpass", 1100, 24)), (this.whistle = silent()), white);
    loop(filter("highpass", 3200), (this.hiss = silent()), white);
    this.gritSrc = loop(filter("highpass", 2400), (this.grit = silent()), patter);
    this.timer = window.setInterval(() => this.weather(), 50);
  }

  /** 20 times a second: the storm's sounds follow the gusts the scene is drawing */
  private weather() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime, s = wind.storm, g = wind.gust, q = wind.squall, s2 = s * s, s3 = s2 * s;
    const to = (p: AudioParam, v: number, tc = 0.25) => p.setTargetAtTime(v, t, tc);
    to(this.rumble.gain, s2 * 0.55 + q * 0.5, 0.4);
    to(this.howl.gain, s2 * (0.14 + g * 0.42) + q * 0.2);
    to(this.howlFilter.frequency, 230 + g * 420 + q * 330 + Math.sin(t * 0.7) * 40);
    to(this.whistle.gain, s3 * (g * g * 0.5 + q * 0.6), 0.35);
    to(this.whistleFilter.frequency, 850 + g * 700 + q * 500 + Math.sin(t * 1.3) * 90, 0.3);
    to(this.hiss.gain, s3 * (0.012 + g * 0.045 + q * 0.07));
    to(this.grit.gain, s3 * (0.06 + g * 0.3 + q * 0.45), 0.15);
    to(this.gritSrc.playbackRate, 0.75 + g * 0.6 + q * 0.5, 0.3);
    to(this.motor.frequency, 118 + s3 * 16 + q * 10, 0.6);   // the fan works harder against the dust
    // a squall arriving thumps the suit
    if (q > 0.45 && !this.inSquall) {
      this.inSquall = true;
      this.burst(t, 0.55, "lowpass", 130, 0.9);
      this.sweep(t, 62, 34, 0.6, 0.5);
    } else if (q < 0.15) this.inSquall = false;
    if (wind.zaps !== this.zaps) { this.zaps = wind.zaps; this.crackle(t); }
  }

  /** a static discharge nearby: a sharp snap, a few smaller ones, a fizz on the radio */
  private crackle(t: number) {
    const n = 2 + Math.floor(Math.random() * 4);
    let at = t;
    for (let k = 0; k < n; k++) {
      this.burst(at, 0.004 + Math.random() * 0.016, "highpass", 1500 + Math.random() * 2500, (k ? 0.1 : 0.3) * (0.6 + Math.random() * 0.6), this.white);
      at += 0.008 + Math.random() * 0.05;
    }
    this.burst(t + 0.01, 0.09, "bandpass", 2600, 0.07, this.white);
  }

  private sweep(at: number, from: number, to: number, dur: number, gain: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(from, at); o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at); o.stop(at + dur + 0.02);
  }

  /** twice a second: breathing paced by the suit, footsteps while walking, the pulse you hear when it is bad */
  update(respPerMin: number, exertion: number, moving: boolean, speed: number, storm: number, pulse = 80) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    // deep in the dust you breathe harder and hear your own heart
    const fear = Math.min(1, Math.max(0, (storm - 0.55) / 0.35));
    if (fear <= 0) this.nextBeat = t;
    else while (this.nextBeat < t + 0.6) {
      const at = Math.max(t, this.nextBeat), level = fear * (0.75 + wind.squall * 0.5);
      this.burst(at, 0.1, "lowpass", 110, 0.5 * level); this.sweep(at, 92, 60, 0.11, 0.2 * level);
      this.burst(at + 0.14, 0.08, "lowpass", 140, 0.3 * level); this.sweep(at + 0.14, 108, 72, 0.08, 0.12 * level);
      this.nextBeat = at + 60 / Math.min(150, Math.max(50, pulse + fear * 22));
    }
    if (t >= this.nextBreath) {
      const period = 60 / (Math.max(8, respPerMin) * (1 + fear * 0.35)), half = this.inhale ? period * 0.42 : period * 0.58;
      const peak = (this.inhale ? 0.05 : 0.075) * (0.55 + exertion * 0.9) * (1 + fear * 0.7);
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
    this.fan.gain.setTargetAtTime(0.14 + exertion * 0.05, t, 1);
  }

  private burst(at: number, dur: number, type: BiquadFilterType, freq: number, gain: number, buffer: AudioBuffer = this.noise) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buffer; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), at + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.loop = dur > buffer.duration - 0.3;
    src.start(at, Math.random() * Math.max(0, buffer.duration - dur - 0.1), dur + 0.05);
  }

  /** a boot on regolith, heard through the suit: a dull thump and a little crunch */
  private step(weight: number) {
    const t = this.ctx!.currentTime;
    this.burst(t, 0.16, "lowpass", 260, 0.28 * (0.6 + weight));
    this.burst(t + 0.02, 0.09, "bandpass", 1400, 0.05 * (0.5 + weight));
  }

  /** a soft tone: a sine with a little of its octave, a quick fade in and a long fade out, low-passed — a chime, not a buzzer */
  private chime(at: number, freq: number, dur: number, gain: number) {
    const ctx = this.ctx!, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 2400;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    for (const [mult, level] of [[1, 1], [2, 0.16]] as const) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq * mult; og.gain.value = level;
      o.connect(og).connect(g);
      o.start(at); o.stop(at + dur + 0.05);
    }
    g.connect(lp).connect(this.master);
  }

  /** radio: a soft squelch and the two-tone call signal, before mission control speaks */
  radio() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    this.burst(t, 0.07, "highpass", 2200, 0.045);
    if (wind.storm > 0.5) this.crackle(t + 0.05);   // the dust is on the link too
    this.chime(t + 0.1, 1480, 0.2, 0.035);
    this.chime(t + 0.34, 1245, 0.24, 0.035);
  }

  /**
   * The alert tones, kept quiet: they point at the display and the voice, they do not shout over them.
   * WARNING (critical): three falling two-note chimes; CAUTION: two notes; advisory: one rising pair.
   */
  alarm(level: Tone) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    if (level === "critical") {
      for (let k = 0; k < 3; k++) { this.chime(t + k * 0.62, 784, 0.34, 0.07); this.chime(t + k * 0.62 + 0.2, 587, 0.42, 0.07); }
    } else if (level === "warning") {
      this.chime(t, 659, 0.36, 0.05); this.chime(t + 0.3, 659, 0.46, 0.05);
    } else {
      this.chime(t, 523, 0.26, 0.03); this.chime(t + 0.16, 659, 0.38, 0.03);
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
    const path = `${voiceLang()}/${key}`;
    let rec = recordings.get(path);
    if (!rec) {
      rec = fetch(`/voice/${path}.mp3`)
        .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("audio") ? r.arrayBuffer() : null))
        .then((b) => (b ? ctx.decodeAudioData(b) : null))
        .catch(() => null);
      recordings.set(path, rec);
    }
    void rec.then((buf) => {
      if (!buf || ctx.state !== "running") { this.say(text, urgent); return; }
      const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), sh = ctx.createWaveShaper();
      src.buffer = buf; hp.type = "highpass"; hp.frequency.value = 320; lp.type = "lowpass"; lp.frequency.value = 3200;
      const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 1.8); }
      sh.curve = curve; g.gain.value = 1.1;
      src.connect(hp).connect(lp).connect(sh).connect(g).connect(this.master);
      const t = ctx.currentTime;
      this.burst(t, 0.06, "highpass", 2200, 0.04);
      // in a storm the voice comes through static
      if (wind.storm > 0.4) this.burst(t + 0.05, buf.duration, "bandpass", 2100, 0.05 * wind.storm, this.white);
      src.start(t + 0.05);
      src.onended = () => this.burst(ctx.currentTime, 0.08, "highpass", 2200, 0.045); // squelch tail
    });
  }

  /** read a call out loud (after the radio tones) */
  say(text: string, urgent = false) {
    if (this.muted || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const lang = voiceLang(), voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? BCP[lang];
    // spoken plainly, like on the radio: natural pitch, a little quicker when it matters
    u.rate = urgent ? 1.1 : 1.0; u.pitch = 1; u.volume = 1;
    u.onstart = () => { this.speaking = true; };
    u.onend = u.onerror = () => { this.speaking = false; };
    if (urgent) window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  dispose() {
    clearInterval(this.timer);
    window.speechSynthesis?.cancel();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
