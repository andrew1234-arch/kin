/**
 * Runs `fn` after every earlier call has finished. The demo keeper, public launches and the sandbox all send from
 * the same admin key; running their transactions one at a time keeps them from picking the same nonce.
 */
let adminQueue: Promise<unknown> = Promise.resolve();
export function withAdminLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = adminQueue.then(fn);
  adminQueue = run.catch(() => undefined);
  return run;
}
