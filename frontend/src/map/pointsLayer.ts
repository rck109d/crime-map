import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import { hexToRgb, type DataTheme } from "../theme";

const VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform float u_size;
uniform vec3 u_colors[4];
in vec2 a_pos;
in float a_style;
out vec3 v_color;
void main() {
  if (a_style > 3.5) {
    // Filtered out: park the vertex outside the clip volume.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  v_color = u_colors[int(a_style + 0.5)];
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_size;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 u_ring;
uniform float u_size;
uniform float u_ringWidth;
in vec3 v_color;
out vec4 fragColor;
void main() {
  // Distance from the sprite centre, in pixels.
  float d = length(gl_PointCoord - 0.5) * u_size;
  float r = u_size * 0.5;
  float alpha = clamp(r - d, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  float core = clamp(r - u_ringWidth - d, 0.0, 1.0);
  vec3 color = mix(u_ring, v_color, core);
  fragColor = vec4(color * alpha, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

/** Point diameter in CSS pixels: small when zoomed out, a comfortable target up close. */
export function pointDiameter(zoom: number): number {
  const stops: [number, number][] = [
    [9, 3],
    [12, 5],
    [15, 9],
    [18, 15],
  ];
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, s1] = stops[i];
    if (zoom <= z1) {
      const [z0, s0] = stops[i - 1];
      return s0 + ((zoom - z0) / (z1 - z0)) * (s1 - s0);
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Draws every incident as a GPU point sprite. All rows stay in one vertex
 * buffer; filtering only rewrites a one-byte-per-row style buffer, so changing
 * a filter on hundreds of thousands of points is instant.
 */
export class PointsLayer implements CustomLayerInterface {
  readonly id = "incidents";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;

  private map: MapLibreMap | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private posBuffer: WebGLBuffer | null = null;
  private styleBuffer: WebGLBuffer | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  /** Mercator positions relative to `origin` (keeps float32 precise at street level). */
  private positions: Float32Array = new Float32Array(0);
  private origin: [number, number] = [0, 0];
  private style: Uint8Array = new Uint8Array(0);
  private first = 0;
  private drawCount = 0;
  private positionsDirty = false;
  private styleDirty = false;
  private colors = new Float32Array(12);
  private ring: [number, number, number] = [1, 1, 1];
  visible = true;

  setPositions(positions: Float32Array, origin: [number, number]) {
    this.positions = positions;
    this.origin = origin;
    this.positionsDirty = true;
    this.map?.triggerRepaint();
  }

  /** `style[i]` is the colour group of row i, or 255 to hide it; rows outside [first, end) are skipped. */
  setStyle(style: Uint8Array, first: number, end: number) {
    this.style = style;
    this.first = first;
    this.drawCount = Math.max(0, end - first);
    this.styleDirty = true;
    this.map?.triggerRepaint();
  }

  setTheme(theme: DataTheme) {
    theme.groups.forEach((hex, i) => this.colors.set(hexToRgb(hex), i * 3));
    this.ring = hexToRgb(theme.ring);
    this.map?.triggerRepaint();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    const program = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = program;
    for (const name of ["u_matrix", "u_size", "u_colors", "u_ring", "u_ringWidth"]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    this.vao = gl.createVertexArray();
    this.posBuffer = gl.createBuffer();
    this.styleBuffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const aStyle = gl.getAttribLocation(program, "a_style");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.styleBuffer);
    gl.enableVertexAttribArray(aStyle);
    gl.vertexAttribPointer(aStyle, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    // Buffers are new (first add, or re-added after a basemap change): upload again.
    this.positionsDirty = true;
    this.styleDirty = true;
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.posBuffer);
    gl.deleteBuffer(this.styleBuffer);
    this.program = this.vao = this.posBuffer = this.styleBuffer = null;
    this.map = null;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.program || !this.map || !this.visible) return;
    const rows = this.positions.length / 2;
    if (this.positionsDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.STATIC_DRAW);
      this.positionsDirty = false;
    }
    if (this.styleDirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.styleBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.style, gl.DYNAMIC_DRAW);
      this.styleDirty = false;
    }
    if (this.drawCount === 0 || this.style.length !== rows) return;

    // mainMatrix maps the 0..1 mercator square to clip space, in float64.
    // Fold the origin shift into it here so the shader only ever sees small numbers.
    const m = args.defaultProjectionData.mainMatrix as ArrayLike<number>;
    const [ox, oy] = this.origin;
    const matrix = new Float32Array(16);
    for (let i = 0; i < 16; i++) matrix[i] = m[i];
    for (let i = 0; i < 4; i++) matrix[12 + i] = m[i] * ox + m[4 + i] * oy + m[12 + i];

    const dpr = this.map.getCanvas().width / Math.max(1, this.map.getCanvas().clientWidth);
    const ringWidth = 1 * dpr;
    const size = pointDiameter(this.map.getZoom()) * dpr + 2 * ringWidth;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.u_matrix, false, matrix);
    gl.uniform1f(this.uniforms.u_size, size);
    gl.uniform1f(this.uniforms.u_ringWidth, ringWidth);
    gl.uniform3fv(this.uniforms.u_colors, this.colors);
    gl.uniform3f(this.uniforms.u_ring, ...this.ring);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, this.first, this.drawCount);
    gl.bindVertexArray(null);
  }
}
