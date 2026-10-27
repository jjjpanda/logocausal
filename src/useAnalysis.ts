import { useEffect, useRef, useState } from "react";
import AnalysisWorker from "./analysis.worker?worker&inline";
import type { NetworkModel } from "./core/model";
import type { Analysis, WorkerResponse } from "./worker-protocol";

/** One worker, one in-flight request, and only the latest queued topology. */
export default function useAnalysis(model: NetworkModel, generation: number) {
  const [analysis, setAnalysis] = useState<(Analysis & { model: NetworkModel; generation: number }) | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const pending = useRef({ model, generation });
  const send = useRef<(() => void) | null>(null);

  useEffect(() => {
    let worker: Worker;
    try { worker = new AnalysisWorker(); }
    catch { setError("Analysis could not start. Check that this page allows workers, then retry."); return; }
    let requested: { model: NetworkModel; generation: number } | null = null;
    let busy = false;
    let disposed = false;
    const submit = () => {
      if (busy || disposed || (requested?.model === pending.current.model && requested.generation === pending.current.generation)) return;
      requested = pending.current;
      busy = true;
      worker.postMessage(requested.model);
    };
    send.current = submit;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (disposed) return;
      busy = false;
      if (requested!.generation === pending.current.generation) {
        if ("tiers" in event.data) {
          setAnalysis({ ...event.data, ...requested! });
          setError("");
        } else setError(event.data.error);
      }
      submit();
    };
    worker.onerror = event => {
      event.preventDefault();
      disposed = true;
      send.current = null;
      worker.terminate();
      setError("Analysis stopped. Retry to inspect the current circuit.");
    };
    submit();
    return () => { disposed = true; send.current = null; worker.terminate(); };
  }, [attempt]);

  useEffect(() => { pending.current = { model, generation }; send.current?.(); }, [model, generation]);
  return { analysis: analysis?.generation === generation ? analysis : null,
    error, retry: () => setAttempt(value => value + 1) };
}
