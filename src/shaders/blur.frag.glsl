// Separable 13-tap Gaussian (7 bilinear fetches) over a sub-rect of a canvas-sized texture.
#version 300 es
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
}
