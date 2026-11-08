# Kin: Vibeathon 02 scorecard

Scored on 6 Nov 2026 against the official rules post, [blog.vibestarter.xyz/vibeathon-02](https://blog.vibestarter.xyz/vibeathon-02).
The rubric below was read through a fetch tool that summarises pages, so the weights and short phrases are
reliable but the wording is not guaranteed verbatim. **Owner: paste the exact text from the post over this
section before the freeze.**

## Rules that decide the outcome

- **Build window closes Mon 9 Nov 2026, 22:00 UTC.** Submissions are editable until then.
- **Required by then:** "a working MVP that people can actually use, with a live URL". Kin has **no live URL**.
- Judging and the holder vote run 9–16 Nov. Final score = the average of every scorecard: each judge's card,
  plus one holders' card. On the holders' card the most-voted entry scores 100, others score in proportion to
  their votes, and entries with no votes score 10.
- Prizes: 1st $500, 2nd $250, 3rd $125, 4th $75, 5th $50 (plus Starter Card points); 6th–10th get points only.
  No guaranteed raise. Strong entries may be invited to raise, and anyone invited commits to launching on Vibestarter.
- Spirit: net-new products (Kin was started on 3 Nov, inside the build window).
- Theme "Night shift" is described as artwork only; the post names no theme criterion.

## Judges' rubric

| Criterion (weight) | Top score means | Kin today | Evidence a judge can find | Gap → action |
|---|---|---|---|---|
| **Execution (30%)**: does it work end to end? | Live URL, the whole flow works on a real network | Works end to end **only on a local chain**. Nothing deployed. | `contracts/` 53 tests, `engine/` 57 tests, local e2e of both launch modes in BUILD_LOG | **Critical.** Deploy contracts to Base Sepolia (`engine/scripts/real-sepolia.sh`), host the engine (`engine/Dockerfile`), deploy `web/` to Vercel, run one real launch and one sandbox run, and link the transactions. |
| **Launch potential (25%)**: would people back it? | A real problem, measured on real data, with named users | Problem is stated (bundled Clanker launches), but **no real Base number exists**: replay and Gate A not run | `README.md` pitch; `/replay` page is empty | **High.** Run `engine/scripts/real-mainnet.sh` (needs an Alchemy Base key) so `/replay` shows the share of early buys that came from linked entities on real Clanker launches. Name the user: Base token creators who want a fair launch, and their buyers. |
| **Originality (20%)** | Something new, not a copy of an existing launchpad | Strong: entity caps instead of wallet caps; instant launches (no registration: funding traced at buy time, EIP-712 permit checked by the hook); allowlist mode with evidence hash committed before the window and disputes; v4 hook + vault | Contracts, `/receipt` Fairness Receipt, evidence files | Low. Now clusters with the weighted Nuno engine (below), not a single heuristic. |
| **Craft and UX (15%)** | Polished, clear, works on a phone | Full web app built; verified only against a local chain | `web/` pages, `web/e2e` | Medium. Smoke-test the live site with a real wallet on Base Sepolia, on a phone. |
| **Vibecoding leverage (10%)** | Shows how AI tools were used | Strong: every session logged with tool, prompt and what changed by hand | `BUILD_LOG.md` | Low. Keep logging. |

**Holders' card** (counts as one judge's card): holders pick the one entry they would back. With no votes, Kin scores 10
on that card. Action: post the live URL, the replay numbers and a sandbox run where $VIBES holders will see them during 9–16 Nov.

## Against Vibeathon 01's winners

- 1st, Corvo Edge: a chat-first trading terminal. 2nd, Onetoken: "a permissionless token launchpad on Uniswap V4"
  pitched as "no gatekeeping, no allowlist, no waiting on approval", with no anti-bundling claims. Both went on to raises.
- A registration step was Kin's weakest point next to Onetoken's pitch. Instant mode removes it: a buyer connects and
  buys, and the entity cap is applied at buy time. Kin's differentiator over a plain v4 launchpad is the one thing
  Onetoken does not claim: linked wallets share one cap, enforced in the pool.
- The rules require a usable MVP at a live URL. Kin still has none, and that outweighs any feature.

## Honest position

With no live URL and no real-network numbers, Kin currently misses the one hard requirement and the two
heaviest criteria (55% of the judges' score). No placement prediction until both are closed and this card is re-scored.

## Re-score checkpoints

- [ ] After the Sepolia deploy and live URL
- [ ] After the first real-mainnet replay
- [ ] Mon 9 Nov 16:00 UTC at the latest (6 h before the freeze): re-score everything, then only close gaps
