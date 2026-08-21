import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";
import {EXPLORER_URL} from "@/lib/chain";

export const metadata: Metadata = {
  title: "Audits",
  description:
    "Sitowise has not been audited by a third party. What exists instead, how to review the code yourself, and what that means for your risk.",
};

export default function AuditsPage() {
  return (
    <DocPage
      href="/docs/audits"
      lede={
        <>
          Sitowise has not been audited. No third-party firm has reviewed the contract that holds
          node balances, there is no report to link, and no audit is currently scheduled.
        </>
      }
    >
      <Callout tone="warn" title="Stated plainly">
        <p>
          There is no audit. If you are deciding whether to spend money here, treat the contracts
          as unreviewed code written by one team and verify them yourself, or do not use them.
        </p>
        <p>
          Nobody involved will claim otherwise, and if you see a page, a post or a badge claiming
          Sitowise is audited, it is not from us and it is not true.
        </p>
      </Callout>

      <h2 id="instead">What exists instead</h2>
      <p>
        Not an audit, and not a substitute for one. It is what can honestly be said about how the
        code was written and checked.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>What</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Test suite</td>
            <td>
              112 tests across 4 Foundry suites, all passing, against the one contract this
              repository contains.
            </td>
          </tr>
          <tr>
            <td>Coverage of the money paths</td>
            <td>
              Minting and the payment-reference guard; the wallet cap; pausing; credit batches,
              including value mismatches, oversized amounts, unknown ids and length mismatches;
              single and sweeping withdrawals, repeated and redirected, and to recipients that
              reject ETH; rescue against the free-balance bound; reentrancy; role access control;
              an empty contract.
            </td>
          </tr>
          <tr>
            <td>Invariants</td>
            <td>
              Six invariant properties run under fuzzing, including that the contract balance
              always covers <code>outstanding</code>, that <code>outstanding</code> equals the sum
              of every node balance, and that <code>freeBalance()</code> is exactly the rescuable
              remainder. Three further tests check the fuzzing handler is not passing vacuously.
            </td>
          </tr>
          <tr>
            <td>Dependencies</td>
            <td>
              None in the deployed code. <code>SitowiseFactory</code> inherits nothing, imports
              nothing, and contains no cryptography: access control is three address comparisons
              and withdrawal authorisation is <code>msg.sender</code>. Foundry and forge-std are
              test-only.
            </td>
          </tr>
          <tr>
            <td>Upgradeability</td>
            <td>
              None. There is no proxy, so the code you review is the code that stays deployed.
            </td>
          </tr>
          <tr>
            <td>Verification</td>
            <td>
              Sources are verified on the explorer, so the deployed bytecode can be matched against
              the repository.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Tests demonstrate that the paths the author thought of behave as intended. An audit is
        someone whose job is to think of the other paths. Do not confuse the two.
      </p>

      <h2 id="review">Reviewing it yourself</h2>
      <p>
        The contract is small on purpose. <code>SitowiseFactory</code> is a single file of a few
        hundred lines with no inheritance and no imports, and there is nothing else deployed. A
        competent Solidity reader can go through the whole thing in an afternoon.
      </p>
      <CodeBlock label="Build and test">{`cd contracts
forge install foundry-rs/forge-std --no-git
forge build
forge test -vv

# the properties, under fuzzing
forge test --match-path 'test/*invariant*'`}</CodeBlock>
      <p>Read these six things first, in this order:</p>
      <ol>
        <li>
          <code>mintFor</code>. Confirm it is relayer-only, that it rejects a zero{" "}
          <code>paymentRef</code>, and that it sets <code>paymentRefUsed[paymentRef]</code> before
          creating the node, so one payment can never back two nodes. Without that guard the{" "}
          <code>paymentRef</code> in <code>NodeMinted</code> would prove nothing.
        </li>
        <li>
          <code>creditBatch</code>. Confirm it is payable and reverts with{" "}
          <code>ValueMismatch</code> unless <code>msg.value</code> equals the sum of{" "}
          <code>amounts</code>, so a balance can never exist without the ETH behind it. Confirm the
          sum is validated before any storage is written, and that the loop rejects an unknown node
          id.
        </li>
        <li>
          The <code>AmountTooLarge</code> guard inside that loop. Balances are{" "}
          <code>uint128</code>, and an explicit narrowing cast in Solidity truncates silently
          rather than reverting, which would credit a node less than the ETH backing it and break{" "}
          <code>outstanding</code> permanently. Confirm the check is on the raw{" "}
          <code>uint256</code>, before the cast.
        </li>
        <li>
          <code>withdraw</code> and <code>withdrawAll</code>. Confirm the owner check is against{" "}
          <code>msg.sender</code> and nothing else, and that the node balance is zeroed and{" "}
          <code>outstanding</code> reduced <em>before</em> the external call. Confirm neither
          function reads <code>paused</code>.
        </li>
        <li>
          <code>rescue</code> together with <code>freeBalance()</code>. Confirm the bound is the
          contract balance minus <code>outstanding</code>, so the owner cannot reach a node
          balance under any sequence of calls. This is the holders&rsquo; guarantee, and it is the
          one line worth checking twice.
        </li>
        <li>
          <code>transferOwnership</code> and <code>acceptOwnership</code>. Confirm ownership only
          moves when the named address accepts, so a mistyped address cannot brick the admin
          surface.
        </li>
      </ol>
      <p>
        Then read the invariant suite, and satisfy yourself that it is not passing vacuously.{" "}
        <code>invariant_FreeBalanceIsTheRescuableRemainder</code> is the mutation canary: change{" "}
        <code>rescue</code>&rsquo;s bound from <code>freeBalance()</code> to the full contract
        balance and the suite must fail. If it still passes, the invariant is not testing what it
        claims to. The contracts README describes that check.
      </p>

      <h2 id="onchain">Checking the deployed code</h2>
      <p>
        Reading the repository tells you what was written. Reading the chain tells you what is
        deployed. Do both.
      </p>
      <CodeBlock label="cast">{`# compare deployed bytecode against a local build
cast code $FACTORY --rpc-url $RPC_URL | shasum

# who holds which power
cast call $FACTORY "owner()(address)"
cast call $FACTORY "relayer()(address)"
cast call $FACTORY "distributor()(address)"

# the settings those roles operate under
cast call $FACTORY "maxPerWallet()(uint256)"
cast call $FACTORY "MAX_PER_WALLET_CEILING()(uint256)"
cast call $FACTORY "paused()(bool)"

# the guarantee, checked against the contract's own balance
cast call $FACTORY "outstanding()(uint256)"
cast call $FACTORY "freeBalance()(uint256)"
cast call $FACTORY "isSolvent()(bool)"
cast call $FACTORY "totalNodes()(uint256)"`}</CodeBlock>
      <p>
        <code>freeBalance()</code> is the ceiling on <code>rescue</code>, and{" "}
        <code>isSolvent()</code> is the one-word version of the same question. Neither needs an
        account, a session or this website.
      </p>
      <p>
        The verified source is browsable at <code>{EXPLORER_URL}</code>. Addresses are on{" "}
        <Link href="/docs/addresses">Addresses</Link>.
      </p>

      <h2 id="reporting">Reporting something</h2>
      <p>
        If you find a bug, report it before publishing it, through the account linked in the site
        footer. There is no bug bounty programme, and pretending one exists would be another thing
        to be honest about. A report will be read, acted on, and credited if you want credit.
      </p>

      <h2 id="means">What this means for you</h2>
      <p>
        Unaudited code can contain a fault that nobody involved has noticed, and a fault in a
        contract holding ETH can mean the loss of that ETH. That is a real possibility, not a
        formality, and it sits alongside the other risks on{" "}
        <Link href="/docs/risks">Risks</Link>. Size your exposure accordingly.
      </p>
    </DocPage>
  );
}
