/* Sombreadores: el cuerpo es común a GLSL 3.30 core (escritorio) y GLSL ES 3.00 (Switch); el
 * prefijo #version lo pone render.c según el contexto que se haya conseguido.
 * Todo se calcula en espacio lineal y cada sombreador termina con finish(): la saturación del
 * pase de gradación de la web (1,08), el tono neutro de Three (NeutralToneMapping) y la
 * conversión a sRGB del OutputPass. Así no hace falta posproceso para que los colores cuadren. */
#ifndef HT_SHADERS_H
#define HT_SHADERS_H

#define SH_COMMON_FRAG \
"uniform float uSatAmt;\n" \
"vec3 neutralTM(vec3 color){\n" \
"  const float StartCompression = 0.8 - 0.04; const float Desaturation = 0.15;\n" \
"  float x = min(color.r, min(color.g, color.b));\n" \
"  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;\n" \
"  color -= offset;\n" \
"  float peak = max(color.r, max(color.g, color.b));\n" \
"  if (peak < StartCompression) return color;\n" \
"  float d = 1.0 - StartCompression;\n" \
"  float newPeak = 1.0 - d * d / (peak + d - StartCompression);\n" \
"  color *= newPeak / peak;\n" \
"  float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);\n" \
"  return mix(color, vec3(newPeak), g);\n" \
"}\n" \
"vec3 toSRGB(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c)); }\n" \
"vec3 finish(vec3 c){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(l), c, uSatAmt), 0.0); return toSRGB(neutralTM(c)); }\n"

/* ---------------------------------------------------------------- túnel (tunnel.js) */
static const char *VS_TUNNEL =
"uniform mat4 uVP;\n"
"in vec3 aPos; in vec3 aN; in vec2 aUv; in vec4 aWarn; in vec2 aCell;\n"
"out vec2 vUv; out vec4 vWarn; out vec3 vN; out vec3 vW; out vec2 vCell;\n"
"void main(){ vUv = aUv; vWarn = aWarn; vN = aN; vCell = aCell; vW = aPos; gl_Position = uVP * vec4(aPos, 1.0); }\n";

static const char *FS_TUNNEL = SH_COMMON_FRAG
"uniform vec3 uBase; uniform vec3 uBase2; uniform vec3 uSeam; uniform vec3 uFog; uniform vec3 uGlow;\n"
"uniform vec3 uCam; uniform vec3 uKey; uniform float uFogNear; uniform float uFogFar; uniform float uTime;\n"
"uniform float uInvert; uniform vec2 uCellSize; uniform float uHit; uniform vec3 uRing; uniform float uOutside; uniform vec3 uSkyFill; uniform float uDark; uniform vec3 uInvBase;\n"
"in vec2 vUv; in vec4 vWarn; in vec3 vN; in vec3 vW; in vec2 vCell;\n"
"out vec4 fragColor;\n"
"float edgeDist(vec2 uv, vec2 size){ vec2 p = uv * size; vec2 q = min(p, size - p); return min(q.x, q.y); }\n"
"void main(){\n"
"  vec2 size = uCellSize;\n"
"  float d = edgeDist(vUv, size);\n"
"  float px = fwidth(d) + 1e-4;\n"
"  float seam = 1.0 - smoothstep(0.02 - px, 0.02 + px, d);\n"
"  float bevel = smoothstep(0.03, 0.26, d);\n"
"  vec2 sub = abs(fract(vUv * vec2(2.0, 2.0)) - 0.5) * size / 2.0;\n"
"  float subD = min(sub.x, sub.y);\n"
"  float subL = (1.0 - smoothstep(0.0, 0.008 + px, subD)) * 0.07;\n"
"  float ao = smoothstep(0.02, 0.12, d);\n"
"  vec3 N = normalize(vN);\n"
"  vec3 V = normalize(uCam - vW);\n"
"  float lam = mix(0.6, 0.86, uOutside) + mix(0.4, 0.14, uOutside) * max(dot(N, uKey), 0.0);\n"
"  float hemi = 0.5 + 0.5 * N.y;\n"
"  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);\n"
"  vec3 base = mix(uBase2, uBase, hemi);\n"
"  base *= 0.92 + 0.1 * vUv.y;\n"
"  vec3 col = base * lam;\n"
"  float wa = vWarn.a;\n"
"  vec3 warn = vWarn.rgb;\n"
"  float on = clamp((wa - 0.42) / 0.58, 0.0, 1.0);\n"
"  vec3 pastel = mix(warn, vec3(1.0), 0.3) * (0.82 + 0.18 * lam);\n"
"  vec3 vivid = warn * (0.85 + 0.15 * lam);\n"
"  if (wa > 0.0) col = mix(pastel, vivid, on);\n"
"  col += warn * on * 0.38;\n"
"  col *= mix(0.78, 1.0, bevel);\n"
"  col += 0.1 * (1.0 - bevel) * step(0.5, vUv.x) * (1.0 - clamp(wa * 2.0, 0.0, 1.0));\n"
"  col += uSkyFill * 0.14 * max(N.y, 0.0) * uOutside;\n"
"  col *= mix(0.86, 1.0, ao);\n"
"  vec3 seamC = mix(base * 0.45, uSeam, 0.6);\n"
"  col = mix(col, seamC, seam);\n"
"  col = mix(col, seamC, subL * (1.0 - clamp(wa * 2.0, 0.0, 1.0) * 0.5));\n"
"  vec3 H = normalize(uKey + V);\n"
"  col += vec3(1.0) * pow(max(dot(N, H), 0.0), 64.0) * 0.1 * (1.0 - clamp(wa, 0.0, 1.0) * 0.5);\n"
"  col += uGlow * fres * 0.25;\n"
"  float ringLine = (mod(vCell.y, 8.0) < 0.5) ? (1.0 - smoothstep(0.02, 0.16 + px * 2.0, vUv.y * size.y)) : 0.0;\n"
"  float ring = ringLine;\n"
"  float ringB2 = (mod(vCell.y, 8.0) < 0.5) ? (1.0 - smoothstep(0.0, 0.6, vUv.y * size.y)) : 0.0;\n"
"  col = mix(col, uRing * 1.3, ringB2 * 0.55 * (1.0 - uInvert));\n"
"  float pulse = 0.65 + 0.9 * smoothstep(0.88, 1.0, fract(vCell.y / 24.0 + uTime * 0.6));\n"
"  vec3 neon = mix(uGlow, vec3(1.0), 0.35 + 0.4 * uInvert) * pulse;\n"
"  vec3 inv = uInvBase * (0.7 + 0.3 * lam) * mix(0.8, 1.0, bevel) * (0.8 + 0.4 * hemi) * mix(0.8, 1.0, ao);\n"
"  inv = mix(inv, vec3(0.03, 0.028, 0.06), uInvert);\n"
"  if (wa > 0.0) inv = mix(warn * 0.4, warn * 1.1, on) + warn * on * 0.3;\n"
"  inv += neon * (seam * 1.25 + subL * 0.45 + ring * 1.0) * (1.0 - clamp(wa * 2.0, 0.0, 1.0) * 0.5);\n"
"  inv += vec3(1.0) * pow(max(dot(N, H), 0.0), 64.0) * 0.06;\n"
"  col = mix(col, inv, max(uInvert, uDark));\n"
"  float dist = length(uCam - vW);\n"
"  float fog = smoothstep(uFogNear, uFogFar, dist);\n"
"  col = mix(col, uFog, fog);\n"
"  col += uGlow * fog * (1.0 - fog) * 0.6 * smoothstep(80.0, 110.0, dist) * (1.0 - uOutside);\n"
"  col = mix(col, vec3(1.0, 0.25, 0.3), uHit * 0.35);\n"
"  fragColor = vec4(finish(col), 1.0);\n"
"}\n";

/* ---------------------------------------------------------------- cajas (boxes.js) */
static const char *VS_BOX =
"uniform mat4 uVP; uniform mat4 uModel; uniform vec3 uScale; uniform float uOutlineW;\n"
"in vec3 aPos; in vec3 aNrm;\n"
"out vec3 vN; out vec3 vW; out float vUpY;\n"
"void main(){\n"
"  vec3 p = aPos + aNrm * uOutlineW / uScale;\n"
"  vec4 w = uModel * vec4(p, 1.0); vW = w.xyz; vUpY = aPos.y;\n"
"  vN = mat3(uModel) * (aNrm / (uScale * uScale));\n"
"  gl_Position = uVP * w;\n"
"}\n";

static const char *FS_BOX = SH_COMMON_FRAG
"uniform vec3 uColor; uniform float uGlow; uniform vec3 uKey; uniform vec3 uCam; uniform float uHemiI; uniform float uFlat;\n"
"in vec3 vN; in vec3 vW; in float vUpY;\n"
"out vec4 fragColor;\n"
"void main(){\n"
"  if (uFlat > 0.5) { fragColor = vec4(finish(uColor), 1.0); return; }\n"
"  vec3 N = normalize(vN); vec3 V = normalize(uCam - vW);\n"
"  float gy = clamp(vUpY + 0.5, 0.0, 1.0);\n"
"  vec3 alb = uColor * mix(vec3(0.62, 0.55, 0.78), vec3(1.1), gy);\n"
"  vec3 hemi = mix(vec3(1.0, 0.80, 0.69), vec3(1.0), 0.5 + 0.5 * N.y) * uHemiI;\n"
"  float nl = max(dot(N, uKey), 0.0);\n"
"  vec3 col = alb * (hemi * 0.42 + vec3(1.0, 0.91, 0.79) * 1.3 * nl * 0.36 + 0.22);\n"
"  vec3 H = normalize(uKey + V);\n"
"  float nv = clamp(dot(N, V), 0.0, 1.0);\n"
"  float fr = 0.04 + 0.96 * pow(1.0 - nv, 5.0);\n"
"  col += vec3(1.0) * pow(max(dot(N, H), 0.0), 90.0) * 0.9;\n"      /* barniz (clearcoat) */
"  col += mix(vec3(0.9, 0.92, 1.0), alb, 0.3) * fr * 0.35;\n"        /* reflejo del entorno */
"  col += alb * (0.05 + 0.3 * uGlow);\n"
"  col += vec3(pow(1.0 - nv, 2.0)) * 0.35;\n"
"  fragColor = vec4(finish(col), 1.0);\n"
"}\n";

/* ---------------------------------------------------------------- monedas (coins.js) */
static const char *FS_COIN = SH_COMMON_FRAG
"uniform vec3 uColor; uniform float uGlow; uniform vec3 uKey; uniform vec3 uCam; uniform float uHemiI; uniform float uFlat;\n"
"in vec3 vN; in vec3 vW; in float vUpY;\n"
"out vec4 fragColor;\n"
"void main(){\n"
"  vec3 N = normalize(vN); vec3 V = normalize(uCam - vW);\n"
"  vec3 gold = vec3(1.0, 0.54, 0.01);\n"
"  float nl = max(dot(N, uKey), 0.0); float nv = clamp(abs(dot(N, V)), 0.0, 1.0);\n"
"  vec3 H = normalize(uKey + V);\n"
"  vec3 col = gold * (0.35 + 0.55 * nl + 0.35 * (0.5 + 0.5 * N.y) * uHemiI);\n"
"  col += gold * pow(1.0 - nv, 2.0) * 0.6;\n"
"  col += vec3(1.0, 0.85, 0.5) * pow(max(dot(N, H), 0.0), 40.0) * 1.2;\n"
"  col += vec3(1.0, 0.33, 0.0) * 0.15;\n"
"  fragColor = vec4(finish(col), 1.0);\n"
"}\n";

/* ---------------------------------------------------------------- placas (pads.js) */
static const char *VS_PAD =
"uniform mat4 uVP; uniform mat4 uModel;\n"
"in vec3 aPos; in vec3 aNrm;\n"
"out vec2 vUv;\n"
"void main(){ vUv = vec2(aPos.x + 0.5, aPos.z + 0.5); gl_Position = uVP * uModel * vec4(aPos, 1.0); }\n";

static const char *FS_PAD = SH_COMMON_FRAG
"uniform float uTime; uniform float uAlpha; uniform float uMain;\n"
"in vec2 vUv;\n"
"out vec4 fragColor;\n"
"float chev(vec2 p){\n"
"  float y = fract(p.y * 2.0 - uTime * 2.4);\n"
"  float x = abs(p.x - 0.5);\n"
"  float d = abs(y - 0.35 - x * 0.9);\n"
"  return 1.0 - smoothstep(0.07, 0.11, d);\n"
"}\n"
"void main(){\n"
"  vec2 uv = vUv;\n"
"  vec2 q = abs(uv - 0.5);\n"
"  float border = smoothstep(0.5, 0.44, max(q.x, q.y));\n"
"  float c = chev(uv) * smoothstep(0.46, 0.34, q.x);\n"
"  vec3 blue = mix(vec3(0.02, 0.2, 1.0), vec3(0.08, 0.72, 1.0), uv.y);\n"
"  vec3 col = mix(blue, vec3(0.92), c * 0.9);\n"
"  float a = uMain > 0.5 ? border : c * uAlpha;\n"
"  float m = max(q.x, q.y);\n"
"  float frame = smoothstep(0.41, 0.43, m) * (1.0 - smoothstep(0.47, 0.49, m));\n"
"  float navy = smoothstep(0.38, 0.4, m) * (1.0 - smoothstep(0.41, 0.42, m));\n"
"  col = mix(col, vec3(1.0), frame); col = mix(col, vec3(0.04, 0.1, 0.4), navy);\n"
"  vec3 outc = uMain > 0.5 ? min(col, vec3(1.0)) : vec3(0.3, 0.7, 1.0) * 0.9;\n"
"  if (a < 0.01) discard;\n"
"  fragColor = vec4(finish(outc), a);\n"
"}\n";

/* ---------------------------------------------------------------- cielo y mar de nubes (sky.js) */
static const char *VS_SKY =
"in vec3 aPos; in vec3 aNrm;\n"
"out vec2 vNdc;\n"
"void main(){ vNdc = aPos.xy; gl_Position = vec4(aPos.xy, 1.0, 1.0); }\n";

static const char *FS_SKY = SH_COMMON_FRAG
"uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform vec3 uSun; uniform vec3 uUp; uniform vec3 uSunDir;\n"
"uniform float uStars; uniform float uTime; uniform float uInvert;\n"
"uniform vec3 uCamF; uniform vec3 uCamR; uniform vec3 uCamU; uniform vec2 uTan;\n"
"uniform vec3 uSeaA; uniform vec3 uSeaB; uniform vec3 uSeaFog; uniform float uSeaAlpha; uniform vec2 uSeaOff; uniform float uSeaTime; uniform vec3 uSeaE1; uniform vec3 uSeaE2;\n"
"in vec2 vNdc;\n"
"out vec4 fragColor;\n"
"float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n"
"float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n"
"float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n"
"  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }\n"
"float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }\n"
"void main(){\n"
"  vec3 d = normalize(uCamF + uCamR * vNdc.x * uTan.x + uCamU * vNdc.y * uTan.y);\n"
"  vec3 up = normalize(uUp);\n"
"  float h = dot(d, up);\n"
"  vec3 col = h > 0.0 ? mix(uMid, uTop, pow(h, 0.55)) : mix(uMid, uBot, pow(-h, 0.45));\n"
"  float sd = max(dot(d, normalize(uSunDir)), 0.0);\n"
"  col += uSun * (pow(sd, 900.0) * 3.0 + pow(sd, 24.0) * 0.35 + pow(sd, 4.0) * 0.08);\n"
"  vec3 g = d * 180.0; vec3 id = floor(g); float r = hash(id);\n"
"  float st = step(0.985, r) * smoothstep(0.5, 0.0, length(fract(g) - 0.5)) * (0.6 + 0.4 * sin(uTime * 2.0 + r * 40.0));\n"
"  col += vec3(st) * uStars * smoothstep(-0.2, 0.3, h);\n"
"  vec3 night = mix(vec3(0.02, 0.015, 0.06), vec3(0.09, 0.04, 0.16), smoothstep(-0.3, 0.6, h)) + vec3(st) * 1.2;\n"
"  col = mix(col, night, uInvert);\n"
/* el mar de nubes: un plano 110 m por debajo, en vez de un disco de verdad */
"  if (uSeaAlpha > 0.0 && h < -0.01) {\n"
"    vec3 hit = d * (110.0 / -h) + up * 110.0;\n"
"    float vD = length(hit);\n"
"    if (vD < 1600.0) {\n"
"      vec2 vP = vec2(dot(hit, uSeaE1), dot(hit, uSeaE2));\n"
"      vec2 p = vP / 180.0 + uSeaOff;\n"
"      float c = fbm(p + vec2(uSeaTime * 0.01, 0.0));\n"
"      float puff = smoothstep(0.38, 0.72, c);\n"
"      vec3 sc = mix(uSeaB, uSeaA, puff);\n"
"      sc = mix(uSeaFog, sc, smoothstep(1500.0, 300.0, vD));\n"
"      col = mix(col, sc, uSeaAlpha * smoothstep(1600.0, 900.0, vD));\n"
"    }\n"
"  }\n"
"  fragColor = vec4(finish(col), 1.0);\n"
"}\n";

/* ---------------------------------------------------------------- destello a pantalla completa */
static const char *FS_FLASH =
"uniform vec4 uFlash; uniform vec3 uVigCol; uniform float uVig;\n"
"in vec2 vNdc;\n"
"out vec4 fragColor;\n"
"void main(){\n"
"  float r = length(vNdc * vec2(0.5, 0.5) - vec2(0.0, -0.02));\n"
"  float v = uVig * smoothstep(0.35, 0.95, r * 1.25);\n"
"  vec3 c = mix(uVigCol, uFlash.rgb, uFlash.a / max(uFlash.a + v, 1e-4));\n"
"  fragColor = vec4(c, clamp(uFlash.a + v, 0.0, 1.0));\n"
"}\n";

/* ---------------------------------------------------------------- HUD 2D */
static const char *VS_HUD =
"uniform vec2 uScreen;\n"
"in vec2 aPos; in vec4 aCol; in vec2 aLocal; in vec3 aBox;\n"
"out vec4 vCol; out vec2 vLocal; out vec3 vBox;\n"
"void main(){ vCol = aCol; vLocal = aLocal; vBox = aBox;\n"
"  gl_Position = vec4(aPos.x / uScreen.x * 2.0 - 1.0, 1.0 - aPos.y / uScreen.y * 2.0, 0.0, 1.0); }\n";

static const char *FS_HUD =
"in vec4 vCol; in vec2 vLocal; in vec3 vBox;\n"
"out vec4 fragColor;\n"
"void main(){\n"
"  vec2 q = abs(vLocal) - vBox.xy + vBox.z;\n"
"  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vBox.z;\n"
"  float a = clamp(0.5 - d, 0.0, 1.0);\n"
"  fragColor = vec4(vCol.rgb, vCol.a * a);\n"
"}\n";

#endif
