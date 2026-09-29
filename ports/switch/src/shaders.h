/* Sombreadores: el cuerpo es común a GLSL 3.30 core (escritorio) y GLSL ES 3.00 (Switch); el
 * prefijo #version lo pone render.c según el contexto que se haya conseguido.
 * Todo se calcula en espacio lineal y cada sombreador termina con finish(): la saturación del
 * pase de gradación de la web (1,08), el tono neutro de Three (NeutralToneMapping) y la
 * conversión a sRGB del OutputPass. Así no hace falta posproceso para que los colores cuadren. */
#ifndef HT_SHADERS_H
#define HT_SHADERS_H

#define SH_COMMON_FRAG \
"uniform float uSatAmt; uniform float uLinear;\n" \
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
"vec3 grade(vec3 c){ float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(l), c, uSatAmt), 0.0);\n" \
"  c = max(vec3(0.0), (c - 0.18) * 1.12 + 0.18);\n" \
"  c *= mix(vec3(0.95, 0.98, 1.07), vec3(1.05, 1.0, 0.93), smoothstep(0.03, 0.5, dot(c, vec3(0.2126, 0.7152, 0.0722))));\n" \
"  return toSRGB(neutralTM(c)); }\n" \
"/* con posproceso (uLinear) la escena sale en lineal HDR y la gradación la hace el último pase */\n" \
"vec3 finish(vec3 c){ return uLinear > 0.5 ? max(c, 0.0) : grade(c); }\n"

/* ---------------------------------------------------------------- túnel (tunnel.js) */
static const char *VS_TUNNEL =
"uniform mat4 uVP;\n"
"in vec3 aPos; in vec3 aN; in vec2 aUv; in vec4 aWarn; in vec2 aCell;\n"
"out vec2 vUv; out vec4 vWarn; out vec3 vN; out vec3 vW; out vec2 vCell;\n"
"void main(){ vUv = aUv; vWarn = aWarn; vN = aN; vCell = aCell; vW = aPos; gl_Position = uVP * vec4(aPos, 1.0); }\n";

static const char *FS_TUNNEL = SH_COMMON_FRAG
/* Losas de piedra del kit de la web (tunnelkit.js + stylize.js): textura de sillería con relieve
 * (normal map), sol fijo en la pista con la sombra del color del mundo, arcos en las juntas cada 4
 * filas, anillo con incrustación dorada cada 8, cristal en los carriles de aviso y, en los mundos
 * oscuros, juntas que brillan. */
"uniform sampler2D tAlb; uniform sampler2D tNrm; uniform sampler2D tOrm; uniform sampler2D tCAlb; uniform sampler2D tCNrm;\n"
"uniform vec3 uFog; uniform vec3 uGlow; uniform vec3 uCam; uniform float uFogNear; uniform float uFogFar; uniform float uTime;\n"
"uniform float uInvert; uniform float uHit; uniform float uDark; uniform vec3 uInvBase;\n"
"uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uShadowCol; uniform vec3 uInlay; uniform vec3 uSeamGlow; uniform vec3 uTint; uniform float uGlowK;\n"
"in vec2 vUv; in vec4 vWarn; in vec3 vN; in vec3 vW; in vec2 vCell;\n"
"out vec4 fragColor;\n"
"float dwin(float z){ if (z <= 0.35 || z >= 3.65) return 0.0; if (z < 0.69) return sqrt(max(0.0, 0.1156 - (0.69 - z) * (0.69 - z))); if (z > 3.31) return sqrt(max(0.0, 0.1156 - (z - 3.31) * (z - 3.31))); return 0.34; }\n"
"vec3 perturb(vec3 N, vec3 P, vec2 uv, vec3 nm){\n"
"  vec3 dp1 = dFdx(P), dp2 = dFdy(P); vec2 du1 = dFdx(uv), du2 = dFdy(uv);\n"
"  vec3 d2 = cross(dp2, N), d1 = cross(N, dp1);\n"
"  vec3 T = d2 * du1.x + d1 * du2.x, B = d2 * du1.y + d1 * du2.y;\n"
"  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));\n"
"  return normalize(mat3(T * im, B * im, N) * nm);\n"
"}\n"
"void main(){\n"
"  float k = vCell.y, z = vUv.y * 4.0, xe = min(vUv.x, 1.0 - vUv.x) * 2.07;\n"
"  bool arch = mod(k, 4.0) < 0.5;\n"
"  if (arch && xe < dwin(z)) discard;\n"
"  float wa = vWarn.a; vec3 warn = vWarn.rgb;\n"
"  float on = clamp((wa - 0.42) / 0.58, 0.0, 1.0);\n"
"  vec3 N0 = normalize(vN); vec3 V = normalize(uCam - vW);\n"
"  float tile = fract(sin(dot(vCell, vec2(12.9898, 78.233))) * 43758.5453);\n"
"  vec3 col; vec3 emis = vec3(0.0);\n"
"  if (wa > 0.0) {\n"
"    vec3 ca = texture(tCAlb, vUv).rgb;\n"
"    vec3 N = perturb(N0, vW, vUv, texture(tCNrm, vUv).xyz * 2.0 - 1.0);\n"
"    vec3 base = ca * mix(mix(warn, vec3(1.0), 0.35), warn * mix(vec3(1.0), warn, 0.6), on);\n"
"    float ndl = dot(N, uSunDir), sh = smoothstep(0.35, -0.35, ndl) * 0.6;\n"
"    col = mix(base * uSunCol * (0.9 + 0.3 * max(ndl, 0.0)), base * uShadowCol, sh);\n"
"    float rimC = smoothstep(0.8, 0.95, dot(ca, vec3(0.3333)));\n"
"    float fres = pow(1.0 - abs(dot(N, V)), 3.0);\n"
"    vec3 glowC = mix(warn, vec3(1.0), 0.35);\n"
"    emis = (warn * (0.06 + 0.3 * on) + glowC * rimC * (0.1 + 0.3 * on) + glowC * fres * (0.08 + 0.15 * on)) * uGlowK;\n"
"  } else {\n"
"    vec2 uvT = vec2(vUv.x, vUv.y * 0.875);\n"
"    vec3 alb = texture(tAlb, uvT).rgb;\n"
"    alb = mix(vec3(dot(alb, vec3(0.2126, 0.7152, 0.0722))), alb, 0.8) * 1.15;   /* arenisca más clara, como la web con su luz ambiente */\n"
"    vec3 orm = texture(tOrm, uvT).rgb;\n"
"    vec3 N = perturb(N0, vW, uvT, texture(tNrm, uvT).xyz * 2.0 - 1.0);\n"
"    vec3 base = alb * uTint * (0.94 + 0.12 * tile) * mix(vec3(1.0), vec3(0.93, 1.02, 0.9), step(0.82, fract(tile * 7.13)));\n"
"    bool rib = mod(k, 8.0) < 0.5;\n"
"    float kz = vUv.y;\n"
"    if (rib) base *= 1.0 - 0.28 * (1.0 - smoothstep(0.075, 0.09, kz));\n"
"    float ndl = dot(N, uSunDir), sh = smoothstep(0.35, -0.35, ndl) * 0.6;\n"
"    float lb = dot(base, vec3(0.3333));\n"
"    vec3 shade = mix(base * uShadowCol, vec3(lb) * uShadowCol * 1.2, 0.6) + uShadowCol * 0.05;\n"
"    col = mix(base * uSunCol * (0.9 + 0.3 * max(ndl, 0.0)), shade, sh);\n"
"    col *= mix(1.0, orm.r, 0.85);\n"
"    if (rib) emis += uInlay * 1.4 * smoothstep(0.022, 0.03, kz) * (1.0 - smoothstep(0.05, 0.058, kz));\n"
"    emis += uSeamGlow * (1.0 - smoothstep(0.1, 0.15, dot(alb, vec3(0.2126, 0.7152, 0.0722))));\n"
"  }\n"
"  col += emis;\n"
"  /* tránsito entre mundos: el túnel se apaga y solo brillan las juntas */\n"
"  col = mix(col, uInvBase * 0.6 + uGlow * emis * 0.5, uInvert);\n"
"  float dist = length(uCam - vW);\n"
"  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));\n"
"  col = mix(col, vec3(1.0, 0.25, 0.3), uHit * 0.35);\n"
"  fragColor = vec4(finish(col), 1.0);\n"
"}\n";

/* ---------------------------------------------------------------- cajas (boxes.js) */
static const char *VS_BOX =
"uniform mat4 uVP; uniform mat4 uModel; uniform vec3 uScale; uniform float uOutlineW;\n"
"in vec3 aPos; in vec3 aNrm;\n"
"out vec3 vN; out vec3 vW; out float vUpY; out vec3 vL;\n"
"void main(){\n"
"  vec3 p = aPos + aNrm * uOutlineW / uScale;\n"
"  vec4 w = uModel * vec4(p, 1.0); vW = w.xyz; vUpY = aPos.y; vL = aPos;\n"
"  vN = mat3(uModel) * (aNrm / (uScale * uScale));\n"
"  gl_Position = uVP * w;\n"
"}\n";

static const char *FS_BOX = SH_COMMON_FRAG
/* Cajas como las de la web (boxes.js): las fijas, bloques de piedra teñidos de su color con la runa
 * X luminosa y las aristas encendidas; las rodantes, cubos de cristal. Una caja larga se reparte en
 * bloques casi cúbicos (uBlocks) para que la runa no se estire. */
"uniform vec3 uColor; uniform float uGlow; uniform vec3 uCam; uniform float uFlat; uniform float uCrystal;\n"
"uniform sampler2D tAlb; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uShadowCol; uniform vec3 uBlocks;\n"
"in vec3 vN; in vec3 vW; in float vUpY; in vec3 vL;\n"
"out vec4 fragColor;\n"
"void main(){\n"
"  if (uFlat > 0.5) { fragColor = vec4(finish(uColor), 1.0); return; }\n"
"  vec3 N = normalize(vN); vec3 V = normalize(uCam - vW);\n"
"  vec3 q = fract((vL + 0.5) * uBlocks) - 0.5;          /* posición dentro de su bloque, −0,5..0,5 */\n"
"  vec3 a = abs(q);\n"
"  float mid = a.x + a.y + a.z - max(a.x, max(a.y, a.z)) - min(a.x, min(a.y, a.z));\n"
"  float edge = smoothstep(0.34, 0.44, mid);\n"
"  vec3 al = abs(vL); vec2 f;\n"
"  if (al.x > al.y && al.x > al.z) f = q.zy; else if (al.y > al.z) f = q.xz; else f = q.xy;\n"
"  float ndl = dot(N, uSunDir), sh = smoothstep(0.35, -0.35, ndl) * 0.6;\n"
"  float fres = pow(1.0 - abs(dot(N, V)), 3.0);\n"
"  vec3 col;\n"
"  if (uCrystal > 0.5) {\n"
"    vec3 base = mix(uColor, vec3(1.0), 0.15) * 0.75;\n"
"    col = mix(base * uSunCol, base * uShadowCol, sh) * 0.8;\n"
"    col += uColor * (0.25 + 0.5 * uGlow) + mix(uColor, vec3(1.0), 0.5) * (fres * 0.9 + edge * 0.8);\n"
"  } else {\n"
"    vec3 st = texture(tAlb, (f + 0.5) * vec2(0.42, 0.2) + vec2(0.05, 0.03)).rgb * 1.6;\n"
"    vec3 base = st * uColor * 0.8;\n"
"    col = mix(base * uSunCol * (0.9 + 0.3 * max(ndl, 0.0)), base * uShadowCol, sh);\n"
"    vec2 g = abs(f);\n"
"    float xr = step(max(g.x, g.y), 0.3) * (1.0 - smoothstep(0.035, 0.06, abs(abs(f.x) - abs(f.y))));\n"
"    float fr = step(0.3, max(g.x, g.y)) * (1.0 - step(0.37, max(g.x, g.y)));\n"
"    col += uColor * (0.14 + edge * 1.0 + fres * 0.45) + uColor * (1.9 + uGlow * 1.6) * max(xr, fr * 0.8);\n"
"  }\n"
"  fragColor = vec4(finish(col), 1.0);\n"
"}\n";

/* ---------------------------------------------------------------- monedas (coins.js) */
static const char *FS_COIN = SH_COMMON_FRAG
"uniform vec3 uColor; uniform float uGlow; uniform vec3 uKey; uniform vec3 uCam; uniform float uHemiI; uniform float uFlat;\n"
"in vec3 vN; in vec3 vW; in float vUpY; in vec3 vL;\n"
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
"uniform sampler2D tPanoA; uniform sampler2D tPanoB; uniform float uPanoT; uniform vec3 uFwd; uniform float uIn;\n"
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
"  /* paisaje de 360° del mundo (sky.js): equirectangular orientado con el arriba y el frente */\n"
"  { vec3 fw = normalize(uFwd - up * dot(uFwd, up)); vec3 rt = cross(fw, up);\n"
"    float lon = atan(dot(d, rt), dot(d, fw)); float lat = asin(clamp(h, -1.0, 1.0));\n"
"    vec2 puv = vec2(lon / 6.2831853 + 0.5 + uTime * 0.0015, 0.5 - lat / 3.14159265);\n"
"    vec3 pano = mix(texture(tPanoA, puv).rgb, texture(tPanoB, puv).rgb, uPanoT);\n"
"    pano = mix(pano, uMid, smoothstep(-0.6, -0.9, h) * 0.5);\n"
"    col = pano * 1.05 + uSun * pow(sd, 900.0) * 2.0;\n"
"    vec3 thru = mix(uMid, uTop, 0.55); thru = mix(vec3(dot(thru, vec3(0.2126, 0.7152, 0.0722))), thru, 0.6) * 0.85;\n"
"    col = mix(col, thru, uIn * 0.45);\n"
"    float colL = dot(col, vec3(0.2126, 0.7152, 0.0722));\n"
"    col = mix(col, vec3(colL * 0.8 + 0.12) * mix(vec3(1.0), uMid, 0.25), uIn * smoothstep(0.05, -0.25, h) * 0.85); }\n"
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
"in vec2 aPos; in vec4 aCol; in vec2 aLocal; in vec3 aBox; in vec3 aTex;\n"
"out vec4 vCol; out vec2 vLocal; out vec3 vBox; out vec3 vTex;\n"
"void main(){ vCol = aCol; vLocal = aLocal; vBox = aBox; vTex = aTex;\n"
"  gl_Position = vec4(aPos.x / uScreen.x * 2.0 - 1.0, 1.0 - aPos.y / uScreen.y * 2.0, 0.0, 1.0); }\n";

static const char *FS_HUD =
"uniform sampler2D tFont;\n"
"in vec4 vCol; in vec2 vLocal; in vec3 vBox; in vec3 vTex;\n"
"out vec4 fragColor;\n"
"void main(){\n"
/* texto: campo de distancia de Fredoka; vTex.z es el umbral (más bajo = trazo más gordo, contorno) */
"  if (vTex.z > 0.0) { float d = texture(tFont, vTex.xy).r; float w = max(fwidth(d) * 0.7, 0.01);\n"
"    fragColor = vec4(vCol.rgb, vCol.a * smoothstep(vTex.z - w, vTex.z + w, d)); return; }\n"
"  vec2 q = abs(vLocal) - vBox.xy + vBox.z;\n"
"  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vBox.z;\n"
"  float a = clamp(0.5 - d, 0.0, 1.0);\n"
"  fragColor = vec4(vCol.rgb, vCol.a * a);\n"
"}\n";

/* ---------------------------------------------------------------- posproceso (bloom + gradación) */
/* pase de brillo (UnrealBloomPass: umbral 1,22 sobre la luminancia) y bajada a media resolución */
static const char *FS_BRIGHT =
"uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr;\n"
"in vec2 vNdc;\n"
"out vec4 fragColor;\n"
"void main(){ vec2 uv = vNdc * 0.5 + 0.5;\n"
"  vec3 c = (texture(tSrc, uv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tSrc, uv + uTexel * vec2(1.0, -1.0)).rgb + texture(tSrc, uv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tSrc, uv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;\n"
"  float l = dot(c, vec3(0.299, 0.587, 0.114));\n"
"  fragColor = vec4(c * smoothstep(uThr, uThr + 0.01, l), 1.0); }\n";
/* bajada con filtro de 13 muestras simplificado (4 bilineales) */
static const char *FS_DOWN =
"uniform sampler2D tSrc; uniform vec2 uTexel;\n"
"in vec2 vNdc;\n"
"out vec4 fragColor;\n"
"void main(){ vec2 uv = vNdc * 0.5 + 0.5;\n"
"  vec3 c = texture(tSrc, uv).rgb * 0.5 + (texture(tSrc, uv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tSrc, uv + uTexel * vec2(1.0, -1.0)).rgb + texture(tSrc, uv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tSrc, uv + uTexel * vec2(1.0, 1.0)).rgb) * 0.125;\n"
"  fragColor = vec4(c, 1.0); }\n";
/* subida con filtro tienda, sumando al nivel de arriba (se usa con mezcla aditiva) */
static const char *FS_UP =
"uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uK;\n"
"in vec2 vNdc;\n"
"out vec4 fragColor;\n"
"void main(){ vec2 uv = vNdc * 0.5 + 0.5; vec2 t = uTexel * 1.5;\n"
"  vec3 c = texture(tSrc, uv).rgb * 4.0\n"
"    + (texture(tSrc, uv + vec2(t.x, 0.0)).rgb + texture(tSrc, uv - vec2(t.x, 0.0)).rgb + texture(tSrc, uv + vec2(0.0, t.y)).rgb + texture(tSrc, uv - vec2(0.0, t.y)).rgb) * 2.0\n"
"    + texture(tSrc, uv + t).rgb + texture(tSrc, uv - t).rgb + texture(tSrc, uv + vec2(t.x, -t.y)).rgb + texture(tSrc, uv + vec2(-t.x, t.y)).rgb;\n"
"  fragColor = vec4(c / 16.0 * uK, 1.0); }\n";
/* composición final: escena + bloom, gradación de la web, viñeta, tono neutro y sRGB */
static const char *FS_POST = SH_COMMON_FRAG
"uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloomK; uniform float uVig; uniform vec3 uVigCol; uniform float uBlur;\n"
"in vec2 vNdc;\n"
"out vec4 fragColor;\n"
"void main(){ vec2 uv = vNdc * 0.5 + 0.5; vec2 d = uv - vec2(0.5, 0.52); float r = length(d);\n"
/* desenfoque radial solo en los bordes con la velocidad (el centro, donde miras, nítido) */
"  float amt = uBlur * smoothstep(0.18, 0.75, r); vec3 acc = vec3(0.0); float tot = 0.0;\n"
"  for (int i = 0; i < 5; i++) { float t = float(i) / 4.0; float w = 1.0 - t * 0.6; acc += texture(tScene, uv - d * amt * t).rgb * w; tot += w; }\n"
"  vec3 col = acc / tot + texture(tBloom, uv).rgb * uBloomK;\n"
"  col = mix(col, col * uVigCol * 1.6, uVig * smoothstep(0.35, 0.95, r * 1.25));\n"
"  fragColor = vec4(grade(col), 1.0); }\n";

#endif
