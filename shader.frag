#version 300 es
// Marathon Spinner — Shadertoy-style fragment shader
//
// Abby Welsh (@DubThinkDev):
//   1. shapes via 2D SDFs (rounded-rect pixels + registration marks)
//   2. blend a few colors for pixels turning on/off
//   3. per pixel: position + moth shape + time + noise → on/off
// Moth designs: Wolfie Davis (bit-packed integers)
//
// Loop: cocoon → moth 1 → moth 2 → full noisy center-to-edge wipe.
// Lime model:
//   Form/morph: radial wave from center; glyph-masked energy with soft halo.
//   End wipe: noisy full-grid clear (no silhouette mask) center → corners.
//
// Uniforms (Shadertoy aliases set from JS):
//   iResolution.xy  — viewport size
//   iTime           — seconds

precision highp float;

uniform vec2  iResolution;
uniform float iTime;

out vec4 fragColor;

// ---------------------------------------------------------------------------
const int   GRID = 21;
const float PI   = 3.14159265;

const vec3 COL_BG       = vec3(0.04, 0.04, 0.045);
const vec3 COL_CELL     = vec3(0.105, 0.115, 0.125);
const vec3 COL_LIT      = vec3(0.60, 0.62, 0.66);
const vec3 COL_LIT_HI   = vec3(0.76, 0.78, 0.82);
const vec3 COL_LIME     = vec3(0.78, 1.00, 0.00);
const vec3 COL_LIME_DIM = vec3(0.40, 0.52, 0.03);
const vec3 COL_MARK     = vec3(0.20, 0.21, 0.23);

// Wave measured from footage: ~6 cells/s, band ~2.3 cells wide
const float WAVE_SPEED = 6.0;
const float WAVE_HALF  = 1.15;
const float R_CORNER   = 14.142135; // sqrt(10^2+10^2) for 21×21

// ---------------------------------------------------------------------------
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float fill(float d, float aa) {
  return 1.0 - smoothstep(-aa, aa, d);
}

// ---------------------------------------------------------------------------
// Bit-packed stages (21 rows, LSB = column 0). Sampled from stable holds.
// ---------------------------------------------------------------------------
const uint SH_COCOON[21] = uint[21](
  0x000000u, 0x000000u, 0x000000u, 0x000000u, 0x000e00u, 0x000a00u, 0x001f00u,
  0x000e00u, 0x001500u, 0x000e00u, 0x001500u, 0x000e00u, 0x001500u, 0x000e00u,
  0x001500u, 0x000e00u, 0x000e00u, 0x000000u, 0x000000u, 0x000000u, 0x000000u
);
const uint SH_MID[21] = uint[21](
  0x000000u, 0x000000u, 0x000000u, 0x000e00u, 0x000a00u, 0x010e10u, 0x00d560u,
  0x005b40u, 0x00aea0u, 0x003580u, 0x001b00u, 0x002e80u, 0x001500u, 0x001b00u,
  0x000e00u, 0x001500u, 0x000a00u, 0x000e00u, 0x000000u, 0x000000u, 0x000000u
);
const uint SH_MOTH_A[21] = uint[21](
  0x000000u, 0x000000u, 0x001100u, 0x031118u, 0x078a3cu, 0x02e4e8u, 0x02e4e8u,
  0x0175d0u, 0x03bbb8u, 0x00eee0u, 0x002e80u, 0x00df60u, 0x00b5a0u, 0x00a4a0u,
  0x00a4a0u, 0x0064c0u, 0x002080u, 0x004040u, 0x008020u, 0x000000u, 0x000000u
);
const uint SH_MOTH_B[21] = uint[21](
  0x000000u, 0x000000u, 0x001100u, 0x001100u, 0x04ca64u, 0x03e4f8u, 0x021508u,
  0x02fbe8u, 0x013590u, 0x00e4e0u, 0x003f80u, 0x03df78u, 0x02ce68u, 0x055554u,
  0x01e4f0u, 0x00d560u, 0x004040u, 0x004040u, 0x004040u, 0x000000u, 0x000000u
);
const uint SH_MOTH_C[21] = uint[21](
  0x000000u, 0x000000u, 0x010a10u, 0x030a18u, 0x078a3cu, 0x014450u, 0x0164d0u,
  0x00bfa0u, 0x01fff0u, 0x01aeb0u, 0x018430u, 0x020a08u, 0x001f00u, 0x0064c0u,
  0x00e0e0u, 0x014050u, 0x004040u, 0x004040u, 0x002080u, 0x000000u, 0x000000u
);
const uint SH_MOTH_D[21] = uint[21](
  0x000000u, 0x000000u, 0x002080u, 0x021108u, 0x011110u, 0x018a30u, 0x07c47cu,
  0x02d568u, 0x03eef8u, 0x00d560u, 0x00d560u, 0x012e90u, 0x00f5e0u, 0x0164d0u,
  0x014050u, 0x01a0b0u, 0x008020u, 0x018030u, 0x008020u, 0x000000u, 0x000000u
);

// 0 cocoon, 1 mid, 2-5 moths, 6 empty
bool shapeBit(int s, int gx, int gy) {
  if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return false;
  uint bits = 0u;
  if      (s == 0) bits = SH_COCOON[gy];
  else if (s == 1) bits = SH_MID[gy];
  else if (s == 2) bits = SH_MOTH_A[gy];
  else if (s == 3) bits = SH_MOTH_B[gy];
  else if (s == 4) bits = SH_MOTH_C[gy];
  else if (s == 5) bits = SH_MOTH_D[gy];
  else return false;
  return ((bits >> uint(gx)) & 1u) == 1u;
}

// Discrete distance (in cells) from (gx,gy) to nearest ON bit of shape s.
// Caps search radius for perf; 0 if on shape.
float distToShape(int s, int gx, int gy) {
  if (shapeBit(s, gx, gy)) return 0.0;
  float best = 20.0;
  // local neighborhood is enough for falloff look
  for (int dy = -6; dy <= 6; dy++) {
    for (int dx = -6; dx <= 6; dx++) {
      if (dx == 0 && dy == 0) continue;
      if (shapeBit(s, gx + dx, gy + dy)) {
        float d = length(vec2(float(dx), float(dy)));
        best = min(best, d);
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Timeline — pure function of iTime (no JS stage machine)
// ---------------------------------------------------------------------------
// Cycle (matches footage stages):
//   form cocoon → hold → morph mid (wings) → hold → morph moth → hold
//   → full noisy wipe (center → grid edge)
// Moth design rotates A→B→C→D each cycle.

struct Phase {
  int   shapeFrom;
  int   shapeTo;
  float waveR;     // current wave radius in cell units
  float form;      // 1 = form/morph (arrive center→out), 0 = clear
  float hold;      // 1 = fully held
  float fullWipe;  // 1 = noisy full-grid wipe
  float waveOn;    // 1 if lime wave is active
};

Phase timeline(float t) {
  Phase p;
  p.shapeFrom = 6;
  p.shapeTo   = 2;
  p.waveR     = -1.0;
  p.form      = 1.0;
  p.hold      = 1.0;
  p.fullWipe  = 0.0;
  p.waveOn    = 0.0;

  const float T_FORM_COC = 1.15;
  const float T_HOLD_COC = 1.35;
  const float T_MORPH_MID = 1.40;
  const float T_HOLD_MID  = 1.20;
  const float T_MORPH_MOTH = 1.55;
  const float T_HOLD_MOTH  = 1.40;
  const float T_WIPE  = 2.45;
  const float T_EMPTY = 0.30;
  const float TC =
      T_FORM_COC + T_HOLD_COC + T_MORPH_MID + T_HOLD_MID +
      T_MORPH_MOTH + T_HOLD_MOTH + T_WIPE + T_EMPTY;

  float S0 = T_FORM_COC;
  float S1 = S0 + T_HOLD_COC;
  float S2 = S1 + T_MORPH_MID;
  float S3 = S2 + T_HOLD_MID;
  float S4 = S3 + T_MORPH_MOTH;
  float S5 = S4 + T_HOLD_MOTH;
  float S6 = S5 + T_WIPE;

  float gt = max(t, 0.0);
  int cycle = int(floor(gt / TC));
  float lt = gt - float(cycle) * TC;
  int moth = 2 + (cycle - (cycle / 4) * 4); // 2..5 = moths A–D

  // form cocoon
  if (lt < S0) {
    p.shapeFrom = 6; p.shapeTo = 0;
    p.form = 1.0; p.hold = 0.0;
    p.waveR = lt * WAVE_SPEED;
    p.waveOn = 1.0;
    return p;
  }
  // hold cocoon
  if (lt < S1) {
    p.shapeFrom = 0; p.shapeTo = 0;
    p.hold = 1.0; p.form = 1.0;
    return p;
  }
  // morph cocoon → mid (sprouting wings)
  if (lt < S2) {
    p.shapeFrom = 0; p.shapeTo = 1;
    p.form = 1.0; p.hold = 0.0;
    p.waveR = (lt - S1) * WAVE_SPEED;
    p.waveOn = 1.0;
    return p;
  }
  // hold mid
  if (lt < S3) {
    p.shapeFrom = 1; p.shapeTo = 1;
    p.hold = 1.0; p.form = 1.0;
    return p;
  }
  // morph mid → full moth
  if (lt < S4) {
    p.shapeFrom = 1; p.shapeTo = moth;
    p.form = 1.0; p.hold = 0.0;
    p.waveR = (lt - S3) * WAVE_SPEED;
    p.waveOn = 1.0;
    return p;
  }
  // hold moth
  if (lt < S5) {
    p.shapeFrom = moth; p.shapeTo = moth;
    p.hold = 1.0; p.form = 1.0;
    return p;
  }
  // full noisy wipe
  if (lt < S6) {
    p.shapeFrom = moth; p.shapeTo = 6;
    p.form = 0.0; p.hold = 0.0;
    p.fullWipe = 1.0;
    p.waveR = (lt - S5) * WAVE_SPEED;
    p.waveOn = 1.0;
    return p;
  }
  // empty beat
  p.shapeFrom = 6; p.shapeTo = 6;
  p.hold = 0.0; p.form = 1.0;
  p.waveOn = 0.0;
  p.fullWipe = 0.0;
  return p;
}

// ---------------------------------------------------------------------------
// Per-cell: position + shape + time + noise → on / lime
// ---------------------------------------------------------------------------
void cellState(int gx, int gy, Phase ph, out float onAmt, out float limeAmt) {
  onAmt = 0.0;
  limeAmt = 0.0;

  vec2 gc = vec2(float(gx), float(gy));
  vec2 center = vec2(10.0); // grid center of 21×21
  float r = length(gc - center);

  // noise staggers each pixel's effective radius (Abby: position + noise)
  // full wipe uses stronger noise for a messier clear
  float n = hash21(gc * 1.73 + 4.1);
  float n2 = hash21(gc * 3.91 + 11.7);
  float jitter = (n - 0.5) * (ph.fullWipe > 0.5 ? 1.85 : 0.9);
  // extra high-freq scatter on wipe
  if (ph.fullWipe > 0.5) jitter += (n2 - 0.5) * 1.1;
  float d = r + jitter;

  bool fromOn = shapeBit(ph.shapeFrom, gx, gy);
  bool toOn   = shapeBit(ph.shapeTo,   gx, gy);

  int energyShape = (ph.form > 0.5) ? ph.shapeTo : ph.shapeFrom;
  bool onSilhouette = shapeBit(energyShape, gx, gy);
  float distOut = distToShape(energyShape, gx, gy);

  // --- ON/OFF ---
  if (ph.hold > 0.5) {
    onAmt = toOn ? 1.0 : 0.0;
    // Footage often keeps a single lime “heart” at the body center on holds
    if (toOn && gx == 10 && gy == 10) {
      limeAmt = 0.85; // set early; final clamp at end
    }
  } else if (ph.waveOn > 0.5) {
    float passed = 1.0 - smoothstep(ph.waveR - 0.4, ph.waveR + 0.4, d);

    if (ph.fullWipe > 0.5) {
      // Full grid wipe: anything the wave has reached is cleared.
      // Ahead of the wave, previous moth (or whatever was lit) remains.
      onAmt = fromOn ? (1.0 - passed) : 0.0;
      // optional: briefly light empty cells at the front so the wipe reads as
      // a noisy sheet, not only silhouette dissolve
      float front = 1.0 - smoothstep(WAVE_HALF * 0.4, WAVE_HALF * 1.3, abs(d - ph.waveR));
      onAmt = max(onAmt, front * 0.55 * (0.5 + 0.5 * n2));
    } else if (ph.form > 0.5) {
      // form / morph: new pixels arrive center → out
      float inside  = passed;
      float outside = 1.0 - passed;
      float v = 0.0;
      if (toOn)   v = max(v, inside);
      if (fromOn) v = max(v, outside);
      onAmt = v;
    } else {
      // silhouette dissolve (unused when fullWipe handles clear)
      onAmt = fromOn ? (1.0 - passed) : 0.0;
    }
  } else {
    onAmt = 0.0;
  }

  // --- LIME ---
  float lime = 0.0;
  if (ph.waveOn > 0.5) {
    float band = abs(d - ph.waveR);
    lime = 1.0 - smoothstep(WAVE_HALF * 0.5, WAVE_HALF * 1.2, band);

    if (ph.fullWipe > 0.5) {
      // No glyph mask — wave lights the whole grid, energy stays high to the edge.
      // Noise modulates so it feels chaotic, not a perfect ring.
      float scatter = 0.55 + 0.45 * n2;
      lime *= scatter;
      // thick noisy trail behind the front
      float trail = smoothstep(ph.waveR + 0.2, ph.waveR - 0.8, d)
                  * smoothstep(ph.waveR - WAVE_HALF * 3.5, ph.waveR - 0.2, d);
      lime = max(lime, trail * (0.35 + 0.5 * n) * scatter);
      // sparse salt-and-pepper on recently cleared cells
      float spark = step(0.82, n2) * smoothstep(ph.waveR, ph.waveR - 3.0, d)
                  * smoothstep(ph.waveR - 6.0, ph.waveR - 2.0, d);
      lime = max(lime, spark * 0.7);
    } else {
      // Glyph-masked form/morph: full on silhouette, falloff past bounds
      float onShapeE = onSilhouette ? 1.0 : 0.0;
      float outsideE = exp(-distOut * 1.2);
      outsideE *= 1.0 - smoothstep(2.2, 3.5, distOut);
      float emptyEnergy = outsideE * 0.45;
      lime *= mix(emptyEnergy, 1.0, onShapeE);
    }
  }

  onAmt   = clamp(onAmt, 0.0, 1.0);
  limeAmt = clamp(max(limeAmt, lime), 0.0, 1.0);
}

// ---------------------------------------------------------------------------
float registrationMarks(vec2 p, float gridHalf, float aa) {
  float m = 0.0;
  float halfW = 0.0045;
  float arm = 0.048;
  float gap = gridHalf + 0.012;

  for (int i = 0; i < 4; i++) {
    float sx = (i == 0 || i == 2) ? -1.0 : 1.0;
    float sy = (i < 2) ? -1.0 : 1.0;
    vec2 c = vec2(sx * gap, sy * gap);
    m = max(m, fill(sdSegment(p, c, c + vec2(-sx * arm, 0.0)) - halfW, aa));
    m = max(m, fill(sdSegment(p, c, c + vec2(0.0, -sy * arm)) - halfW, aa));
  }

  float edge = gridHalf + 0.028;
  float tick = 0.032;
  m = max(m, fill(sdSegment(p, vec2(0.0, -edge), vec2(0.0, -edge - tick)) - halfW * 0.9, aa));
  m = max(m, fill(sdSegment(p, vec2(0.0,  edge), vec2(0.0,  edge + tick)) - halfW * 0.9, aa));
  m = max(m, fill(sdSegment(p, vec2(-edge, 0.0), vec2(-edge - tick, 0.0)) - halfW * 0.9, aa));
  m = max(m, fill(sdSegment(p, vec2( edge, 0.0), vec2( edge + tick, 0.0)) - halfW * 0.9, aa));

  float o = 0.70, ol = 0.055;
  m = max(m, fill(sdSegment(p, vec2(-o, -o), vec2(-o + ol * 0.7, -o + ol * 0.7)) - halfW * 0.8, aa));
  m = max(m, fill(sdSegment(p, vec2( o, -o), vec2( o - ol * 0.7, -o + ol * 0.7)) - halfW * 0.8, aa));
  m = max(m, fill(sdSegment(p, vec2(-o,  o), vec2(-o + ol * 0.7,  o - ol * 0.7)) - halfW * 0.8, aa));
  m = max(m, fill(sdSegment(p, vec2( o,  o), vec2( o - ol * 0.7,  o - ol * 0.7)) - halfW * 0.8, aa));
  return m;
}

// ---------------------------------------------------------------------------
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 res  = iResolution.xy;
  vec2 uv = (frag - 0.5 * res) / min(res.x, res.y);
  uv.y = -uv.y;

  float aa = 1.5 / min(res.x, res.y);
  float t  = iTime;

  Phase ph = timeline(t);

  float gridHalf  = 0.38;
  float cellPitch = (gridHalf * 2.0) / float(GRID);

  vec3 col = COL_BG;
  float marks = registrationMarks(uv, gridHalf, aa);
  col = mix(col, COL_MARK, marks * 0.9);

  vec2 local = uv / cellPitch + vec2(float(GRID) * 0.5);
  int gx = int(floor(local.x));
  int gy = int(floor(local.y));
  vec2 pCell = fract(local) - 0.5;
  // Chubbier cells / tighter gaps — closer to the plastic “dice” look
  float dCell = sdRoundedBox(pCell, vec2(0.455), 0.16);

  bool inGrid = gx >= 0 && gy >= 0 && gx < GRID && gy < GRID
             && abs(uv.x) <= gridHalf + cellPitch * 0.1
             && abs(uv.y) <= gridHalf + cellPitch * 0.1;

  if (inGrid) {
    float cellMask = fill(dCell * cellPitch, aa);

    float onAmt, limeAmt;
    cellState(gx, gy, ph, onAmt, limeAmt);

    float grain = hash21(vec2(float(gx), float(gy)) * 2.3);
    float bevel = clamp(0.55 - pCell.x * 0.35 - pCell.y * 0.45, 0.0, 1.0);

    vec3 cellOff = COL_CELL * (0.85 + 0.35 * bevel);
    vec3 litCol  = mix(COL_LIT, COL_LIT_HI, grain * 0.5);
    vec3 cellOn  = litCol * (0.88 + 0.22 * bevel);
    vec3 limeCol = mix(COL_LIME_DIM, COL_LIME, 0.5 + 0.5 * bevel);

    // Blend colors for pixels turning on/off (Abby part 2)
    vec3 cellCol = mix(cellOff, cellOn, smoothstep(0.05, 0.95, onAmt));
    cellCol = mix(cellCol, limeCol, smoothstep(0.0, 0.7, limeAmt));

    float hl = fill(sdRoundedBox(pCell - vec2(-0.1, -0.12), vec2(0.1, 0.07), 0.05), aa * 8.0);
    cellCol += vec3(1.0) * hl * onAmt * 0.08 * (1.0 - limeAmt);

    col = mix(col, cellCol, cellMask);

    // soft lime glow bleeds slightly outside the rounded cell
    if (limeAmt > 0.08) {
      float glow = exp(-max(dCell, 0.0) * 5.0) * limeAmt * 0.32;
      col += COL_LIME * glow * (1.0 - cellMask * 0.6);
    }
  }

  col += (hash21(frag + fract(t * 0.37) * 97.0) - 0.5) * 0.025;
  fragColor = vec4(col, 1.0);
}
