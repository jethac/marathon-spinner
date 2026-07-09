/**
 * Shadertoy-style host: iTime + iResolution, live-editable fragment shader.
 */
const canvas = document.getElementById("c");
const fpsEl = document.getElementById("fps");
const hudTime = document.getElementById("hudTime");
const editor = document.getElementById("shaderEditor");
const compileLog = document.getElementById("compileLog");
const compileStatus = document.getElementById("compileStatus");

const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
if (!gl) {
  document.body.innerHTML =
    '<p style="color:#f66;padding:2rem;font-family:monospace">WebGL2 required.</p>';
  throw new Error("WebGL2 required");
}

const VERT = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() {
  gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// GL program
// ---------------------------------------------------------------------------

let prog = null;
let uRes = null;
let uTime = null;
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);

function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
  const log = gl.getShaderInfoLog(sh) || "";
  if (!ok) {
    gl.deleteShader(sh);
    return { ok: false, log };
  }
  return { ok: true, shader: sh, log };
}

/**
 * Try to link a new fragment source. On failure, keep the previous program.
 * Returns { ok, log }.
 */
function tryCompileFragment(src) {
  const vs = compileShader(gl.VERTEX_SHADER, VERT);
  if (!vs.ok) return { ok: false, log: "Vertex shader:\n" + vs.log };

  const fs = compileShader(gl.FRAGMENT_SHADER, src);
  if (!fs.ok) {
    gl.deleteShader(vs.shader);
    return { ok: false, log: fs.log };
  }

  const p = gl.createProgram();
  gl.attachShader(p, vs.shader);
  gl.attachShader(p, fs.shader);
  gl.linkProgram(p);
  // shaders can be detached/deleted after link
  gl.deleteShader(vs.shader);
  gl.deleteShader(fs.shader);

  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) || "link failed";
    gl.deleteProgram(p);
    return { ok: false, log };
  }

  if (prog) gl.deleteProgram(prog);
  prog = p;
  gl.useProgram(prog);
  uRes = gl.getUniformLocation(prog, "iResolution");
  uTime = gl.getUniformLocation(prog, "iTime");
  return { ok: true, log: "" };
}

function setStatus(kind, text) {
  compileStatus.textContent = text;
  compileStatus.className = "compile-status" + (kind ? " " + kind : "");
}

function showLog(msg) {
  if (!msg) {
    compileLog.hidden = true;
    compileLog.textContent = "";
    return;
  }
  compileLog.hidden = false;
  compileLog.textContent = msg.trim();
}

function compileFromEditor() {
  const src = editor.value;
  setStatus("busy", "compiling…");
  // defer so the status paints
  requestAnimationFrame(() => {
    const result = tryCompileFragment(src);
    if (result.ok) {
      setStatus("ok", "ok");
      showLog("");
    } else {
      setStatus("err", "error");
      showLog(result.log);
    }
  });
}

// ---------------------------------------------------------------------------
// Load source + editor
// ---------------------------------------------------------------------------

let originalSource = "";

async function boot() {
  const res = await fetch("./shader.frag");
  if (!res.ok) throw new Error("Could not load shader.frag — serve over HTTP.");
  originalSource = await res.text();
  editor.value = originalSource;

  const result = tryCompileFragment(originalSource);
  if (!result.ok) {
    setStatus("err", "error");
    showLog(result.log);
  } else {
    setStatus("ok", "ok");
  }

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
let speed = parseFloat(params.get("speed") || "1") || 1;
let paused = params.has("pause");
let t0 = performance.now();
let elapsed = parseFloat(params.get("t") || "0") || 0;
let pauseAt = 0;
let baseElapsed = elapsed;

const speedEl = document.getElementById("speed");
const speedVal = document.getElementById("speedVal");
const btnPause = document.getElementById("btnPause");
const btnReset = document.getElementById("btnReset");
const btnCompile = document.getElementById("btnCompile");
const btnRevert = document.getElementById("btnRevert");

speedEl.value = String(speed);
speedVal.textContent = speed.toFixed(2) + "×";
if (paused) {
  btnPause.textContent = "Play";
  btnPause.classList.add("active");
}

speedEl.addEventListener("input", () => {
  speed = parseFloat(speedEl.value);
  speedVal.textContent = speed.toFixed(2) + "×";
});

btnPause.addEventListener("click", () => {
  paused = !paused;
  if (paused) {
    pauseAt = performance.now();
    btnPause.textContent = "Play";
    btnPause.classList.add("active");
  } else {
    t0 += performance.now() - pauseAt;
    btnPause.textContent = "Pause";
    btnPause.classList.remove("active");
  }
});

btnReset.addEventListener("click", () => {
  t0 = performance.now();
  baseElapsed = 0;
  elapsed = 0;
  paused = false;
  btnPause.textContent = "Pause";
  btnPause.classList.remove("active");
});

btnCompile.addEventListener("click", compileFromEditor);
btnRevert.addEventListener("click", () => {
  editor.value = originalSource;
  compileFromEditor();
});

// Ctrl/Cmd+Enter to compile
editor.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    compileFromEditor();
  }
  // Tab inserts spaces
  if (e.key === "Tab") {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const v = editor.value;
    editor.value = v.slice(0, start) + "  " + v.slice(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
  }
});

// Live recompile (debounced) while typing
let debounceTimer = 0;
editor.addEventListener("input", () => {
  setStatus("busy", "edited");
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(compileFromEditor, 550);
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    document.querySelectorAll(".panel").forEach((p) => {
      const on = p.id === "panel-" + name;
      p.classList.toggle("active", on);
      p.hidden = !on;
    });
  });
});

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const css = Math.max(1, Math.min(rect.width, rect.height));
  const s = Math.max(1, Math.floor(css * dpr));
  if (canvas.width !== s || canvas.height !== s) {
    canvas.width = canvas.height = s;
    gl.viewport(0, 0, s, s);
  }
}

let frames = 0;
let fpsT = performance.now();

function frame(now) {
  resize();

  if (!paused) {
    elapsed = baseElapsed + (now - t0) * 0.001 * speed;
  }

  if (prog) {
    gl.useProgram(prog);
    if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
    if (uTime) gl.uniform1f(uTime, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  if (hudTime) hudTime.textContent = elapsed.toFixed(1) + "s";

  frames++;
  if (now - fpsT > 500) {
    if (fpsEl) fpsEl.textContent = ((frames * 1000) / (now - fpsT)).toFixed(0);
    frames = 0;
    fpsT = now;
  }

  requestAnimationFrame(frame);
}

boot().catch((err) => {
  setStatus("err", "error");
  showLog(String(err && err.message ? err.message : err));
});
