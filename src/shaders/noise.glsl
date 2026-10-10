// v6's noise block up to its fbm, which only the sky uses: the sky defines ROT and its own fbm (sky.frag.glsl).
// The glass calls only hash12 from it; the build drops the vnoise it never calls (dropUnusedFunctions in
// scripts/shaders.ts), as the GLSL compiler would.
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
