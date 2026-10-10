// Value noise from a texture, for the sky and the glass's frost: hash12 at the lattice points of a 256-cell tile
// (src/gl/noise.ts), repeated and filtered bilinearly. Moving the sample by vnoise's quintic fade within its cell turns
// the filter's linear weights into vnoise's quintic ones, at the filter's sub-texel precision. Level 0 is named, as
// both programs sample after a per-pixel branch or exit, where derivatives are undefined. highp: a lowp sampler may
// drop bits the half floats hold.
uniform highp sampler2D uNoise;
float tnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*f*(f*(f*6.0-15.0)+10.0); return textureLod(uNoise, (i + f + 0.5)/256.0, 0.0).r; }
