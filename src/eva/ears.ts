// Where the astronaut's head is and which way it faces, and where the things that can be heard are —
// shared between the scene (which knows the head, every frame), the mission logic (which knows the
// target and the base) and the sound (audio.ts), so a tone can come from the side it is on.
export interface Spot { x: number; z: number }
export const ears = {
  /** set once the scene is drawing: until then nothing is placed in space */
  live: false,
  x: 0, z: 0,
  /** compass degrees the head faces */
  heading: 0,
  /** where the route leads now (the target, or the airlock when returning); null: no walk under way or already there */
  beacon: null as Spot | null,
  /** the habitat */
  base: null as Spot | null,
};
