import {readFile} from "node:fs/promises";
import {ImageResponse} from "next/og";
import {isAddress} from "viem";
import {formatEth, shortAddress} from "@/lib/format";
import {nodesForOwner, shapeNode} from "@/lib/nodes";
import {nodeInfo} from "@/lib/rpc";
import {SITE} from "@/lib/site";

/**
 * The card a holder link unfurls into.
 *
 * Same reasoning as the node card: a wallet page shared without one said
 * nothing about the wallet. Money comes from the contract, so the preview and
 * the page cannot disagree.
 */

const PAPER = "#fcfaf7";
const INK = "#111210";
const ORANGE = "#ff4f14";
const FAINT = "#90918a";
const LINE = "#e2ded7";

export const alt = "A Sitowise holder";
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

export default async function HolderCard({params}: {params: Promise<{address: string}>}) {
  const fonts = await manrope();
  const {address} = await params;

  const rows = isAddress(address) ? await nodesForOwner(address).catch(() => []) : [];
  const ledger = rows.map(shapeNode);
  const chain = await Promise.all(
    ledger.map((n) => nodeInfo(BigInt(n.chainNodeId)).catch(() => null)),
  );

  const sum = (pick: (i: number) => bigint | undefined) =>
    ledger.reduce((total, _n, i) => total + (pick(i) ?? 0n), 0n);

  const balance = sum((i) => chain[i]?.balanceWei);
  const credited = sum((i) => chain[i]?.totalReceivedWei);
  const withdrawn = sum((i) => chain[i]?.totalWithdrawnWei);

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

        <div style={{display: "flex", flexDirection: "column", gap: 16}}>
          <span style={{fontSize: 72, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1}}>
            {ledger.length} {ledger.length === 1 ? "node" : "nodes"}
          </span>
          <span style={{fontSize: 30, fontWeight: 500, color: FAINT, letterSpacing: "-0.01em"}}>
            held by {isAddress(address) ? shortAddress(address, 10, 8) : "this wallet"}
          </span>
        </div>

        <div style={{display: "flex", flexDirection: "column", gap: 22}}>
          <div style={{width: "100%", height: 1, backgroundColor: LINE}} />
          <div style={{display: "flex", justifyContent: "space-between"}}>
            <Figure label="Holds" value={`${formatEth(balance, 8)} ETH`} />
            <Figure label="Credited" value={`${formatEth(credited, 8)} ETH`} />
            <Figure label="Withdrawn" value={`${formatEth(withdrawn, 8)} ETH`} />
          </div>
        </div>
      </div>
    ),
    {...size, fonts},
  );
}
