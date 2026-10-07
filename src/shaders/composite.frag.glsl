// Pass 2: upsample the sky and add the sharp features (moon, stars, meteors, sun disc, bolt core) at scene resolution.
#version 300 es
precision highp float;
uniform sampler2D uSky; uniform vec2 uRes, uSunPos, uMoonPos, uBoltPos;
uniform float uTime, uSeed, uSunUp, uMoonUp, uMoonPhase, uStar, uEnc, uHide, uBolt, uBoltSeed;
uniform vec3 uSunCol, uMoonCol;
in vec2 vUv; out vec4 o;
#include "noise.glsl"
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
}
