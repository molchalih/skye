// Pass 4: glass and post. Fine drop detail is skipped when the output is blurred.
#version 300 es
precision highp float;
uniform sampler2D uScene, uRaysTex; uniform vec2 uRes, uSunUV; uniform float uTime, uRainG, uFrost, uMist, uFlash, uExposure, uSeed, uEnc, uDim, uWet, uRays, uFlare, uDetail; uniform vec3 uSunTint;
in vec2 vUv; out vec4 o;
#include "noise.glsl"
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
  // trailRegion is 0 only if a factor is. inTrail shares the 0.7 and ti factors, and the first is 0 only for above near 0 or
  // below, under aboveStart >= 0.0728 where inTrail is 0 as well. So trail and beads are both 0.
  if (trailRegion == 0.0) return vec2(drop, smoothstep(0.0, 0.15, drop));
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
  if (fract(n.z*7.0) < 0.72) return 0.0; // v6's step(0.72, .) factor: this cell has no bead
  vec2 p = (n.xy - 0.5)*0.6;
  float life = saw(0.05, fract(t*0.6 + n.z));
  float r = 0.06 + 0.16*fract(n.z*10.0);
  return smoothstep(r, 0.0, length(f - p))*life; }
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
      // the second layer's weight, smoothstep(0.5, 1.0, uRainG), is 0 up to 0.5, and max with 0 keeps hgt and trailClear
      if (uRainG > 0.5) {
        vec2 m2 = slideLayer(U + 3.7, t*1.3, 1.85)*smoothstep(0.5, 1.0, uRainG);
        hgt = max(hgt, m2.x); trailClear = max(trailClear, m2.y);
      }
    }
  }
  if (uMist > 0.001) hgt = max(hgt, beadLayer(U*0.7 + 17.0, t*0.3)*smoothstep(0.0, 0.7, uMist)*0.9);
  float dropMask = smoothstep(0.02, 0.25, hgt);
  n = vec2(dFdx(hgt), dFdy(hgt))*(uRes.y/900.0)*1.6;
  if (uFrost > 0.001) {
    vec2 cuv = (uv - 0.5)*vec2(asp, 1.0);
    frostMask = smoothstep(0.55, 1.15, length(cuv)*1.25 + (vnoise(U*6.0 + uSeed) - 0.5)*0.5)*uFrost;
    // fn and this normal offset are weighted by frostMask, so where it is 0 they change nothing
    if (uDetail > 0.5 && frostMask > 0.0) { fn = vnoise(U*90.0)*0.5 + vnoise(U*180.0)*0.5; n += (vec2(vnoise(U*40.0 + 3.0), vnoise(U*40.0 + 9.0)) - 0.5)*0.02*frostMask; }
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
}
