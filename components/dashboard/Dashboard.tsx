"use client";

import {useCallback, useMemo, useState} from "react";
import {AccountBar} from "@/components/dashboard/AccountBar";
import {ActivityFeed} from "@/components/dashboard/ActivityFeed";
import {CoverPanel} from "@/components/dashboard/CoverPanel";
import {ConnectScreen, LoadingScreen, SignScreen} from "@/components/dashboard/GateScreens";
import {DeployModal} from "@/components/dashboard/DeployModal";
import {ErrorPanel} from "@/components/dashboard/ErrorPanel";
import {Metrics} from "@/components/dashboard/Metrics";
import {NetworkBanner} from "@/components/dashboard/NetworkBanner";
import {NodeList} from "@/components/dashboard/NodeList";
import {
  WalletProvider,
  useWallet,
  type WalletPhase,
} from "@/components/dashboard/WalletProvider";
import {
  WithdrawModal,
  type WithdrawMode,
  type WithdrawTarget,
} from "@/components/dashboard/WithdrawModal";
import {
  useDashboardData,
  type DashNode,
  type WithdrawalApplied,
} from "@/components/dashboard/useDashboardData";
import {Button} from "@/components/ui/Button";
import {Callout} from "@/components/ui/Callout";
import {nodeLabel} from "@/lib/format";

/**
 * The dashboard, driven by the wallet state machine in WalletProvider:
 *
 *   starting              -> skeletons
 *   disconnected/connecting -> pick a wallet
 *   unsigned/signing      -> sign in
 *   ready                 -> the screens below, which then have their own
 *                            loading, error and populated states
 *
 * Data loading lives one component deeper than the phase switch so that the
 * hooks in `useDashboardData` are never mounted without an address.
 *
 * There is no separate empty screen any more. A signed-in wallet holding
 * nothing gets the same furniture as a wallet holding fifty nodes, with
 * the contract's zeros in it: the metrics, the node list and the activity feed
 * are all rendered, and the node list says in as many words that nothing has
 * been deployed. Nothing on the page is invented to fill the space.
 */

function toTarget(node: DashNode): WithdrawTarget {
  return {nodeId: node.id, chainNodeId: node.chainNodeId};
}

function UnsyncedNotice({
  ids,
  onRegister,
  registering,
}: {
  ids: bigint[];
  onRegister: () => void;
  registering: boolean;
}) {
  const many = ids.length > 1;
  return (
    <Callout
      tone="warn"
      title={many ? `${ids.length} nodes are not registered yet` : "One node is not registered yet"}
    >
      <p>
        The contract shows {many ? "nodes" : "node"}{" "}
        <span className="font-mono text-ink">
          {ids.map((id) => `NODE ${nodeLabel(id.toString())}`).join(", ")}
        </span>{" "}
        under this wallet, and the ledger has no record of {many ? "them" : "it"}. Register{" "}
        {many ? "them" : "it"} so {many ? "they" : "it"} can start accruing.
      </p>
      <Button variant="ghost" size="sm" className="mt-3" onClick={onRegister} loading={registering}>
        Register {many ? "nodes" : "node"}
      </Button>
    </Callout>
  );
}

function SignedIn({address}: {address: `0x${string}`}) {
  const {sessionLost} = useWallet();
  const data = useDashboardData(address, sessionLost);
  // `all` is one `withdrawAll` transaction over every node the wallet holds,
  // `single` is one `withdraw` over the node whose row was clicked. The targets
  // are carried either way so the rows can be decremented by what the receipt
  // reports.
  const [withdraw, setWithdraw] = useState<{mode: WithdrawMode; targets: WithdrawTarget[]} | null>(
    null,
  );
  const [deployOpen, setDeployOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(async () => {
    setRetrying(true);
    await data.refresh();
    setRetrying(false);
  }, [data]);

  // Every node, not only the ones showing a balance: `withdrawAll` empties the
  // lot, including a node credited between this render and the transaction.
  const allTargets = useMemo(() => data.nodes.map(toTarget), [data.nodes]);

  // Zero the rows as each node lands (spec 5.3). Reconciling with the server
  // waits until the modal closes: a 25-node run would otherwise fire 25
  // refreshes, each one racing the next optimistic update.
  const onWithdrawn = useCallback(
    (applied: WithdrawalApplied[]) => data.applyWithdrawals(applied),
    [data],
  );

  const closeWithdraw = useCallback(() => {
    setWithdraw(null);
    void data.refresh();
  }, [data]);

  const closeDeploy = useCallback(() => setDeployOpen(false), []);
  const onDeployed = useCallback(() => void data.refresh(), [data]);

  if (data.status === "loading") return <LoadingScreen />;

  if (data.status === "error") {
    return (
      <div className="flex flex-col gap-6 py-10">
        <ErrorPanel
          message={data.error ?? "The dashboard could not be loaded."}
          onRetry={() => void retry()}
          retrying={retrying}
        />
      </div>
    );
  }

  // A minted node the ledger has not seen still counts against the contract's
  // per-wallet cap, so the deploy button has to count it too.
  const ownedCount = data.totals.count + (data.unsynced?.length ?? 0);

  return (
    <div className="flex flex-col gap-6 py-10">
      <AccountBar
        nodeCount={ownedCount}
        limit={data.limit}
        onDeploy={() => setDeployOpen(true)}
      />

      {data.unsynced && data.unsynced.length > 0 ? (
        <UnsyncedNotice
          ids={data.unsynced}
          onRegister={() => void data.registerUnsynced()}
          registering={data.registering}
        />
      ) : null}

      <Metrics
        totals={data.totals}
        limit={data.limit}
        ethUsd={data.ethUsd}
        onWithdrawAll={() => setWithdraw({mode: "all", targets: allTargets})}
      />

      <NodeList
        nodes={data.nodes}
        details={data.details}
        detailErrors={data.detailErrors}
        ethUsd={data.ethUsd}
        onWithdraw={(node) => setWithdraw({mode: "single", targets: [toTarget(node)]})}
        onLoadDetail={(node) => void data.loadDetail(node.id, node.cumulativeWei)}
        onDeploy={() => setDeployOpen(true)}
        canDeploy={ownedCount < data.limit}
      />

      <ActivityFeed items={data.feed} loading={data.detailsLoading} ethUsd={data.ethUsd} />

      {/* Last, deliberately. It is the answer to a question the page raises
          rather than one it opens with: everything above says what you are
          owed, and this says whether it is actually there. */}
      <CoverPanel ethUsd={data.ethUsd} />

      <WithdrawModal
        open={withdraw !== null && withdraw.targets.length > 0}
        mode={withdraw?.mode ?? "single"}
        targets={withdraw?.targets ?? []}
        onClose={closeWithdraw}
        onWithdrawn={onWithdrawn}
      />

      <DeployModal open={deployOpen} onClose={closeDeploy} onDeployed={onDeployed} />
    </div>
  );
}

/** The wrong-network banner sits above every connected phase, not just the last one. */
function Screens() {
  const {phase, address} = useWallet();

  return (
    <>
      <NetworkBanner />
      <Phase phase={phase} address={address} />
    </>
  );
}

function Phase({
  phase,
  address,
}: {
  phase: WalletPhase;
  address: `0x${string}` | null;
}) {
  switch (phase) {
    case "starting":
      return <LoadingScreen />;
    case "disconnected":
    case "connecting":
      return <ConnectScreen />;
    case "unsigned":
    case "signing":
      return <SignScreen />;
    case "ready":
      // `ready` is only reachable with an address; the guard keeps that
      // invariant checkable rather than assumed.
      return address ? <SignedIn address={address} /> : <ConnectScreen />;
  }
}

export function Dashboard() {
  return (
    <WalletProvider>
      <Screens />
    </WalletProvider>
  );
}
