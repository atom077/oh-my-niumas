import { useCallback, useEffect, useRef, useState } from "react";

export function useLocalRefresh(
  local: boolean,
  ready: boolean,
  reading: boolean,
  onUpdated: () => void,
  onCancel: () => void,
) {
  const [period, setPeriod] = useState("off"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [hidden, setHidden] = useState(document.visibilityState !== "visible"),
    [settled, setSettled] = useState(0);
  const request = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    onCancel();
  }, [onCancel]);
  useEffect(() => {
    if (!local) {
      setPeriod("off");
      setError("");
    }
    return cancel;
  }, [local, cancel]);
  useEffect(() => {
    const visibility = () => {
      const hide = document.visibilityState !== "visible";
      setHidden(hide);
      if (local) {
        if (hide) cancel();
        else onUpdated();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [cancel, local, onUpdated]);
  const refresh = useCallback(async () => {
    if (!local || hidden || reading || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });
      if (!response.ok)
        throw Error("刷新未成功，保留上次数据；请重试或等待下次刷新");
      if (!controller.signal.aborted) {
        setError("");
        onUpdated();
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "刷新失败，保留上次数据");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        setSettled((n) => n + 1);
      }
    }
  }, [local, hidden, reading, onUpdated]);
  useEffect(() => {
    if (!local || !ready || hidden || busy || reading || period === "off")
      return;
    const timer = window.setTimeout(
      () => void refresh(),
      Number(period) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [local, ready, hidden, busy, reading, period, settled, refresh]);
  const changePeriod = (value: string) => {
    cancel();
    setPeriod(value);
  };
  return { period, changePeriod, busy, error, hidden, refresh };
}
