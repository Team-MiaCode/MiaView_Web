"use client";

import { useEffect, useRef, useState } from "react";
import { createPreview } from "../sdk/index.mjs";

// loadResources(chartId, signal) returns { maidata, audio?, cover?, video? }.
// Keep loadResources stable while the selected work stays the same.
export function ChartPreview({ chartId, loadResources, onPlaying }) {
  const container = useRef(null);
  const notify = useRef(onPlaying);
  const [result, setResult] = useState(null);
  const current = result?.chartId === chartId ? result : null;

  useEffect(() => { notify.current = onPlaying; }, [onPlaying]);
  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    let preview;
    try {
      preview = createPreview(container.current, { layout: "fit", diagnostics: false,
        resolution: { width: 1080, height: 1080 } });
    } catch (error) {
      setResult({ chartId, status: error.message });
      return;
    }
    const update = patch => {
      if (signal.aborted) return;
      setResult(previous => ({
        ...(previous?.preview === preview ? previous : {}),
        chartId, preview, ...patch,
      }));
    };
    const stopProgress = preview.on("progress", event => update({ status: event.stage }));
    const stopPlaying = preview.on("playing", event => notify.current?.(chartId, event));
    const stopError = preview.on("error", event => update({ status: event.message }));
    update({ status: "正在初始化预览" });
    void (async () => {
      try {
        const [resources] = await Promise.all([loadResources(chartId, signal), preview.ready]);
        if (signal.aborted) return;
        const info = await preview.load(resources);
        update({ info, status: info.title });
      } catch (error) {
        update({ status: error.message });
      }
    })();
    return () => {
      abort.abort();
      stopProgress();
      stopPlaying();
      stopError();
      preview.destroy();
    };
  }, [chartId, loadResources]);

  async function selectDifficulty(event) {
    const { preview, info } = current;
    const id = Number(event.target.value);
    setResult(previous => ({ ...previous, switching: true }));
    try {
      const selected = await preview.selectDifficulty(id);
      setResult(previous => previous?.preview === preview
        ? { ...previous, switching: false, info: { ...info, difficultyId: selected.difficultyId } }
        : previous);
    } catch (error) {
      setResult(previous => previous?.preview === preview
        ? { ...previous, switching: false, status: error.message }
        : previous);
    }
  }

  return (
    <section style={{ containerType: "inline-size" }}>
      <div ref={container} style={{ height: "min(72dvh, 100cqw * 865 / 741)" }} />
      <label>
        难度
        <select value={current?.info?.difficultyId ?? ""} disabled={!current?.info || current.switching}
          onChange={selectDifficulty}>
          {current?.info?.charts.map(chart => <option key={chart.id} value={chart.id}>{chart.label}</option>)}
        </select>
      </label>
      <p role="status">{current?.status}</p>
    </section>
  );
}
