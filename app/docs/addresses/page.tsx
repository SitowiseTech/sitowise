import type {Metadata} from "next";
import Link from "next/link";
import {AddressRow} from "@/components/docs/AddressRow";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {CREATE2_FACTORY, POOL_MANAGER, POSITION_MANAGER} from "@/components/docs/protocol";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID, CHAIN_ID_HEX, EXPLORER_URL, FACTORY_ADDRESS, RPC_URL} from "@/lib/chain";
import {readFactory} from "@/lib/onchain";
import {NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Addresses",
  description:
    "Every address Sitowise uses on Robinhood Chain, which one you send to, which ones you must never send to, and how to verify each.",
};

/**
 * The payments wallet is a server-side variable and the role addresses are
 * contract state, so both are resolved here rather than compiled into the
 * client bundle. Revalidating hourly means a role rotation, which emits an
 * event on chain, shows up on this page without a rebuild.
 */
export const revalidate = 3600;

const ZERO = "0x0000000000000000000000000000000000000000";

/** Any address from env, or the zero address, which AddressRow renders as missing. */
function fromEnv(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed.toLowerCase() : ZERO;
}

export default async function AddressesPage() {
  // Roles are read from the contract rather than from configuration: the owner
  // can rotate the relayer and the distributor, and a page that printed the
  // deploy-time values would eventually be telling readers about keys that no
  // longer have any power. A failed read prints nothing rather than a guess.
  const chain = await readFactory();
  const roles = chain.ok ? chain.data : null;

  return (
    <DocPage
      href="/docs/addresses"
      lede={
        <>
          Every address Sitowise uses on Robinhood Chain, what each one does, which single one you
          ever send money to, and how to check that the one you are looking at is the real one.
        </>
      }
    >
      <Callout tone="warn" title="One address takes money, and it is not the contract">
        <p>
          A node is bought by sending a plain {NODE_PRICE_ETH} ETH transfer to the{" "}
          <strong>payments wallet</strong> below. That is the only Sitowise address you should
          ever send ETH to. Sending to the factory does not buy a node: a bare transfer to it is
          recorded as <code>Funded</code> and becomes unattached contract balance, not a node and
          not your balance.
        </p>
      </Callout>

      <h2 id="chain">The chain</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Network</td>
            <td>Robinhood Chain</td>
          </tr>
          <tr>
            <td>Chain id</td>
            <td>
              <code>{CHAIN_ID}</code> decimal, <code>{CHAIN_ID_HEX}</code> hex
            </td>
          </tr>
          <tr>
            <td>RPC</td>
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
        There is no Sitowise deployment on any other network, and no testnet deployment. Anything
        claiming to be Sitowise elsewhere is not this project.
      </p>

      <h2 id="contract">The contract</h2>
      <p>
        There is one. <code>SitowiseFactory</code> records nodes and holds their balances. There
        is no treasury contract, no voucher contract and no proxy.
      </p>
      <div className="panel mb-6">
        <AddressRow
          label="SitowiseFactory"
          address={FACTORY_ADDRESS}
          missingLabel="Not configured on this deployment"
          note={
            <>
              Records nodes, holds node balances, and pays them out when the node&rsquo;s own owner
              calls <code>withdraw</code>. Verified on the explorer. Its interface is documented on{" "}
              <Link href="/docs/factory-interface">Factory interface</Link>.{" "}
              <strong>Do not send ETH here to buy a node.</strong>
            </>
          }
        />
      </div>

      <h2 id="wallets">Wallets and roles</h2>
      <p>
        Four wallets, kept deliberately separate so that each one can only cost what it is worth.
        The payments wallet is configuration. The other three are roles the contract itself
        enforces, so the addresses below are read from the contract, not from a config file.
      </p>
      <div className="panel mb-6">
        <AddressRow
          label="Payments wallet"
          address={fromEnv(process.env.PAYMENT_ADDRESS)}
          missingLabel="Not configured on this deployment"
          note={
            <>
              <strong>Safe to send to, and the only one.</strong> Send exactly{" "}
              {NODE_PRICE_ETH} ETH here to buy one node. A watcher sees the transfer and the
              relayer mints your node against that transaction&rsquo;s hash. It is an ordinary
              wallet, not a contract: it runs no code and can never mint anything by itself. See{" "}
              <Link href="/docs/deploying">Deploying a node</Link>.
            </>
          }
        />
        <AddressRow
          label="Owner"
          address={roles?.owner ?? ZERO}
          missingLabel="Could not read the contract just now"
          note={
            <>
              <strong>Never send anything here.</strong> The cold key that deployed the contract.
              It can change roles, pause new mints, set <code>maxPerWallet</code>, and rescue
              contract funds that belong to no node. It cannot touch a node balance. Ownership
              moves only in two steps, <code>transferOwnership</code> then{" "}
              <code>acceptOwnership</code>. See <Link href="/docs/security-model">Security model</Link>.
            </>
          }
        />
        <AddressRow
          label="Relayer"
          address={roles?.relayer ?? ZERO}
          missingLabel="Could not read the contract just now"
          note={
            <>
              <strong>Never send anything here.</strong> A server key whose only power is{" "}
              <code>mintFor</code>. It creates your node and pays the gas for it. It holds gas and
              nothing else, so if it leaked the cost would be unauthorised mints and gas, never
              anyone&rsquo;s balance.
            </>
          }
        />
        <AddressRow
          label="Distributor"
          address={roles?.distributor ?? ZERO}
          missingLabel="Could not read the contract just now"
          note={
            <>
              <strong>Never send anything here.</strong> A server key whose only power is{" "}
              <code>creditBatch</code>, which is payable, so this is the wallet that actually
              sends the ETH that lands on node balances. It carries the payout float and nothing
              more.
            </>
          }
        />
      </div>
      {chain.ok ? null : (
        <Callout tone="info">
          The role addresses could not be read from the chain while this page was generated, so
          they are shown as unavailable rather than filled in from configuration. Read them
          yourself with the <code>cast</code> calls below.
        </Callout>
      )}
      <p>
        No role can move a node balance. <code>withdraw</code> and <code>withdrawAll</code> check
        the caller against the node&rsquo;s own owner and against nothing else, which is why the
        list above has no entry that is able to pay you or to take from you.
      </p>

      <h2 id="hook">The Uniswap v4 hook</h2>
      <div className="panel mb-6">
        <AddressRow
          label="SitowiseHook"
          address={fromEnv(process.env.NEXT_PUBLIC_HOOK)}
          note={
            <>
              Not deployed. Its address will be published here once it exists, and it has to be
              mined so that its low bits encode its permissions. Until it is deployed and pools
              are initialised naming it, it accrues nothing and no part of today&rsquo;s numbers
              comes from it. See <Link href="/docs/hook-lifecycle">The hook lifecycle</Link>.
            </>
          }
        />
      </div>

      <h2 id="uniswap">Uniswap v4 on Robinhood Chain</h2>
      <p>
        These are not Sitowise contracts and nothing here interacts with them yet. They are listed
        because the hook will be built on them, and because the PoolManager would be the only
        contract permitted to call it.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Contract</th>
            <th>Address</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>PoolManager</td>
            <td>
              <code>{POOL_MANAGER}</code>
            </td>
            <td>Holds every v4 pool and calls hooks</td>
          </tr>
          <tr>
            <td>PositionManager</td>
            <td>
              <code>{POSITION_MANAGER}</code>
            </td>
            <td>
              v4 liquidity positions. Confirms the manager above through <code>poolManager()</code>
            </td>
          </tr>
          <tr>
            <td>CREATE2 factory</td>
            <td>
              <code>{CREATE2_FACTORY}</code>
            </td>
            <td>Deterministic deployer needed to hit a mined hook address</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="verify">Verifying an address</h2>
      <p>
        Do not trust a contract address from a message, a reply, or a search result, including
        this one if you can check it another way. Three checks, in increasing strength:
      </p>
      <ol>
        <li>
          <strong>Open it on the explorer.</strong> The source is verified, so you can read the
          exact code that is deployed.
        </li>
        <li>
          <strong>Ask the contract about itself.</strong> A copy with different roles or a
          different node count will answer differently.
        </li>
        <li>
          <strong>Compare against the repository.</strong> Build the contract and check that the
          deployed bytecode matches what you built.
        </li>
      </ol>
      <CodeBlock label="cast">{`cast call $FACTORY "owner()(address)"        --rpc-url ${RPC_URL}
cast call $FACTORY "relayer()(address)"      --rpc-url ${RPC_URL}
cast call $FACTORY "distributor()(address)"  --rpc-url ${RPC_URL}
cast call $FACTORY "maxPerWallet()(uint256)" --rpc-url ${RPC_URL}
cast call $FACTORY "outstanding()(uint256)"  --rpc-url ${RPC_URL}
cast call $FACTORY "isSolvent()(bool)"       --rpc-url ${RPC_URL}`}</CodeBlock>
      <p>
        The strongest single check on the money is the last two together.{" "}
        <code>outstanding</code> is the sum of every node balance, and{" "}
        <code>isSolvent()</code> says whether the contract holds at least that much. A factory
        that cannot answer both is not this one. See{" "}
        <Link href="/docs/settlement">Settlement</Link>.
      </p>
      <p>
        There is nothing equivalent to check about the payments wallet, because it is a plain
        wallet with no code and no state. The check that matters there is the sale itself: your
        payment transaction hash appears as <code>paymentRef</code> in the{" "}
        <code>NodeMinted</code> log of the mint, and it can only ever appear once.
      </p>

      <h2 id="changes">If an address changes</h2>
      <p>
        The contract is not upgradeable. There is no proxy and no admin key that can swap the
        implementation, so the factory at a given address is the code that was deployed there and
        stays that way. A new deployment would be a new address, announced as such, and the old
        one would keep working for the nodes it holds, including their withdrawals.
      </p>
      <p>
        What can change without a redeployment are the things the owner controls: the relayer, the
        distributor, the per-wallet cap and the pause flag. Each emits an event when it changes,
        so the history is public and this page reads the current values rather than remembering
        the old ones. The payments wallet can also change, which is why you should take it from
        this page or from the deploy flow at the moment you pay rather than from a saved copy. See{" "}
        <Link href="/docs/events">Events</Link> and{" "}
        <Link href="/docs/security-model">Security model</Link>.
      </p>
    </DocPage>
  );
}
