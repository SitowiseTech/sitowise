import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";
import {ADD_CHAIN_PARAMS, CHAIN_ID, CHAIN_ID_HEX, EXPLORER_URL, RPC_URL} from "@/lib/chain";
import {MAX_NODES_PER_WALLET, NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Requirements",
  description:
    "Wallet, network parameters, and how much ETH you need on Robinhood Chain before deploying an Sitowise node.",
};

export default function RequirementsPage() {
  return (
    <DocPage
      href="/docs/requirements"
      lede={
        <>
          What you need before anything on this site is useful: a wallet that can sign on chain id{" "}
          {CHAIN_ID}, ETH on that chain, and enough of it to cover the node plus gas.
        </>
      }
    >
      <h2 id="wallet">A wallet</h2>
      <p>
        Any browser wallet that speaks EIP-1193 works. The dashboard discovers installed wallets
        through EIP-6963 and lists each provider under the name it reports, rather than guessing
        from injected flags. That matters because more than one extension advertises itself as the
        same wallet, and picking the wrong one is the most common way people end up signing from an
        address they did not expect.
      </p>
      <p>
        Hardware wallets work through whichever browser wallet you already use to drive them. The
        only operations Sitowise asks for are a message signature to sign in, a plain ETH transfer
        to buy a node, and a contract call to withdraw. No token approval is ever requested.
      </p>

      <h2 id="network">The network</h2>
      <p>
        Sitowise is deployed on Robinhood Chain and nowhere else. There is no testnet deployment and
        no address on any other chain. If someone shows you an Sitowise contract on a different
        network, it is not this project.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Network name</td>
            <td>{ADD_CHAIN_PARAMS.chainName}</td>
          </tr>
          <tr>
            <td>Chain id</td>
            <td>
              <code>{CHAIN_ID}</code> decimal, <code>{CHAIN_ID_HEX}</code> hex
            </td>
          </tr>
          <tr>
            <td>Currency</td>
            <td>ETH, 18 decimals</td>
          </tr>
          <tr>
            <td>RPC URL</td>
            <td>
              <code>{RPC_URL}</code>
            </td>
          </tr>
          <tr>
            <td>Explorer</td>
            <td>
              <a href={EXPLORER_URL} target="_blank" rel="noreferrer noopener">
                {EXPLORER_URL}
              </a>
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The dashboard offers to add the network for you. If you would rather add it by hand, these
        are the exact parameters it sends.
      </p>
      <CodeBlock label="wallet_addEthereumChain">{JSON.stringify(
        {method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS]},
        null,
        2,
      )}</CodeBlock>

      <h2 id="funds">How much ETH</h2>
      <p>
        A node costs exactly {NODE_PRICE_ETH} ETH, sent as a plain transfer to the payments wallet.
        The amount is checked off chain by the watcher rather than by the contract, and it has to
        match: a transfer for any other amount is held for manual review instead of minting a
        node.
      </p>
      <p>
        You pay the gas for that transfer, and later the gas for your own withdrawals. You do not
        pay the gas to mint. Minting is <code>mintFor</code>, and only the relayer can call it, so
        the operator pays for it.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Action</th>
            <th>Approximate gas</th>
            <th>Paid by</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Signing in</td>
            <td>None, it is a message signature</td>
            <td>Nobody</td>
          </tr>
          <tr>
            <td>Paying for a node</td>
            <td>21,000, an ordinary transfer</td>
            <td>You</td>
          </tr>
          <tr>
            <td>
              <code>mintFor</code>
            </td>
            <td>About 130,000</td>
            <td>Sitowise, through the relayer</td>
          </tr>
          <tr>
            <td>
              <code>withdraw</code>, one node
            </td>
            <td>About 55,000</td>
            <td>You</td>
          </tr>
          <tr>
            <td>
              <code>withdrawAll</code>, {MAX_NODES_PER_WALLET} nodes
            </td>
            <td>About 700,000</td>
            <td>You</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Those figures were measured against this contract, and the cost in ETH depends on the gas
        price at the time. Budget the node price plus a little for the transfer, and keep a small
        amount back afterwards so a withdrawal is never blocked by an empty gas tank, which is the
        situation described in <Link href="/docs/troubleshooting">Troubleshooting</Link>.
      </p>

      <h2 id="limits">Limits that apply to you</h2>
      <ul>
        <li>
          {MAX_NODES_PER_WALLET} nodes per wallet, enforced in the contract. See{" "}
          <Link href="/docs/limits">Limits</Link>.
        </li>
        <li>
          Minting can be paused by the operator. Withdrawals cannot be paused; that asymmetry is
          deliberate and is described on <Link href="/docs/security-model">Security model</Link>.
        </li>
        <li>
          Public API endpoints are rate limited per IP. See{" "}
          <Link href="/docs/api">the API overview</Link>.
        </li>
      </ul>

      <h2 id="not-needed">What you do not need</h2>
      <Callout>
        <p>
          Sitowise never asks for a token approval, a seed phrase, or a private key. It never asks
          you to send funds to an address given in a message. There is no token to buy, no
          allowlist, and no presale.
        </p>
        <p>
          The only three interactions are: one message signature to sign in, one plain ETH
          transfer to the payments wallet to buy a node, and one <code>withdraw</code> or{" "}
          <code>withdrawAll</code> call per payout. The payments wallet is printed on{" "}
          <Link href="/docs/addresses">Addresses</Link>; check it there before you send anything.
        </p>
      </Callout>
    </DocPage>
  );
}
