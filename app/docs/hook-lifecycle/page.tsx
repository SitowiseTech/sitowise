import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {FlowSchematic} from "@/components/docs/charts/FlowSchematic";
import {
  CREATE2_FACTORY,
  DEFAULT_HOOK_SHARE_BPS,
  HOOK_FLAG_MASK,
  HOOK_REQUIRED_FLAGS,
  POOL_MANAGER,
  POSITION_MANAGER,
} from "@/components/docs/protocol";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "The hook lifecycle",
  description:
    "Mining a hook address, deploying it, initialising a pool that names it, accruing on every swap, and sweeping into the factory.",
};

export default function HookLifecyclePage() {
  return (
    <DocPage
      href="/docs/hook-lifecycle"
      lede={
        <>
          A Uniswap v4 hook has a stricter life than an ordinary contract. Its address encodes its
          permissions, its pools choose it at birth and can never change it, and it only ever runs
          inside somebody else&rsquo;s transaction. Here is that lifecycle end to end.
        </>
      }
    >
      <Callout tone="warn" title="None of this has happened yet">
        The hook is not deployed. There is no hook address on Robinhood Chain, no pool names it,
        and no figure anywhere on this site comes from swap flow. This page describes the intended
        design and the constraints it has to satisfy, not something currently running. What funds
        rewards today is on <Link href="/docs/accrual">How accrual works</Link>.
      </Callout>

      <h2 id="stages">The five stages</h2>
      <ol>
        <li>
          <strong>Mine an address.</strong> v4 reads permissions from the low bits of the hook
          address, so the address has to be ground out before deployment.
        </li>
        <li>
          <strong>Deploy to it.</strong> Through CREATE2, with the salt that produces that exact
          address.
        </li>
        <li>
          <strong>Initialise pools that name it.</strong> A pool commits to its hook at{" "}
          <code>initialize</code> and never again.
        </li>
        <li>
          <strong>Accrue.</strong> Every swap through such a pool calls{" "}
          <code>afterSwap</code> and leaves a share behind.
        </li>
        <li>
          <strong>Sweep.</strong> The accrued value is pushed into the factory as payout
          liquidity.
        </li>
      </ol>

      <DocFigure caption="Stages three through five, with launch-period funding shown as the branch it is.">
        <FlowSchematic />
      </DocFigure>

      <h2 id="address">1. The address is the permission set</h2>
      <p>
        Uniswap v4 does not ask a hook which callbacks it wants. It reads them from the low 14 bits
        of the hook&rsquo;s own address. A contract deployed to the wrong address is not a
        misconfigured hook, it is a hook that v4 silently never calls.
      </p>
      <p>
        Sitowise needs two flags: <code>afterSwap</code>, and{" "}
        <code>afterSwapReturnDelta</code> because taking value from the pool means returning a
        non-zero delta. Together they are <code>{HOOK_REQUIRED_FLAGS}</code>.
      </p>
      <CodeBlock label="The address constraint">{`uint160(address(hook)) & ${HOOK_FLAG_MASK} == ${HOOK_REQUIRED_FLAGS}

AFTER_SWAP_FLAG               = 1 << 6   // 0x40
AFTER_SWAP_RETURNS_DELTA_FLAG = 1 << 2   // 0x04`}</CodeBlock>
      <p>
        The constructor calls <code>Hooks.validateHookPermissions</code> against its own address,
        so a deployment to a wrong address reverts instead of quietly producing a dead hook. That
        check costs one deployment and removes an entire class of silent failure.
      </p>

      <h2 id="deploy">2. Deploying to a mined address</h2>
      <p>
        Only CREATE2 gives a predictable address, so the deploy script grinds salts locally until
        the resulting address carries the right low bits, then deploys through the standard
        deterministic factory at <code>{CREATE2_FACTORY}</code> and asserts that the deployed
        address equals the mined one.
      </p>
      <CodeBlock label="contracts, deploying the hook">{`export FACTORY_ADDRESS=0x...        # the SitowiseFactory
export OWNER_ADDRESS=0x...
export HOOK_SHARE_BPS=${DEFAULT_HOOK_SHARE_BPS}             # optional, cap 500

forge script script/DeployHook.s.sol:DeployHook \\
  --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast`}</CodeBlock>
      <p>
        <code>POOL_MANAGER</code> defaults to the Robinhood Chain v4 PoolManager, which is verified
        on the explorer under that name. The v4 PositionManager at{" "}
        <code>{POSITION_MANAGER}</code> reports the same address from <code>poolManager()</code>,
        which is how it was confirmed rather than assumed.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Contract</th>
            <th>Address on Robinhood Chain</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Uniswap v4 PoolManager</td>
            <td>
              <code>{POOL_MANAGER}</code>
            </td>
          </tr>
          <tr>
            <td>Uniswap v4 PositionManager</td>
            <td>
              <code>{POSITION_MANAGER}</code>
            </td>
          </tr>
          <tr>
            <td>CREATE2 deterministic factory</td>
            <td>
              <code>{CREATE2_FACTORY}</code>
            </td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="attach">3. Pools choose their hook once</h2>
      <Callout tone="warn">
        A v4 pool&rsquo;s hook is part of its <code>PoolKey</code>, which is fixed when the pool is
        initialised. There is no function to attach a hook to a pool afterwards, and none can
        exist: changing the key would make it a different pool. The only way Sitowise earns from
        swap flow is for pools to be created with <code>PoolKey.hooks</code> set to the hook
        address, and for traders to use them.
      </Callout>
      <p>
        This is the single fact that decides whether the protocol is swap funded or not, which is
        why it appears on this page, on <Link href="/docs/accrual">How accrual works</Link>, in the
        contract&rsquo;s own comments, and on <Link href="/docs/risks">Risks</Link>. Until those
        pools exist and carry volume, rewards are funded by Sitowise.
      </p>

      <h2 id="accrue">4. Accrual, per swap</h2>
      <p>
        Once a pool is live on the hook, every swap through it runs the same short path: measure
        the unspecified side, compute the share, take it from the manager, add it to the
        per-currency cumulative total, emit <code>SwapAccrued</code>, return the delta. It adds a
        few thousand gas to a swap and cannot revert the swap for any reason other than a genuine
        accounting failure.
      </p>

      <h2 id="sweep">5. Sweeping into the factory</h2>
      <p>
        Accrued native value would sit on the hook until somebody swept it.{" "}
        <code>sweepNative()</code> is permissionless and always sends to the factory through{" "}
        <code>fund()</code>, so the value lands as unattached contract balance and is booked with a{" "}
        <code>Funded</code> event. A sweep credits nothing by itself: balances only ever move
        through <code>creditBatch</code>, which is a separate, payable call. See{" "}
        <Link href="/docs/settlement">Settlement</Link>.
      </p>
      <CodeBlock label="Sweeping">{`# permissionless, destination fixed in code
cast send $HOOK "sweepNative()" --private-key $ANY_KEY

# owner only, for ERC-20 accruals the factory cannot hold
cast send $HOOK "sweepToken(address)" $TOKEN --private-key $OWNER_KEY`}</CodeBlock>
      <p>
        After the sweep, <code>accrued</code> is unchanged: it is a lifetime total, not a balance.
        The difference between it and the hook&rsquo;s current balance is what has already been
        swept.
      </p>

      <h2 id="admin">What the hook owner can change</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Call</th>
            <th>Effect</th>
            <th>Bound</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>setShareBps</code>
            </td>
            <td>Changes the share taken per swap</td>
            <td>
              Cannot exceed <code>MAX_SHARE_BPS</code>, which is a constant
            </td>
          </tr>
          <tr>
            <td>
              <code>setFactory</code>
            </td>
            <td>
              Changes where <code>sweepNative</code> sends value
            </td>
            <td>Cannot be the zero address</td>
          </tr>
          <tr>
            <td>
              <code>setSweepRecipient</code>
            </td>
            <td>Changes where token accruals are sent</td>
            <td>Cannot be the zero address</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        There is no owner call that pulls native value out of the hook to an arbitrary address.
        Native value has exactly one exit, and it leads to the factory. The equivalent analysis for
        the factory is on <Link href="/docs/security-model">Security model</Link>.
      </p>
    </DocPage>
  );
}
