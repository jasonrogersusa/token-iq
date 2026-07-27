"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Phase = "intro" | "calibration" | "compiler" | "rank" | "incident" | "result";
type Scores = { calibration: number; compiler: number; rank: number; incident: number };

const calibrationPrompts = [
  {
    eyebrow: "Long-form corpus",
    title: "The King James Bible",
    note: "Plain English text, no annotations or metadata.",
    actual: 1_050_000,
    insight: "Books live at a scale where a single prompt can become a context architecture problem.",
  },
  {
    eyebrow: "Classic novel",
    title: "War and Peace",
    note: "English translation, roughly 587,000 words.",
    actual: 780_000,
    insight: "A rough words-to-tokens conversion gets you close; structure and translation still matter.",
  },
  {
    eyebrow: "Engineering artifact",
    title: "A 500-line TypeScript file",
    note: "Typical application code with comments and imports.",
    actual: 6_800,
    insight: "Code tokenizes differently from prose. Punctuation, identifiers, and whitespace all count.",
  },
  {
    eyebrow: "Spoken content",
    title: "A 45-minute product meeting",
    note: "Clean transcript at 145 spoken words per minute.",
    actual: 9_100,
    insight: "Transcripts feel large but are usually cheaper than the surrounding docs, logs, and outputs.",
  },
];

const contextCards = [
  { id: "trace", name: "Stack trace extract", tokens: 2_200, signal: "logs", value: 3, label: "LOGS", desc: "Exception chain + 40 surrounding lines" },
  { id: "logs", name: "Full service logs", tokens: 14_600, signal: "logs", value: 1, label: "LOGS", desc: "Eight hours, all severities" },
  { id: "code", name: "CheckoutService.ts", tokens: 9_800, signal: "code", value: 3, label: "CODE", desc: "Failing service and direct helpers" },
  { id: "repo", name: "Entire repository", tokens: 118_000, signal: "code", value: 0, label: "CODE", desc: "Every package, fixture, and test" },
  { id: "schema", name: "Order schema", tokens: 3_100, signal: "schema", value: 3, label: "DATA", desc: "Relevant tables and migrations" },
  { id: "runbook", name: "Payments runbook", tokens: 1_400, signal: "runbook", value: 2, label: "DOC", desc: "Known failure modes and rollback steps" },
  { id: "chat", name: "#random export", tokens: 21_400, signal: "noise", value: -2, label: "CHAT", desc: "Three months of unrelated discussion" },
  { id: "roadmap", name: "FY roadmap deck", tokens: 7_900, signal: "noise", value: -1, label: "DECK", desc: "Strategy, staffing, and milestones" },
];

const initialRank = [
  { id: "web", name: "News homepage", tokens: 1_800, detail: "article + navigation" },
  { id: "sms", name: "One SMS", tokens: 24, detail: "short message" },
  { id: "hamlet", name: "Hamlet", tokens: 40_000, detail: "complete play" },
  { id: "docs", name: "1,000 pages", tokens: 750_000, detail: "mixed business docs" },
  { id: "api", name: "Large API response", tokens: 12_000, detail: "nested JSON" },
];

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 ? 1 : 0)}K`;
  return value.toLocaleString();
}

function TokenField({ intensity = 0.35 }: { intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: true });
    if (!gl) return;

    const vertex = `
      attribute vec2 a_position;
      void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
    `;
    const fragment = `
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_intensity;
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      void main() {
        vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
        float t = u_time * 0.18;
        float r = length(uv);
        float a = atan(uv.y, uv.x);
        float rings = pow(max(0.0, 1.0 - abs(fract(r * 3.1 - t) - 0.5) * 2.0), 18.0);
        float spokes = pow(max(0.0, 1.0 - abs(fract(a / 0.392699 + t * 0.4) - 0.5) * 2.0), 30.0);
        vec2 cell = floor((uv + vec2(t * 0.5, -t * 0.3)) * 13.0);
        vec2 local = fract((uv + vec2(t * 0.5, -t * 0.3)) * 13.0) - 0.5;
        float star = smoothstep(0.12, 0.0, length(local)) * step(0.84, hash(cell));
        float pulse = 0.58 + 0.42 * sin(u_time * 1.5 + r * 8.0);
        vec3 cyan = vec3(0.28, 0.96, 0.82);
        vec3 amber = vec3(1.0, 0.49, 0.23);
        vec3 col = mix(cyan, amber, smoothstep(0.38, 0.92, u_intensity));
        float field = rings * 0.23 + spokes * 0.08 + star * (1.0 + u_intensity) + 0.025 / max(r, 0.035);
        field *= smoothstep(1.45, 0.12, r) * pulse;
        gl_FragColor = vec4(col * field, min(0.86, field));
      }
    `;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram();
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    if (!program || !vs || !fs) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "u_resolution");
    const time = gl.getUniformLocation(program, "u_time");
    const signal = gl.getUniformLocation(program, "u_intensity");
    let frame = 0;

    const draw = (now: number) => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.floor(canvas.clientWidth * ratio);
      const height = Math.floor(canvas.clientHeight * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      gl.uniform2f(resolution, width, height);
      gl.uniform1f(time, now / 1000);
      gl.uniform1f(signal, intensity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      gl.deleteProgram(program);
    };
  }, [intensity]);

  return <canvas ref={canvasRef} className="token-field" aria-hidden="true" />;
}

function Chrome({ phase, scores }: { phase: Phase; scores: Scores }) {
  const total = Object.values(scores).reduce((sum, n) => sum + n, 0);
  const stageMap: Record<Phase, string> = {
    intro: "READY",
    calibration: "01 / CALIBRATE",
    compiler: "02 / COMPILE",
    rank: "03 / ORDER",
    incident: "04 / ROUTE",
    result: "DEBRIEF",
  };
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">T/</span>
        <span>TokenOps</span>
        <span className="dim">// IQ LAB</span>
      </div>
      <div className="topbar-status">
        <span className="live-dot" />
        <span>{stageMap[phase]}</span>
        <span className="score-chip">SCORE {Math.round(total).toString().padStart(4, "0")}</span>
      </div>
    </header>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [scores, setScores] = useState<Scores>({ calibration: 0, compiler: 0, rank: 0, incident: 0 });
  const [calibrationIndex, setCalibrationIndex] = useState(0);
  const [logEstimate, setLogEstimate] = useState(4.3);
  const [calibrationFeedback, setCalibrationFeedback] = useState<{ points: number; ratio: number } | null>(null);
  const [selectedContext, setSelectedContext] = useState<string[]>([]);
  const [compilerFeedback, setCompilerFeedback] = useState<string | null>(null);
  const [ranked, setRanked] = useState(initialRank);
  const [rankFeedback, setRankFeedback] = useState<string | null>(null);
  const [cacheRate, setCacheRate] = useState(45);
  const [summaryRate, setSummaryRate] = useState(20);
  const [outputCap, setOutputCap] = useState(2200);
  const [incidentFeedback, setIncidentFeedback] = useState<string | null>(null);
  const [best, setBest] = useState(0);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem("tokenops-best") || 0);
    setBest(stored);
  }, []);

  const totalScore = Object.values(scores).reduce((sum, n) => sum + n, 0);
  const estimate = Math.round(Math.pow(10, logEstimate) / 100) * 100;
  const selectedCards = contextCards.filter((card) => selectedContext.includes(card.id));
  const contextTotal = selectedCards.reduce((sum, card) => sum + card.tokens, 0);
  const requiredSignals = ["logs", "code", "schema"];
  const coveredSignals = new Set(selectedCards.map((card) => card.signal));
  const contextCoverage = requiredSignals.filter((signal) => coveredSignals.has(signal)).length;
  const contextOver = contextTotal > 32_000;

  const incident = useMemo(() => {
    const input = 48_000 * (1 - cacheRate / 100) * (1 - (summaryRate / 100) * 0.65);
    const tokens = Math.round(input + outputCap);
    const latency = Math.round(220 + tokens / 45 + (summaryRate > 0 ? 110 : 0));
    const quality = Math.max(0, Math.round((92 - summaryRate * 0.11 - Math.max(0, 1200 - outputCap) / 45) * 10) / 10);
    const spend = Math.round(tokens * 0.0000045 * 10_000) / 10_000;
    return { tokens, latency, quality, spend };
  }, [cacheRate, summaryRate, outputCap]);

  const start = () => {
    setPhase("calibration");
    setCalibrationIndex(0);
    setLogEstimate(4.3);
    setCalibrationFeedback(null);
    setSelectedContext([]);
    setCompilerFeedback(null);
    setRanked(initialRank);
    setRankFeedback(null);
    setIncidentFeedback(null);
    setScores({ calibration: 0, compiler: 0, rank: 0, incident: 0 });
  };

  const submitCalibration = () => {
    if (calibrationFeedback) return;
    const actual = calibrationPrompts[calibrationIndex].actual;
    const distance = Math.abs(Math.log10(estimate) - Math.log10(actual));
    const points = Math.max(0, Math.round(62.5 - distance * 45));
    const ratio = estimate / actual;
    setScores((current) => ({ ...current, calibration: current.calibration + points }));
    setCalibrationFeedback({ points, ratio });
  };

  const nextCalibration = () => {
    if (calibrationIndex === calibrationPrompts.length - 1) {
      setPhase("compiler");
      return;
    }
    setCalibrationIndex((current) => current + 1);
    setLogEstimate(4.3);
    setCalibrationFeedback(null);
  };

  const toggleContext = (id: string) => {
    if (compilerFeedback) return;
    setSelectedContext((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const submitCompiler = () => {
    const relevance = selectedCards.reduce((sum, card) => sum + card.value, 0);
    const efficient = contextTotal <= 32_000 ? Math.max(0, 70 - Math.max(0, contextTotal - 18_000) / 300) : 0;
    const points = Math.max(0, Math.min(250, Math.round(contextCoverage * 50 + relevance * 7 + efficient)));
    setScores((current) => ({ ...current, compiler: points }));
    if (contextCoverage === 3 && !contextOver && relevance >= 8) {
      setCompilerFeedback("Clean compile. You covered the failure surface without flooding the window.");
    } else if (contextOver) {
      setCompilerFeedback("Context overflow. More evidence is not always more signal.");
    } else {
      setCompilerFeedback(`You covered ${contextCoverage}/3 required signals. Production debugging needs logs, code, and data shape.`);
    }
  };

  const moveRank = (index: number, direction: -1 | 1) => {
    if (rankFeedback) return;
    const target = index + direction;
    if (target < 0 || target >= ranked.length) return;
    setRanked((current) => {
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  };

  const submitRank = () => {
    let inversions = 0;
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        if (ranked[i].tokens > ranked[j].tokens) inversions++;
      }
    }
    const points = Math.max(0, 250 - inversions * 35);
    setScores((current) => ({ ...current, rank: points }));
    setRankFeedback(inversions === 0 ? "Perfect order. Your scale model is internally consistent." : `${inversions} ordering conflict${inversions === 1 ? "" : "s"} detected. Close still counts; systems work is comparative.`);
  };

  const submitIncident = () => {
    const checks = [incident.tokens <= 20_000, incident.latency <= 800, incident.quality >= 84];
    const passed = checks.filter(Boolean).length;
    let points = passed * 65;
    if (passed === 3) points += Math.max(0, Math.round(55 - Math.max(0, incident.tokens - 12_000) / 250));
    points = Math.min(250, points);
    const updated = { ...scores, incident: points };
    const final = Object.values(updated).reduce((sum, n) => sum + n, 0);
    setScores(updated);
    setIncidentFeedback(passed === 3 ? "SLOs green. The route is efficient, fast, and still useful." : `${passed}/3 SLOs passed. Every token lever trades against latency or answer quality.`);
    const newBest = Math.max(best, Math.round(final));
    setBest(newBest);
    window.localStorage.setItem("tokenops-best", String(newBest));
  };

  const tier = totalScore >= 880 ? "TOKEN ARCHITECT" : totalScore >= 700 ? "CONTEXT ENGINEER" : totalScore >= 500 ? "PROMPT OPERATOR" : "TOKEN APPRENTICE";

  return (
    <main className="app-shell">
      <Chrome phase={phase} scores={scores} />
      <TokenField intensity={phase === "incident" ? incident.tokens / 48_000 : Math.min(1, totalScore / 800 + 0.15)} />
      <div className="scanline" aria-hidden="true" />

      {phase === "intro" && (
        <section className="screen intro-screen">
          <div className="intro-copy">
            <div className="kicker"><span>NEW SIMULATION</span><span>EST. 06 MIN</span></div>
            <h1>How expensive is<br /><em>what you know?</em></h1>
            <p className="lede">
              Tokens are the hidden unit of AI systems. Prove you can estimate them, pack them,
              order them, and route them under pressure.
            </p>
            <button className="primary-button" onClick={start}>
              INITIATE TEST <span>↗</span>
            </button>
            <div className="intro-meta">
              <div><strong>04</strong><span>OPERATIONS</span></div>
              <div><strong>1,000</strong><span>MAX SCORE</span></div>
              <div><strong>{best.toString().padStart(3, "0")}</strong><span>LOCAL BEST</span></div>
            </div>
          </div>
          <aside className="radar-panel">
            <div className="radar-label"><span>CONTEXT FIELD</span><span className="online">● ONLINE</span></div>
            <div className="orbital">
              <div className="orbit orbit-a" />
              <div className="orbit orbit-b" />
              <div className="orbit orbit-c" />
              <div className="core">T</div>
              <span className="orbital-tag tag-a">ESTIMATE</span>
              <span className="orbital-tag tag-b">COMPILE</span>
              <span className="orbital-tag tag-c">ROUTE</span>
            </div>
            <div className="system-readout">
              <span>MODEL CONTEXT</span><strong>1M</strong>
              <span>INPUT CHANNELS</span><strong>04</strong>
              <span>STATUS</span><strong className="cyan">NOMINAL</strong>
            </div>
          </aside>
        </section>
      )}

      {phase === "calibration" && (
        <section className="screen mission-screen">
          <div className="mission-head">
            <div>
              <span className="step-label">OPERATION 01</span>
              <h2>Scale calibration</h2>
              <p>Estimate orders of magnitude. Exact tokenizer counts vary; good instincts should not.</p>
            </div>
            <div className="progress-dots" aria-label={`Question ${calibrationIndex + 1} of ${calibrationPrompts.length}`}>
              {calibrationPrompts.map((_, index) => <span key={index} className={index <= calibrationIndex ? "active" : ""} />)}
            </div>
          </div>
          <div className="calibration-grid">
            <article className="target-card">
              <div className="target-index">0{calibrationIndex + 1}</div>
              <div>
                <span className="card-eyebrow">{calibrationPrompts[calibrationIndex].eyebrow}</span>
                <h3>{calibrationPrompts[calibrationIndex].title}</h3>
                <p>{calibrationPrompts[calibrationIndex].note}</p>
              </div>
              <div className="token-glyphs" aria-hidden="true">{Array.from({ length: 28 }).map((_, i) => <i key={i} />)}</div>
            </article>
            <div className="estimator-panel">
              <label htmlFor="estimate">YOUR ESTIMATE</label>
              <div className="estimate-number">{formatTokens(estimate)}<span>TOKENS</span></div>
              <input
                id="estimate"
                className="range"
                type="range"
                min="1.3"
                max="6.3"
                step="0.01"
                value={logEstimate}
                disabled={Boolean(calibrationFeedback)}
                onChange={(event) => setLogEstimate(Number(event.target.value))}
              />
              <div className="range-labels"><span>20</span><span>2M</span></div>
              {!calibrationFeedback ? (
                <button className="primary-button compact" onClick={submitCalibration}>LOCK ESTIMATE</button>
              ) : (
                <div className="feedback-panel">
                  <div className="feedback-score">+{calibrationFeedback.points} PTS</div>
                  <p>Actual benchmark: <strong>{formatTokens(calibrationPrompts[calibrationIndex].actual)} tokens</strong></p>
                  <p>{calibrationFeedback.ratio < 1 ? `${Math.round(1 / calibrationFeedback.ratio)}× under` : `${calibrationFeedback.ratio.toFixed(1)}× over`} · {calibrationPrompts[calibrationIndex].insight}</p>
                  <button className="text-button" onClick={nextCalibration}>{calibrationIndex === 3 ? "CONTINUE TO COMPILER" : "NEXT SIGNAL"} →</button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {phase === "compiler" && (
        <section className="screen mission-screen">
          <div className="mission-head">
            <div>
              <span className="step-label">OPERATION 02</span>
              <h2>Context compiler</h2>
              <p>A checkout service is returning 500s. Build a useful context packet under 32K.</p>
            </div>
            <div className={`budget ${contextOver ? "danger" : ""}`}>
              <span>WINDOW LOAD</span>
              <strong>{formatTokens(contextTotal)} / 32K</strong>
              <i><b style={{ width: `${Math.min(100, contextTotal / 320)}%` }} /></i>
            </div>
          </div>
          <div className="compiler-layout">
            <div className="context-grid">
              {contextCards.map((card) => {
                const selected = selectedContext.includes(card.id);
                return (
                  <button
                    key={card.id}
                    className={`context-card ${selected ? "selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => toggleContext(card.id)}
                  >
                    <span className="file-type">{card.label}</span>
                    <span className="context-name">{card.name}</span>
                    <span className="context-desc">{card.desc}</span>
                    <span className="context-cost">{formatTokens(card.tokens)} TK</span>
                    <span className="select-box">{selected ? "✓" : "+"}</span>
                  </button>
                );
              })}
            </div>
            <aside className="brief-panel">
              <span className="card-eyebrow">MISSION BRIEF</span>
              <h3>Cover the failure surface.</h3>
              <ul>
                <li className={coveredSignals.has("logs") ? "done" : ""}><span>{coveredSignals.has("logs") ? "✓" : "○"}</span> Failure evidence</li>
                <li className={coveredSignals.has("code") ? "done" : ""}><span>{coveredSignals.has("code") ? "✓" : "○"}</span> Relevant code</li>
                <li className={coveredSignals.has("schema") ? "done" : ""}><span>{coveredSignals.has("schema") ? "✓" : "○"}</span> Data shape</li>
              </ul>
              <p className="hint">High signal density earns more than filling the window.</p>
              {!compilerFeedback ? (
                <button className="primary-button compact" disabled={!selectedContext.length} onClick={submitCompiler}>COMPILE PACKET</button>
              ) : (
                <div className="feedback-panel">
                  <div className="feedback-score">+{scores.compiler} PTS</div>
                  <p>{compilerFeedback}</p>
                  <button className="text-button" onClick={() => setPhase("rank")}>OPEN ORDER QUEUE →</button>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {phase === "rank" && (
        <section className="screen mission-screen">
          <div className="mission-head">
            <div>
              <span className="step-label">OPERATION 03</span>
              <h2>Order the stream</h2>
              <p>Reorder the artifacts from smallest to largest token footprint.</p>
            </div>
            <div className="rank-key"><span>SMALLEST</span><i>→</i><span>LARGEST</span></div>
          </div>
          <div className="rank-layout">
            <ol className="rank-list">
              {ranked.map((item, index) => (
                <li key={item.id}>
                  <span className="rank-number">{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{item.name}</strong><span>{item.detail}</span></div>
                  {rankFeedback && <span className="revealed">{formatTokens(item.tokens)} TK</span>}
                  <div className="rank-controls">
                    <button aria-label={`Move ${item.name} up`} disabled={index === 0 || Boolean(rankFeedback)} onClick={() => moveRank(index, -1)}>↑</button>
                    <button aria-label={`Move ${item.name} down`} disabled={index === ranked.length - 1 || Boolean(rankFeedback)} onClick={() => moveRank(index, 1)}>↓</button>
                  </div>
                </li>
              ))}
            </ol>
            <aside className="brief-panel rank-aside">
              <span className="card-eyebrow">COMPARATIVE REASONING</span>
              <h3>Exact counts are brittle. Relative scale travels.</h3>
              <p className="hint">Use the controls to sort. Token count includes the useful content, not binary assets.</p>
              {!rankFeedback ? (
                <button className="primary-button compact" onClick={submitRank}>VERIFY ORDER</button>
              ) : (
                <div className="feedback-panel">
                  <div className="feedback-score">+{scores.rank} PTS</div>
                  <p>{rankFeedback}</p>
                  <button className="text-button" onClick={() => setPhase("incident")}>ENTER ROUTING BAY →</button>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {phase === "incident" && (
        <section className="screen mission-screen">
          <div className="mission-head">
            <div>
              <span className="step-label">OPERATION 04</span>
              <h2>Routing incident</h2>
              <p>Traffic is 6× normal. Tune the route and keep every production SLO green.</p>
            </div>
            <div className="incident-live"><span className="live-dot" /> LIVE LOAD: 6.2×</div>
          </div>
          <div className="incident-layout">
            <div className="control-bank">
              <div className="control-row">
                <div><label htmlFor="cache">SEMANTIC CACHE HIT RATE</label><p>Reuse equivalent prompts and stable context.</p></div>
                <strong>{cacheRate}%</strong>
                <input id="cache" className="range" type="range" min="0" max="90" value={cacheRate} disabled={Boolean(incidentFeedback)} onChange={(e) => setCacheRate(Number(e.target.value))} />
              </div>
              <div className="control-row">
                <div><label htmlFor="summary">CONTEXT COMPRESSION</label><p>Summarize older turns before model routing.</p></div>
                <strong>{summaryRate}%</strong>
                <input id="summary" className="range" type="range" min="0" max="70" value={summaryRate} disabled={Boolean(incidentFeedback)} onChange={(e) => setSummaryRate(Number(e.target.value))} />
              </div>
              <div className="control-row">
                <div><label htmlFor="output">OUTPUT TOKEN CAP</label><p>Constrain response length at generation time.</p></div>
                <strong>{formatTokens(outputCap)}</strong>
                <input id="output" className="range" type="range" min="500" max="4000" step="100" value={outputCap} disabled={Boolean(incidentFeedback)} onChange={(e) => setOutputCap(Number(e.target.value))} />
              </div>
              {!incidentFeedback ? (
                <button className="primary-button compact" onClick={submitIncident}>EXECUTE ROUTE</button>
              ) : (
                <div className="feedback-panel incident-feedback">
                  <div className="feedback-score">+{scores.incident} PTS</div>
                  <p>{incidentFeedback}</p>
                  <button className="text-button" onClick={() => setPhase("result")}>GENERATE DEBRIEF →</button>
                </div>
              )}
            </div>
            <aside className="telemetry">
              <div className="telemetry-head"><span>LIVE TELEMETRY</span><span>p95</span></div>
              <div className={incident.tokens <= 20_000 ? "metric pass" : "metric fail"}>
                <span>TOKENS / REQUEST</span><strong>{formatTokens(incident.tokens)}</strong><small>target ≤ 20K</small>
              </div>
              <div className={incident.latency <= 800 ? "metric pass" : "metric fail"}>
                <span>LATENCY</span><strong>{incident.latency} ms</strong><small>target ≤ 800ms</small>
              </div>
              <div className={incident.quality >= 84 ? "metric pass" : "metric fail"}>
                <span>QUALITY INDEX</span><strong>{incident.quality}</strong><small>target ≥ 84</small>
              </div>
              <div className="cost-line"><span>EST. UNIT COST</span><strong>${incident.spend.toFixed(4)}</strong></div>
            </aside>
          </div>
        </section>
      )}

      {phase === "result" && (
        <section className="screen result-screen">
          <div className="result-seal">
            <span>TOKEN IQ</span>
            <strong>{Math.round(totalScore)}</strong>
            <small>/ 1000</small>
          </div>
          <div className="result-copy">
            <span className="step-label">SIMULATION COMPLETE</span>
            <h2>{tier}</h2>
            <p>
              {totalScore >= 700
                ? "You reason about tokens as a system resource—not a trivia number. Your strongest decisions balanced signal, budget, and production constraints."
                : "Your systems instinct is forming. Focus less on exact counts and more on orders of magnitude, signal density, and repeated context."}
            </p>
            <div className="score-breakdown">
              <div><span>CALIBRATION</span><strong>{scores.calibration}</strong><i><b style={{ width: `${scores.calibration / 2.5}%` }} /></i></div>
              <div><span>COMPILER</span><strong>{scores.compiler}</strong><i><b style={{ width: `${scores.compiler / 2.5}%` }} /></i></div>
              <div><span>ORDERING</span><strong>{scores.rank}</strong><i><b style={{ width: `${scores.rank / 2.5}%` }} /></i></div>
              <div><span>ROUTING</span><strong>{scores.incident}</strong><i><b style={{ width: `${scores.incident / 2.5}%` }} /></i></div>
            </div>
            <div className="ops-note">
              <span>OPERATOR NOTE</span>
              <p>Measure first. Retrieve narrowly. Cache repeated context. Compress with intent. The same control loop applies when teams build on Gemini and Vertex AI.</p>
            </div>
            <button className="primary-button" onClick={start}>RUN NEW SIMULATION <span>↻</span></button>
          </div>
        </section>
      )}

      <footer>
        <span>TOKENOPS SIMULATION // LOCAL SESSION</span>
        <span>WEBGL CORE <b>ACTIVE</b></span>
      </footer>
    </main>
  );
}
