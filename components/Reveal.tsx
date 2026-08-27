"use client";

import {
  createElement,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

/**
 * The single scroll-animation mechanism for the site (spec 16).
 *
 * All motion lives in `[data-reveal]` rules in globals.css. This module only
 * decides *when* the `.in` class lands, and it does so through one shared
 * IntersectionObserver for the whole document: one observer costs the browser
 * far less than one per section, and the WeakMap of handlers lets unrelated
 * consumers (CountUp) share it without knowing about each other.
 *
 * Every target is unobserved the moment it fires, so a reveal plays once and
 * never replays on scroll-back.
 */

const REVEAL_SELECTOR = "[data-reveal]";

/** Stagger step inside a section: 80ms per index, per spec 16. */
export const STAGGER_MS = 80;

type EnterHandler = () => void;

const handlers = new WeakMap<Element, EnterHandler>();
const registered = new WeakSet<Element>();

let observer: IntersectionObserver | null = null;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const handler = handlers.get(entry.target);
        handlers.delete(entry.target);
        self.unobserve(entry.target);
        handler?.();
      }
    },
    // threshold 0 plus a negative bottom margin fires as the element's top
    // crosses ~88% of the viewport. A ratio threshold would strand any element
    // taller than the viewport, which sections routinely are.
    {rootMargin: "0px 0px -12% 0px", threshold: 0},
  );
  return observer;
}

/**
 * Run `onEnter` the first time `el` scrolls into view, then forget it.
 * Under reduced motion the callback runs immediately and nothing is observed.
 * Returns a cleanup that cancels a pending observation.
 */
export function observeOnce(el: Element, onEnter: EnterHandler): () => void {
  if (prefersReducedMotion()) {
    onEnter();
    return () => {};
  }
  handlers.set(el, onEnter);
  getObserver().observe(el);
  return () => {
    handlers.delete(el);
    observer?.unobserve(el);
  };
}

function reveal(el: Element): void {
  el.classList.add("in");
}

/** Register `el` and every `[data-reveal]` inside it. Idempotent. */
function scanTree(root: Element): void {
  if (root.matches(REVEAL_SELECTOR)) track(root);
  const nested = root.querySelectorAll(REVEAL_SELECTOR);
  for (const el of nested) track(el);
}

function track(el: Element): void {
  if (registered.has(el) || el.classList.contains("in")) return;
  registered.add(el);
  observeOnce(el, () => reveal(el));
}

/**
 * Mounted once in the root layout. Server-rendered markup can then use plain
 * `data-reveal` attributes with no client component of its own, which keeps
 * pages as server components.
 */
export function RevealRoot() {
  useEffect(() => {
    scanTree(document.body);

    // Client navigation and late-mounting widgets add new nodes. Reacting to
    // added element nodes only (never text) keeps this off the hot path of
    // things like CountUp rewriting its own text 60 times a second.
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scanTree(node as Element);
        }
      }
    });
    mutations.observe(document.body, {childList: true, subtree: true});
    return () => mutations.disconnect();
  }, []);

  return null;
}

/**
 * Escape hatch for markup that is built imperatively. Attach the ref to any
 * container and its `[data-reveal]` descendants are registered on mount.
 */
export function useReveal<T extends Element = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) scanTree(el);
  }, []);
  return ref;
}

export type RevealVariant = "default" | "panel" | "bar" | "stroke";

type RevealTag =
  | "div"
  | "section"
  | "article"
  | "aside"
  | "header"
  | "footer"
  | "li"
  | "p"
  | "span"
  | "figure";

/** `style` carrying the custom property the CSS reads for stagger. */
type RevealStyle = CSSProperties & {"--reveal-delay"?: string};

export type RevealProps = Omit<HTMLAttributes<HTMLElement>, "style"> & {
  as?: RevealTag;
  variant?: RevealVariant;
  /** Explicit delay in ms. Wins over `index`. */
  delay?: number;
  /** Position inside a staggered group: delay becomes 80ms * index. */
  index?: number;
  style?: RevealStyle;
  children?: ReactNode;
};

export function Reveal({
  as = "div",
  variant = "default",
  delay,
  index,
  style,
  children,
  ...rest
}: RevealProps) {
  const ms = delay ?? (index ? index * STAGGER_MS : 0);
  const merged: RevealStyle | undefined =
    ms > 0 ? {...style, "--reveal-delay": `${ms}ms`} : style;

  return createElement(
    as,
    {
      ...rest,
      style: merged,
      "data-reveal": variant === "default" ? "" : variant,
    },
    children,
  );
}
