/**
 * A photon in flight while a reply is pending: the Photon mark (a rotated
 * square) travels along a light wave, trailing a few fading copies of itself
 * and a soft glow. Pure SVG + CSS (see `.photon-*` in styles.css); the wave
 * path is shared by the mark and its trail through `offset-path`, each copy
 * lagging the one before. Frozen under `prefers-reduced-motion`.
 */
const WAVE = "M 4 20 C 20 0, 36 0, 52 20 S 84 40, 100 20 S 132 0, 148 20";

export function ThinkingPhoton() {
  return (
    <div className="photon-lane" aria-hidden="true">
      <svg viewBox="0 0 152 40" className="photon-svg" xmlns="http://www.w3.org/2000/svg">
        {/* the wave itself: faint, drawn on as the photon passes */}
        <path d={WAVE} className="photon-wave" />
      </svg>
      {/* trail: oldest first so the live mark paints on top */}
      <span className="photon-mark photon-trail photon-trail-3" />
      <span className="photon-mark photon-trail photon-trail-2" />
      <span className="photon-mark photon-trail photon-trail-1" />
      <span className="photon-mark photon-live" />
    </div>
  );
}
