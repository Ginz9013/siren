/**
 * The ELK synchronous wrapper: the one module in this repository that imports
 * elkjs, and the reason `render()` can stay synchronous on top of an engine
 * whose public API only answers through a Promise.
 *
 * ## How it is synchronous
 *
 * elkjs's public entry (`elk-api.js`) posts every request to a worker and
 * resolves a Promise when the worker answers, so the earliest a caller could
 * see a layout is the next microtask. Under Node and bundlers there is no real
 * worker: `lib/elk-worker.min.js` exports a `FakeWorker` that wraps the GWT
 * compiled engine in a `dispatcher`, and its own `postMessage` merely defers
 * `dispatcher.saveDispatch` behind `setTimeout(0)`. This module skips both
 * layers of deferral and calls `dispatcher.saveDispatch` itself. That method
 * runs the command and hands the reply to the worker's `onmessage` before it
 * returns — read off elkjs's source, and measured under Node, headless
 * Chrome and a Vite 8 bundle for both 0.9.3 (the version pinned, Mermaid
 * 12.2.0's own) and 0.12.0 (nook spec issue `01M4V72SN0P6TNYRD3SE2E0VBS`).
 * `elkSync.test.ts` pins it: a microtask and a zero-delay timer queued before the call are both
 * still pending when the result comes back.
 *
 * ## What that costs
 *
 * `FakeWorker`, `dispatcher.saveDispatch` and the `{ cmd, id, graph }`
 * message shape are elkjs internals, not API. The version is pinned exactly in
 * `package.json` for that reason — and to the version Mermaid 12.2.0 bundles,
 * 0.9.3, because the same options under 0.12.0 order nodes differently (nook
 * decisions `01M4VA67HYZZ1PZG49XA30454N` and `01M4VANRC6B2C14NHVC2KRZ9Y8`,
 * rule 3) — and the test above is the alarm an upgrade trips if any of the
 * three moves. The file is also why siren-core must not run inside a Web
 * Worker: there `lib/elk-worker.min.js` takes the other
 * branch of its own export test, installs itself as the worker's
 * `self.onmessage` and exports nothing (not supported; see nook decision
 * `01M4VA67HYZZ1PZG49XA30454N`).
 *
 * The engine is compiled once per process, on first use: about 0.1s for the
 * first layout, then about 20ms for a 40-node graph (measured; nook
 * decision `01M4VA67HYZZ1PZG49XA30454N`). Each layout also leaves a 10ms
 * watchdog timer behind it inside ELK, which is harmless and is not this module's to cancel.
 */
import * as elkWorkerModule from "elkjs/lib/elk-worker.min.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";

export type { ElkExtendedEdge, ElkNode };

/**
 * A graph ELK could not lay out, as Siren's own error rather than whatever
 * the engine threw — a GWT exception object that is not always an `Error` and
 * whose message names Java classes.
 *
 * `render()` converts it to the error-severity diagnostic an author sees, the
 * same way it converts `UnplacedNodesError`; see `attemptLayout` in
 * `index.ts`. It should be unreachable from a document — every graph the
 * shared layout core builds names only nodes it declared — so reaching it is
 * a defect in Siren rather than in the document, and the message says what
 * the engine said so that the defect can be found.
 */
export class LayoutEngineError extends Error {
  constructor(engineMessage: string) {
    super(`The layout engine rejected this diagram: ${engineMessage}. This document cannot be drawn.`);
    this.name = "LayoutEngineError";
  }
}

/** The `FakeWorker` class, whichever way the bundler presented the CommonJS export. */
function fakeWorkerClass() {
  const candidates = [
    elkWorkerModule.Worker,
    elkWorkerModule.default?.Worker,
    elkWorkerModule.default?.default,
  ];
  const found = candidates.find((candidate) => typeof candidate === "function");
  if (found === undefined) {
    throw new LayoutEngineError("elkjs's worker module exported no FakeWorker");
  }
  return found;
}

/** The message of whatever the engine threw: an `Error`, a GWT exception, or a bare value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** The engine, compiled and registered on first use, then reused for the life of the process. */
let engine: ((message: Record<string, unknown>) => unknown) | undefined;

function elk(): (message: Record<string, unknown>) => unknown {
  if (engine !== undefined) return engine;
  const worker = new (fakeWorkerClass())();
  // A holder rather than a bare `let`: the reply is written from inside the
  // callback, which control-flow analysis cannot see.
  const inbox: { reply?: { data?: unknown; error?: unknown } } = {};
  worker.onmessage = (message) => {
    inbox.reply = message.data;
  };
  let nextId = 0;
  const call = (message: Record<string, unknown>): unknown => {
    inbox.reply = undefined;
    worker.dispatcher.saveDispatch({ data: { ...message, id: nextId++ } });
    const reply = inbox.reply as { data?: unknown; error?: unknown } | undefined;
    if (reply === undefined) {
      // The alarm in its production form: an elkjs that stopped answering
      // inside `saveDispatch` fails here, loudly, rather than handing back
      // an unlaid-out graph.
      throw new LayoutEngineError("elkjs did not answer synchronously");
    }
    if (reply.error !== undefined) throw new LayoutEngineError(messageOf(reply.error));
    return reply.data;
  };
  call({ cmd: "register", algorithms: ["layered"] });
  engine = call;
  return engine;
}

/**
 * Lays out an ELK JSON graph and returns it laid out, synchronously.
 *
 * The graph handed in is copied first, because ELK writes its answer into
 * the very object it was given, and a caller's input should not change under
 * it. Throws `LayoutEngineError` for a graph the engine rejects.
 */
export function layoutWithElk(graph: ElkNode): ElkNode {
  const copy = structuredClone(graph);
  return elk()({ cmd: "layout", graph: copy, layoutOptions: {}, options: {} }) as ElkNode;
}
