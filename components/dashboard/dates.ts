"use client";

import {formatDate, timeAgo} from "@/lib/format";

/**
 * The ledger returns `created_at` as `string | null`. A missing timestamp is
 * rendered as missing rather than replaced with "now", which is the difference
 * between an empty field and a wrong one.
 */

export function dateOrNothing(iso: string | null): string {
  return iso ? formatDate(iso) : "No data yet";
}

export function agoOrNothing(iso: string | null): string {
  return iso ? timeAgo(iso) : "unknown";
}
