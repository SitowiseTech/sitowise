"use client";

import {useEffect, useRef, useState} from "react";
import {DPR_CAP, LANES} from "@/components/home/hero-diagram/constants";
import {createField, stepField, type Field} from "@/components/home/hero-diagram/field";
import {buildLayout, type Layout} from "@/components/home/hero-diagram/geometry";
import {readPalette} from "@/components/home/hero-diagram/palette";
import {paintFrame, paintStatic} from "@/components/home/hero-diagram/render";
import {StaticDiagram} from "@/components/home/hero-diagram/StaticDiagram";

/**
 * The hero diagram (spec 4.2): ETH entering the Sitowise contract on the left,
 * balances leaving it for the nodes and the wallet total on the right.
 *
 * Canvas rather than SVG because the field is several thousand stipple dots. As
 * DOM nodes that is a layout and paint cost the hero cannot afford; as canvas it
 * is a single blit.
 *
 * The split that keeps it cheap: everything static (colour wash, stipple,
 * brackets, connector paths, markers, the centre lattice, labels) is painted
 * once into an offscreen layer and repainted only when the box or the device
 * pixel ratio changes. Each animation frame copies that layer and draws ~30
 * particles over it, so the hot loop allocates nothing, measures no text and
 * builds no strings.
 *
 * Nothing rotates and nothing counts down, per spec.
 */

export type HeroDiagramProps = {
  className?: string;
};

export function HeroDiagram({className}: HeroDiagramProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const probe = probeRef.current;
    if (!host || !canvas || !probe) return;

    const context = canvas.getContext("2d");
    const layer = document.createElement("canvas");
    const layerContext = layer.getContext("2d");
    if (!context || !layerContext) {
      setUnsupported(true);
      return;
    }

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const palette = readPalette(document.documentElement);
    // The mono family is hashed by next/font, so it can only be read back off a
    // real element that already uses it.
    const family = getComputedStyle(probe).fontFamily;

    let layout: Layout | null = null;
    let field: Field | null = null;
    let width = 0;
    let height = 0;
    let dpr = 0;
    let frame = 0;
    let pendingResize = 0;
    let last = 0;
    let running = false;
    let onScreen = false;
    let disposed = false;

    function render(): void {
      if (!layout || !field) return;
      paintFrame(context!, layer, palette, layout, field);
    }

    function rebuild(): void {
      const rect = host!.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      const nextDpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;

      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;

      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      canvas!.width = pixelWidth;
      canvas!.height = pixelHeight;
      layer.width = pixelWidth;
      layer.height = pixelHeight;
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);
      layerContext!.setTransform(dpr, 0, 0, dpr, 0, 0);

      layout = buildLayout(context!, width, height, family);
      paintStatic(layerContext!, palette, layout);

      // Roughly one particle per 18px of width: enough to read as flow, few
      // enough that arrivals stay individually visible.
      const count = Math.max(14, Math.min(36, Math.round(width / 18)));
      if (!field || field.count !== count) field = createField(count);
      render();
    }

    function loop(now: number): void {
      frame = requestAnimationFrame(loop);
      // A long pause (tab switch, main-thread jank) must not teleport the field.
      const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      last = now;
      if (field) stepField(field, dt);
      render();
    }

    function start(): void {
      if (running || disposed || motionQuery.matches) return;
      running = true;
      last = 0;
      frame = requestAnimationFrame(loop);
    }

    function stop(): void {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
    }

    function sync(): void {
      if (onScreen && !document.hidden) start();
      else stop();
    }

    function freeze(): void {
      if (!field) return;
      // Reduced motion gets one frame with the field caught mid flight and the
      // outputs lit, so the diagram still reads without a single tick.
      for (let lane = 0; lane < LANES; lane += 1) field.outGlow[lane] = 0.32;
      field.hookGlow[0] = 0.45;
      render();
    }

    rebuild();
    if (motionQuery.matches) freeze();

    const resizeObserver = new ResizeObserver(() => {
      if (pendingResize) return;
      pendingResize = requestAnimationFrame(() => {
        pendingResize = 0;
        rebuild();
        if (motionQuery.matches) freeze();
        else if (!running) render();
      });
    });
    resizeObserver.observe(host);

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        sync();
      },
      {threshold: 0},
    );
    intersectionObserver.observe(host);

    document.addEventListener("visibilitychange", sync);
    const onMotionChange = () => {
      if (motionQuery.matches) {
        stop();
        freeze();
      } else {
        sync();
      }
    };
    motionQuery.addEventListener("change", onMotionChange);

    // Web font metrics arrive after first paint and the measured gutters depend
    // on them, so the static layer is worth building twice.
    if (document.fonts) {
      document.fonts.ready.then(() => {
        if (disposed) return;
        width = 0;
        rebuild();
        if (motionQuery.matches) freeze();
        else if (!running) render();
      });
    }

    return () => {
      disposed = true;
      stop();
      if (pendingResize) cancelAnimationFrame(pendingResize);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`relative aspect-[6/5] w-full min-h-[300px] ${className ?? ""}`}
    >
      {unsupported ? (
        <StaticDiagram />
      ) : (
        <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />
      )}
      {/* Font probe: canvas cannot resolve a CSS variable, only a computed family. */}
      <span
        ref={probeRef}
        aria-hidden="true"
        className="mono-label pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-hidden"
      >
        M
      </span>
      <p className="sr-only">
        Flow diagram. Credits, batches, funding and incoming ETH enter the Sitowise contract in
        the centre. From the contract, balances are written out to Node 01, Node 02, Node 03 and
        your balance.
      </p>
    </div>
  );
}

export default HeroDiagram;
