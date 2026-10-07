/** `hdr`: half-float (RGBA8 without `EXT_color_buffer_float`); `r8`: one channel; `rgba8`: plain colour. */
export type TargetKind = "hdr" | "r8" | "rgba8";

/**
 * Scale applied to HDR values before they are stored. RGBA8 fallback targets
 * clip at 1, so values are stored at a fifth and divided back on read (v6 `enc`).
 */
export function hdrEncoding(float: boolean): number {
  return float ? 1 : 0.2;
}

/** A texture with its framebuffer, bilinear and clamped; storage is (re)allocated by `resize`. */
export class Target {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  width = 0;
  height = 0;
  private readonly gl: WebGL2RenderingContext;
  private readonly kind: TargetKind;
  private readonly float: boolean;

  constructor(gl: WebGL2RenderingContext, kind: TargetKind, float: boolean, mipmapped: boolean) {
    this.gl = gl;
    this.kind = kind;
    this.float = float;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.texture = t;
    this.framebuffer = fb;
  }

  /** Allocates `width` x `height` storage unless the size is unchanged. Returns whether it reallocated. */
  resize(width: number, height: number): boolean {
    if (this.width === width && this.height === height) return false;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.kind === "hdr" && this.float) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else if (this.kind === "r8") {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    this.width = width;
    this.height = height;
    return true;
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}
