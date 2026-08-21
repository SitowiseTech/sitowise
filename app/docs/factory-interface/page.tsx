import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {MAX_PER_WALLET_CEILING} from "@/components/docs/protocol";
import {Callout} from "@/components/ui/Callout";
import {MAX_NODES_PER_WALLET} from "@/lib/site";

export const metadata: Metadata = {
  title: "Factory interface",
  description:
    "Every function on SitowiseFactory: arguments, return values, access control, and the complete list of the fifteen custom errors it can revert with.",
};

export default function FactoryInterfacePage() {
  return (
    <DocPage
      href="/docs/factory-interface"
      lede={
        <>
          The complete external surface of <code>SitowiseFactory</code>, function by function,
          with every custom error it can revert with. Nothing here is a summary of a larger
          interface; this is the whole thing.
        </>
      }
    >
      <h2 id="shape">Shape of the contract</h2>
      <p>
        One contract, no inheritance, no libraries, no proxy. Access control is three address
        variables and three modifiers rather than a role registry, because there are exactly three
        privileged callers and a registry would only make them harder to read off the chain.
      </p>
      <CodeBlock label="Storage that governs everything else">{`address public owner;         // cold key: roles, pause, cap, rescue
address public pendingOwner;  // owner-elect, until it accepts
address public relayer;        // may call mintFor, nothing else
address public distributor;    // may call creditBatch, nothing else

uint256 public maxPerWallet = 25;
uint256 public constant MAX_PER_WALLET_CEILING = ${MAX_PER_WALLET_CEILING};
bool    public paused;

uint256 public outstanding;    // sum of every node balance`}</CodeBlock>
      <p>
        A node is a struct, not a token. There is no <code>ownerOf</code>, no{" "}
        <code>transferFrom</code> and no approval surface, so a node cannot be sold or moved once
        minted. See <Link href="/docs/node-model">Node model</Link>.
      </p>
      <CodeBlock label="struct Node">{`struct Node {
    address owner;
    uint64  createdAt;
    uint128 balance;         // withdrawable right now
    uint128 totalReceived;   // credited over the node's whole life
    uint128 totalWithdrawn;
}`}</CodeBlock>

      <h2 id="mint">Minting</h2>
      <CodeBlock label="mintFor">{`function mintFor(address to, bytes32 paymentRef)
    external
    onlyRelayer
    returns (uint256 id);`}</CodeBlock>
      <p>
        Not payable, because the contract never receives the purchase money. Payment is a plain
        transfer to the payments wallet, and <code>paymentRef</code> is that transfer&rsquo;s
        transaction hash. The relayer sends this call and pays its gas.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Detail</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Caller</td>
            <td>
              <code>relayer()</code> only, otherwise <code>NotRelayer</code>
            </td>
          </tr>
          <tr>
            <td>Returns</td>
            <td>
              The new node id, <code>++totalNodes</code>, so ids are sequential from 1
            </td>
          </tr>
          <tr>
            <td>Emits</td>
            <td>
              <code>NodeMinted(id, to, paymentRef, createdAt)</code>
            </td>
          </tr>
          <tr>
            <td>Reverts</td>
            <td>
              <code>IsPaused</code>, <code>BadInput</code> (zero <code>to</code> or zero{" "}
              <code>paymentRef</code>), <code>RefAlreadyUsed</code>, <code>WalletLimit</code>
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        <code>paymentRefUsed[paymentRef]</code> is set before anything else, so one payment backs
        exactly one node. That mapping is the reason the reference in the log is evidence rather
        than decoration. See <Link href="/docs/settlement">Settlement</Link>.
      </p>

      <h2 id="credit">Crediting</h2>
      <CodeBlock label="creditBatch">{`function creditBatch(uint256[] calldata ids, uint256[] calldata amounts)
    external
    payable
    onlyDistributor;`}</CodeBlock>
      <p>
        Payable, and <code>msg.value</code> must equal the sum of <code>amounts</code> exactly. The
        ETH that backs the balances arrives in the same call that records them, so a balance can
        never exist unbacked.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Detail</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Caller</td>
            <td>
              <code>distributor()</code> only, otherwise <code>NotDistributor</code>
            </td>
          </tr>
          <tr>
            <td>Effect</td>
            <td>
              Adds to each node&rsquo;s <code>balance</code> and <code>totalReceived</code>, then
              to <code>outstanding</code> and <code>totalDistributed</code>
            </td>
          </tr>
          <tr>
            <td>Emits</td>
            <td>
              One <code>Credited(id, amount, newBalance)</code> per node in the batch
            </td>
          </tr>
          <tr>
            <td>Reverts</td>
            <td>
              <code>BadInput</code> (empty batch, mismatched lengths, a zero amount, or an id that
              was never minted), <code>AmountTooLarge</code>, <code>ValueMismatch</code>
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The sum is checked before any storage is touched, so a malformed batch costs the caller
        memory-only gas instead of one write per node. It is not pausable: pausing stops sales,
        not payouts.
      </p>

      <h2 id="withdraw">Withdrawing</h2>
      <CodeBlock label="withdraw and withdrawAll">{`function withdraw(uint256 id, address to) external;

function withdrawAll(address to) external returns (uint256 amount);`}</CodeBlock>
      <p>
        These are the only two functions an ordinary user ever calls, and they are callable by the
        node&rsquo;s owner and by nobody else. There is no amount argument: a withdrawal always
        moves the node&rsquo;s whole balance.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th></th>
            <th>
              <code>withdraw</code>
            </th>
            <th>
              <code>withdrawAll</code>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Caller</td>
            <td>
              <code>node.owner</code>, otherwise <code>NotNodeOwner</code>
            </td>
            <td>Anyone, but it only sweeps the caller&rsquo;s own nodes</td>
          </tr>
          <tr>
            <td>Moves</td>
            <td>The whole balance of one node</td>
            <td>The combined balance of every node the caller owns</td>
          </tr>
          <tr>
            <td>Returns</td>
            <td>Nothing</td>
            <td>The total sent</td>
          </tr>
          <tr>
            <td>Emits</td>
            <td>
              <code>Withdrawn(id, to, amount)</code>
            </td>
            <td>
              One <code>Withdrawn</code> per node with a non-zero balance
            </td>
          </tr>
          <tr>
            <td>Reverts</td>
            <td>
              <code>NotNodeOwner</code>, <code>BadInput</code>, <code>NothingToWithdraw</code>,{" "}
              <code>TransferFailed</code>, <code>Reentrancy</code>
            </td>
            <td>
              <code>BadInput</code>, <code>NothingToWithdraw</code> (no node held any balance),{" "}
              <code>TransferFailed</code>, <code>Reentrancy</code>
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Both zero the balances and update <code>outstanding</code> before sending, and both carry{" "}
        <code>nonReentrant</code> on top of that. <code>withdrawAll</code> skips nodes with a zero
        balance rather than reverting on them, so a wallet holding a mix of credited and
        uncredited nodes still sweeps in one transaction. Neither reads <code>paused</code>.
      </p>

      <h2 id="reads">Reads</h2>
      <p>Every one of these is <code>view</code> and free to call.</p>
      <DocTable>
        <thead>
          <tr>
            <th>Function</th>
            <th>Returns</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>nodeInfo(uint256 id)</code>
            </td>
            <td>
              <code>(address nodeOwner, uint64 createdAt, uint256 balance, uint256 totalReceived,
              uint256 totalWithdrawnByNode)</code>. Everything about one node in a single call, for
              the explorer&rsquo;s Read Contract tab. An unminted id answers with the zero address.
            </td>
          </tr>
          <tr>
            <td>
              <code>nodesOf(address who)</code>
            </td>
            <td>
              <code>uint256[]</code>, every node id that wallet owns, in mint order
            </td>
          </tr>
          <tr>
            <td>
              <code>nodeCountOf(address who)</code>
            </td>
            <td>How many nodes that wallet owns, which is what the cap is checked against</td>
          </tr>
          <tr>
            <td>
              <code>balanceOfOwner(address who)</code>
            </td>
            <td>Combined withdrawable balance across every node of a wallet</td>
          </tr>
          <tr>
            <td>
              <code>outstanding()</code>
            </td>
            <td>Sum of every node balance. The contract must always hold at least this much</td>
          </tr>
          <tr>
            <td>
              <code>freeBalance()</code>
            </td>
            <td>
              <code>address(this).balance - outstanding</code>, or zero. Contract funds attached to
              no node, and all the owner can ever rescue
            </td>
          </tr>
          <tr>
            <td>
              <code>isSolvent()</code>
            </td>
            <td>
              <code>balance &gt;= outstanding</code>. False would mean node balances are not fully
              backed
            </td>
          </tr>
          <tr>
            <td>
              <code>paymentRefUsed(bytes32)</code>
            </td>
            <td>Whether that payment transaction hash has already minted a node</td>
          </tr>
          <tr>
            <td>
              <code>totalNodes()</code>
            </td>
            <td>Nodes ever minted, and the id of the most recent one</td>
          </tr>
          <tr>
            <td>
              <code>totalDistributed()</code>
            </td>
            <td>Everything ever credited to node balances</td>
          </tr>
          <tr>
            <td>
              <code>totalWithdrawn()</code>
            </td>
            <td>Everything ever withdrawn out of them</td>
          </tr>
          <tr>
            <td>
              <code>owner()</code>, <code>pendingOwner()</code>, <code>relayer()</code>,{" "}
              <code>distributor()</code>
            </td>
            <td>The current roles. See <Link href="/docs/addresses">Addresses</Link></td>
          </tr>
          <tr>
            <td>
              <code>maxPerWallet()</code>, <code>MAX_PER_WALLET_CEILING()</code>
            </td>
            <td>
              Currently {MAX_NODES_PER_WALLET}, and the constant {MAX_PER_WALLET_CEILING} the owner
              cannot raise it past
            </td>
          </tr>
          <tr>
            <td>
              <code>paused()</code>
            </td>
            <td>Whether new mints are blocked. It has no effect on withdrawals</td>
          </tr>
        </tbody>
      </DocTable>
      <Callout tone="info">
        There is no <code>price()</code>. The contract never sees the purchase money, so it has no
        opinion about what a node costs; the price lives off chain and is the figure the watcher
        checks a payment against.
      </Callout>

      <h2 id="admin">Admin</h2>
      <p>
        Every function here is <code>onlyOwner</code> except <code>acceptOwnership</code>,{" "}
        <code>fund</code> and <code>receive</code>, and every one of them emits an event, so the
        entire history of the admin surface is readable from logs.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Function</th>
            <th>Effect</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>setRelayer(address v)</code>
            </td>
            <td>
              Who may mint. Cannot be zero (<code>BadInput</code>). Emits{" "}
              <code>RelayerChanged</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>setDistributor(address v)</code>
            </td>
            <td>
              Who may credit. Cannot be zero. Emits <code>DistributorChanged</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>setMaxPerWallet(uint256 v)</code>
            </td>
            <td>
              Nodes per wallet. Must be between 1 and {MAX_PER_WALLET_CEILING} inclusive, else{" "}
              <code>BadInput</code>. Emits <code>MaxPerWalletChanged</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>setPaused(bool v)</code>
            </td>
            <td>
              Blocks <code>mintFor</code>. Read nowhere else in the contract. Emits{" "}
              <code>PausedChanged</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>transferOwnership(address v)</code>
            </td>
            <td>
              Records <code>pendingOwner</code> only. Ownership does not move yet. Emits{" "}
              <code>OwnershipOfferStarted</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>acceptOwnership()</code>
            </td>
            <td>
              Callable by <code>pendingOwner</code> alone, else <code>NotPendingOwner</code>. This
              is what actually moves ownership. Emits <code>OwnerChanged</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>rescue(address to, uint256 amount)</code>
            </td>
            <td>
              Sends unattached funds only. Reverts <code>ExceedsFree</code> above{" "}
              <code>freeBalance()</code>. Emits <code>Rescued</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>fund()</code> payable, and <code>receive()</code>
            </td>
            <td>
              Anyone may top the contract up without attaching the money to a node. Emits{" "}
              <code>Funded</code>. A plain transfer to the contract lands here, which is why it
              does not buy a node
            </td>
          </tr>
        </tbody>
      </DocTable>
      <Callout tone="warn" title="What the owner cannot do">
        There is no function that moves a node balance, reassigns a node, blocks a withdrawal, or
        raises what <code>rescue</code> may take. The two-step ownership handover exists so a typo
        in <code>transferOwnership</code> cannot brick the admin surface. See{" "}
        <Link href="/docs/security-model">Security model</Link>.
      </Callout>

      <h2 id="errors">Every custom error</h2>
      <p>
        Fifteen, all of them zero-argument, so a revert is four bytes and a wallet that decodes
        the ABI can name it exactly. The selector is the first four bytes of the keccak hash of
        the signature, which is what you will see in raw RPC output when a wallet fails to decode.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Error</th>
            <th>Selector</th>
            <th>Raised when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>NotOwner()</code>
            </td>
            <td>
              <code>0x30cd7471</code>
            </td>
            <td>An admin function was called by anything other than the owner</td>
          </tr>
          <tr>
            <td>
              <code>NotRelayer()</code>
            </td>
            <td>
              <code>0xc64891a5</code>
            </td>
            <td>
              <code>mintFor</code> was called by anything other than the relayer
            </td>
          </tr>
          <tr>
            <td>
              <code>NotDistributor()</code>
            </td>
            <td>
              <code>0x385296d5</code>
            </td>
            <td>
              <code>creditBatch</code> was called by anything other than the distributor
            </td>
          </tr>
          <tr>
            <td>
              <code>NotNodeOwner()</code>
            </td>
            <td>
              <code>0xd08a05d5</code>
            </td>
            <td>
              <code>withdraw</code> was sent from a wallet that does not own that node. Usually the
              wrong account is selected in the wallet
            </td>
          </tr>
          <tr>
            <td>
              <code>NotPendingOwner()</code>
            </td>
            <td>
              <code>0x1853971c</code>
            </td>
            <td>
              <code>acceptOwnership</code> was called by anyone but the recorded owner-elect
            </td>
          </tr>
          <tr>
            <td>
              <code>WalletLimit()</code>
            </td>
            <td>
              <code>0x5426a580</code>
            </td>
            <td>
              The buyer already holds <code>maxPerWallet</code> nodes. See{" "}
              <Link href="/docs/limits">Limits</Link>
            </td>
          </tr>
          <tr>
            <td>
              <code>IsPaused()</code>
            </td>
            <td>
              <code>0x1309a563</code>
            </td>
            <td>Minting is paused. Withdrawals are never affected</td>
          </tr>
          <tr>
            <td>
              <code>BadInput()</code>
            </td>
            <td>
              <code>0x2bb9acf7</code>
            </td>
            <td>
              A zero address, a zero <code>paymentRef</code>, an empty or mismatched batch, a zero
              credit amount, an unminted node id, or a cap outside 1 to{" "}
              {MAX_PER_WALLET_CEILING}
            </td>
          </tr>
          <tr>
            <td>
              <code>NothingToWithdraw()</code>
            </td>
            <td>
              <code>0xd0d04f60</code>
            </td>
            <td>
              The balance is already zero. Often means an earlier <code>withdrawAll</code> already
              swept it
            </td>
          </tr>
          <tr>
            <td>
              <code>ValueMismatch()</code>
            </td>
            <td>
              <code>0xdd8e4af7</code>
            </td>
            <td>
              <code>msg.value</code> did not equal the sum of the credited amounts
            </td>
          </tr>
          <tr>
            <td>
              <code>AmountTooLarge()</code>
            </td>
            <td>
              <code>0x06250401</code>
            </td>
            <td>
              A single credit exceeded <code>type(uint128).max</code>, which would truncate
              silently on the cast into a balance
            </td>
          </tr>
          <tr>
            <td>
              <code>TransferFailed()</code>
            </td>
            <td>
              <code>0x90b8ec18</code>
            </td>
            <td>
              The destination rejected the ETH. The whole call reverts, so the balance stays where
              it was. See <Link href="/docs/destination-addresses">Destination addresses</Link>
            </td>
          </tr>
          <tr>
            <td>
              <code>ExceedsFree()</code>
            </td>
            <td>
              <code>0x887a9e7a</code>
            </td>
            <td>
              <code>rescue</code> asked for more than <code>freeBalance()</code>. This is the
              holders&rsquo; guarantee refusing
            </td>
          </tr>
          <tr>
            <td>
              <code>RefAlreadyUsed()</code>
            </td>
            <td>
              <code>0x45e84473</code>
            </td>
            <td>That payment transaction hash has already minted a node</td>
          </tr>
          <tr>
            <td>
              <code>Reentrancy()</code>
            </td>
            <td>
              <code>0xab143c06</code>
            </td>
            <td>
              A paying function was re-entered. Every ETH-sending path is already
              checks-effects-interactions, so this is a second line rather than the first
            </td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="abi">Getting the ABI</h2>
      <p>
        The ABI this site uses is generated from the compiled artifact and lives in{" "}
        <code>lib/abi.ts</code>, so it cannot drift from the deployed bytecode. To produce it
        yourself:
      </p>
      <CodeBlock label="shell">{`cd contracts
forge build
jq .abi out/SitowiseFactory.sol/SitowiseFactory.json`}</CodeBlock>
      <p>
        Or take it from the explorer, where the source is verified. Both should match, and if they
        do not, trust neither and ask why. The events, with their topic hashes, are on{" "}
        <Link href="/docs/events">Events</Link>.
      </p>
    </DocPage>
  );
}
