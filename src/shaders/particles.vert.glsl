// Rain, snow and dust as stateless instanced quads; each instance derives its motion from its id.
#version 300 es
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
}
