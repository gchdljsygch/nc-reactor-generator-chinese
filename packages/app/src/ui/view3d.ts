/**
 * R3.7 — the 3D view.
 *
 * Deliberately **WebGL 1**, not WebGPU (the plan is explicit: "用 WebGL，不用
 * WebGPU（兼容性优先）"). The renderer draws the reactor as an axis-aligned cube
 * field with:
 *
 *  - orbit (drag) and zoom (wheel);
 *  - slice: hide everything past a layer on the selected axis;
 *  - shell only: keep the outer layer;
 *  - one colour per palette entry (`paletteColor`, shared with the 2D view).
 *
 * Geometry is rebuilt whenever the grid changes: one interleaved buffer of
 * position+colour, drawn in a single call. Cells are culled against the shader's
 * clip space, and very large grids are capped ({@link MAX_CUBES}) — a 64³ grid
 * has 262k cells and 9.4M vertices, which no browser will thank us for.
 */

import { AIR, isInterior, type Dims, type GridState } from '../model/grid.js';
import { h } from './dom.js';
import { paletteColor } from './grid2d.js';

const MAX_CUBES = 60_000;

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aColor;
uniform mat4 uMvp;
varying vec3 vColor;
void main() {
  gl_Position = uMvp * vec4(aPosition, 1.0);
  vColor = aColor;
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}`;

export interface View3DOptions {
  readonly grid: () => GridState;
  readonly sliceAxis: () => 0 | 1 | 2;
  readonly sliceIndex: () => number;
  readonly shellOnly: () => boolean;
}

export interface View3D {
  readonly element: HTMLElement;
  render(): void;
  resetView(): void;
}

interface Camera {
  yaw: number;
  pitch: number;
  distance: number;
}

export function createView3D(options: View3DOptions): View3D {
  const canvas = h('canvas', { class: 'view3d-canvas' }) as HTMLCanvasElement;
  const element = h('div', { class: 'view3d' }, [canvas]);
  const gl = canvas.getContext('webgl', { antialias: true });
  const camera: Camera = { yaw: 0.7, pitch: 0.5, distance: 3 };

  if (gl === null) {
    element.append(h('div', { class: 'view3d-error', text: 'WebGL is not available in this browser' }));
    return { element, render: () => {}, resetView: () => {} };
  }

  const program = buildProgram(gl);
  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  const colorLocation = gl.getAttribLocation(program, 'aColor');
  const mvpLocation = gl.getUniformLocation(program, 'uMvp');
  const buffer = gl.createBuffer();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('mousedown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    camera.yaw += (event.clientX - lastX) * 0.01;
    camera.pitch = clamp(camera.pitch + (event.clientY - lastY) * 0.01, -1.5, 1.5);
    lastX = event.clientX;
    lastY = event.clientY;
    render();
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      camera.distance = clamp(camera.distance * (event.deltaY > 0 ? 1.1 : 0.9), 0.4, 12);
      render();
    },
    { passive: false },
  );

  const render = (): void => {
    const grid = options.grid();
    const width = canvas.clientWidth || 480;
    const height = canvas.clientHeight || 360;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.09, 0.1, 0.13, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const vertices = buildGeometry(grid, options);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(colorLocation);
    gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, stride, 3 * 4);

    gl.useProgram(program);
    gl.uniformMatrix4fv(mvpLocation, false, viewProjection(grid.dims, camera, canvas.width / canvas.height));
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6);
  };

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(canvas);

  return {
    element,
    render,
    resetView: () => {
      camera.yaw = 0.7;
      camera.pitch = 0.5;
      camera.distance = 3;
      render();
    },
  };
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`3D view: could not link program (${String(gl.getProgramInfoLog(program))})`);
  }
  return program;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('3D view: could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`3D view: shader compile failed (${String(gl.getShaderInfoLog(shader))})`);
  }
  return shader;
}

/**
 * Cube faces, wound counter-clockwise. Only the six faces are emitted (no
 * per-face culling pass): interiors of a reactor are usually hollow, and a
 * visibility pass would cost more than it saves at these block counts.
 */
const CUBE_FACES: readonly (readonly [number, number, number])[][] = [
  // +X, -X, +Y, -Y, +Z, -Z
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];

function buildGeometry(grid: GridState, options: View3DOptions): Float32Array {
  const [dx, dy, dz] = grid.dims;
  const axis = options.sliceAxis();
  const sliceIndex = options.sliceIndex();
  const shellOnly = options.shellOnly();
  const values: number[] = [];
  const center: [number, number, number] = [dx / 2, dy / 2, dz / 2];
  let cubes = 0;

  for (let x = 0; x < dx && cubes < MAX_CUBES; x++) {
    for (let y = 0; y < dy && cubes < MAX_CUBES; y++) {
      for (let z = 0; z < dz && cubes < MAX_CUBES; z++) {
        const block = grid.blocks[x]?.[y]?.[z] ?? AIR;
        const interior = isInterior(grid, x, y, z);
        if (interior && block === AIR) continue;
        if (!interior && !shellOnly && block === AIR) {
          // The casing is implicit; draw it only when it is not hidden by the
          // slice, and only when the user asked for the shell or a slice is
          // active (otherwise it would hide the interior entirely).
          if (axis === 0 && x !== sliceIndex) continue;
          if (axis === 1 && y !== sliceIndex) continue;
          if (axis === 2 && z !== sliceIndex) continue;
        } else if (interior && shellOnly) {
          continue;
        }
        if (interior && axis === 0 && x > sliceIndex) continue;
        if (interior && axis === 1 && y > sliceIndex) continue;
        if (interior && axis === 2 && z > sliceIndex) continue;
        if (interior && shellOnly && !onShell(grid.dims, x, y, z)) continue;
        const color: [number, number, number] = interior
          ? hexToRgb(paletteColor(block))
          : [0.23, 0.25, 0.29];
        cubes++;
        for (const face of CUBE_FACES) {
          const [a, b, c, d] = face;
          pushTriangle(values, x, y, z, a, b, c, color, center);
          pushTriangle(values, x, y, z, a, c, d, color, center);
        }
      }
    }
  }
  return new Float32Array(values);
}

function onShell(dims: Dims, x: number, y: number, z: number): boolean {
  return x === 1 || y === 1 || z === 1 || x === dims[0] - 2 || y === dims[1] - 2 || z === dims[2] - 2;
}

function pushTriangle(
  out: number[],
  x: number,
  y: number,
  z: number,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  color: readonly [number, number, number],
  center: readonly [number, number, number],
): void {
  for (const v of [a, b, c]) {
    out.push(
      x + v[0] - center[0],
      y + v[1] - center[1],
      z + v[2] - center[2],
      color[0],
      color[1],
      color[2],
    );
  }
}

function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith('hsl')) {
    const match = /hsl\((\d+(?:\.\d+)?)\s+(\d+)%\s+(\d+)%\)/.exec(color);
    if (match !== null) {
      const hue = Number(match[1]) / 360;
      const saturation = Number(match[2]) / 100;
      const lightness = Number(match[3]) / 100;
      return hslToRgb(hue, saturation, lightness);
    }
  }
  return [0.8, 0.8, 0.8];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

/** Perspective × view × model matrix, in column-major order (WebGL's layout). */
function viewProjection(
  dims: Dims,
  camera: Camera,
  aspect: number,
): Float32Array {
  const scale = Math.max(dims[0], dims[1], dims[2]);
  const distance = camera.distance * scale * 1.5;
  const cosPitch = Math.cos(camera.pitch);
  const eye: [number, number, number] = [
    distance * cosPitch * Math.sin(camera.yaw),
    distance * Math.sin(camera.pitch),
    distance * cosPitch * Math.cos(camera.yaw),
  ];
  const near = 0.1;
  const far = distance * 4 + scale * 4;
  const f = 1 / Math.tan((45 * Math.PI) / 360);
  const nf = 1 / (near - far);
  const perspective: number[] = [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  return multiply(perspective, view);
}

function lookAt(eye: readonly number[], target: readonly number[], up: readonly number[]): number[] {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize([...cross(up, z)]);
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ];
}

function multiply(a: readonly number[], b: readonly number[]): Float32Array {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return Float32Array.from(out);
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: number[]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
