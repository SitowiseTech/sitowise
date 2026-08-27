/**
 * Node states and every transition between them.
 *
 * Deliberately drawn with a self-loop on both live states: withdrawing does not
 * change a node's state, and neither does being credited. The only one-way door
 * is retirement, which stops new credits without touching value already
 * credited, and the diagram has to show that or readers assume retirement takes
 * their balance with it.
 */

const VIEW = {w: 720, h: 236};
const BOX = {w: 148, h: 54, y: 96};
const MID_Y = BOX.y + BOX.h / 2;

type State = {
  label: string;
  x: number;
  sub: string;
};

const STATES: readonly State[] = [
  {label: "Not deployed", x: 16, sub: "No node exists"},
  {label: "Active", x: 286, sub: "Receives credits"},
  {label: "Retired", x: 556, sub: "No new credits"},
];

/** Rounded self-loop leaving and re-entering the top or bottom of a box. */
function loopPath(cx: number, above: boolean): string {
  const y = above ? BOX.y : BOX.y + BOX.h;
  const reach = above ? y - 46 : y + 46;
  return `M${cx - 34} ${y} C${cx - 34} ${reach}, ${cx + 34} ${reach}, ${cx + 34} ${y}`;
}

export function LifecycleDiagram() {
  const active = STATES[1];
  const retired = STATES[2];
  const activeCx = active.x + BOX.w / 2;
  const retiredCx = retired.x + BOX.w / 2;

  return (
    <svg
      className="doc-chart"
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      role="img"
      aria-label="Node lifecycle: a payment is relayed into a mint, after which the node is active, is credited each round and can be withdrawn from at any time. The operator can retire a node, which stops new credits; a retired node can still be withdrawn from. Nothing returns a node to the not deployed state."
    >
      {[0, 1].map((i) => {
        const from = STATES[i].x + BOX.w;
        const to = STATES[i + 1].x;
        // Not "mint, 0.02 ETH": the buyer pays a wallet and the relayer mints,
        // so labelling the edge with a price would put the money in the wrong
        // place on the one diagram that is meant to show where a node comes from.
        const label = i === 0 ? "payment, then mintFor" : "retire";
        return (
          <g key={label}>
            <path
              className="doc-edge"
              d={`M${from} ${MID_Y} H${to - 8}`}
              data-reveal="stroke"
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="doc-edge"
              d={`M${to - 14} ${MID_Y - 4} L${to - 6} ${MID_Y} L${to - 14} ${MID_Y + 4}`}
              vectorEffect="non-scaling-stroke"
            />
            <text
              className="doc-edge-label"
              x={(from + to) / 2}
              y={MID_Y - 10}
              textAnchor="middle"
            >
              {label}
            </text>
          </g>
        );
      })}

      <g>
        <path
          className="doc-edge"
          d={loopPath(activeCx, true)}
          vectorEffect="non-scaling-stroke"
        />
        <text className="doc-edge-label" x={activeCx} y={BOX.y - 54} textAnchor="middle">
          credited each round
        </text>
      </g>

      {[activeCx, retiredCx].map((cx) => (
        <g key={`withdraw-${cx}`}>
          <path className="doc-edge" d={loopPath(cx, false)} vectorEffect="non-scaling-stroke" />
          <text
            className="doc-edge-label"
            x={cx}
            y={BOX.y + BOX.h + 62}
            textAnchor="middle"
          >
            withdraw
          </text>
        </g>
      ))}

      {STATES.map((state, i) => (
        <g key={state.label}>
          <rect
            className={`doc-node-box${i === 1 ? " is-focus" : ""}`}
            x={state.x}
            y={BOX.y}
            width={BOX.w}
            height={BOX.h}
            rx={2}
            vectorEffect="non-scaling-stroke"
          />
          <text
            className={`doc-node-label${i === 1 ? " on-dark" : ""}`}
            x={state.x + BOX.w / 2}
            y={BOX.y + 24}
            textAnchor="middle"
          >
            {state.label}
          </text>
          <text
            className={`doc-node-sub${i === 1 ? " on-dark" : ""}`}
            x={state.x + BOX.w / 2}
            y={BOX.y + 40}
            textAnchor="middle"
          >
            {state.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}
