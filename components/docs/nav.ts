/**
 * The documentation tree (spec 6.1).
 *
 * One ordered list drives four things: the sidebar, the previous/next pager,
 * the section index cards on /docs, and the page titles in metadata. Adding a
 * page anywhere means adding one entry here and one route; nothing else has to
 * learn about it.
 */

export type DocLink = {
  href: string;
  label: string;
  /** One line, shown on section index cards and in the pager. */
  blurb: string;
};

export type DocGroup = {
  title: string;
  items: readonly DocLink[];
};

export const DOC_NAV: readonly DocGroup[] = [
  {
    title: "Getting started",
    items: [
      {
        href: "/docs",
        label: "Overview",
        blurb: "What Sitowise is, what a node is, and where the money comes from today.",
      },
      {
        href: "/docs/quick-start",
        label: "Quick start",
        blurb: "Connect a wallet, deploy a node, watch it accrue, withdraw.",
      },
      {
        href: "/docs/requirements",
        label: "Requirements",
        blurb: "Wallet, network, and how much ETH you need before you start.",
      },
    ],
  },
  {
    title: "Protocol",
    items: [
      {
        href: "/docs/accrual",
        label: "How accrual works",
        blurb: "What the hook measures inside a swap, and what funds rewards right now.",
      },
      {
        href: "/docs/hook-lifecycle",
        label: "The hook lifecycle",
        blurb: "Deploy, mine the address, initialise a pool, accrue, sweep.",
      },
      {
        href: "/docs/node-model",
        label: "Node model",
        blurb: "What a node is on chain, and the things it deliberately is not.",
      },
      {
        href: "/docs/distribution",
        label: "Distribution",
        blurb: "How value reaches nodes: what funds a round, and how it is credited on chain.",
      },
      {
        href: "/docs/fee-flow",
        label: "Fee flow",
        blurb: "The full path a unit of value takes from a swap to a withdrawal.",
      },
    ],
  },
  {
    title: "Nodes",
    items: [
      {
        href: "/docs/deploying",
        label: "Deploying a node",
        blurb: "Step by step, with the on-chain effect of each step.",
      },
      {
        href: "/docs/node-states",
        label: "Node states",
        blurb: "Active and retired, and every transition between them.",
      },
      {
        href: "/docs/limits",
        label: "Limits",
        blurb: "Twenty-five nodes per wallet, and the reasoning behind the cap.",
      },
      {
        href: "/docs/node-numbering",
        label: "Node numbering",
        blurb: "How to read #0001 and how ids map onto the chain.",
      },
    ],
  },
  {
    title: "Payouts",
    items: [
      {
        href: "/docs/balances",
        label: "Balances",
        blurb: "Where a balance lives, who can move it, and what the numbers mean.",
      },
      {
        href: "/docs/withdrawing",
        label: "Withdrawing",
        blurb: "One call from your own wallet, what it costs, and how each failure behaves.",
      },
      {
        href: "/docs/destination-addresses",
        label: "Destination addresses",
        blurb: "Sending a withdrawal somewhere other than the wallet that signed in.",
      },
      {
        href: "/docs/troubleshooting",
        label: "Troubleshooting",
        blurb: "Stuck transactions, wrong network, missing gas, mints that never appeared.",
      },
    ],
  },
  {
    title: "Contracts",
    items: [
      {
        href: "/docs/addresses",
        label: "Addresses",
        blurb: "Deployed addresses, the chain they live on, and explorer links.",
      },
      {
        href: "/docs/factory-interface",
        label: "Factory interface",
        blurb: "Every function, argument, return value and custom error.",
      },
      {
        href: "/docs/events",
        label: "Events",
        blurb: "What the contracts emit and how to index it yourself.",
      },
      {
        href: "/docs/settlement",
        label: "Settlement",
        blurb: "How a payment becomes a node, and how a balance becomes ETH in your wallet.",
      },
      {
        href: "/docs/security-model",
        label: "Security model",
        blurb: "Exactly what the owner can do, and what the code prevents.",
      },
      {
        href: "/docs/audits",
        label: "Audits",
        blurb: "There is no third-party audit. Here is how to review it yourself.",
      },
    ],
  },
  {
    title: "API",
    items: [
      {
        href: "/docs/api",
        label: "Overview",
        blurb: "Base URL, response shape, rate limits, and caching.",
      },
      {
        href: "/docs/api/authentication",
        label: "Authentication",
        blurb: "What is public, and what needs a wallet session cookie.",
      },
      {
        href: "/docs/api/stats",
        label: "GET /api/stats",
        blurb: "Protocol totals: nodes, operators, distributed value.",
      },
      {
        href: "/docs/api/nodes",
        label: "GET /api/nodes/:address",
        blurb: "Every node held by one wallet, with balances.",
      },
      {
        href: "/docs/api/node",
        label: "GET /api/node/:id",
        blurb: "One node in full, with its credits and withdrawals.",
      },
      {
        href: "/docs/api/distributions",
        label: "GET /api/distributions",
        blurb: "Recent distribution rounds, newest first.",
      },
      {
        href: "/docs/api/cover",
        label: "GET /api/cover",
        blurb: "Whether node balances are backed, read from the chain.",
      },
      {
        href: "/docs/api/errors",
        label: "Errors",
        blurb: "Status codes, the error envelope, and how to retry.",
      },
    ],
  },
  {
    title: "Resources",
    items: [
      {
        href: "/docs/faq",
        label: "FAQ",
        blurb: "The questions that come up most, answered plainly.",
      },
      {
        href: "/docs/glossary",
        label: "Glossary",
        blurb: "Hook, pool, node, credit, payment reference, outstanding, and the rest.",
      },
      {
        href: "/docs/risks",
        label: "Risks",
        blurb: "Everything that can go wrong, stated without softening.",
      },
      {
        href: "/docs/changelog",
        label: "Changelog",
        blurb: "What shipped, when, and what changed for holders.",
      },
    ],
  },
] as const;

/** Every page in reading order, which is exactly the pager order. */
export const DOC_PAGES: readonly DocLink[] = DOC_NAV.flatMap((group) => group.items);

export function docByHref(href: string): DocLink | undefined {
  return DOC_PAGES.find((page) => page.href === href);
}

export function groupOf(href: string): DocGroup | undefined {
  return DOC_NAV.find((group) => group.items.some((item) => item.href === href));
}

/**
 * Neighbours in reading order. Returns undefined at either end rather than
 * wrapping, because a pager that loops from the last page back to the first
 * reads as a broken link.
 */
export function adjacentDocs(href: string): {prev?: DocLink; next?: DocLink} {
  const index = DOC_PAGES.findIndex((page) => page.href === href);
  if (index < 0) return {};
  return {
    prev: index > 0 ? DOC_PAGES[index - 1] : undefined,
    next: index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : undefined,
  };
}
