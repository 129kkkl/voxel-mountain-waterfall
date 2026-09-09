"use client";

import { useCallback, useState } from "react";
import VoxelLandscape, { type SceneMetrics } from "./VoxelLandscape";

const formatCount = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

export default function Home() {
  const [touring, setTouring] = useState(true);
  const [ready, setReady] = useState(false);
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null);
  const [error, setError] = useState("");

  const handleReady = useCallback((nextMetrics: SceneMetrics) => {
    setMetrics(nextMetrics);
    setReady(true);
  }, []);

  const handleMetrics = useCallback((nextMetrics: SceneMetrics) => {
    setMetrics(nextMetrics);
  }, []);

  const handleError = useCallback((message: string) => {
    setError(message);
    setReady(false);
  }, []);

  return (
    <main className={`experience-shell${ready ? " is-ready" : ""}`} data-testid="experience">
      <VoxelLandscape
        touring={touring}
        onReady={handleReady}
        onMetrics={handleMetrics}
        onError={handleError}
      />

      <div className="cinematic-grade" aria-hidden="true" />
      <div className="edge-fade" aria-hidden="true" />
      <div className="frame-corners" aria-hidden="true">
        <i /><i /><i /><i />
      </div>

      <header className="hero-copy">
        <div className="eyebrow-row">
          <span className="eyebrow">VOXEL LANDSCAPE · 01</span>
          <span className="eyebrow-line" aria-hidden="true" />
        </div>
        <h1>云岫</h1>
        <p>山从雾里醒来，水向云外落去。</p>
        <div className="scene-tags" aria-label="场景特色">
          <span>体素群峰</span>
          <span>双瀑入涧</span>
          <span>山腰云海</span>
        </div>
      </header>

      <aside className="performance-panel" aria-label="实时场景性能">
        <span className="panel-kicker">REAL-TIME</span>
        <div className="performance-primary">
          <strong data-testid="fps-counter">{metrics ? metrics.fps : "—"}</strong>
          <span>FPS</span>
        </div>
        <dl>
          <div>
            <dt>体素</dt>
            <dd data-testid="voxel-count">{metrics ? formatCount(metrics.totalVoxels) : "生成中"}</dd>
          </div>
          <div>
            <dt>绘制</dt>
            <dd>{metrics ? `${metrics.drawCalls} calls` : "—"}</dd>
          </div>
          <div>
            <dt>画质</dt>
            <dd>{metrics?.quality === "adaptive" ? "自适应" : "高"}</dd>
          </div>
        </dl>
      </aside>

      <div className="altitude-mark" aria-hidden="true">
        <span>36</span>
        <i />
        <span>00</span>
      </div>

      <footer className="scene-footer">
        <button
          type="button"
          className="tour-toggle"
          onClick={() => setTouring((active) => !active)}
          aria-pressed={!touring}
          aria-label={touring ? "暂停自动巡游" : "继续自动巡游"}
        >
          <span className={touring ? "pause-icon" : "play-icon"} aria-hidden="true" />
          {touring ? "暂停巡游" : "继续巡游"}
        </button>
        <p className="control-hint">
          <span>拖拽环视</span>
          <i aria-hidden="true" />
          <span>滚轮远近</span>
        </p>
      </footer>

      <div className="scene-loader" aria-live="polite" aria-hidden={ready}>
        <span className="loader-peak" aria-hidden="true"><i /><i /><i /></span>
        <p>{error || "正在生成山脉与云海"}</p>
        {!error && <span className="loading-line"><i /></span>}
      </div>
    </main>
  );
}
