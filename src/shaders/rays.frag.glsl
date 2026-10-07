// Pass 3: crepuscular ray gather at sky resolution; only runs while rays are active. Has its own hash12 and no shared noise.
#version 300 es
precision highp float;
uniform sampler2D uScene; uniform vec2 uSunUV, uRes; uniform float uEnc, uLod; uniform int uTaps;
in vec2 vUv; out vec4 o;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 d = uSunUV - vUv; vec2 stp = d/float(max(uTaps, 1))*0.9;
  float acc = 0.0, wgt = 1.0, ws = 0.0; vec2 s = vUv + stp*hash12(vUv*uRes)*0.9;
  for (int i = 0; i < 24; i++) { if (i >= uTaps) break; s += stp; float lm = dot(textureLod(uScene, s, uLod).rgb, vec3(0.2126, 0.7152, 0.0722))/uEnc; acc += min(max(lm - 1.2, 0.0), 1.0)*wgt; ws += wgt; wgt *= 0.92; }
  o = vec4(acc/ws, 0.0, 0.0, 1.0);
}
