"use client";

import {useRouter} from "next/navigation";
import {useState} from "react";
import {encodeFunctionData, numberToHex} from "viem";
import {Button} from "@/components/ui/Button";
import {useToast} from "@/components/ui/Toast";
import {FACTORY_ABI} from "@/lib/abi";
import {ADD_CHAIN_PARAMS, CHAIN_ID_HEX, txUrl} from "@/lib/chain";
import {formatEth, parseEth} from "@/lib/format";

/**
 * Sends ETH to SitowiseFactory.fund() from the operator's own wallet.
 *
 * Talks to the injected provider directly rather than through a connector: this
 * is the internal console, used by one person on one machine, and the payment
 * has to come from a wallet the server must never hold a key for.
 */

type Eip1193 = {
  request(args: {method: string; params?: unknown[]}): Promise<unknown>;
};

function injected(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as {ethereum?: Eip1193}).ethereum ?? null;
}

/** Trim the trailing zeros off a fixed-decimal amount for an input field. */
function ethInput(wei: bigint): string {
  const text = formatEth(wei, 18).replace(/0+$/, "").replace(/\.$/, "");
  return text === "" ? "0" : text;
}

export function FundButton({factory, suggestedWei}: {factory: string; suggestedWei: string | null}) {
  const router = useRouter();
  const toast = useToast();
  const [amount, setAmount] = useState(suggestedWei ? ethInput(BigInt(suggestedWei)) : "");
  const [busy, setBusy] = useState(false);

  async function fund() {
    const provider = injected();
    if (!provider) {
      toast.push({title: "No wallet", body: "This browser has no injected wallet.", tone: "error"});
      return;
    }

    let value: bigint;
    try {
      value = parseEth(amount);
    } catch {
      toast.push({title: "Check the amount", body: "Enter a decimal ETH amount.", tone: "error"});
      return;
    }
    if (value <= 0n) {
      toast.push({title: "Check the amount", body: "Enter more than zero.", tone: "error"});
      return;
    }

    setBusy(true);
    try {
      const accounts = (await provider.request({method: "eth_requestAccounts"})) as string[];
      const from = accounts[0];
      if (!from) throw new Error("The wallet returned no account.");

      const chainId = (await provider.request({method: "eth_chainId"})) as string;
      if (chainId.toLowerCase() !== CHAIN_ID_HEX) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{chainId: CHAIN_ID_HEX}],
          });
        } catch (err) {
          // 4902: the wallet has never seen this chain, so offer to add it.
          if ((err as {code?: number}).code === 4902) {
            await provider.request({method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS]});
          } else {
            throw err;
          }
        }
      }

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from,
            to: factory,
            value: numberToHex(value),
            data: encodeFunctionData({abi: FACTORY_ABI, functionName: "fund"}),
          },
        ],
      })) as string;

      toast.push({
        title: "Funding sent",
        body: `${amount} ETH to the contract.`,
        tone: "success",
        href: txUrl(hash),
        hrefLabel: "View on Blockscout",
      });
      setTimeout(() => router.refresh(), 8000);
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : "The wallet rejected the request.";
      toast.push({title: "Not funded", body: message, tone: "error"});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="fund-amount" className="sr-only">
        Amount in ETH
      </label>
      <input
        id="fund-amount"
        value={amount}
        inputMode="decimal"
        placeholder="0.0"
        onChange={(e) => setAmount(e.target.value)}
        className="field field-mono h-9 w-[140px]"
      />
      <Button size="sm" loading={busy} onClick={fund}>
        Fund contract
      </Button>
    </div>
  );
}
