import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "Node numbering",
  description:
    "How Sitowise node ids are assigned, why they are displayed zero padded, and how the display id maps onto the chain and the API.",
};

export default function NodeNumberingPage() {
  return (
    <DocPage
      href="/docs/node-numbering"
      lede={
        <>
          Node ids come from the chain, are sequential from 1, and are never reused. Everything
          else about numbering is presentation.
        </>
      }
    >
      <h2 id="assignment">How an id is assigned</h2>
      <CodeBlock label="SitowiseFactory.mintFor">{`id = ++totalNodes;
_node[id] =
    Node({owner: to, createdAt: uint64(block.timestamp), balance: 0, totalReceived: 0, totalWithdrawn: 0});
_owned[to].push(id);`}</CodeBlock>
      <p>
        The counter increments first, so the first node ever minted is id 1, not 0. Zero is
        the empty value: <code>nodeInfo(0)</code> answers with the zero address, and a withdrawal
        naming an id nobody owns reverts with <code>NotNodeOwner</code>.
      </p>
      <p>
        Because ids come from a counter inside the transaction, the id is decided by the chain and
        is final the moment the transaction confirms. Two buyers whose nodes are minted in the
        same block get different ids, in the order the block orders them. There is no reservation,
        no queue, and no way to pick your number. You do not send the minting transaction
        yourself; the relayer sends it after your payment is seen, so the id is assigned then
        rather than when you paid. See <Link href="/docs/deploying">Deploying a node</Link>.
      </p>

      <h2 id="reading">Reading #0001</h2>
      <p>
        Interfaces display ids zero padded to four digits with a leading hash, so node 1 reads as{" "}
        <code>#0001</code> and node 137 as <code>#0137</code>. The padding is cosmetic: it keeps
        columns of ids aligned in a table, which matters when a wallet holds several.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>On chain</th>
            <th>Displayed</th>
            <th>In the API</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>1</code>
            </td>
            <td>
              <code>#0001</code>
            </td>
            <td>
              <code>1</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>42</code>
            </td>
            <td>
              <code>#0042</code>
            </td>
            <td>
              <code>42</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>13705</code>
            </td>
            <td>
              <code>#13705</code>
            </td>
            <td>
              <code>13705</code>
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Ids longer than four digits are not truncated; the padding simply stops applying. When you
        call the contract or the API, pass the plain number without the hash and without leading
        zeros.
      </p>

      <h2 id="counter">totalNodes is also the count</h2>
      <p>
        Since ids are sequential and never reused, <code>totalNodes()</code> is both the highest id
        issued and the number of nodes that have ever existed. There is no burn, so nothing lowers
        it.
      </p>
      <CodeBlock label="cast">{`cast call $FACTORY "totalNodes()(uint256)"
cast call $FACTORY "nodeInfo(uint256)(address,uint64,uint256,uint256,uint256)" 1`}</CodeBlock>
      <p>
        The same figure is served as <code>totalNodes</code> by{" "}
        <Link href="/docs/api/stats">GET /api/stats</Link>.
      </p>

      <h2 id="two-ids">Two ids, and when they differ</h2>
      <p>
        The operator&rsquo;s database has its own row identifier for each node, separate from the
        chain id. They usually match, and they are not required to: the database row is created
        when the mint is indexed, while the chain id was assigned when the transaction ran.
      </p>
      <p>
        The API is explicit about which is which. <code>chainNodeId</code> is the number the
        contract knows, and it is the one to pass to <code>withdraw</code> or{" "}
        <code>nodeInfo</code>. When in doubt, trust the chain id, because it is the only one your
        money responds to.
      </p>
      <Callout>
        Anywhere the documentation says &quot;node id&quot; without qualification, it means the
        chain id. That is the number displayed as <code>#0001</code> and the number the contract
        accepts.
      </Callout>

      <h2 id="order">What an id does not tell you</h2>
      <ul>
        <li>
          It does not confer priority. A low id is not paid first, more, or sooner than a high one.
        </li>
        <li>
          It does not indicate value. Rounds credit active nodes; the id plays no part in the
          amount.
        </li>
        <li>
          It is not scarce in any enforced way. There is no fixed supply of nodes, and no cap on{" "}
          <code>totalNodes</code>.
        </li>
      </ul>
      <p>
        If any of those properties would change your decision to deploy, read{" "}
        <Link href="/docs/risks">Risks</Link> before you spend anything.
      </p>
    </DocPage>
  );
}
