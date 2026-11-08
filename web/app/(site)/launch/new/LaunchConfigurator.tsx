"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Copy, Notice } from "@/components/bits";
import { DEPLOYMENT, LAUNCH_CHAIN_ID } from "@/lib/config";
import { chainLabel, useEngine } from "@/lib/engine";
import { REPO_URL } from "@/lib/site";

type Mode = "instant" | "allowlist";

interface Form {
  mode: Mode;
  slug: string;
  name: string;
  symbol: string;
  cap: string;
  fresh: string;
  verified: string;
  regHours: string;
  disputeMin: string;
  startsMin: string;
  windowMin: string;
  lockMin: string;
  minBalance: string;
  freshAgeHours: string;
}

// The admin CLI's own defaults (engine/src/launch/admin.ts), so an untouched form matches a bare `create-instant`
// (fresh pool = the entity cap) or, in allowlist mode, a bare `create` (fresh pool 0.02).
const DEFAULTS: Form = {
  mode: "instant",
  slug: "",
  name: "",
  symbol: "",
  cap: "0.01",
  fresh: "0.01",
  verified: "0.01",
  regHours: "24",
  disputeMin: "30",
  startsMin: "30",
  windowMin: "30",
  lockMin: "60",
  minBalance: "0.0005",
  freshAgeHours: "168",
};

/**
 * The hook's deploy-time limits: from this site's deployment file when it records them, else the Base defaults in
 * contracts/script/DeployKin.s.sol (30 min review, 5 min to 24 h window, lock up to 7 days).
 */
const LIMITS = DEPLOYMENT?.limits ?? { minReviewPeriod: 1800, minWindow: 300, maxWindow: 86_400, maxLock: 604_800, maxCreatorBps: 1000 };
const LIMITS_FROM = DEPLOYMENT?.limits ? "this deployment" : "Kin's Base defaults";

const NUM = /^\d+(\.\d+)?$/;

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(f.slug)) e.slug = "2 to 39 characters: lowercase letters, digits and dashes.";
  else if (f.slug === "new") e.slug = "“new” is reserved by this site.";
  if (!f.name.trim()) e.name = "Required.";
  if (!/^[A-Z0-9]{1,11}$/.test(f.symbol)) e.symbol = "1 to 11 capital letters or digits.";
  const instant = f.mode === "instant";
  const nums = instant
    ? (["cap", "fresh", "startsMin", "windowMin", "lockMin", "freshAgeHours"] as const)
    : (["cap", "fresh", "verified", "regHours", "disputeMin", "windowMin", "lockMin", "freshAgeHours"] as const);
  for (const k of nums) {
    if (!NUM.test(f[k]) || Number(f[k]) <= 0) e[k] = "A positive number.";
  }
  const min = (s: number) => (s >= 60 ? `${s / 60} min` : `${s} s`);
  if (instant) {
    if (!e.startsMin && Number(f.startsMin) * 60 < LIMITS.minReviewPeriod)
      e.startsMin = `At least ${min(LIMITS.minReviewPeriod)}: the hook's review period.`;
  } else {
    if (!NUM.test(f.minBalance)) e.minBalance = "A number, 0 for none.";
    if (!e.verified && !e.cap && Number(f.verified) < Number(f.cap)) e.verified = "Should be at least the entity cap.";
    if (!e.disputeMin && Number(f.disputeMin) * 60 < LIMITS.minReviewPeriod)
      e.disputeMin = `At least ${min(LIMITS.minReviewPeriod)}: the hook's review period.`;
  }
  if (!e.windowMin && Number(f.windowMin) * 60 < LIMITS.minWindow) e.windowMin = `At least ${min(LIMITS.minWindow)}.`;
  if (!e.windowMin && Number(f.windowMin) * 60 > LIMITS.maxWindow) e.windowMin = `At most ${LIMITS.maxWindow / 3600} h.`;
  if (!e.lockMin && Number(f.lockMin) * 60 > LIMITS.maxLock) e.lockMin = `At most ${LIMITS.maxLock / 86_400} days.`;
  return e;
}

/** POSIX single-quote a value for the shell. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function Field({
  id,
  label,
  hint,
  error,
  suffix,
  value,
  onChange,
  inputMode,
  placeholder,
}: {
  id: keyof Form;
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "decimal" | "text";
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={`f-${id}`}>{label}</label>
      <div className="field-input">
        <input
          id={`f-${id}`}
          value={value}
          inputMode={inputMode}
          placeholder={placeholder}
          aria-invalid={!!error || undefined}
          aria-describedby={`f-${id}-hint`}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </div>
      <p id={`f-${id}-hint`} className={error ? "field-error" : "field-hint"}>
        {error ?? hint}
      </p>
    </div>
  );
}

function Cmd({ step, title, cmd, children }: { step: string; title: string; cmd?: string; children: React.ReactNode }) {
  return (
    <li className="cmd">
      <span className="cmd-step mono">{step}</span>
      <div>
        <h3>{title}</h3>
        <p className="muted small">{children}</p>
        {cmd && (
          <div className="cmd-box">
            <pre>
              <code>{cmd}</code>
            </pre>
            <Copy text={cmd} />
          </div>
        )}
      </div>
    </li>
  );
}

export function LaunchConfigurator() {
  const [f, setF] = useState<Form>(DEFAULTS);
  const [touched, setTouched] = useState<Set<keyof Form>>(new Set());
  const engine = useEngine();
  const errors = useMemo(() => validate(f), [f]);
  const ok = Object.keys(errors).length === 0;
  const set = (k: keyof Form) => (v: string) => {
    setTouched((t) => (t.has(k) ? t : new Set(t).add(k)));
    setF((p) => ({ ...p, [k]: k === "symbol" ? v.toUpperCase() : k === "slug" ? v.toLowerCase() : v }));
  };
  // The verified cap is checked against the entity cap, so editing either one surfaces its error.
  const show = (k: keyof Form) => (touched.has(k) || (k === "verified" && touched.has("cap")) ? errors[k] : undefined);
  const tokenIncomplete = !!(errors.name || errors.symbol || errors.slug);

  const slug = f.slug || "<slug>";
  const instant = f.mode === "instant";
  const createInstant = ok
    ? `bun run admin create-instant ${f.slug} ${q(f.name.trim())} ${f.symbol} ${f.cap} ${f.fresh} ${f.startsMin} ${f.windowMin} ${f.lockMin} ${f.freshAgeHours}`
    : undefined;
  const create = ok
    ? `bun run admin create ${f.slug} ${q(f.name.trim())} ${f.symbol} ${f.cap} ${f.fresh} ${f.regHours} ${f.windowMin} ${f.lockMin} ${f.disputeMin} ${f.verified} ${f.minBalance} ${f.freshAgeHours}`
    : undefined;
  const chain = chainLabel(LAUNCH_CHAIN_ID);
  const engineState =
    engine.status === "ok" ? "connected" : engine.status === "loading" ? "checking" : engine.status === "offline" ? "not reachable" : "not configured";

  return (
    <div className="newlaunch">
      <header className="newlaunch-head">
        <p className="eyebrow">
          <span className="dot" /> Launch with Kin
        </p>
        <h1>Set up a fair launch.</h1>
        <p className="lede">
          Choose how much one entity can buy, when the capped window opens and how long window buys stay locked. Kin
          generates the exact commands that create and deploy the launch.
        </p>
      </header>

      <Notice tone="warn">
        <strong>Launch creation is operator-run today.</strong> There is no self-serve form or public create endpoint
        yet: a launch operator runs the engine&apos;s admin CLI, which holds the launch admin key. This page builds those
        commands from your settings; it does not create anything by itself.
      </Notice>

      <ul className="env-row" aria-label="This site's setup">
        <li>
          <span className="faint">Launch chain</span>
          <strong>
            {chain.name} · {LAUNCH_CHAIN_ID}
          </strong>
        </li>
        <li>
          <span className="faint">Kin contracts on this site</span>
          <strong className={DEPLOYMENT ? "check-ok" : "check-bad"}>{DEPLOYMENT ? "configured" : "not configured"}</strong>
        </li>
        <li>
          <span className="faint">Engine</span>
          <strong className={engine.status === "ok" ? "check-ok" : engine.status === "loading" ? "" : "check-bad"}>{engineState}</strong>
        </li>
      </ul>

      <div className="newlaunch-grid">
        <form className="card newlaunch-form" onSubmit={(e) => e.preventDefault()} noValidate>
          <fieldset>
            <legend>How buyers get their limit</legend>
            <div className="mode-pick" role="radiogroup" aria-label="Launch mode">
              {(
                [
                  ["instant", "Instant", "No registration. Kin checks a wallet's funding when it buys and signs its limit."],
                  ["allowlist", "Allowlist", "Wallets register first. Kin publishes the allowlist and takes disputes before the window."],
                ] as const
              ).map(([m, title, text]) => (
                <button key={m} type="button" role="radio" aria-checked={f.mode === m} className="mode-opt" onClick={() =>
                    setF((p) => ({ ...p, mode: m, fresh: touched.has("fresh") ? p.fresh : m === "instant" ? p.cap : "0.02" }))
                  }>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Token</legend>
            <Field id="name" label="Name" value={f.name} onChange={set("name")} error={show("name")} placeholder="Night Shift" />
            <div className="field-pair">
              <Field id="symbol" label="Symbol" value={f.symbol} onChange={set("symbol")} error={show("symbol")} placeholder="SHIFT" />
              <Field
                id="slug"
                label="Launch URL"
                value={f.slug}
                onChange={set("slug")}
                error={show("slug")}
                hint={`/launch/${slug}`}
                placeholder="night-shift"
              />
            </div>
          </fieldset>
          <fieldset>
            <legend>Limits</legend>
            <Field id="cap" label="Cap per entity" suffix="ETH" inputMode="decimal" value={f.cap} onChange={set("cap")} error={show("cap")} hint="Shared by every wallet in one entity." />
            <Field id="fresh" label="Fresh-wallet pool" suffix="ETH" inputMode="decimal" value={f.fresh} onChange={set("fresh")} error={show("fresh")} hint={instant ? "One limit shared by every new wallet." : "Split evenly between all new wallets."} />
            {!instant && <Field id="verified" label="Verified-human cap" suffix="ETH" inputMode="decimal" value={f.verified} onChange={set("verified")} error={show("verified")} hint="For single verified wallets, when the engine has Base Verify." />}
          </fieldset>
          <fieldset>
            <legend>{instant ? "Fresh wallets" : "Who can register"}</legend>
            <div className="field-pair">
              {!instant && <Field id="minBalance" label="Minimum balance" suffix="ETH" inputMode="decimal" value={f.minBalance} onChange={set("minBalance")} error={show("minBalance")} hint="Makes mass sign-ups cost money. Not spent." />}
              <Field id="freshAgeHours" label="Fresh if newer than" suffix="hours" inputMode="decimal" value={f.freshAgeHours} onChange={set("freshAgeHours")} error={show("freshAgeHours")} hint="Wallets first funded this recently join the fresh pool." />
            </div>
          </fieldset>
          <fieldset>
            <legend>Timing</legend>
            {instant ? (
              <Field id="startsMin" label="Window opens in" suffix="min" inputMode="decimal" value={f.startsMin} onChange={set("startsMin")} error={show("startsMin")} hint="From deploy. Limits are handed out from 10 minutes before." />
            ) : (
              <div className="field-pair">
                <Field id="regHours" label="Registration" suffix="hours" inputMode="decimal" value={f.regHours} onChange={set("regHours")} error={show("regHours")} />
                <Field id="disputeMin" label="Dispute period" suffix="min" inputMode="decimal" value={f.disputeMin} onChange={set("disputeMin")} error={show("disputeMin")} />
              </div>
            )}
            <div className="field-pair">
              <Field id="windowMin" label="Capped window" suffix="min" inputMode="decimal" value={f.windowMin} onChange={set("windowMin")} error={show("windowMin")} />
              <Field id="lockMin" label="Vault lock" suffix="min" inputMode="decimal" value={f.lockMin} onChange={set("lockMin")} error={show("lockMin")} />
            </div>
          </fieldset>
        </form>

        <aside className="newlaunch-side">
          <div className="card summary">
            <p className="eyebrow">What participants get</p>
            <ul>
              {instant ? (
                <li>
                  <strong>No registration.</strong> Connect and buy; Kin traces the wallet&apos;s funding at that moment.
                </li>
              ) : (
                <li>
                  <strong>{f.regHours || "?"} h</strong> to register a wallet by signing a message. Free.
                </li>
              )}
              <li>
                Up to <strong>{f.cap || "?"} ETH</strong> per entity, however many wallets it uses.
              </li>
              <li>
                <strong>{f.fresh || "?"} ETH</strong> {instant ? "shared by all brand-new wallets." : "split evenly between brand-new wallets."}
              </li>
              {instant ? (
                <li>
                  The window opens <strong>{f.startsMin || "?"} min</strong> after deploy. Every limit handed out is public.
                </li>
              ) : (
                <li>
                  <strong>{f.disputeMin || "?"} min</strong> to read the evidence and dispute before buying opens.
                </li>
              )}
              <li>
                A <strong>{f.windowMin || "?"} min</strong> capped window, then <strong>{f.lockMin || "?"} min</strong> in the vault before tokens can be claimed.
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <section className="newlaunch-steps" aria-labelledby="steps-title">
        <h2 id="steps-title">The operator runs these, from <code className="mono">engine/</code></h2>
        <p className="muted small">
          Needs <code className="mono">LAUNCH_RPC_URL</code>, <code className="mono">LAUNCH_CHAIN_ID</code>,{" "}
          <code className="mono">LAUNCH_ADMIN_KEY</code> and <code className="mono">LAUNCH_DEPLOYMENT</code> in the
          engine&apos;s environment. See the{" "}
          <a href={`${REPO_URL}#go-live-base-sepolia--base-mainnet-read-only`} target="_blank" rel="noreferrer">
            go-live runbook
          </a>
          .
        </p>
        {instant ? (
          <ol className="cmds">
            <Cmd step="01" title="Create and deploy the launch" cmd={createInstant}>
              {createInstant
                ? "Creates the launch and deploys the pool in one step, with the rules' hash committed onchain. Also needs PERMIT_SIGNER_KEY: the key the hook accepts permits from."
                : tokenIncomplete
                  ? "Fill in the token details above to generate this command."
                  : "Fix the highlighted fields above to generate this command."}
            </Cmd>
            <Cmd step="02" title="Share the launch page">
              Buyers connect a wallet at <code className="mono">/launch/{slug}</code>. From 10 minutes before the window, each wallet
              gets its limit when it asks: the engine traces its funding, puts it in an entity and signs a 10-minute permit. Keep
              the engine online through the window.
            </Cmd>
            <Cmd step="03" title="After the window" cmd={`bun run admin finalize ${slug}`}>
              Optional. The Fairness Receipt is final at the end of the window and lives at <code className="mono">/receipt/{slug}</code>;
              every limit handed out stays public at <code className="mono">/launches/{slug}/permits</code>.
            </Cmd>
          </ol>
        ) : (
        <ol className="cmds">
          <Cmd step="01" title="Create the launch" cmd={create}>
            {create
              ? "Registration opens immediately."
              : tokenIncomplete
                ? "Fill in the token details above to generate this command."
                : "Fix the highlighted fields above to generate this command."}
          </Cmd>
          <Cmd step="02" title="Share the launch page">
            Participants connect a wallet at <code className="mono">/launch/{slug}</code> and sign to register.
          </Cmd>
          <Cmd step="03" title="Build the allowlist when registration closes" cmd={`bun run admin build ${slug}`}>
            Traces funding, clusters wallets, assigns tiers and caps, and writes the Merkle root and evidence file.
          </Cmd>
          <Cmd step="04" title="Deploy the pool" cmd={`bun run admin deploy ${slug}`}>
            Calls the launch factory with the built root and evidence hash, and publishes a static copy of the launch
            and every proof. The window opens after the dispute period; the hook refuses settings outside its limits
            ({LIMITS_FROM}).
          </Cmd>
          <Cmd step="05" title="Resolve disputes before the window" cmd={`bun run admin resolve ${slug} <disputeId> accept|reject\nbun run admin build ${slug}\nbun run admin update-root ${slug}`}>
            If a dispute is accepted, rebuild and push the new root. A new root restarts the review period, so a late
            change pushes the window back. The root freezes when the window opens.
          </Cmd>
          <Cmd step="06" title="After the window" cmd={`bun run admin finalize ${slug}`}>
            Optional. The Fairness Receipt is final at the end of the window without a transaction and lives at{" "}
            <code className="mono">/receipt/{slug}</code>; finalize only emits the receipt event.
          </Cmd>
        </ol>
        )}
        <div className="ctas">
          <Link className="btn" href="/launch">
            See existing launches
          </Link>
          <Link className="btn btn-ghost" href="/sandbox">
            Watch a bundle hit a Kin pool
          </Link>
        </div>
      </section>
    </div>
  );
}
