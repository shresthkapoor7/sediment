import type { CSSProperties } from "react";

// A small brain for the home headline: the two hemispheres draw in, then the folds light up one
// after another, the way muzzle's switch flips on. The resting style is the lit state (see
// `.landing-brain` in globals.css), so with reduced motion it simply shows lit.
const LINES = [
  // hemispheres
  { d: "M20 6C20 3 17 1.5 14.5 2.5C12 3.5 11 5.5 11 7C8 7 5.5 9.5 5.5 12.5C3 13.5 2 16 2 18.5C2 21 3 23 4.5 24C4 27 6 29.5 9 29.5C10 31.5 12.5 32.5 15 32C17.5 31.5 20 29.5 20 27Z", delay: 1.0 },
  { d: "M20 6C20 3 23 1.5 25.5 2.5C28 3.5 29 5.5 29 7C32 7 34.5 9.5 34.5 12.5C37 13.5 38 16 38 18.5C38 21 37 23 35.5 24C36 27 34 29.5 31 29.5C30 31.5 27.5 32.5 25 32C22.5 31.5 20 29.5 20 27Z", delay: 1.15 },
  // folds, alternating sides
  { d: "M11 7C12.5 9.5 14.5 10.5 16 10", delay: 1.4 },
  { d: "M29 7C27.5 9.5 25.5 10.5 24 10", delay: 1.5 },
  { d: "M5.5 12.5C8 13 9.5 14.5 9.5 16.5", delay: 1.6 },
  { d: "M34.5 12.5C32 13 30.5 14.5 30.5 16.5", delay: 1.7 },
  { d: "M4.5 24C7 23.5 9 22 9.5 20", delay: 1.8 },
  { d: "M35.5 24C33 23.5 31 22 30.5 20", delay: 1.9 },
  { d: "M9 29.5C10 27.5 12 26.5 14 26.5", delay: 2.0 },
  { d: "M31 29.5C30 27.5 28 26.5 26 26.5", delay: 2.1 },
];

export function LandingBrain() {
  return (
    <svg className="landing-brain" viewBox="0 0 40 34" aria-hidden="true">
      {LINES.map((line) => (
        <path
          key={line.d}
          className="landing-brain-line"
          d={line.d}
          pathLength={1}
          style={{ "--delay": `${line.delay}s` } as CSSProperties}
        />
      ))}
    </svg>
  );
}
