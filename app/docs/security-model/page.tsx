import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {MAX_PER_WALLET_CEILING} from "@/components/docs/protocol";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "Security model",
  description:
    "What each key can and cannot do, why rescue is bounded by the sum of node balances, and the failure modes the contract does not protect against.",
};

export default function SecurityModelPage() {
  return (
    <DocPage
      href="/docs/security-model"
      lede={
        <>
          Four wallets exist, and each can do a specific and limited set of things. This page
          states all of them, including the ones that are uncomfortable, and names what the
          contract does not defend against.
        </>
      }
    >
      <h2 id="keys">The four wallets</h2>
      <p>
        They are separate keys because they are separate powers and separate risks. What matters
        is the last column: none of them is a key that can move a node balance.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Wallet</th>
            <th>Where it lives</th>
            <th>Holds funds</th>
            <th>Can do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Owner</td>
            <td>Cold, off the server</td>
            <td>No, beyond gas</td>
            <td>
              Rotate the relayer and distributor, pause minting, set the cap, rescue unattached
              funds, hand over ownership in two steps
            </td>
          </tr>
          <tr>
            <td>Payments</td>
            <td>Offline; the server only watches the address</td>
            <td>Yes, node purchases</td>
            <td>
              Nothing on the contract. It is a recipient address with no privileges of any kind
            </td>
          </tr>
          <tr>
            <td>Relayer</td>
            <td>On the server</td>
            <td>No, gas only</td>
            <td>
              <code>mintFor</code>, and nothing else
            </td>
          </tr>
          <tr>
            <td>Distributor</td>
            <td>On the server</td>
            <td>Yes, the payout float</td>
            <td>
              <code>creditBatch</code>, and nothing else. Because that call is payable, it spends
              its own ETH rather than the contract&rsquo;s
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The deploy script refuses to run if the relayer or the distributor equals the deployer,
        because the deployer becomes the owner and that check is what keeps the cold key off an
        internet-facing server.
      </p>
      <Callout tone="info" title="There is no signer key">
        Withdrawals used to be authorised by a server signature. They are not any more. Nothing on
        the server can authorise a payment to anyone, which removes the sharpest edge the earlier
        design had. See <Link href="/docs/settlement">Settlement</Link>.
      </Callout>

      <h2 id="owner-can">What the owner can do</h2>
      <ul>
        <li>
          <strong>Rotate the relayer</strong> with <code>setRelayer</code>, and the distributor
          with <code>setDistributor</code>. Neither can be set to the zero address.
        </li>
        <li>
          <strong>Change the per-wallet cap</strong> with <code>setMaxPerWallet</code>, within 1
          to {MAX_PER_WALLET_CEILING}. Lowering it does not remove nodes anyone already holds.
        </li>
        <li>
          <strong>Pause minting</strong> with <code>setPaused</code>.
        </li>
        <li>
          <strong>Take unattached funds</strong> with <code>rescue</code>, bounded as described
          below.
        </li>
        <li>
          <strong>Offer ownership</strong> with <code>transferOwnership</code>. It does not take
          effect until the new address calls <code>acceptOwnership</code> itself, so a typo cannot
          brick the admin surface.
        </li>
      </ul>

      <h2 id="owner-cannot">What the owner cannot do</h2>
      <ul>
        <li>
          <strong>Cannot take a node.</strong> There is no function that reassigns{" "}
          <code>node.owner</code>. Nodes cannot be moved by anyone, including the owner.
        </li>
        <li>
          <strong>Cannot withdraw on your behalf.</strong> Both withdrawal functions check the
          caller against <code>node.owner</code> and against nothing else.
        </li>
        <li>
          <strong>Cannot pause withdrawals.</strong> The pause flag is read by{" "}
          <code>mintFor</code> and nowhere else in the contract. There is no state in which a
          balance is stuck.
        </li>
        <li>
          <strong>Cannot credit a node without paying for it.</strong>{" "}
          <code>creditBatch</code> is payable and reverts unless <code>msg.value</code> equals the
          sum of the amounts, so no key can inflate a balance the contract cannot honour.
        </li>
        <li>
          <strong>Cannot reach money owed to holders.</strong> This is the point of the next
          section.
        </li>
        <li>
          <strong>Cannot upgrade the contract.</strong> There is no proxy and no implementation
          slot. The code at the address is the code that was deployed.
        </li>
      </ul>

      <h2 id="rescue">Why rescue is bounded</h2>
      <p>
        <code>rescue</code> exists so that ETH sent in error, or held in excess of what is owed, is
        not stranded forever. It is capped at <code>freeBalance()</code>, which is the contract
        balance minus <code>outstanding</code>, the sum of every node balance.
      </p>
      <CodeBlock label="SitowiseFactory">{`/// @notice Sum of every node balance. The contract must always hold at least this.
uint256 public outstanding;

function freeBalance() public view returns (uint256) {
    uint256 bal = address(this).balance;
    return bal > outstanding ? bal - outstanding : 0;
}

function rescue(address to, uint256 amount) external onlyOwner nonReentrant {
    if (to == address(0)) revert BadInput();
    if (amount > freeBalance()) revert ExceedsFree();
    (bool ok,) = payable(to).call{value: amount}("");
    if (!ok) revert TransferFailed();
    emit Rescued(to, amount);
}`}</CodeBlock>
      <p>
        <code>outstanding</code> is not a figure anyone publishes or attests to. It rises by the
        exact <code>msg.value</code> of every credit and falls by the exact amount of every
        withdrawal, inside the same transactions that move the ETH. It cannot be set, cannot be
        lowered by hand, and there is no admin path that touches it. So crediting a node is a
        one-way commitment: the same arithmetic that gives you a balance is what stops the owner
        taking it back.
      </p>
      <p>
        The property is enforced by a fuzz invariant in the test suite, and the invariant is
        verified by mutation. Changing <code>rescue</code>&rsquo;s bound to the full balance makes
        the suite fail, which is the only evidence that the test was ever testing anything. See{" "}
        <Link href="/docs/audits">Audits</Link>.
      </p>
      <Callout>
        You can check this at any time without permission. <code>freeBalance()</code> is the
        absolute ceiling on what the owner could remove right now, <code>outstanding()</code> is
        what is owed to node balances, and <code>isSolvent()</code> says whether the contract
        holds at least that much. All three are public views; see{" "}
        <Link href="/docs/factory-interface">Factory interface</Link>.
      </Callout>

      <h2 id="server-risk">What a compromised server key could do</h2>
      <p>
        Two keys sit on an internet-facing machine. Both are deliberately shaped so that losing
        one costs a bounded, known amount and never costs a holder their balance.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Key</th>
            <th>Worst case if it leaks</th>
            <th>What it still cannot do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Relayer</td>
            <td>
              Unauthorised mints, up to <code>maxPerWallet</code> per wallet, and the gas spent
              doing it. Every one of them is capped by needing an unused{" "}
              <code>paymentRef</code>, so a mint without a real payment is visible as exactly that
            </td>
            <td>
              Credit anything, move any balance, change any setting, or mint while paused
            </td>
          </tr>
          <tr>
            <td>Distributor</td>
            <td>
              The payout float that wallet is holding at that moment, which is why it is topped up
              with days of runway rather than months
            </td>
            <td>
              Take ETH out of the contract. <code>creditBatch</code> only ever moves value
              inwards, and there is no matching function that moves it back out
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The owner can rotate either key immediately with <code>setRelayer</code> or{" "}
        <code>setDistributor</code>, and can pause minting while doing it. Neither rotation
        affects a single existing balance.
      </p>

      <h2 id="contract">What the contract defends against</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Attack</th>
            <th>Defence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Withdrawing against someone else&rsquo;s node</td>
            <td>
              <code>node.owner != msg.sender</code> reverts <code>NotNodeOwner</code>, checked per
              node even inside a sweep
            </td>
          </tr>
          <tr>
            <td>Reentrancy on payout</td>
            <td>
              The balance is zeroed and <code>outstanding</code> reduced before any transfer, and
              every value-moving function carries <code>nonReentrant</code> on top of that
            </td>
          </tr>
          <tr>
            <td>One payment minting many nodes</td>
            <td>
              <code>paymentRefUsed</code> is set before the node is created; a repeat reverts{" "}
              <code>RefAlreadyUsed</code>
            </td>
          </tr>
          <tr>
            <td>A balance that is not backed by ETH</td>
            <td>
              <code>creditBatch</code> reverts <code>ValueMismatch</code> unless{" "}
              <code>msg.value</code> is exactly the sum credited
            </td>
          </tr>
          <tr>
            <td>A credit silently truncating on the cast into a balance</td>
            <td>
              Amounts above <code>type(uint128).max</code> revert <code>AmountTooLarge</code>{" "}
              rather than wrapping, which would leave a node credited less than the ETH behind it
            </td>
          </tr>
          <tr>
            <td>Purchase money being paid out as rewards</td>
            <td>
              Payment never enters the contract. It is a transfer to a separate wallet, so there
              is no path from a sale into a balance
            </td>
          </tr>
          <tr>
            <td>Owner draining what is owed</td>
            <td>
              <code>rescue</code> is capped at <code>freeBalance()</code> and reverts{" "}
              <code>ExceedsFree</code>
            </td>
          </tr>
          <tr>
            <td>A mistyped ownership handover locking the admin surface</td>
            <td>
              Ownership moves only when the new owner calls <code>acceptOwnership</code>{" "}
              themselves
            </td>
          </tr>
          <tr>
            <td>
              A <code>withdrawAll</code> sweep exceeding the block gas limit
            </td>
            <td>
              <code>maxPerWallet</code> cannot be raised past{" "}
              <code>MAX_PER_WALLET_CEILING</code>, and per-node <code>withdraw</code> works
              regardless
            </td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="not-defended">What it does not defend against</h2>
      <Callout tone="warn">
        <p>
          <strong>Operator discretion.</strong> Nothing in the contract compels Sitowise to credit
          anything to any node, ever. Credits are decided off chain. During the launch period they
          are funded by Sitowise and can be reduced or stopped at any time.
        </p>
        <p>
          <strong>A payment that is sent but never minted.</strong> The purchase happens outside
          the contract, so nothing on chain guarantees that a transfer to the payments wallet
          becomes a node. That step depends on the watcher and the relayer, which means it depends
          on Sitowise. Withdrawing does not.
        </p>
        <p>
          <strong>Code that has not been audited.</strong> No third party has reviewed this. See{" "}
          <Link href="/docs/audits">Audits</Link>.
        </p>
        <p>
          <strong>Your own keys.</strong> Losing the wallet that owns a node loses the node and
          its balance. There is no recovery path, because there is no function that could move it.
        </p>
      </Callout>
      <p>
        The complete list of ways this can go wrong for you, including the ones above, is on{" "}
        <Link href="/docs/risks">Risks</Link>.
      </p>
    </DocPage>
  );
}
