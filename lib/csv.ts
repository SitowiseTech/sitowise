/**
 * CSV for the activity export.
 *
 * Amounts are written twice, as wei and as ETH. Wei is the number the contract
 * actually holds and the only one that survives arithmetic; the ETH column is
 * there because a spreadsheet is where this file is going. The ETH string is
 * built from the integer, never through a float, so a long balance does not
 * quietly lose its last digits on the way to the page.
 */

export function weiToEthString(wei: bigint): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const fraction = (abs % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  const body = fraction === "" ? whole.toString() : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

/**
 * Quote every field rather than only the ones that need it. Wallet software
 * and explorers put commas in nothing, but a node label or a future column is
 * one comma away from shifting every cell to its right, and a spreadsheet
 * opens a fully quoted file identically.
 */
function cell(value: string | number | bigint): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function toCsv(headers: readonly string[], rows: readonly (string | number | bigint)[][]): string {
  const lines = [headers.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))];
  // Trailing newline: without it some tools treat the last row as truncated.
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Hand the file to the browser.
 *
 * Built and revoked around the click because an object URL held open keeps the
 * whole blob alive for the life of the tab.
 */
export function downloadCsv(filename: string, csv: string): void {
  // A BOM, so Excel opens a UTF-8 file as UTF-8 instead of guessing.
  const blob = new Blob([`﻿${csv}`], {type: "text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
