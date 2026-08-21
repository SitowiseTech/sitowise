import type {Metadata} from "next";
import type {ReactNode} from "react";
import {DocsSidebar} from "@/components/docs/DocsSidebar";
import {DocsToc} from "@/components/docs/DocsToc";
import {SITE} from "@/lib/site";
import "./docs.css";

/**
 * Three columns: index, content, on this page. The stylesheet is imported here
 * rather than in globals.css so the prose rules never leak onto the landing
 * page or the dashboard, which use the same tokens but a different rhythm.
 */

export const metadata: Metadata = {
  title: {
    default: `Documentation · ${SITE.name}`,
    template: `%s · ${SITE.name} docs`,
  },
  description: `How ${SITE.name} works: the Uniswap v4 hook, the node model, payouts, the contract interface and the public API.`,
};

export default function DocsLayout({children}: {children: ReactNode}) {
  return (
    <div className="docs-shell">
      <DocsSidebar />
      <div className="docs-main">
        <div className="min-w-0">{children}</div>
        <DocsToc />
      </div>
    </div>
  );
}
