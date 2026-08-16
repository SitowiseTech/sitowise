import type {Metadata} from "next";
import {AnnounceBanner} from "@/components/home/AnnounceBanner";
import {Capabilities} from "@/components/home/Capabilities";
import {Comparison} from "@/components/home/Comparison";
import {FinalCta} from "@/components/home/FinalCta";
import {Hero} from "@/components/home/Hero";
import {HowItWorks} from "@/components/home/HowItWorks";
import {RunsOn} from "@/components/home/RunsOn";
import {SITE} from "@/lib/site";

/**
 * The landing page (spec 4). Every section is static, so the whole route
 * prerenders: nothing here reads a wallet, the database or the chain.
 *
 * The title is set explicitly rather than through the layout template, which
 * would append " · Sitowise" to a string that already starts with it.
 */

export const metadata: Metadata = {
  title: {absolute: `${SITE.name}: deploy a node on Robinhood Chain`},
  alternates: {canonical: "/"},
};

export default function Home() {
  return (
    <>
      <AnnounceBanner />
      <Hero />
      <Capabilities />
      <HowItWorks />
      <Comparison />
      <RunsOn />
      <FinalCta />
    </>
  );
}
