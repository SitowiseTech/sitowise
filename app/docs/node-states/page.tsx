import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {LifecycleDiagram} from "@/components/docs/charts/LifecycleDiagram";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "Node states",
  description:
    "Active and retired are ledger states, not contract states. What each one means, what causes a transition, and why neither can touch value already credited.",
};

export default function NodeStatesPage() {
  return (
    <DocPage
      href="/docs/node-states"
      lede={
        <>
          A node is either active or retired. Both are rows in the operator&rsquo;s database, not
          fields in the contract, and the distinction decides one thing only: whether the node is
          included in new distribution rounds. It has no effect on value already credited to it.
        </>
      }
    >
      <DocFigure caption="Every state a node can be in, and every transition between them. All of it is ledger-side; the contract has no equivalent.">
        <LifecycleDiagram />
      </DocFigure>

      <h2 id="states">The two states</h2>
      <DocTable>
        <thead>
          <tr>
            <th>State</th>
            <th>Included in rounds</th>
            <th>Can withdraw</th>
            <th>Reversible</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>active</code>
            </td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Not applicable</td>
          </tr>
          <tr>
            <td>
              <code>retired</code>
            </td>
            <td>No</td>
            <td>Yes, for everything already credited</td>
            <td>Only by the operator, and it is not routine</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        A node is active from the moment <code>mintFor</code> creates it on chain. There is no
        activation step, no waiting period, and nothing to configure.
      </p>

      <h2 id="offchain">State lives off chain, and that is deliberate</h2>
      <p>
        The factory has no status field. A node is a struct holding an owner, a creation timestamp,
        a balance and two running totals, and none of those is a state machine. The state you see
        in the dashboard comes from the operator&rsquo;s ledger, where it is a column on the node
        row:
      </p>
      <CodeBlock label="db/schema.sql">{`status text not null default 'active'
  check (status in ('active','retired'))`}</CodeBlock>
      <p>
        The consequence is the important part: because the contract does not know about the state,
        the state cannot stop you withdrawing. <code>withdraw</code> consults two things, the
        node&rsquo;s owner and the node&rsquo;s balance, and both are on chain.
      </p>
      <p>
        There is also nothing in the contract that ends a node. No retirement function, no burn, no
        expiry, and no admin call that deletes one. A node exists from the moment it is created and
        keeps existing; the only thing that ever changes about it without the owner acting is its
        balance going up when a round credits it.
      </p>
      <Callout>
        If Sitowise disappeared tomorrow, a retired node and an active node would be in exactly the
        same position: whatever balance is already on the node is withdrawable by its owner, from
        their own wallet, with nothing else required, and no new credits would arrive for either.
        Retirement takes nothing away.
      </Callout>

      <h2 id="retirement">What causes retirement</h2>
      <p>
        Retirement is an operator action in the ledger, not something a holder triggers and not
        something that happens on a timer. In normal operation it is used for one thing: excluding
        a node from rounds when it should no longer receive new credits, for example a node created
        during testing or one involved in an abuse investigation.
      </p>
      <p>
        It is not a punishment mechanism aimed at holders, and it does not exist to claw back
        value. It cannot claw back value: retiring a row in a database does not move ETH out of a
        node balance, and the contract offers no call that would.
      </p>

      <h2 id="withdrawing">Withdrawing does not change state</h2>
      <p>
        Withdrawing is not an exit. It sets the node&rsquo;s <code>balance</code> to zero, adds the
        same amount to its <code>totalWithdrawn</code>, and sends the ETH. The node carries on
        exactly as before, with its <code>totalReceived</code> intact as the record of everything
        it has ever earned. An active node that has withdrawn everything credited to it is still
        active and still included in the next round.
      </p>
      <p>
        This is why the lifecycle diagram has a loop on both live states rather than an arrow
        leading out. There is no state that a withdrawal moves you into.
      </p>
      <p>
        Pausing is the one operator switch that touches the contract, and it does not touch this
        either. <code>setPaused(true)</code> stops new nodes being created and nothing else; there
        is no code path in which a pause blocks a withdrawal. See{" "}
        <Link href="/docs/limits">Limits</Link>.
      </p>

      <h2 id="reading">Reading the state</h2>
      <p>
        The dashboard shows it per node. Over HTTP it is on the node record returned by{" "}
        <Link href="/docs/api/node">GET /api/node/:id</Link> and in the list from{" "}
        <Link href="/docs/api/nodes">GET /api/nodes/:address</Link>.
      </p>
      <p>
        On chain there is no state to read, because there is none there. What you can read on chain
        is what actually governs your money:
      </p>
      <CodeBlock label="cast">{`cast call $FACTORY "nodeInfo(uint256)(address,uint64,uint256,uint256,uint256)" $NODE_ID
# -> owner, createdAt, balance, totalReceived, totalWithdrawn

cast call $FACTORY "balanceOfOwner(address)(uint256)" $WALLET`}</CodeBlock>
      <p>
        If the owner and the balance are what you expect, your position is what you expect,
        whatever any interface says about state.
      </p>
    </DocPage>
  );
}
