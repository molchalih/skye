// Pass 1: soft sky at reduced resolution. Alpha is cloud transmittance times fog/tint attenuation, read by the composite pass.
#version 300 es
precision highp float;
uniform vec2 uRes, uSunPos, uMoonPos, uLPos, uFlashPos, uASun, uBoltPos;
uniform float uTime, uWindT, uCover, uSeed, uNight, uFlash, uCloudDark, uEl, uSunUp, uRainy, uSnowy, uEnc, uFog, uHaze, uBolt, uBoltSeed, uRainbow, uMoonPhase, uBelt, uStar, uStorm;
uniform int uStart, uEnd, uOctCap;
uniform vec3 uSunCol, uMoonCol, uLCol, uZenith, uHorizon;
in vec2 vUv; out vec4 o;
#include "noise.glsl"
// v6's fbm for a caller that only reads it through smoothstep(lo, hi, .), lo < hi: it stops once the result cannot land in
// [lo, hi]. Octave i weighs 2^-(i+1) and vnoise is in [0, 1]: with weight n summed so far, out of w = 1 - 2^-oct, the octaves
// left add between 0 and w - n. If s + w - n < lo*w the full sum ends below lo*w, and if s > hi*w above hi*w; s/n lies on the
// same side, as n <= w, so the smoothstep is 0 or 1 either way. 1e-4 covers float rounding. Octaves are summed in v6's order.
float fbm(vec2 p, int oct, float lo, float hi){ float a = 0.5, s = 0.0, n = 0.0, w = 1.0 - exp2(-float(oct));
  float below = (lo - 1.0)*w - 1e-4, above = hi*w + 1e-4;
  for (int i = 0; i < 6; i++){ if (i >= oct) break; s += a*vnoise(p); n += a; p = ROT*p + 17.3; a *= 0.5; if (s - n < below || s > above) break; } return s/n; }
vec3 spectrum(float t){ t = clamp(t, 0.0, 1.0);
  return clamp(vec3(smoothstep(0.4, 0.9, t) + 0.45*smoothstep(0.15, 0.0, t), sin(t*3.1416)*0.9, smoothstep(0.55, 0.05, t)), 0.0, 1.0); }
float cov2(vec2 q, int oct, float th, float soft){ return smoothstep(th, th + soft*2.6, fbm(q, oct, th, th + soft*2.6)); }
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
    // below th + 0.025*soft, c < 0.002 (smoothstep at 0.025 is 0.0018), so v6's own continue skips the layer and the exit stops
    // only where it would; above th + 2.6*soft, c and t2 are both 1. soft > 0 keeps the band's ends in order.
    float d = fbm(q, oct, th + 0.025*soft, th + soft*2.6);
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
}
