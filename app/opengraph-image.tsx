import {readFile} from "node:fs/promises";
import {ImageResponse} from "next/og";
import {SITE} from "@/lib/site";

/**
 * Social card, generated at build time from the same brand values as the site.
 *
 * ImageResponse renders outside the DOM, so the CSS variables in globals.css
 * are not reachable here. These four constants mirror them and are the only
 * place in the app where the palette is repeated.
 */

const PAPER = "#fcfaf7";
const INK = "#111210";
const ORANGE = "#ff4f14";
const FAINT = "#90918a";

export const alt = `${SITE.name}: ${SITE.tagline}`;
export const size = {width: 1200, height: 630};
export const contentType = "image/png";

/**
 * Manrope ships in the repo rather than being fetched, so a build without
 * network access still produces a card. If reading fails the card falls back
 * to the renderer's built-in face instead of failing the build.
 */
async function manrope(): Promise<
  {name: string; data: ArrayBuffer; weight: 500 | 600; style: "normal"}[]
> {
  try {
    const [medium, semibold] = await Promise.all([
      readFile(new URL("./_og/manrope-500.ttf", import.meta.url)),
      readFile(new URL("./_og/manrope-600.ttf", import.meta.url)),
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

export default async function OpenGraphImage() {
  const fonts = await manrope();

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
          padding: "68px 76px",
          fontFamily: fonts.length > 0 ? "Manrope" : "sans-serif",
          color: INK,
        }}
      >
        <div style={{display: "flex", alignItems: "center", gap: 12}}>
          <span style={{fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em"}}>
            {SITE.name}
          </span>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 12,
              backgroundColor: ORANGE,
              marginTop: 6,
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 74,
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.024em",
          }}
        >
          <span>Deploy a node.</span>
          <span>A Uniswap v4 hook</span>
          <span style={{color: ORANGE}}>on Robinhood Chain.</span>
        </div>

        <div style={{display: "flex", flexDirection: "column", gap: 22}}>
          <div style={{width: "100%", height: 1, backgroundColor: "#e2ded7"}} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 19,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: FAINT,
            }}
          >
            <span>Robinhood Chain · 4663</span>
            <span>{SITE.domain}</span>
          </div>
        </div>
      </div>
    ),
    {...size, fonts},
  );
}
