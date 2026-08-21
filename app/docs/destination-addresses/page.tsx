import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID} from "@/lib/chain";

export const metadata: Metadata = {
  title: "Destination addresses",
  description:
    "Withdrawing to an address other than the one that owns the node: how the destination is passed, and what will not work.",
};

export default function DestinationAddressesPage() {
  return (
    <DocPage
      href="/docs/destination-addresses"
      lede={
        <>
          A withdrawal can be sent anywhere. The address that owns the node sends the transaction;
          where the ETH lands is a separate argument, typed into the call at the moment you make
          it.
        </>
      }
    >
      <h2 id="two-addresses">Two addresses, two jobs</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Address</th>
            <th>Role</th>
            <th>Checked how</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Node owner</td>
            <td>Authorises the withdrawal by sending the transaction</td>
            <td>
              <code>node.owner == msg.sender</code>, in the contract
            </td>
          </tr>
          <tr>
            <td>Destination</td>
            <td>Receives the ETH</td>
            <td>
              Not checked against anything. It is the <code>to</code> argument you pass.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <CodeBlock label="SitowiseFactory">{`function withdraw(uint256 id, address to) external;
function withdrawAll(address to) external returns (uint256 amount);`}</CodeBlock>
      <p>
        Nothing binds the destination in advance, and nothing needs to. The only authority the
        contract recognises is <code>msg.sender</code>, so a withdrawal sent by anyone other than
        the node owner reverts with <code>NotNodeOwner</code> before the destination matters at
        all. Since you are the one making the call, you are also the one naming the recipient, and
        there is no step in between where it could be swapped.
      </p>

      <h2 id="uses">Why you might use it</h2>
      <ul>
        <li>
          Buying from a hot wallet and sweeping payouts to a cold one, without ever moving the
          node.
        </li>
        <li>Sending to an exchange deposit address, where supported by that exchange.</li>
        <li>Paying out to a shared address for a group that funded the node.</li>
      </ul>
      <p>
        Since a node cannot be transferred, this is the only way to change where value ends up
        without buying a new node. See <Link href="/docs/node-model">Node model</Link>.
      </p>

      <h2 id="rules">Rules the contract enforces</h2>
      <ul>
        <li>
          The destination cannot be the zero address. Passing it reverts with{" "}
          <code>BadInput</code>.
        </li>
        <li>
          The destination must be able to receive ETH. Value is sent with a plain call, so a
          contract without a payable receive or fallback reverts the whole withdrawal with{" "}
          <code>TransferFailed</code>.
        </li>
        <li>
          The contract always sends the node&rsquo;s whole balance. There is no amount argument, so
          the destination receives all of it or the transaction reverts and none of it moves.
        </li>
        <li>
          In <code>withdrawAll</code>, every node the wallet owns pays into the same destination.
          One call, one recipient, one transfer carrying the combined total. To split across
          addresses, make separate <code>withdraw</code> calls.
        </li>
        <li>
          The destination has no bearing on ownership. Sending a payout somewhere does not give
          that address any claim on the node, and the node keeps accruing to the same owner.
        </li>
      </ul>

      <Callout tone="warn" title="Check the address before you send">
        <p>
          The value goes exactly where the call says. There is no reversal, no support desk that
          can recall a transfer, and no recovery of ETH sent to an address you do not control. A
          mistyped address is a permanent loss.
        </p>
        <p>
          Confirm that the address is on Robinhood Chain, chain id {CHAIN_ID}, and that you control
          it there. An address that works on another network is not automatically usable here, and
          exchange deposit addresses in particular are usually chain specific.
        </p>
      </Callout>

      <h2 id="contracts">Sending to a contract</h2>
      <p>
        A contract can receive a withdrawal if it accepts plain ETH transfers. Three things to keep
        in mind:
      </p>
      <ul>
        <li>
          The transfer forwards all remaining gas rather than a fixed stipend, so a receiver doing
          real work will not run out for that reason alone. It will still revert the whole
          withdrawal if its own logic reverts.
        </li>
        <li>
          The contract is reentrancy guarded and the balance is zeroed before the transfer, so a
          receiver that calls back into <code>withdraw</code> gains nothing and gets{" "}
          <code>Reentrancy</code> for trying.
        </li>
        <li>
          Some multisigs and custody contracts refuse plain transfers, and there is no way to tell
          from the address alone. If you are not certain, withdraw one node with a small balance
          first and confirm it arrived before sweeping the rest.
        </li>
      </ul>

      <h2 id="verify">Confirming where it went</h2>
      <p>
        Every payout emits an event naming the destination, so the record is on chain and does not
        depend on this site.
      </p>
      <CodeBlock label="The event">{`event Withdrawn(uint256 indexed id, address indexed to, uint256 amount);`}</CodeBlock>
      <p>
        Both the node id and the destination are indexed, so you can filter by either.{" "}
        <code>withdrawAll</code> emits one <code>Withdrawn</code> per node it emptied, every one of
        them naming the same destination, which is how a sweep stays readable per node afterwards.
        Reading events is described on <Link href="/docs/events">Events</Link>, and the same
        history is available over HTTP from{" "}
        <Link href="/docs/api/node">GET /api/node/:id</Link>.
      </p>
    </DocPage>
  );
}
