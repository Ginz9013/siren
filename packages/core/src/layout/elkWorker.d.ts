/**
 * The one elkjs file Siren loads, typed by hand because elkjs ships no
 * declarations for its minified worker (`lib/elk-worker.d.ts` describes the
 * unminified `elk-worker.js` and says nothing useful). Only the shape
 * `elkSync.ts` drives is described: the `FakeWorker` class the file exports
 * under Node and bundlers, and the dispatcher that class wraps.
 *
 * Read off elkjs's own source, 0.9.3 and 0.12.0 alike (the tail of
 * `lib/elk-worker.min.js`):
 * outside a real Web Worker the file assigns
 * `module.exports = { default: FakeWorker, Worker: FakeWorker }`, and a
 * `FakeWorker` holds a `dispatcher` whose `saveDispatch({ data })` runs the
 * command and calls the worker's `onmessage` with the reply **before it
 * returns** — the synchronous path `elkSync.ts` exists to use.
 */
declare module "elkjs/lib/elk-worker.min.js" {
  /** One reply the dispatcher posts back: the request's id, and its data or its error. */
  export interface ElkWorkerReply {
    id: number;
    data?: unknown;
    error?: unknown;
  }

  /** elkjs's in-process stand-in for a Web Worker. */
  export class FakeWorker {
    constructor();
    /** Called with every reply, synchronously from inside `saveDispatch`. */
    onmessage: (message: { data: ElkWorkerReply }) => void;
    dispatcher: {
      /** Runs one command now; an exception is posted back as `{ error }` rather than thrown. */
      saveDispatch(message: { data: Record<string, unknown> }): void;
    };
  }

  const elkWorkerModule: { default?: typeof FakeWorker; Worker?: typeof FakeWorker };
  export default elkWorkerModule;
  export const Worker: typeof FakeWorker | undefined;
}
