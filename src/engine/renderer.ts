import { VERTEX_SHADER, FRAGMENT_SHADER } from './shaders';
import type { Adjustments } from './adjustments';
import { CONTROLS } from './adjustments';

export type TextureSource =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap
  | VideoFrame;

export interface RenderOptions {
  /** 0..1 wipe position for the before/after compare, or null to disable. */
  split?: number | null;
  /** Clockwise display rotation to bake in: 0 | 90 | 180 | 270. */
  rotation?: number;
  /** Animates the grain pattern between frames. */
  seed?: number;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

/**
 * One WebGL2 program, reused for live preview, preset thumbnails, still export
 * and every frame of a video export. Because there is exactly one code path,
 * the exported file matches the preview by construction.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private srcWidth = 1;
  private srcHeight = 1;
  private disposed = false;
  /** True when we made the canvas, and so may destroy its context on dispose. */
  private ownsCanvas: boolean;

  constructor(canvas?: HTMLCanvasElement) {
    this.ownsCanvas = !canvas;
    this.canvas = canvas ?? document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;
    gl.useProgram(program);

    // Full-screen triangle pair.
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.uniform1i(this.loc('u_tex'), 0);
  }

  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name)!;
  }

  /** Upload a frame. Cheap enough to call once per video frame. */
  upload(source: TextureSource, width: number, height: number): void {
    if (this.disposed) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    this.srcWidth = Math.max(1, width);
    this.srcHeight = Math.max(1, height);
  }

  /** Size of the output buffer. For 90/270 rotation, callers swap w/h themselves. */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  render(adj: Adjustments, opts: RenderOptions = {}): void {
    if (this.disposed) return;
    const gl = this.gl;
    const { split = null, rotation = 0, seed = 0 } = opts;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.uniformMatrix3fv(this.loc('u_uvTransform'), false, uvTransformFor(rotation));
    gl.uniform2f(this.loc('u_texel'), 1 / this.srcWidth, 1 / this.srcHeight);
    gl.uniform1f(this.loc('u_aspect'), this.canvas.width / Math.max(1, this.canvas.height));
    gl.uniform1f(this.loc('u_seed'), seed);
    gl.uniform1f(this.loc('u_split'), split === null ? -1 : split);

    for (const c of CONTROLS) {
      gl.uniform1f(this.loc(`u_${c.key}`), adj[c.key] ?? 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    // Only tear down the context on canvases we created. A caller-supplied
    // canvas may be re-attached to a new Renderer (React StrictMode remounts
    // effects), and a lost context can never be reacquired for that element.
    if (this.ownsCanvas) gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * Column-major mat3 mapping output UV -> source UV.
 *
 * Containers store rotation as metadata, and while a <video> element applies it
 * for you, a decoded WebCodecs VideoFrame does not. Baking it here is what keeps
 * an iPhone portrait clip from exporting sideways.
 */
export function uvTransformFor(rotation: number): Float32Array {
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  switch (r) {
    case 90:  // u' = v,      v' = 1 - u
      return new Float32Array([0, -1, 0, 1, 0, 0, 0, 1, 1]);
    case 180: // u' = 1 - u,  v' = 1 - v
      return new Float32Array([-1, 0, 0, 0, -1, 0, 1, 1, 1]);
    case 270: // u' = 1 - v,  v' = u
      return new Float32Array([0, 1, 0, -1, 0, 0, 1, 0, 1]);
    default:
      return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
}
