/**
 * A small robot that paces back and forth while a reply is pending, looking
 * worried: brows knitted, head tilting, a sweat drop, arms wringing. Pure SVG + CSS keyframes (see `.robot-*` in
 * styles.css); it goes still under `prefers-reduced-motion`.
 *
 * Structure (each group has its own animation so they can run out of phase):
 *
 *   .robot-walk   the whole robot, translated left and right across the lane,
 *                 flipped when it turns around
 *     .robot-body  bobs up and down with each step
 *       .robot-head   tilts side to side (worry)
 *       .robot-arm-*  wring in front of the chest
 *       .robot-leg-*  swing in opposite phase
 *     .robot-sweat  a drop that forms and falls from the temple
 */
export function ThinkingRobot() {
  return (
    <div className="robot-lane" aria-hidden="true">
      <div className="robot-walk">
        <svg viewBox="0 0 64 64" className="robot-svg" xmlns="http://www.w3.org/2000/svg">
          <g className="robot-body">
            {/* antenna */}
            <line x1="32" y1="6" x2="32" y2="12" className="robot-stroke" />
            <circle cx="32" cy="5" r="2" className="robot-fill robot-antenna" />

            {/* head */}
            <g className="robot-head">
              <rect x="20" y="12" width="24" height="18" rx="4" className="robot-fill" />
              {/* eyes: small, looking down-left, with worried brows */}
              <circle cx="27" cy="22" r="2" className="robot-eye" />
              <circle cx="37" cy="22" r="2" className="robot-eye" />
              <path d="M23 17 L30 19" className="robot-brow" />
              <path d="M41 17 L34 19" className="robot-brow" />
              {/* wavy mouth */}
              <path d="M27 26 q2.5 -2 5 0 t5 0" className="robot-mouth" />
            </g>

            {/* torso */}
            <rect x="22" y="32" width="20" height="16" rx="3" className="robot-fill" />
            <rect x="27" y="36" width="10" height="4" rx="1" className="robot-panel" />

            {/* arms, wringing in front */}
            <g className="robot-arm-left">
              <rect x="16" y="33" width="6" height="12" rx="3" className="robot-fill" />
            </g>
            <g className="robot-arm-right">
              <rect x="42" y="33" width="6" height="12" rx="3" className="robot-fill" />
            </g>

            {/* legs */}
            <g className="robot-leg-left">
              <rect x="24" y="48" width="6" height="11" rx="2" className="robot-fill" />
            </g>
            <g className="robot-leg-right">
              <rect x="34" y="48" width="6" height="11" rx="2" className="robot-fill" />
            </g>
          </g>

          {/* sweat drop from the temple */}
          <path d="M47 14 q3 4 0 6 q-3 -2 0 -6 z" className="robot-sweat" />
        </svg>
      </div>
    </div>
  );
}
