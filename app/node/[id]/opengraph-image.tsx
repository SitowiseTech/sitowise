import {readFile} from "node:fs/promises";
import {ImageResponse} from "next/og";
import {formatEth, nodeLabel} from "@/lib/format";
import {nodeByChainId, shapeNodeDetail} from "@/lib/nodes";
import {nodeInfo} from "@/lib/rpc";
import {TIER_LABEL} from "@/lib/tierLabels";
import {SITE} from "@/lib/site";

/**
 * The card a node's link unfurls into.
 *
 * Every node has had its own page for a while, and sharing one produced the
 * same generic site card as sharing the front page: the one thing a reader
 * wanted to know, which node and what it holds, was the one thing the preview
 * did not say. This draws it from the same figures the page shows, which means
 * from the contract.
 *
 * Rendered outside the DOM, so the CSS variables in globals.css are not
 * reachable and the palette is repeated here, as it is in the site-wide card.
 */

const PAPER = "#fcfaf7";
const INK = "#111210";
const ORANGE = "#ff4f14";
const FAINT = "#90918a";
const LINE = "#e2ded7";

export const alt = "A Sitowise node";
export const size = {width: 1200, height: 630};
export const contentType = "image/png";

async function manrope(): Promise<
  {name: string; data: ArrayBuffer; weight: 500 | 600; style: "normal"}[]
> {
  try {
    const [medium, semibold] = await Promise.all([
      readFile(new URL("../../_og/manrope-500.ttf", import.meta.url)),
      readFile(new URL("../../_og/manrope-600.ttf", import.meta.url)),
    ]);
    const toBuffer = (view: Uint8Array): ArrayBuffer =>
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
    return [
      {name: "Manrope", data: toBuffer(medium), weight: 500, style: "normal"},
      {name: "Manrope", data: toBuffer(semibold), weight: 600, style: "normal"},
    ];
  } catch {
    return [];
  }
}

function Figure({label, value}: {label: string; value: string}) {
  return (
    <div style={{display: "flex", flexDirection: "column", gap: 8}}>
      <span
        style={{
          fontSize: 17,
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: FAINT,
        }}
      >
        {label}
      </span>
      <span style={{fontSize: 34, fontWeight: 500, letterSpacing: "-0.02em", color: INK}}>
        {value}
      </span>
    </div>
  );
}

export default async function NodeCard({params}: {params: Promise<{id: string}>}) {
  const fonts = await manrope();
  const {id} = await params;

  // A card must never fail the page it belongs to, so every read here falls
  // back rather than throwing: a card with dashes on it is worse than nothing
  // only if nothing is what a broken card produces, which it is not.
  const wanted = /^\d+$/.test(id) ? BigInt(id) : null;
  const row = wanted === null ? null : await nodeByChainId(wanted).catch(() => null);
  const node = row ? shapeNodeDetail(row) : null;
  const chain = wanted === null ? null : await nodeInfo(wanted).catch(() => null);

  const label = node ? `Node ${nodeLabel(node.chainNodeId)}` : "Node";
  const tier = node?.tier && node.tier !== "base" ? (TIER_LABEL[node.tier] ?? null) : null;
  const balance = chain?.balanceWei ?? (node ? BigInt(node.balanceWei) : null);
  const credited = chain?.totalReceivedWei ?? (node ? BigInt(node.cumulativeWei) : null);
  const withdrawn = chain?.totalWithdrawnWei ?? (node ? BigInt(node.withdrawnWei) : null);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: PAPER,
          padding: "62px 76px",
          fontFamily: fonts.length > 0 ? "Manrope" : "sans-serif",
          color: INK,
        }}
      >
        <div style={{display: "flex", alignItems: "center", gap: 12}}>
          <span style={{fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em"}}>
            {SITE.name}
          </span>
          <span
            style={{width: 11, height: 11, borderRadius: 11, backgroundColor: ORANGE, marginTop: 5}}
          />
        </div>

        <div style={{display: "flex", flexDirection: "column", gap: 18}}>
          <div style={{display: "flex", alignItems: "center", gap: 20}}>
            <span style={{fontSize: 96, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1}}>
              {label}
            </span>
            {tier ? (
              <span
                style={{
                  display: "flex",
                  fontSize: 19,
                  fontWeight: 500,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: INK,
                  border: `1px solid ${LINE}`,
                  borderRadius: 4,
                  padding: "8px 14px",
                  marginTop: 14,
                }}
              >
                {tier}
              </span>
            ) : null}
          </div>
          <span style={{fontSize: 25, fontWeight: 500, color: FAINT, letterSpacing: "-0.01em"}}>
            A position in a contract on Robinhood Chain, readable by anyone.
          </span>
        </div>

        <div style={{display: "flex", flexDirection: "column", gap: 22}}>
          <div style={{width: "100%", height: 1, backgroundColor: LINE}} />
          <div style={{display: "flex", justifyContent: "space-between"}}>
            <Figure
              label="Holds"
              value={balance === null ? "—" : `${formatEth(balance, 8)} ETH`}
            />
            <Figure
              label="Credited"
              value={credited === null ? "—" : `${formatEth(credited, 8)} ETH`}
            />
            <Figure
              label="Withdrawn"
              value={withdrawn === null ? "—" : `${formatEth(withdrawn, 8)} ETH`}
            />
          </div>
        </div>
      </div>
    ),
    {...size, fonts},
  );
}
