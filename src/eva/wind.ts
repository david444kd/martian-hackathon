// What the dust is doing around the astronaut this instant. The scene writes it every frame
// (atmo.tsx); the sound (audio.ts), the visor and the screen view read it, so a squall is seen, heard
// and felt at the same moment. Authored for the demonstration: not a weather model or a measurement.
export const wind = {
  /** dust around the astronaut, 0..1, eased */
  storm: 0,
  /** how hard it is blowing right now, 0..1 */
  gust: 0,
  /** a squall passing (visibility collapses for a few seconds), 0..1; only inside a storm */
  squall: 0,
  /** static discharges in the dust so far, and when the last one was (performance.now()) */
  zaps: 0,
  zapAt: 0,
};
