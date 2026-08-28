import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {AdminGate} from "@/app/admin/AdminGate";
import {CaForm} from "@/app/admin/CaForm";
import {
  AlertsPanel,
  CountsPanel,
  DiscoveryPanel,
  MoneyPanel,
  PayoutsPanel,
  SalesPanel,
  WorkerPanel,
} from "@/app/admin/panels";
import {Passkeys} from "@/app/admin/Passkeys";
import {SettingsForm} from "@/app/admin/SettingsForm";
import {TiersForm} from "@/app/admin/TiersForm";
import {SignOut} from "@/app/admin/SignOut";
import {BuyersTable, DistributionsTable, WithdrawalsTable, TierMoneyTable} from "@/app/admin/tables";
import {Panel} from "@/components/ui/Panel";
import {adminConfigured, isAdmin} from "@/lib/admin";
import {hasPasskeys} from "@/lib/passkeys";
import {adminSnapshot} from "@/lib/adminData";

/**
 * The internal console (spec 14).
 *
 * Rendered on every request: a cached view of liquidity is worse than no view.
 * Nothing here is animated and nothing reveals on scroll; this is the page
 * somebody opens when they need a number immediately.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: {index: false, follow: false},
};

export default async function AdminPage() {
  // With no ADMIN_KEY the surface behaves as if it was never built.
  if (!adminConfigured()) notFound();

  if (!(await isAdmin())) {
    // A database that cannot be read must not remove the key form: the console
    // has to stay reachable exactly when something is broken.
    let enrolled = false;
    try {
      enrolled = await hasPasskeys();
    } catch {
      enrolled = false;
    }

    return (
      <div className="shell flex flex-col gap-6 py-16">
        <h1 className="h2">Admin</h1>
        <AdminGate passkeysEnrolled={enrolled} />
      </div>
    );
  }

  const snapshot = await adminSnapshot();
  const settings = snapshot.settings;

  // Remounts the form whenever the stored values change, so a refresh after
  // saving shows the truth instead of stale local state.
  const settingsKey = settings
    ? [
        settings.config.enabled,
        settings.config.mode,
        settings.config.minDelaySec,
        settings.config.maxDelaySec,
        settings.config.minAmountWei,
        settings.config.maxAmountWei,
        settings.config.dailyCapWei,
      ].join("|")
    : "unavailable";

  return (
    <div className="shell flex flex-col gap-6 py-12 sm:py-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="mono-label">Internal console</span>
          <h1 className="h2 mt-1">Admin</h1>
        </div>
        <SignOut />
      </header>

      <AlertsPanel snapshot={snapshot} />

      <Section
        title="Launch"
        note="The one control that has to work under pressure. Publishing the address here puts it in the site header without a deploy."
      />
      <CaForm />

      <Section
        title="Tiers"
        note="What each tier costs, how many one wallet may hold, what it must hold in SITOWISE, and how fast it accrues."
      />
      <TiersForm contractCap={snapshot.chain.ok ? Number(snapshot.chain.data.maxPerWallet) : null} />
      <TierMoneyTable rows={snapshot.tierMoney} />

      <Section
        title="Money"
        note="What the contract holds, what came in from sales, and what has gone out to holders."
      />
      <MoneyPanel snapshot={snapshot} />
      <SalesPanel snapshot={snapshot} />
      <PayoutsPanel snapshot={snapshot} />

      <Section
        title="Who is buying"
        note="Grouped by paying wallet, largest holder first. Click a wallet to open it on Blockscout."
      />
      <BuyersTable rows={snapshot.buyers} />
      <CountsPanel snapshot={snapshot} />

      <Section
        title="Machinery"
        note="Payment discovery, the distribution worker, and the settings that drive it. Look here when a number above stops moving."
      />
      <DiscoveryPanel snapshot={snapshot} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <WorkerPanel snapshot={snapshot} />
        <Panel label="Distribution settings" padding="none">
          {settings ? (
            <SettingsForm
              key={settingsKey}
              enabled={settings.config.enabled}
              mode={settings.config.mode}
              minDelaySec={settings.config.minDelaySec}
              maxDelaySec={settings.config.maxDelaySec}
              minAmountWei={settings.config.minAmountWei.toString()}
              maxAmountWei={settings.config.maxAmountWei.toString()}
              dailyCapWei={settings.config.dailyCapWei.toString()}
              overridden={settings.overridden}
            />
          ) : (
            <p className="px-5 py-6 text-[14px] text-red">
              Settings are unreadable: {snapshot.settingsError ?? "unknown error"}
            </p>
          )}
        </Panel>
      </div>

      {settings && settings.problems.length > 0 ? (
        <Panel label="Ignored settings">
          <ul className="flex flex-col gap-2 text-[14px] text-muted">
            {settings.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Section title="History" note="The last fifty of each, newest first." />
      <DistributionsTable rows={snapshot.distributions} />
      <WithdrawalsTable rows={snapshot.withdrawals} />

      <Section title="Access" note="How you get into this console." />
      <Passkeys />
    </div>
  );
}

/**
 * A labelled divider between groups of panels.
 *
 * The console had grown to a dozen panels in one flat column, where finding the
 * right one meant reading all of them. The note under each heading says what
 * the group is for, so a panel can be skipped without being read.
 */
function Section({title, note}: {title: string; note?: string}) {
  return (
    <div className="mt-4 flex flex-col gap-1 border-t border-line-dark pt-6 first:mt-0">
      <h2 className="text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>
      {note ? <p className="max-w-[68ch] text-[13.5px] leading-[1.5] text-muted">{note}</p> : null}
    </div>
  );
}
