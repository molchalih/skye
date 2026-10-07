// <weather-sky-v6 scene="clear|cloudy|fog|rainy|storm|sleet|snowy|haze" hour="17.5" cover="0.4" intensity="0.6" quality="auto|low|balanced|high"
//                 glass="1" focus="0.45" seed="0" wind="" dim="1" lat="52.37" day="" noon="12.7" moon="" motion="auto|full|static" blur="0">
// v6 = v5's look, re-plumbed for cost. Same scenes, solar/lunar model, glass, post effects and eased transitions. What changed:
//  · the frame is split by frequency content. Soft sky (gradients, glows, Milky Way, cloud sheets, fog, rainbow, bolt glow) renders into a
//    small HDR buffer (0.3–0.5× canvas); sharp features (sun disc, moon disc, stars, meteors, bolt core) are composited on top at scene
//    resolution, using the cloud transmittance the sky pass stores in its alpha. Clouds are the dominant cost and are ~2–3× cheaper per pixel:
//    3 fbm taps per sheet instead of 5 (light-facing slope replaces the 2-tap normal, 1 shadow tap), the warp noise is shared across taps,
//    and octaves are capped by the buffer's Nyquist limit so no sub-pixel octaves are evaluated.
//  · crepuscular rays gather in their own quarter-res pass (skipped entirely when the sun is not up / clouds do not qualify) and are read as one
//    texture sample in the glass pass instead of a 14–24 tap loop per screen pixel.
//  · blur is a renderer attribute, not a CSS filter. With blur="12" the whole chain shrinks (canvas backing, sky and scene buffers scale with the
//    blur radius), the glass pass writes to a small texture and a 13-tap separable Gaussian produces the final image, which the compositor
//    upscales bilinearly. Frame rate drops to 30 while blurred. The blur value runs a fixed 0.62 s eased tween so tab switches cross-fade.
//  · auto quality is driven by measured GPU time (EXT_disjoint_timer_query_webgl2) with an interval-based fallback; tiers step both ways.
//  · getStats() exposes GPU/CPU ms, fps, buffer sizes and shaded megapixels per frame for benchmarking and the perf HUD.
(function () {
  const VS_FULL = `#version 300 es
layout(location=0) in vec2 a; out vec2 vUv; void main(){ vUv = a*0.5+0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

  const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
const mat2 ROT = mat2(1.616, 1.212, -1.212, 1.616);
float fbm(vec2 p, int oct){ float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 6; i++){ if (i >= oct) break; s += a*vnoise(p); n += a; p = ROT*p + 17.3; a *= 0.5; } return s/n; }`;

  // pass 1 — soft sky at reduced resolution. alpha = cloud transmittance × fog/tint attenuation, consumed by the composite pass.
  const SKY_FS = `#version 300 es
precision highp float;
uniform vec2 uRes, uSunPos, uMoonPos, uLPos, uFlashPos, uASun, uBoltPos;
uniform float uTime, uWindT, uCover, uSeed, uNight, uFlash, uCloudDark, uEl, uSunUp, uRainy, uSnowy, uEnc, uFog, uHaze, uBolt, uBoltSeed, uRainbow, uMoonPhase, uBelt, uStar, uStorm;
uniform int uStart, uEnd, uOctCap;
uniform vec3 uSunCol, uMoonCol, uLCol, uZenith, uHorizon;
in vec2 vUv; out vec4 o;
${NOISE}
vec3 spectrum(float t){ t = clamp(t, 0.0, 1.0);
  return clamp(vec3(smoothstep(0.4, 0.9, t) + 0.45*smoothstep(0.15, 0.0, t), sin(t*3.1416)*0.9, smoothstep(0.55, 0.05, t)), 0.0, 1.0); }
float cov2(vec2 q, int oct, float th, float soft){ return smoothstep(th, th + soft*2.6, fbm(q, oct)); }
void main(){
  float asp = uRes.x/uRes.y;
  vec2 p = (vUv - 0.5)*vec2(asp, 1.0);
  float ty = clamp(vUv.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(ty, 0.55));
  vec3 urban = vec3(0.9, 0.62, 0.38)*uNight*(1.0 - 0.5*uFog);
  col += urban*0.03*exp(-ty*3.5);
  if (uBelt > 0.001) {
    float side = smoothstep(-0.3, 0.7, p.x*sign(uASun.x + 1e-4));
    col += vec3(0.95, 0.42, 0.48)*uBelt*side*exp(-pow((ty - 0.24)/0.14, 2.0))*0.22;
    col = mix(col, col*vec3(0.72, 0.78, 1.05), uBelt*side*exp(-pow((ty - 0.06)/0.09, 2.0))*0.5);
  }
  float sd = length(p - uSunPos);
  col += uSunCol*(0.22*exp(-sd*sd*14.0) + 0.05*exp(-sd*sd*3.0) + 0.012*exp(-sd*1.5) + 0.10*exp(-sd*2.5)*uHaze)*uSunUp*(1.0 - 0.8*uCover)*(1.0 - 0.7*uRainy)*(1.0 - 0.8*uStorm);
  float md = length(p - uMoonPos);
  float illum = 0.5 - 0.5*cos(uMoonPhase*6.2832);
  col += uMoonCol*0.18*exp(-md*md*12.0)*(0.15 + 0.85*illum);
  if (uStar > 0.001) {
    float band = exp(-pow((p.y*0.8 + p.x*0.45 - 0.15)/0.26, 2.0));
    float mw = smoothstep(0.35, 0.8, fbm(p*vec2(2.2, 3.5) + uSeed, 4));
    col += vec3(0.55, 0.6, 0.85)*mw*band*0.06*uStar*smoothstep(0.15, 0.55, ty);
  }
  // cloud sheets on a foreshortened sky plane
  vec2 q0 = vec2(p.x, p.y*0.75)/(p.y*0.35 + 1.0);
  vec2 sunDir2 = normalize(uLPos - p + vec2(0.0, 1e-4));
  float elc = clamp(abs(uEl), 0.0, 1.0);
  float la = 1.0 - 0.6*elc, lb = 0.3 + 0.7*elc, ln = inversesqrt(la*la + lb*lb);
  const float SC[5] = float[5](7.5, 5.0, 3.3, 2.2, 1.4);
  const float SP[5] = float[5](0.25, 0.45, 0.75, 1.2, 1.9);
  const float SOFT[5] = float[5](0.22, 0.16, 0.14, 0.18, 0.30);
  const float OP[5] = float[5](0.5, 0.85, 0.95, 0.9, 0.7);
  const float BIAS[5] = float[5](0.0, 0.02, 0.05, 0.10, 0.16);
  const int OCT[5] = int[5](6, 6, 6, 5, 4);
  float th0 = mix(0.72, 0.38, uCover);
  float ovc = smoothstep(0.45, 1.0, uCover)*0.55;
  float dirL = 1.0 - 0.8*ovc;
  float zc = 2.5 + 5.0*ovc;
  vec3 ambient = mix(uHorizon, uZenith, 0.5)*(1.0 - 0.45*uCloudDark) + urban*0.045*(1.0 - ty*0.6);
  float lnear = exp(-length(p - uLPos)*2.2);
  float fdist = exp(-length(p - uFlashPos)*2.5);
  float trans = 1.0;
  for (int i = 0; i < 5; i++) {
    if (i < uStart || i > uEnd) continue;
    float sc = SC[i];
    // octave cap: never evaluate an octave whose wavelength is under ~2 buffer pixels
    int oct = min(min(OCT[i], uOctCap), int(log2(uRes.y/(sc*2.0))));
    oct = max(3, oct - int(ovc*2.0));
    float th = th0 + BIAS[i]; float soft = SOFT[i]*(1.0 + 1.2*ovc);
    vec2 q = q0*sc + vec2(uWindT*0.11*SP[i], uWindT*0.012*SP[i]) + vec2(uSeed*3.1 + float(i)*13.7, float(i)*7.3);
    q += (vec2(vnoise(q*0.35 + uTime*0.09), vnoise(q*0.35 + 7.7 - uTime*0.07)) - 0.5)*0.5;
    float d = fbm(q, oct);
    float c = smoothstep(th, th + soft, d);
    if (c < 0.002) continue;
    float t2 = smoothstep(th, th + soft*2.6, d);
    float tn = cov2(q + sunDir2*0.03, oct, th, soft);
    float s1 = cov2(q + sunDir2*0.09*sc, oct, th, soft);
    float D = (tn - t2)*33.333;
    float ndl = pow(clamp((zc*lb - D*la)*ln*inversesqrt(D*D + zc*zc), 0.0, 1.0), 1.5);
    float shd = exp(-(s1*1.1 + (0.5*tn + 0.5*s1)*0.7)*(0.9 + 1.4*uCloudDark)*dirL);
    vec3 alb = mix(vec3(1.0), vec3(0.58, 0.62, 0.70), uCloudDark*(0.4 + 0.6*t2));
    alb = mix(alb, vec3(0.45, 0.47, 0.55), uStorm*0.4*t2);
    vec3 lit = ambient*(1.0 - 0.55*t2*(1.0 - 0.5*ovc)) + uLCol*(0.15 + 0.85*mix(ndl, 0.4, ovc))*shd*(1.0 - 0.7*t2)*(1.0 - 0.5*uCloudDark)*mix(1.0, 0.5, ovc);
    lit += uLCol*(1.0 - t2)*(0.35 + 1.0*lnear)*(1.0 - uCloudDark*0.7)*dirL;
    lit += vec3(0.75, 0.82, 1.0)*uFlash*fdist*(2.0 + 4.0*t2);
    vec3 cc = alb*lit;
    cc = mix(cc, uHorizon*1.1, float(4 - i)*0.08*(1.0 - ty*0.5));
    cc = mix(cc, ambient*alb*(1.0 - 0.3*t2), 0.25*ovc);
    col = mix(col, cc, c*OP[i]);
    trans *= 1.0 - c*OP[i];
  }
  float att = 1.0;
  if (uRainbow > 0.001) {
    float rd = length(p - uASun); float b1 = (rd - 0.80)/0.07; float b2 = (rd - 0.93)/0.10;
    float in1 = step(0.0, b1)*step(b1, 1.0), in2 = step(0.0, b2)*step(b2, 1.0);
    vec3 bow = spectrum(b1)*sin(clamp(b1, 0.0, 1.0)*3.1416)*in1*0.32 + spectrum(1.0 - clamp(b2, 0.0, 1.0))*sin(clamp(b2, 0.0, 1.0)*3.1416)*in2*0.09;
    col += bow*uRainbow*(0.4 + 0.6*trans)*smoothstep(-0.55, -0.2, p.y)*1.8;
  }
  if (uBolt > 0.001) {
    float yb = uBoltPos.y - p.y; float len = 0.95; float along = clamp(yb/len, 0.0, 1.0);
    float xoff = (vnoise(vec2(p.y*5.0 + uBoltSeed*13.0, uBoltSeed*17.0)) - 0.5)*0.36*along + (vnoise(vec2(p.y*24.0 + uBoltSeed*7.0, 3.1)) - 0.5)*0.06;
    float bx = uBoltPos.x + xoff; float d = abs(p.x - bx);
    float vis = step(0.0, yb)*step(yb, len)*(1.0 - along*0.55);
    float by = uBoltPos.y - 0.3*len; float bal = clamp((by - p.y)/0.35, 0.0, 1.0);
    float bxb = bx + 0.02 + (vnoise(vec2(p.y*15.0 + 9.0, uBoltSeed*3.0)) - 0.5)*0.12 + bal*0.24*(uBoltSeed - 0.5)*2.0;
    float db = abs(p.x - bxb)*1.4; float visb = step(0.0, by - p.y)*step(by - p.y, 0.35)*(1.0 - bal);
    float glow = exp(-d*45.0)*vis + exp(-db*60.0)*visb*0.5;
    col += vec3(0.85, 0.9, 1.0)*uBolt*glow*0.8*(0.35 + 0.65*trans);
  }
  if (uFog > 0.001) {
    vec2 fq = vec2(p.x, p.y*1.5);
    float m1 = fbm(fq*1.3 + vec2(uWindT*0.06, uTime*0.012) + uSeed, 4);
    float m2 = fbm(fq*3.1 + vec2(-uWindT*0.10, 5.0 + uTime*0.02), 4);
    float mist = smoothstep(0.2, 0.8, m1*0.6 + m2*0.4);
    float dens = clamp(uFog*(0.35 + 0.7*mist)*mix(1.1, 0.7, ty), 0.0, 1.0);
    float ld = length(p - uLPos);
    vec3 fogCol = mix(uHorizon, uZenith, 0.35)*1.15 + uLCol*(0.35*exp(-ld*1.4) + 0.06) + uSunCol*0.10*exp(-sd*sd*3.0)*uSunUp;
    col = mix(col, fogCol, dens); att *= 1.0 - dens;
  }
  float k1 = uHaze*0.45*(1.0 - ty)*(1.0 - ty*0.5); col = mix(col, uHorizon*1.15, k1); att *= 1.0 - k1;
  float k2 = uRainy*0.3*(1.0 - ty)*(1.0 - ty); col = mix(col, uHorizon*0.9, k2); att *= 1.0 - k2;
  float k3 = uSnowy*0.25*(1.0 - ty); col = mix(col, uHorizon*1.1, k3); att *= 1.0 - k3;
  col += vec3(0.7, 0.78, 1.0)*uFlash*0.12;
  o = vec4(max(col, 0.0)*uEnc, trans*att);
}`;

  // pass 2 — upsample the sky and add the sharp features at scene resolution
  const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uSky; uniform vec2 uRes, uSunPos, uMoonPos, uBoltPos;
uniform float uTime, uSeed, uSunUp, uMoonUp, uMoonPhase, uStar, uEnc, uHide, uBolt, uBoltSeed;
uniform vec3 uSunCol, uMoonCol;
in vec2 vUv; out vec4 o;
${NOISE}
void main(){
  vec4 s = texture(uSky, vUv); vec3 col = s.rgb; float T = s.a;
  float asp = uRes.x/uRes.y; vec2 p = (vUv - 0.5)*vec2(asp, 1.0); float ty = vUv.y;
  vec3 add = vec3(0.0);
  float md = length(p - uMoonPos); const float MR = 0.032;
  if (md < MR*1.1 && uMoonUp > 0.001) {
    vec2 d = (p - uMoonPos)/MR; float z = sqrt(max(0.0, 1.0 - dot(d, d))); vec3 n = vec3(d, z);
    float ph = uMoonPhase*6.2832; vec3 L = normalize(vec3(sin(ph), 0.08, -cos(ph)));
    float lit = pow(max(dot(n, L), 0.0), 0.8); float surf = 0.8 + 0.4*vnoise(d*3.5 + uSeed*2.0);
    add += uMoonCol*(lit*surf*2.8 + 0.06)*smoothstep(MR, MR*0.96, md);
  }
  if (uStar > 0.001) {
    vec2 sg = p*90.0; vec2 sid = floor(sg); vec2 sf = fract(sg) - 0.5; float sh = hash12(sid + uSeed);
    vec2 so = (vec2(hash12(sid + 1.1), hash12(sid + 2.2)) - 0.5)*0.6;
    float mag = pow(hash12(sid + 3.3), 4.0); float tmp = hash12(sid + 4.4);
    vec3 scol = mix(vec3(1.0, 0.78, 0.6), vec3(0.72, 0.82, 1.0), tmp);
    float tw = 0.65 + 0.35*sin(uTime*(0.8 + 2.5*sh) + sh*40.0);
    float star = smoothstep(0.07 + 0.09*mag, 0.0, length(sf - so))*step(0.9, sh)*tw*(0.5 + 1.5*mag);
    float per = 19.0; float k = floor(uTime/per); float tsh = fract(uTime/per);
    vec2 s0 = vec2(hash12(vec2(k, 1.3))*asp - asp*0.5, 0.15 + 0.35*hash12(vec2(k, 7.1)));
    vec2 sdir = normalize(vec2(0.7 + 0.5*hash12(vec2(k, 2.2)), -0.45)); vec2 head = s0 + sdir*tsh*per*1.4; vec2 tail = head - sdir*0.16;
    vec2 pa = p - tail, ba = head - tail; float hh = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); float dsh = length(pa - ba*hh);
    float shoot = exp(-dsh*900.0)*hh*step(tsh, 0.09)*step(0.55, hash12(vec2(k, 9.9)));
    add += (scol*star*0.9 + vec3(0.9, 0.95, 1.0)*shoot*1.5)*uStar*smoothstep(0.15, 0.55, ty);
  }
  float sd = length(p - uSunPos);
  add += uSunCol*uSunUp*(2.2*smoothstep(0.035, 0.028, sd)*T*(1.0 - uHide) + 0.6*exp(-sd*sd*80.0)*(1.0 - T)*(1.0 - 0.7*uHide));
  if (uBolt > 0.001) {
    float yb = uBoltPos.y - p.y; float len = 0.95; float along = clamp(yb/len, 0.0, 1.0);
    float xoff = (vnoise(vec2(p.y*5.0 + uBoltSeed*13.0, uBoltSeed*17.0)) - 0.5)*0.36*along + (vnoise(vec2(p.y*24.0 + uBoltSeed*7.0, 3.1)) - 0.5)*0.06;
    float bx = uBoltPos.x + xoff; float d = abs(p.x - bx);
    float vis = step(0.0, yb)*step(yb, len)*(1.0 - along*0.55);
    float by = uBoltPos.y - 0.3*len; float bal = clamp((by - p.y)/0.35, 0.0, 1.0);
    float bxb = bx + 0.02 + (vnoise(vec2(p.y*15.0 + 9.0, uBoltSeed*3.0)) - 0.5)*0.12 + bal*0.24*(uBoltSeed - 0.5)*2.0;
    float db = abs(p.x - bxb)*1.4; float visb = step(0.0, by - p.y)*step(by - p.y, 0.35)*(1.0 - bal);
    float core = exp(-d*900.0)*vis + exp(-db*900.0)*visb*0.6;
    col += vec3(0.85, 0.9, 1.0)*uBolt*core*6.0*(0.35 + 0.65*T)*uEnc;
  }
  o = vec4(col + add*T*uEnc, 1.0);
}`;

  const PART_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a;
uniform float uTime, uMode, uWindT, uWindNow, uAsp, uFocus, uSeed, uSize, uFlash, uEnc, uInt, uSleet;
uniform vec3 uHorizon, uZenith, uLCol; uniform vec2 uLPos;
out vec2 vQ; out float vSoft, vI, vRot, vPersp; out vec3 vCol;
float h1(float n){ return fract(sin(n*12.9898 + uSeed*7.1)*43758.5453); }
void main(){
  float id = float(gl_InstanceID);
  float r0 = h1(id + 0.1), r1 = h1(id + 1.3), r2 = h1(id + 2.7), r3 = h1(id + 3.9), r4 = h1(id + 5.2);
  float z = mix(0.12, 1.0, pow(r0, 0.6));
  float persp = 0.12/z;
  vec2 half_, pos, dir; vRot = 0.0;
  if (uMode < 0.5) {
    float sp = ((2.2 + 1.2*r1)*persp + 0.15)*mix(0.6, 1.35, uInt);
    float y = fract(r2 - uTime*sp*0.45);
    float shear = uWindNow*0.12*persp;
    float x = fract(r3 + uWindT*0.03*persp);
    pos = vec2(x*2.4 - 1.2 + (y - 0.5)*shear*2.0, y*2.4 - 1.2);
    dir = normalize(vec2(shear, 1.0));
    half_ = vec2(0.0015*(1.0 + 4.0*persp)*mix(0.75, 1.2, uInt), (0.045 + 0.11*persp)*mix(0.5, 1.45, uInt))*uSize;
  } else if (uMode < 1.5) {
    float sp = ((0.10 + 0.08*r1)*persp*2.0 + 0.02)*mix(0.7, 1.4, uInt)*mix(1.0, 2.4, uSleet);
    float y = fract(r2 - uTime*sp*0.5);
    float sway = sin(uTime*(0.6 + 0.8*r4) + r3*6.28)*0.03*persp*(0.6 + 0.4*uWindNow)*(1.0 - 0.75*uSleet);
    float x = fract(r3 + sway + uWindT*0.015*persp);
    pos = vec2(x*2.4 - 1.2 + (y - 0.5)*uWindNow*0.06*persp*uSleet, y*2.4 - 1.2);
    dir = vec2(0.0, 1.0);
    half_ = vec2(0.006*(0.5 + 0.5*r4)*(1.0 + 6.0*persp)*mix(0.8, 1.25, uInt)*mix(1.0, 0.5, uSleet))*uSize;
    vRot = r4*6.28 + uTime*(0.3 + 0.7*r1);
  } else {
    float x = fract(r3 + uWindT*0.006*persp + 0.02*sin(uTime*(0.3 + 0.5*r4) + r1*6.28)*persp);
    float y = fract(r2 + uTime*0.004*persp*(0.3 + r1) + 0.02*cos(uTime*(0.25 + 0.4*r1) + r4*6.28)*persp);
    pos = vec2(x*2.4 - 1.2, y*2.4 - 1.2);
    dir = vec2(0.0, 1.0);
    half_ = vec2(0.0035*(0.5 + 0.5*r4)*(1.0 + 5.0*persp))*uSize;
  }
  float coc = min(0.03, z < uFocus ? (uFocus - z)*0.09 : (z - uFocus)*0.012)*uSize*(uMode < 0.5 ? 1.0 : 1.5);
  vec2 hw = half_ + coc;
  vSoft = coc/hw.x; vPersp = persp;
  vI = (half_.x*half_.x)/(hw.x*hw.x)*mix(0.3, 1.0, persp);
  vQ = a;
  vec2 perp = vec2(dir.y, -dir.x);
  vec2 off = perp*a.x*hw.x + dir*a.y*hw.y; off.x /= uAsp;
  gl_Position = vec4(pos + off, 0.0, 1.0);
  vec2 uv = pos*0.5 + 0.5;
  vec3 sky = mix(uHorizon, uZenith, clamp(uv.y, 0.0, 1.0));
  float sdst = length((uv - 0.5)*vec2(uAsp, 1.0) - uLPos);
  vCol = uMode < 0.5 ? sky*1.6 + uLCol*0.12*exp(-sdst*2.0) : uMode < 1.5 ? sky*2.2 + uLCol*0.15 + 0.08 : sky*1.5 + uLCol*0.3*exp(-sdst*1.5) + vec3(0.10, 0.08, 0.05);
  vCol = (vCol + vec3(0.8, 0.85, 1.0)*uFlash*0.5)*uEnc;
}`;

  const PART_FS = `#version 300 es
precision highp float;
in vec2 vQ; in float vSoft, vI, vRot, vPersp; in vec3 vCol; uniform float uMode; out vec4 o;
void main(){
  float m;
  if (uMode < 0.5) {
    float ax = abs(vQ.x), ay = abs(vQ.y);
    m = smoothstep(0.0, max(vSoft, 0.15), 1.0 - ax)*smoothstep(1.0, 0.6, ay)*(0.5 + 0.5*(vQ.y*0.5 + 0.5));
    o = vec4(vCol*m*vI*0.45, m*vI*0.3);
  } else if (uMode < 1.5) {
    float r = length(vQ); float ang = atan(vQ.y, vQ.x);
    float hex = 1.0 - 0.2*(0.5 + 0.5*cos(6.0*ang + vRot))*smoothstep(0.3, 0.9, vPersp)*(1.0 - vSoft);
    m = smoothstep(hex, hex*(1.0 - max(vSoft, 0.2)), r)*(1.0 + 0.6*vSoft*smoothstep(0.5, 0.95, r));
    o = vec4(vCol*m*vI, m*vI*0.85);
  } else {
    float r = length(vQ);
    m = smoothstep(1.0, 1.0 - max(vSoft, 0.3), r);
    o = vec4(vCol*m*vI*0.4, m*vI*0.3);
  }
}`;

  // pass 3 — crepuscular ray gather at sky resolution (only runs when rays are active)
  const RAYS_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene; uniform vec2 uSunUV, uRes; uniform float uEnc, uLod; uniform int uTaps;
in vec2 vUv; out vec4 o;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 d = uSunUV - vUv; vec2 stp = d/float(max(uTaps, 1))*0.9;
  float acc = 0.0, wgt = 1.0, ws = 0.0; vec2 s = vUv + stp*hash12(vUv*uRes)*0.9;
  for (int i = 0; i < 24; i++) { if (i >= uTaps) break; s += stp; float lm = dot(textureLod(uScene, s, uLod).rgb, vec3(0.2126, 0.7152, 0.0722))/uEnc; acc += min(max(lm - 1.2, 0.0), 1.0)*wgt; ws += wgt; wgt *= 0.92; }
  o = vec4(acc/ws, 0.0, 0.0, 1.0);
}`;

  // pass 4 — glass + post. Identical to v5 except rays come from the ray texture and fine drop detail is skipped when the output is blurred.
  const GLASS_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene, uRaysTex; uniform vec2 uRes, uSunUV; uniform float uTime, uRainG, uFrost, uMist, uFlash, uExposure, uSeed, uEnc, uDim, uWet, uRays, uFlare, uDetail; uniform vec3 uSunTint;
in vec2 vUv; out vec4 o;
${NOISE}
vec3 N13(float p){ vec3 p3 = fract(vec3(p)*vec3(0.1031, 0.11369, 0.13787)); p3 += dot(p3, p3.yzx + 19.19); return fract(vec3((p3.x+p3.y)*p3.z, (p3.x+p3.z)*p3.y, (p3.y+p3.z)*p3.x)); }
float saw(float b, float t){ return smoothstep(0.0, b, t)*smoothstep(1.0, b, t); }
float lumf(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 slideLayer(vec2 U, float t, float k){
  float cols = 5.0*k, rows = 1.4*k;
  vec2 g = U*vec2(cols, rows);
  g.y += hash12(vec2(floor(g.x), k))*3.0;
  vec2 id = floor(g); vec2 fr = fract(g);
  vec3 n = N13(id.x*71.3 + id.y*13.1 + k*5.0);
  float ti = fract(t*(0.7 + 0.6*n.y) + n.z);
  float ydrop = 0.9 - 0.82*(ti + 0.035*sin(ti*25.0 + n.x*6.0));
  float r = (0.16 + 0.16*n.x)*0.35/rows;
  float wob = 0.25*(n.y - 0.5);
  float xc = 0.5 + wob*sin(ydrop*11.0 + n.z*6.28)*0.5;
  vec2 dv = (fr - vec2(xc, ydrop))/vec2(cols, rows);
  float drop = smoothstep(r, 0.0, length(dv*vec2(1.0, 0.8)));
  float above = fr.y - ydrop;
  float trailRegion = smoothstep(0.0, 0.02, above)*smoothstep(0.7, 0.1, above)*step(0.12, ti);
  float aboveStart = r*rows*1.3;
  float inTrail = smoothstep(aboveStart, aboveStart + 0.05, above)*smoothstep(0.7, 0.1, above)*step(0.12, ti);
  float tx = 0.5 + wob*sin(fr.y*11.0 + n.z*6.28)*0.5;
  float tw = r*(0.55 - 0.4*above);
  float dxs = abs(fr.x - tx)/cols;
  float trail = smoothstep(tw, tw*0.4, dxs)*trailRegion;
  float by = fract(fr.y*9.0 + n.x*3.0) - 0.5;
  float beads = smoothstep(r*0.35, 0.0, length(vec2(dxs, by/(rows*9.0))))*inTrail*step(0.4, hash12(id + floor(fr.y*9.0 + n.x*3.0)));
  return vec2(max(drop, beads*0.8), max(trail, smoothstep(0.0, 0.15, drop))); }
float beadLayer(vec2 U, float t){
  vec2 g = U*38.0; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  vec3 n = N13(id.x*107.4 + id.y*3543.6);
  vec2 p = (n.xy - 0.5)*0.6;
  float life = saw(0.05, fract(t*0.6 + n.z));
  float r = 0.06 + 0.16*fract(n.z*10.0);
  return smoothstep(r, 0.0, length(f - p))*life*step(0.72, fract(n.z*7.0)); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  float asp = uRes.x/uRes.y; vec2 uv = vUv; vec2 U = vec2(uv.x*asp, uv.y);
  float t = uTime*0.2;
  vec2 n = vec2(0.0); float lod = 0.0, trailClear = 0.0, frostMask = 0.0, fn = 0.5, hgt = 0.0;
  if (uRainG > 0.001) {
    vec2 m1 = slideLayer(U, t, 1.0)*smoothstep(0.2, 1.0, uRainG);
    hgt = m1.x; trailClear = m1.y;
    if (uDetail > 0.5) {
      hgt = max(hgt, beadLayer(U, t)*smoothstep(0.0, 0.6, uRainG));
      vec2 m2 = slideLayer(U + 3.7, t*1.3, 1.85)*smoothstep(0.5, 1.0, uRainG);
      hgt = max(hgt, m2.x); trailClear = max(trailClear, m2.y);
    }
  }
  if (uMist > 0.001) hgt = max(hgt, beadLayer(U*0.7 + 17.0, t*0.3)*smoothstep(0.0, 0.7, uMist)*0.9);
  float dropMask = smoothstep(0.02, 0.25, hgt);
  n = vec2(dFdx(hgt), dFdy(hgt))*(uRes.y/900.0)*1.6;
  if (uFrost > 0.001) {
    vec2 cuv = (uv - 0.5)*vec2(asp, 1.0);
    frostMask = smoothstep(0.55, 1.15, length(cuv)*1.25 + (vnoise(U*6.0 + uSeed) - 0.5)*0.5)*uFrost;
    if (uDetail > 0.5) { fn = vnoise(U*90.0)*0.5 + vnoise(U*180.0)*0.5; n += (vec2(vnoise(U*40.0 + 3.0), vnoise(U*40.0 + 9.0)) - 0.5)*0.02*frostMask; }
    lod = max(lod, frostMask*3.5);
  }
  float wet = uWet*(1.0 - trailClear)*(1.0 - dropMask);
  float mist = uMist*(1.0 - dropMask)*(1.0 - 0.5*trailClear);
  lod = max(lod, mix(2.5*uWet, 0.0, dropMask));
  lod = max(lod, wet*2.0 + mist*2.8);
  vec2 rc = uv - 0.5; float ca = 0.014*dot(rc, rc);
  vec3 col;
  col.r = textureLod(uScene, uv + n + rc*ca, lod).r;
  col.g = textureLod(uScene, uv + n, lod).g;
  col.b = textureLod(uScene, uv + n - rc*ca, lod).b;
  col /= uEnc;
  vec3 bl = textureLod(uScene, uv, 4.0).rgb/uEnc;
  col += max(bl - vec3(1.0), 0.0)*0.35;
  col *= 1.0 + 0.15*dropMask;
  col = mix(col, mix(bl, vec3(1.0), 0.35)*1.1, frostMask*(0.6 + 0.4*fn));
  col = mix(col, bl*1.06 + 0.015, mist*0.35);
  if (uRays > 0.001) {
    vec2 d = uSunUV - uv; float L = length(d);
    col += uSunTint*texture(uRaysTex, uv).r*uRays*0.22/(1.0 + L*L*3.0);
  }
  if (uFlare > 0.001) {
    float inside = float(uSunUV.x > -0.05 && uSunUV.x < 1.05 && uSunUV.y > -0.05 && uSunUV.y < 1.05);
    float sv = smoothstep(1.3, 2.8, lumf(textureLod(uScene, uSunUV, 3.0).rgb)/uEnc)*uFlare*inside;
    if (sv > 0.001) {
      vec2 sc = uSunUV - 0.5; vec3 fl = vec3(0.0);
      const float K[4] = float[4](-0.45, -0.9, -1.45, 0.4); const float R[4] = float[4](0.05, 0.09, 0.14, 0.03);
      const vec3 TC[4] = vec3[4](vec3(1.0, 0.75, 0.55), vec3(0.6, 0.85, 1.0), vec3(0.95, 0.6, 0.9), vec3(1.0, 0.9, 0.7));
      for (int i = 0; i < 4; i++) { vec2 gp = 0.5 + sc*K[i]; float dd = length((uv - gp)*vec2(asp, 1.0)); fl += TC[i]*smoothstep(R[i], R[i]*0.55, dd)*(0.5 + 0.5*smoothstep(R[i]*0.3, R[i]*0.9, dd))*0.06; }
      float streak = exp(-abs(uv.y - uSunUV.y)*asp*70.0)*exp(-abs(uv.x - uSunUV.x)*3.5)*0.08;
      col += (fl + uSunTint*streak)*sv;
    }
  }
  col *= uExposure*uDim;
  col += vec3(0.7, 0.78, 1.0)*uFlash*0.25;
  col = pow(aces(col), vec3(1.0/2.2));
  vec2 vq = uv*(1.0 - uv.yx); col *= 0.82 + 0.18*pow(clamp(vq.x*vq.y*20.0, 0.0, 1.0), 0.2);
  col += (hash12(uv*uRes + fract(uTime)*vec2(7.3, 3.1)) - 0.5)*0.012;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

  // pass 5/6 — separable 13-tap Gaussian (7 bilinear fetches) over a sub-rect of a canvas-sized texture
  const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir, uSub, uTexel; uniform vec4 uW; uniform vec3 uO;
in vec2 vUv; out vec4 o;
vec3 tp(vec2 u){ return texture(uTex, clamp(u, uTexel*0.5, uSub - uTexel*0.5)).rgb; }
void main(){
  vec2 uv = vUv*uSub;
  vec3 c = tp(uv)*uW.x;
  c += (tp(uv + uDir*uO.x) + tp(uv - uDir*uO.x))*uW.y;
  c += (tp(uv + uDir*uO.y) + tp(uv - uDir*uO.y))*uW.z;
  c += (tp(uv + uDir*uO.z) + tp(uv - uDir*uO.z))*uW.w;
  o = vec4(c, 1.0);
}`;

  const SCENES = {
    clear:  { dark: [0.05, 0.05], darkCov: 0.25, wind: [0.8, 0.8], covMax: 0.35 },
    cloudy: { dark: [0.10, 0.10], darkCov: 0.30, wind: [1.3, 1.3] },
    fog:    { dark: [0.05, 0.08], darkCov: 0.10, wind: [0.35, 0.7], fog: 1, covMin: 0.5 },
    rainy:  { dark: [0.30, 0.72], darkCov: 0.10, wind: [1.1, 3.0], rain: 1 },
    storm:  { dark: [0.62, 0.92], darkCov: 0.08, wind: [2.4, 4.6], rain: 1, storm: 1, covMin: 0.7, intMin: 0.45 },
    sleet:  { dark: [0.30, 0.66], darkCov: 0.10, wind: [1.0, 2.4], rain: 0.6, snow: 0.6, sleet: 1 },
    snowy:  { dark: [0.25, 0.70], darkCov: 0.10, wind: [0.5, 1.6], snow: 1 },
    haze:   { dark: [0.12, 0.28], darkCov: 0.20, wind: [0.5, 0.9], haze: 1, dust: 1, covMax: 0.5 },
  };
  // sky = cloud-buffer scale, scene = composite/particle buffer scale (both relative to the canvas backing store)
  const TIERS = [
    { name: 'low',      sky: 0.30, scene: 0.50, dpr: 1,   start: 1, end: 3, oct: 4, rain: 2500, snow: 700,  dust: 250, rayTaps: 6,  fps: 30 },
    { name: 'balanced', sky: 0.45, scene: 0.75, dpr: 1,   start: 0, end: 3, oct: 5, rain: 4000, snow: 1600, dust: 400, rayTaps: 10, fps: 60 },
    { name: 'high',     sky: 0.50, scene: 1.00, dpr: 1.5, start: 0, end: 4, oct: 6, rain: 8000, snow: 3200, dust: 600, rayTaps: 16, fps: 60 },
  ];
  const BQ_STEPS = [0.125, 0.1875, 0.25, 0.375, 0.5, 0.75, 1];
  const SKY = [
    [-0.31, [0.004, 0.007, 0.020], [0.014, 0.022, 0.045]],
    [-0.21, [0.008, 0.012, 0.036], [0.05, 0.06, 0.12]],
    [-0.105, [0.03, 0.05, 0.13], [0.32, 0.20, 0.30]],
    [0.0, [0.11, 0.17, 0.40], [0.95, 0.52, 0.28]],
    [0.105, [0.15, 0.30, 0.62], [0.88, 0.70, 0.52]],
    [0.5, [0.10, 0.28, 0.70], [0.48, 0.63, 0.84]],
    [1.0, [0.08, 0.24, 0.66], [0.52, 0.67, 0.86]],
  ];
  const DEG = Math.PI/180;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const t = clamp((x - a)/(b - a), 0, 1); return t*t*(3 - 2*t); };
  const mix = (a, b, t) => a + (b - a)*t;
  const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  const lum = c => 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
  const dayOfYear = d => Math.floor((d - new Date(d.getFullYear(), 0, 0))/86400000);
  function solar(lat, day, hour, noon) {
    const phi = lat*DEG, dec = 23.44*DEG*Math.sin(2*Math.PI*(284 + day)/365), H = (hour - noon)*15*DEG;
    const sinEl = clamp(Math.sin(phi)*Math.sin(dec) + Math.cos(phi)*Math.cos(dec)*Math.cos(H), -1, 1);
    const az = Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(phi) - Math.tan(dec)*Math.cos(phi));
    const cosH0 = -Math.tan(phi)*Math.tan(dec);
    const H0 = Math.acos(clamp(cosH0, -1, 1))/(15*DEG);
    return { sinEl, el: Math.asin(sinEl)/DEG, az, sunrise: noon - H0, sunset: noon + H0, polar: cosH0 < -1 ? 'day' : cosH0 > 1 ? 'night' : '' };
  }
  function moonPhase(date) { const syn = 29.530588853; const d = (date - Date.UTC(2000, 0, 6, 18, 14))/86400000; return ((d % syn) + syn) % syn/syn; }
  function skyColors(el) {
    let i = 0; while (i < SKY.length - 2 && el > SKY[i + 1][0]) i++;
    const a = SKY[i], b = SKY[i + 1], t = smooth(a[0], b[0], el);
    return [mix3(a[1], b[1], t), mix3(a[2], b[2], t)];
  }
  window.WeatherSkyMath = window.WeatherSkyMath || { solar, moonPhase, dayOfYear };
  const BLUR_DUR = 0.62;

  class WeatherSkyV6 extends HTMLElement {
    static get observedAttributes() { return ['scene', 'hour', 'cover', 'intensity', 'quality', 'seed', 'glass', 'focus', 'wind', 'dim', 'lat', 'day', 'noon', 'moon', 'motion', 'blur']; }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = '<style>:host{display:block;position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#1a2440}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}</style><canvas></canvas>';
      this._cv = this.shadowRoot.querySelector('canvas');
      this._t0 = performance.now(); this._visible = true; this._raf = 0; this._env = null; this._envKey = ''; this._cur = null;
      this._bolt = { next: -1, start: -10, pos: [0, 0.3], bolt: 0, seed: 0.5 };
      this._sceneName = ''; this._sceneT = 0; this._windT = 0;
      this._tier = 1; this._ema = 16; this._frames = 0; this._sinceTier = 0; this._lastFrame = 0;
      this._cw = 0; this._ch = 0; this._sizes = {}; this._queries = []; this._gpuMs = -1; this._cpuMs = -1; this._fpsCount = 0; this._fpsT = 0; this._fps = 0; this._mpx = 0; this._passes = 0;
    }
    _q() { const q = this.getAttribute('quality'); if (q === 'auto' || !q) return TIERS[this._tier]; return TIERS.find(t => t.name === q) || TIERS[1]; }
    _isAuto() { const q = this.getAttribute('quality'); return q === 'auto' || !q; }
    _isStatic() { const m = this.getAttribute('motion') || 'auto'; return m === 'static' || (m === 'auto' && this._rm && this._rm.matches); }
    connectedCallback() {
      this._rm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this._onRm = () => this._loop(); this._rm && this._rm.addEventListener && this._rm.addEventListener('change', this._onRm);
      const start = () => {
        if (!this.isConnected) return;
        const gl = this._cv.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
        if (!gl) { this._fallback(); return; }
        this._gl = gl;
        this._float = !!gl.getExtension('EXT_color_buffer_float');
        this._tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        this._cv.addEventListener('webglcontextlost', e => { e.preventDefault(); cancelAnimationFrame(this._raf); });
        this._cv.addEventListener('webglcontextrestored', () => { this._init(); this._loop(); });
        const r = this.getBoundingClientRect(); this._cw = r.width; this._ch = r.height;
        this._ro = new ResizeObserver(es => { const c = es[0].contentRect; this._cw = c.width; this._ch = c.height; this._envKey = ''; if (this._isStatic()) this._loop(); }); this._ro.observe(this);
        this._io = new IntersectionObserver(es => { this._visible = es[0].isIntersecting; if (this._visible) this._loop(); }); this._io.observe(this);
        this._onVis = () => { if (!document.hidden) this._loop(); }; document.addEventListener('visibilitychange', this._onVis);
        this._init(); this._loop();
      };
      this._fallback(true);
      if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 300 }); else setTimeout(start, 32);
    }
    disconnectedCallback() {
      cancelAnimationFrame(this._raf); this._ro && this._ro.disconnect(); this._io && this._io.disconnect();
      document.removeEventListener('visibilitychange', this._onVis);
      this._rm && this._rm.removeEventListener && this._rm.removeEventListener('change', this._onRm);
    }
    attributeChangedCallback() {
      if (!this._gl) { this._fallback(true); return; }
      if (!this._glass) return;
      this._envKey = ''; this._lastFrame = 0; this._loop();
    }
    getEnvironment() {
      const e = this._target(this._now(), true);
      return { sunrise: e.sunrise, sunset: e.sunset, elevation: e.elDeg, moonPhase: e.moonPhase, moonIllumination: e.moonIllum, night: e.night, quality: this._q().name, static: this._isStatic() };
    }
    // public: live cost metrics. gpuMs is only measured while quality="auto" (or after probe(true)); -1 when unavailable.
    getStats() {
      const s = this._sizes, q = this._q();
      return { renderer: 'v6', quality: q.name, auto: this._isAuto(), tier: this._tier, gpuMs: this._gpuMs, cpuMs: this._cpuMs, fps: this._fps, fpsCap: this._fpsCap(),
        blur: this._cur ? this._cur.blur : 0, out: [this._cv.width, this._cv.height], sky: [s.skyW || 0, s.skyH || 0], scene: [s.sceneW || 0, s.sceneH || 0], mpx: this._mpx, passes: this._passes, timer: !!this._tq };
    }
    probe(on) { this._probe = !!on; }
    _fallback(keepCanvas) {
      const h = parseFloat(this.getAttribute('hour')); const hour = isFinite(h) ? h : 17.5; const sc = this.getAttribute('scene') || 'cloudy';
      const day = hour > 6.5 && hour < 19.5;
      const g = { clear: day ? ['#5b8fd6', '#cfe0f2'] : ['#070b1a', '#1a2440'], fog: day ? ['#aeb4bc', '#d8dbe0'] : ['#1c2028', '#2c313a'], haze: day ? ['#b98a5a', '#e7c9a0'] : ['#2a1e14', '#4a3423'],
        rainy: day ? ['#5a6470', '#8b95a0'] : ['#0e131c', '#222b38'], storm: ['#1a1f29', '#3a4250'], snowy: day ? ['#8e98a6', '#c7cdd6'] : ['#141a24', '#2a3240'], sleet: day ? ['#6e7884', '#a3acb6'] : ['#121822', '#262e3a'] }[sc] || (day ? ['#6f8fbd', '#bcc9dc'] : ['#101728', '#233050']);
      if (!keepCanvas) this._cv.remove();
      this.style.background = `linear-gradient(180deg, ${g[0]} 0%, ${g[1]} 100%)`;
    }
    _prog(vsSrc, fsSrc) {
      const gl = this._gl;
      const compile = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error('weather-sky-v6 shader:', gl.getShaderInfoLog(sh)); return null; } return sh; };
      const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc); if (!vs || !fs) return null;
      const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
      p._u = {}; return p;
    }
    _u(p, n) { if (!(n in p._u)) p._u[n] = this._gl.getUniformLocation(p, n); return p._u[n]; }
    _set(p, vals) { const gl = this._gl; for (const k in vals) { const v = vals[k], loc = this._u(p, k); if (loc == null) continue; if (typeof v === 'number') gl.uniform1f(loc, v); else if (v.length === 2) gl.uniform2fv(loc, v); else if (v.length === 3) gl.uniform3fv(loc, v); else gl.uniform4fv(loc, v); } }
    _tex(minFilter) {
      const gl = this._gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter || gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { t, fb, w: 0, h: 0 };
    }
    _alloc(rt, w, h, kind) {
      if (rt.w === w && rt.h === h) return false;
      const gl = this._gl; gl.bindTexture(gl.TEXTURE_2D, rt.t);
      if (kind === 'hdr') { if (this._float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null); else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
      else if (kind === 'r8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      rt.w = w; rt.h = h; return true;
    }
    _init() {
      const gl = this._gl;
      this._sky = this._prog(VS_FULL, SKY_FS); this._comp = this._prog(VS_FULL, COMP_FS); this._part = this._prog(PART_VS, PART_FS);
      this._rays = this._prog(VS_FULL, RAYS_FS); this._glass = this._prog(VS_FULL, GLASS_FS); this._blur = this._prog(VS_FULL, BLUR_FS);
      this._vaoFull = gl.createVertexArray(); gl.bindVertexArray(this._vaoFull);
      let b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this._vaoQuad = gl.createVertexArray(); gl.bindVertexArray(this._vaoQuad);
      b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this._rtSky = this._tex(); this._rtScene = this._tex(gl.LINEAR_MIPMAP_LINEAR); this._rtRays = this._tex(); this._rtA = this._tex(); this._rtB = this._tex();
      this._sizes = {}; this._envKey = ''; this._queries = [];
      this.style.background = '';
    }
    // size every buffer for this frame from the tier and the eased blur radius; reallocates only when a quantised step changes
    _layout(env) {
      const q = this._q(), dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
      const W = Math.max(1, Math.round(this._cw*dpr)), H = Math.max(1, Math.round(this._ch*dpr));
      const sigma = env.blur*dpr, tgt = clamp(this._num('blur', 0), 0, 64)*dpr;
      const settled = Math.abs(sigma - tgt) < 1e-3;
      // smallest chain scale that still leaves σ ≥ 1.6 buffer px — and full resolution when no scale does (σ < 1.6),
      // never the deepest step: downsampling 8× for a sub-pixel σ washed the image out at both ends of every fade
      const stepFor = s => { if (s > 0.3) { for (const x of BQ_STEPS) if (x*s >= 1.6) return x; } return 1; };
      // the blur chain runs at a resolution that follows the *eased* blur, so the Gaussian never has to iterate dozens of times on full-size
      // buffers mid-fade (σ in buffer px stays ≈1.6–2.4). Each step is hidden by the blur it carries.
      const bq = stepFor(sigma), blurring = sigma > 0.3;
      const bw = Math.max(1, Math.round(W*bq)), bh = Math.max(1, Math.round(H*bq));
      // the canvas backing store only shrinks once the fade has settled: mid-fade the small blurred texture is blitted onto a full-size canvas,
      // afterwards the compositor does the same bilinear upscale itself — so the output resolution never jumps while anything is moving
      const shrink = blurring && settled;
      const cw = shrink ? bw : W, ch = shrink ? bh : H;
      if (this._cv.width !== cw || this._cv.height !== ch) { this._cv.width = cw; this._cv.height = ch; }
      // sky/scene buffers only need detail down to ~σ/3. They shrink once (when the blur is deep enough to hide the lost detail, ≈3 canvas px)
      // and grow back immediately on the way to sharp, while the image is still heavily blurred.
      const dscTgt = Math.min(1, stepFor(tgt)*3);
      let dsc = this._dsc ?? 1;
      if (dscTgt >= dsc || sigma >= Math.min(tgt*0.85, 8*dpr)) dsc = dscTgt;
      this._dsc = dsc;
      const skyW = Math.max(8, Math.round(W*q.sky*dsc)), skyH = Math.max(8, Math.round(H*q.sky*dsc));
      const sceneW = Math.max(8, Math.round(W*q.scene*dsc)), sceneH = Math.max(8, Math.round(H*q.scene*dsc));
      this._alloc(this._rtSky, skyW, skyH, 'hdr'); this._alloc(this._rtRays, skyW, skyH, 'r8');
      this._alloc(this._rtScene, sceneW, sceneH, 'hdr');
      // blur ping-pong targets live permanently at full size so the first blurred frame never pays an allocation hitch
      this._alloc(this._rtA, W, H, 'rgba8'); this._alloc(this._rtB, W, H, 'rgba8');
      this._sizes = { W, H, cw, ch, bw, bh, skyW, skyH, sceneW, sceneH, bq, blurring, shrink, sigma: sigma*bq, pscale: Math.min(1, dsc*4/3), detail: shrink && sigma > 6 ? 0 : 1 };
    }
    _now() { return this._isStatic() ? 40 : (performance.now() - this._t0)/1000; }
    _num(name, dflt) { const v = parseFloat(this.getAttribute(name)); return isFinite(v) ? v : dflt; }
    // 30 fps only once the blur has settled — the cross-fade itself runs at full rate
    _fpsCap() { const q = this._q(); return this._sizes && this._sizes.shrink ? Math.min(q.fps, 30) : q.fps; }
    _target(T, peek) {
      const scName = SCENES[this.getAttribute('scene')] ? this.getAttribute('scene') : 'cloudy'; const sc = SCENES[scName];
      if (!peek && scName !== this._sceneName) { this._sceneName = scName; this._sceneT = this._isStatic() ? T - 30 : T; }
      const h = ((this._num('hour', 17.5) % 24) + 24) % 24;
      const rainW = sc.rain || 0, snowW = sc.snow || 0, fogW = sc.fog || 0, hz = sc.haze || 0, storm = sc.storm || 0, sleet = sc.sleet || 0, dust = sc.dust || 0;
      const usesInt = rainW || snowW || fogW || hz;
      let inten = usesInt ? clamp(this._num('intensity', 0.6), 0, 1) : 0; if (sc.intMin) inten = Math.max(inten, sc.intMin);
      let cov = clamp(this._num('cover', 0.4), 0, 1);
      if (rainW) cov = Math.max(cov, (0.4 + 0.45*inten)*rainW); if (snowW) cov = Math.max(cov, (0.35 + 0.4*inten)*snowW);
      if (sc.covMin != null) cov = Math.max(cov, sc.covMin); if (sc.covMax != null) cov = Math.min(cov, sc.covMax);
      const seed = this._num('seed', 0);
      const glass = /^(0|off|false|none)$/i.test(this.getAttribute('glass') || '') ? 0 : 1;
      const focus = clamp(this._num('focus', 0.45), 0.12, 1);
      const wind = this._num('wind', mix(sc.wind[0], sc.wind[1], inten));
      const dim = clamp(this._num('dim', 1), 0.2, 1.2);
      const blur = clamp(this._num('blur', 0), 0, 64);
      const lat = clamp(this._num('lat', 52.37), -66, 66), day = this._num('day', dayOfYear(new Date())), noon = this._num('noon', 12.7);
      const moonPh = ((this._num('moon', moonPhase(Date.now())) % 1) + 1) % 1;
      const asp = this._cw/Math.max(1, this._ch);
      const key = [scName, h, cov, inten, seed, glass, focus, wind, dim, blur, lat, day, noon, moonPh, asp.toFixed(4), this._sceneT, Math.floor(T*4)].join('|');
      if (this._env && key === this._envKey) return this._env;
      const sun = solar(lat, day, h, noon), moon = solar(lat, day, h - moonPh*24, noon);
      const el = sun.sinEl;
      const dl = smooth(-0.12, 0.25, el), night = 1 - dl;
      const sunPos = [Math.sin(sun.az)*0.42*asp, -0.42 + 0.95*Math.max(el, -0.2)];
      const moonPos = [Math.sin(moon.az)*0.42*asp, -0.42 + 0.95*Math.max(moon.sinEl, -0.2)];
      let [zen, hor] = skyColors(el);
      const sunUp = smooth(-0.06, 0.05, el);
      const moonIllum = 0.5 - 0.5*Math.cos(moonPh*2*Math.PI);
      const moonUp = smooth(-0.05, 0.1, moon.sinEl)*night*smooth(0.02, 0.12, moonIllum);
      let sunCol = mix3([1.0, 0.45, 0.2], [1.0, 0.95, 0.88], smooth(0, 0.35, el));
      sunCol = mix3(sunCol, [1.0, 0.38, 0.18], 0.9*hz*mix(0.5, 1, inten)).map(v => v*(1.3 + 1.7*smooth(0, 0.35, el))*sunUp*(1 - 0.78*hz*inten));
      const moonCol = [0.45, 0.55, 0.8].map(v => v*0.5*moonUp);
      const gz = lum(zen), gh = lum(hor);
      zen = mix3(zen, [gz*0.92, gz*0.96, gz*1.06], 0.25*cov).map(v => v*(1 - 0.25*cov));
      hor = mix3(hor, [gh*0.95, gh*0.97, gh*1.02], 0.3*cov).map(v => v*(1 - 0.2*cov));
      if (rainW) { const gr = lum(hor); zen = zen.map(v => v*mix(0.8, 0.35, inten*rainW)); hor = mix3(hor, [gr, gr, gr*1.05], 0.6*inten*rainW).map(v => v*mix(0.85, 0.45, inten*rainW)); }
      if (snowW) { const k = mix(0.15, 0.6, inten)*snowW; zen = mix3(zen, [0.12*dl + 0.02, 0.15*dl + 0.03, 0.23*dl + 0.05], k); hor = mix3(hor, [0.21*dl + 0.03, 0.24*dl + 0.04, 0.30*dl + 0.06], k); }
      if (fogW) { const k = 0.55 + 0.4*inten, g = 0.16*dl + 0.012; zen = mix3(zen, [g*1.3, g*1.36, g*1.5], k); hor = mix3(hor, [g*2.0, g*2.05, g*2.15], k); }
      if (hz) { const k = mix(0.5, 0.85, inten), b = 0.12 + 0.88*dl; zen = mix3(zen, [0.55*b, 0.42*b, 0.26*b], k*0.8); hor = mix3(hor, [0.90*b, 0.64*b, 0.36*b], k); }
      if (storm) { zen = zen.map(v => v*mix(0.7, 0.4, inten)); hor = hor.map(v => v*mix(0.75, 0.45, inten)); }
      const w = smooth(-0.08, 0.04, el);
      const LPos = w > 0.5 || moonUp < 0.05 ? sunPos : moonPos;
      const cloudDark = mix(sc.dark[0], sc.dark[1], inten) + sc.darkCov*cov;
      const LCol = mix3(moonCol.map(v => v*1.4), sunCol.map(v => v*0.4*(1 - 0.5*cov)*(1 - 0.6*cloudDark)), w);
      const exposure = (0.8 + 1.2*night)*(snowW ? mix(0.95, 0.78, inten) : 1)*(rainW ? mix(1, 0.82, inten) : 1)*(fogW ? 0.95 : 1)*(hz ? mix(0.95, 0.8, inten) : 1)*(storm ? 0.85 : 1);
      const since = T - this._sceneT;
      const glassRain = rainW && glass ? smooth(0, 8, since)*mix(0.3, 1, inten)*rainW : 0;
      const glassFrost = snowW && glass ? smooth(0, 12, since)*mix(0.15, 0.75, inten)*snowW : 0;
      const glassMist = fogW && glass ? smooth(0, 10, since)*mix(0.25, 0.7, inten) : 0;
      const rays = sunUp*smooth(0.12, 0.4, cov)*(1 - smooth(0.85, 1, cov))*(1 - fogW)*(1 - 0.7*rainW)*(1 - 0.6*hz)*(0.45 + 0.55*(1 - clamp(el, 0, 1)))*(1 - 0.4*storm);
      const flare = glass ? sunUp*(1 - smooth(0.2, 0.6, cov))*(1 - fogW)*(1 - rainW)*(1 - snowW)*(1 - 0.5*hz) : 0;
      const rainbow = rainW*(1 - smooth(0.3, 0.6, inten))*sunUp*smooth(0.72, 0.4, el)*(1 - smooth(0.6, 0.9, cov))*(1 - storm);
      const belt = smooth(-0.16, -0.03, el)*smooth(0.09, -0.02, el)*(1 - cov)*(1 - fogW)*(1 - hz);
      const star = night*Math.pow(1 - cov, 1.5)*(1 - fogW)*(1 - 0.85*hz)*(1 - 0.9*rainW)*(1 - 0.9*snowW);
      const smax = Math.max(sunCol[0], sunCol[1], sunCol[2], 1e-3);
      const sunTint = sunUp > 0.001 ? sunCol.map(v => v/smax) : [1, 0.9, 0.8];
      const fog = fogW*mix(0.6, 1, inten), haze = hz*mix(0.5, 1, inten);
      const hide = Math.max(storm*0.97, fog*0.95, rainW*inten*0.5, haze*0.75);
      this._env = { cov, inten, seed, glass, focus, wind, dim, blur, asp, el, night, sunPos, moonPos, zen, hor, sunUp, moonUp, sunCol, moonCol, LPos, LCol, exposure, cloudDark,
        rain: rainW, snow: snowW, fog, haze, dust: dust*mix(0.3, 1, inten), storm, sleet, glassRain, glassFrost, glassMist, rays, flare, rainbow, belt, star, hide,
        moonPhase: moonPh, moonIllum, asun: [-sunPos[0], -0.84 - sunPos[1]], sunUV: [sunPos[0]/asp + 0.5, sunPos[1] + 0.5], sunTint,
        sunrise: sun.sunrise, sunset: sun.sunset, elDeg: sun.el, gust: 0.5 + storm + 0.3*rainW };
      this._envKey = key; return this._env;
    }
    _ease(target, dt) {
      if (!this._cur || this._isStatic()) { this._cur = JSON.parse(JSON.stringify(target)); this._bFrom = this._bTo = this._cur.blur; this._bT = 1; return this._cur; }
      const a = 1 - Math.exp(-dt/0.7), cur = this._cur;
      for (const k in target) { const v = target[k]; if (k === 'blur') continue;
        if (Array.isArray(v)) { if (!cur[k] || cur[k].length !== v.length) cur[k] = v.slice(); for (let i = 0; i < v.length; i++) cur[k][i] += (v[i] - cur[k][i])*a; }
        else if (typeof v === 'number') { cur[k] = (cur[k] == null ? v : cur[k] + (v - cur[k])*a); if (Math.abs(cur[k] - v) < 1e-4) cur[k] = v; }
        else cur[k] = v; }
      // blur runs a fixed-duration eased tween instead of an exponential chase: frame-rate independent (a 30 fps
      // frame no longer takes a 14% bite out of the fade) and it lands exactly on the target instead of crawling
      if (this._bTo !== target.blur) { this._bFrom = cur.blur == null ? target.blur : cur.blur; this._bTo = target.blur; this._bT = 0; }
      if (this._bT < 1) this._bT = Math.min(1, this._bT + dt/BLUR_DUR);
      cur.blur = this._bT >= 1 ? this._bTo : mix(this._bFrom, this._bTo, smooth(0, 1, this._bT));
      return cur;
    }
    _lightning(T, env) {
      const b = this._bolt;
      const k = env.storm*mix(0.45, 1, env.inten) + (1 - env.storm)*env.rain*smooth(0.55, 0.85, env.inten)*0.6;
      if (k <= 0.01) { b.next = -1; b.bolt = 0; return 0; }
      if (b.next < 0) b.next = T + mix(9, 2.5, k) + Math.random()*mix(9, 4, k);
      if (T > b.next) {
        b.start = T; b.pos = [(Math.random() - 0.5)*env.asp*0.9, 0.15 + Math.random()*0.35]; b.dbl = Math.random() < 0.6;
        b.vis = Math.random() < 0.35 + 0.45*env.storm; b.seed = Math.random(); b.next = T + mix(12, 3, k) + Math.random()*mix(12, 4, k);
      }
      const ph = T - b.start; if (ph < 0 || ph > 1.2) { b.bolt = 0; return 0; }
      const dbl = b.dbl && ph > 0.1 ? 0.7*Math.exp(-(ph - 0.16)*(ph - 0.16)*600) : 0;
      b.bolt = b.vis ? k*Math.max(0, Math.exp(-ph*7)*(0.55 + 0.45*Math.sin(ph*80 + 1)))*(ph < 0.32 ? 1 : 0) + (b.dbl ? dbl*0.8 : 0) : 0;
      return k*(Math.exp(-ph*9) + dbl);
    }
    // GPU timing: one TIME_ELAPSED query per frame, results harvested a few frames later
    _probeBegin() {
      const gl = this._gl, ext = this._tq; const want = this._probe === undefined ? this._isAuto() : this._probe;
      if (!ext || !want || this._queries.length >= 4) return false;
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); this._queries.push(q); return true;
    }
    _probePoll() {
      const gl = this._gl, ext = this._tq; if (!ext) return;
      while (this._queries.length) {
        const q = this._queries[0], avail = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE), disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        if (!avail && !disjoint) break;
        if (avail && !disjoint) { const ms = gl.getQueryParameter(q, gl.QUERY_RESULT)/1e6; this._gpuMs = this._gpuMs < 0 ? ms : this._gpuMs + (ms - this._gpuMs)*0.1; }
        gl.deleteQuery(q); this._queries.shift();
      }
    }
    _loop() {
      cancelAnimationFrame(this._raf);
      if (!this._gl || !this._glass) return;
      if (this._isStatic()) { this._cur = null; this.renderFrame(); return; }
      const tick = now => {
        if (!this._visible || document.hidden || !this.isConnected) return;
        this._raf = requestAnimationFrame(tick);
        const cap = this._fpsCap(); if (cap < 60 && now - this._lastFrame < 1000/cap - 2) return;
        const dt = this._lastFrame ? Math.min(0.1, (now - this._lastFrame)/1000) : 1/60; this._lastFrame = now;
        const c0 = performance.now();
        this.renderFrame(dt);
        const cpu = performance.now() - c0; this._cpuMs = this._cpuMs < 0 ? cpu : this._cpuMs + (cpu - this._cpuMs)*0.1;
        this._probePoll();
        this._fpsCount++; if (!this._fpsT) this._fpsT = now; else if (now - this._fpsT > 1000) { this._fps = Math.round(this._fpsCount*1000/(now - this._fpsT)); this._fpsCount = 0; this._fpsT = now; }
        if (this._isAuto()) {
          this._ema += (dt*1000 - this._ema)*0.05; this._frames++; this._sinceTier++;
          const budget = cap <= 30 ? 20 : 9.5;
          if (this._gpuMs >= 0) {
            if (this._frames > 60 && this._sinceTier > 60 && this._gpuMs > budget && this._tier > 0) { this._tier--; this._sinceTier = 0; this._gpuMs = -1; }
            else if (this._sinceTier > 300 && this._gpuMs < budget*0.35 && this._tier < TIERS.length - 1) { this._tier++; this._sinceTier = 0; this._gpuMs = -1; }
          } else if (this._frames > 90 && this._sinceTier > 90 && this._ema > 1.5*(1000/cap) && this._tier > 0) { this._tier--; this._sinceTier = 0; }
        }
      };
      this._raf = requestAnimationFrame(tick);
    }
    renderFrame(dt) {
      if (!this._sky || !this._comp || !this._part || !this._rays || !this._glass || !this._blur) return;
      dt = dt || 1/60;
      const gl = this._gl, T = this._now(), env = this._ease(this._target(T), dt), q = this._q();
      this._layout(env); const S = this._sizes;
      const flash = this._lightning(T, env); const enc = this._float ? 1 : 0.2;
      const gust = 1 + 0.25*(Math.sin(T*0.31) + 0.6*Math.sin(T*0.83 + 1.7))*env.gust;
      const windNow = env.wind*gust; this._windT += windNow*dt;
      const began = this._probeBegin();
      let mpx = 0, passes = 0;
      // 1. soft sky → small HDR buffer
      let p = this._sky; gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, this._rtSky.fb); gl.viewport(0, 0, S.skyW, S.skyH); gl.disable(gl.BLEND); gl.bindVertexArray(this._vaoFull);
      this._set(p, { uRes: [S.skyW, S.skyH], uSunPos: env.sunPos, uMoonPos: env.moonPos, uLPos: env.LPos, uFlashPos: this._bolt.pos, uASun: env.asun, uBoltPos: this._bolt.pos,
        uTime: T, uWindT: this._windT, uCover: env.cov, uSeed: env.seed, uNight: env.night, uFlash: flash, uCloudDark: env.cloudDark, uEl: env.el, uSunUp: env.sunUp,
        uRainy: env.rain*env.inten, uSnowy: env.snow*env.inten, uEnc: enc, uFog: env.fog, uHaze: env.haze, uBolt: this._bolt.bolt, uBoltSeed: this._bolt.seed, uRainbow: env.rainbow,
        uMoonPhase: env.moonPhase, uBelt: env.belt, uStar: env.star, uStorm: env.storm, uSunCol: env.sunCol, uMoonCol: env.moonCol, uLCol: env.LCol, uZenith: env.zen, uHorizon: env.hor });
      gl.uniform1i(this._u(p, 'uStart'), q.start); gl.uniform1i(this._u(p, 'uEnd'), q.end); gl.uniform1i(this._u(p, 'uOctCap'), q.oct);
      gl.drawArrays(gl.TRIANGLES, 0, 3); mpx += S.skyW*S.skyH; passes++;
      // 2. composite: upsample + sharp features → scene buffer
      p = this._comp; gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, this._rtScene.fb); gl.viewport(0, 0, S.sceneW, S.sceneH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._rtSky.t); gl.uniform1i(this._u(p, 'uSky'), 0);
      this._set(p, { uRes: [S.sceneW, S.sceneH], uSunPos: env.sunPos, uMoonPos: env.moonPos, uBoltPos: this._bolt.pos, uTime: T, uSeed: env.seed, uSunUp: env.sunUp, uMoonUp: env.moonUp,
        uMoonPhase: env.moonPhase, uStar: env.star, uEnc: enc, uHide: env.hide, uBolt: this._bolt.bolt, uBoltSeed: this._bolt.seed, uSunCol: env.sunCol, uMoonCol: env.moonCol });
      gl.drawArrays(gl.TRIANGLES, 0, 3); mpx += S.sceneW*S.sceneH; passes++;
      // 2b. precipitation / motes (instanced, stateless)
      const draws = [];
      if (env.rain > 0.02) draws.push([0, Math.round(q.rain*S.pscale*env.rain*mix(0.08, 1, Math.pow(env.inten, 1.3)))]);
      if (env.snow > 0.02) draws.push([1, Math.round(q.snow*S.pscale*env.snow*mix(0.08, 1, Math.pow(env.inten, 1.3)))]);
      if (env.dust > 0.02) draws.push([2, Math.round(q.dust*S.pscale*env.dust)]);
      if (draws.length) {
        p = this._part; gl.useProgram(p); gl.bindVertexArray(this._vaoQuad); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this._set(p, { uTime: T, uWindT: this._windT, uWindNow: windNow, uAsp: env.asp, uFocus: env.focus, uSeed: env.seed, uSize: 1, uInt: env.inten, uFlash: flash, uEnc: enc, uSleet: env.sleet,
          uHorizon: env.hor, uZenith: env.zen, uLCol: env.LCol, uLPos: env.LPos });
        for (const [mode, n] of draws) { gl.uniform1f(this._u(p, 'uMode'), mode); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.max(1, n)); }
        gl.disable(gl.BLEND); gl.bindVertexArray(this._vaoFull); passes++;
      }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._rtScene.t); gl.generateMipmap(gl.TEXTURE_2D);
      // 3. crepuscular rays at sky resolution, only when active
      const raysOn = env.rays > 0.001 && env.sunUp > 0.001;
      if (raysOn) {
        p = this._rays; gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, this._rtRays.fb); gl.viewport(0, 0, S.skyW, S.skyH);
        gl.uniform1i(this._u(p, 'uScene'), 0);
        this._set(p, { uSunUV: env.sunUV, uRes: [S.skyW, S.skyH], uEnc: enc, uLod: 2 + Math.log2(S.sceneH/S.skyH) });
        gl.uniform1i(this._u(p, 'uTaps'), q.rayTaps);
        gl.drawArrays(gl.TRIANGLES, 0, 3); mpx += S.skyW*S.skyH*q.rayTaps*0.25; passes++;
      }
      // 4. glass + post → canvas, or → blur chain
      // mid-fade the glass (drops, trails, frost) renders at full canvas resolution so its fine detail survives the fade; it only drops to the small
      // blur-chain size once the blur has settled, where the difference is buried under the full radius
      const gw = S.shrink ? S.bw : S.cw, gh = S.shrink ? S.bh : S.ch;
      p = this._glass; gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, S.blurring ? this._rtA.fb : null); gl.viewport(0, 0, gw, gh);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._rtRays.t); gl.uniform1i(this._u(p, 'uRaysTex'), 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this._rtScene.t); gl.uniform1i(this._u(p, 'uScene'), 0);
      this._set(p, { uRes: [gw, gh], uSunUV: env.sunUV, uTime: T, uRainG: env.glassRain, uFrost: env.glassFrost, uMist: env.glassMist, uFlash: flash, uExposure: env.exposure,
        uSeed: env.seed, uEnc: enc, uDim: env.dim, uWet: 0.32*env.glassRain, uRays: raysOn ? env.rays : 0, uFlare: env.flare, uSunTint: env.sunTint, uDetail: S.detail });
      gl.drawArrays(gl.TRIANGLES, 0, 3); mpx += gw*gh; passes++;
      if (S.blurring) {
        p = this._blur; gl.useProgram(p); gl.uniform1i(this._u(p, 'uTex'), 0);
        let src = this._rtA, dst = this._rtB, sw = gw, sh = gh;
        // pre-filter: halve the full-size glass down to the blur-chain size in ≤2× steps (bilinear = 2×2 box), never sampling with a ratio that aliases
        if (sw > S.bw) {
          this._set(p, { uDir: [0, 0], uW: [1, 0, 0, 0], uO: [0, 0, 0] });
          while (sw > S.bw) {
            const last = S.bw/sw >= 0.5; const dw = last ? S.bw : Math.round(sw*0.5), dh = last ? S.bh : Math.round(sh*0.5);
            gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dw, dh); gl.bindTexture(gl.TEXTURE_2D, src.t);
            this._set(p, { uSub: [sw/src.w, sh/src.h], uTexel: [1/src.w, 1/src.h] }); gl.drawArrays(gl.TRIANGLES, 0, 3);
            [src, dst] = [dst, src]; sw = dw; sh = dh; mpx += dw*dh; passes++;
          }
        }
        // the 13-tap kernel is exact to σ≈2.4 buffer px; while the buffers are still full-size mid-fade, iterate (variances add) instead of truncating
        const iters = Math.max(1, Math.ceil(Math.pow(S.sigma/2.4, 2))); const sg = Math.max(0.2, S.sigma/Math.sqrt(iters)); const w = []; let norm = 0;
        for (let i = 0; i <= 6; i++) { w[i] = Math.exp(-i*i/(2*sg*sg)); norm += i ? 2*w[i] : w[i]; }
        const W1 = w[1] + w[2], W2 = w[3] + w[4], W3 = w[5] + w[6];
        const uW = [w[0]/norm, W1/norm, W2/norm, W3/norm], uO = [(w[1] + 2*w[2])/Math.max(W1, 1e-9), (3*w[3] + 4*w[4])/Math.max(W2, 1e-9), (5*w[5] + 6*w[6])/Math.max(W3, 1e-9)];
        const texel = [1/src.w, 1/src.h];
        gl.viewport(0, 0, S.bw, S.bh);
        this._set(p, { uSub: [S.bw/src.w, S.bh/src.h], uTexel: texel, uW, uO });
        for (let it = 0; it < iters; it++) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.bindTexture(gl.TEXTURE_2D, src.t);
          this._set(p, { uDir: [texel[0], 0] }); gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, it === iters - 1 && S.shrink ? null : src.fb); gl.bindTexture(gl.TEXTURE_2D, dst.t);
          this._set(p, { uDir: [0, texel[1]] }); gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        mpx += 2*iters*S.bw*S.bh; passes += 2*iters;
        if (!S.shrink) {
          // mid-fade: bilinear blit of the small blurred result onto the full-size canvas (the same upscale the compositor does once settled)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, S.cw, S.ch); gl.bindTexture(gl.TEXTURE_2D, src.t);
          this._set(p, { uDir: [0, 0], uW: [1, 0, 0, 0] }); gl.drawArrays(gl.TRIANGLES, 0, 3);
          mpx += S.cw*S.ch; passes++;
        }
      }
      if (began) gl.endQuery(this._tq.TIME_ELAPSED_EXT);
      this._mpx = mpx/1e6; this._passes = passes;
    }
  }
  if (!customElements.get('weather-sky-v6')) customElements.define('weather-sky-v6', WeatherSkyV6);
})();
