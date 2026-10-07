#version 300 es
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
}
