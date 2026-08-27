/**
 * The path a unit of value takes, from the transfer that buys a node to the ETH
 * landing back in a wallet.
 *
 * Two strokes make the spine. The hairline underneath draws itself in on scroll
 * with data-reveal="stroke"; the dashed stroke on top marches along it. Boxes
 * are painted after both, so the spine reads as continuous while every segment
 * that would cross a box stays hidden behind it.
 *
 * The branch dropping into `creditBatch` is not decoration: during the launch
 * period that is where the credited value actually comes from, and a schematic
 * that drew only a swap path would be describing something that is not
 * happening yet. The Uniswap hook is deliberately absent for the same reason.
 */

const VIEW = {w: 940, h: 232};
const BOX = {w: 130, h: 48, y: 84, step: 162, x0: 8};
const SPINE_Y = BOX.y + BOX.h / 2;

type Stage = {
  label: string;
  sub: readonly string[];
  focus?: boolean;
};

const STAGES: readonly Stage[] = [
  {label: "Payment", sub: ["A plain transfer to", "the payments wallet"]},
  {label: "Watcher", sub: ["Sees the transfer and", "records the tx hash"]},
  {label: "mintFor", sub: ["The relayer creates", "the node, pays the gas"]},
  {label: "creditBatch", sub: ["The distributor sends", "ETH onto balances"], focus: true},
  {label: "Node balance", sub: ["Held on chain,", "counted in outstanding"]},
  {label: "withdraw", sub: ["You call it yourself,", "the whole balance moves"]},
];

const boxX = (index: number) => BOX.x0 + index * BOX.step;
const centreX = (index: number) => boxX(index) + BOX.w / 2;

export type FlowSchematicProps = {
  /**
   * Draw the launch-period funding branch. Turn it off only on a page that has
   * already made the funding source explicit in the surrounding text.
   */
  showFunding?: boolean;
};

export function FlowSchematic({showFunding = true}: FlowSchematicProps) {
  const spine = `M${boxX(0) + BOX.w} ${SPINE_Y} H${boxX(STAGES.length - 1)}`;
  const fundingX = centreX(3);

  return (
    <svg
      className="doc-chart"
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      role="img"
      aria-label="Flow schematic: a buyer sends a plain transfer to the payments wallet, a watcher records that transaction hash, the relayer calls mintFor to create the node, the distributor calls creditBatch to put ETH on node balances, the balance is held on chain inside outstanding, and the node owner calls withdraw themselves to move the whole balance out. During the launch period the credited value is funded by Sitowise."
    >
      <path
        className="doc-edge"
        d={spine}
        data-reveal="stroke"
        vectorEffect="non-scaling-stroke"
      />
      <path className="doc-flow-dash" d={spine} vectorEffect="non-scaling-stroke" />

      {STAGES.slice(1).map((stage, i) => {
        const tip = boxX(i + 1);
        return (
          <path
            key={`arrow-${stage.label}`}
            className="doc-edge"
            d={`M${tip - 7} ${SPINE_Y - 4} L${tip - 1} ${SPINE_Y} L${tip - 7} ${SPINE_Y + 4}`}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {showFunding ? (
        <g>
          <rect
            className="doc-node-box"
            x={fundingX - 76}
            y={16}
            width={152}
            height={30}
            rx={2}
            vectorEffect="non-scaling-stroke"
          />
          <text className="doc-node-label" x={fundingX} y={35} textAnchor="middle">
            Sitowise, launch period
          </text>
          <path
            className="doc-flow-dash"
            d={`M${fundingX} 46 V${BOX.y}`}
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="doc-edge"
            d={`M${fundingX - 4} ${BOX.y - 7} L${fundingX} ${BOX.y - 1} L${fundingX + 4} ${BOX.y - 7}`}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}

      {STAGES.map((stage, i) => (
        <g key={stage.label}>
          <rect
            className={`doc-node-box${stage.focus ? " is-focus" : ""}`}
            x={boxX(i)}
            y={BOX.y}
            width={BOX.w}
            height={BOX.h}
            rx={2}
            vectorEffect="non-scaling-stroke"
          />
          <text
            className={`doc-node-label${stage.focus ? " on-dark" : ""}`}
            x={centreX(i)}
            y={BOX.y + BOX.h / 2 + 4}
            textAnchor="middle"
          >
            {stage.label}
          </text>
          {stage.sub.map((line, lineIndex) => (
            <text
              key={line}
              className="doc-node-sub"
              x={centreX(i)}
              y={BOX.y + BOX.h + 20 + lineIndex * 14}
              textAnchor="middle"
            >
              {line}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}
