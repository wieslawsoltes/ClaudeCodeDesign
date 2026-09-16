/** Progressive WebGPU ornament. Semantic UI and editing never depend on a GPU. */
const TAU = Math.PI * 2;
export const PARTICLES = 96 * 70;
export const SHADER = `
struct Params { time: f32, aspect: f32, dark: f32, px: f32, py: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> u: Params;
struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) shade: f32 }
@vertex fn vertexMain(@builtin(vertex_index) vi: u32, @builtin(instance_index) id: u32) -> Output {
  let corners = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let a = f32(id % 96u) / 96.0 * 6.2831853;
  let b = f32(id / 96u) / 70.0 * 6.2831853;
  let ripple = 0.022 * sin(a * 4.0 + b * 2.0 + u.time * 0.25);
  let radius = 0.58 + (0.225 + ripple) * cos(b);
  var p = vec3f(radius * cos(a), radius * sin(a), (0.225 + ripple) * sin(b));
  let tilt = 0.65 + u.py * 0.3;
  p = vec3f(p.x, p.y * cos(tilt) - p.z * sin(tilt), p.y * sin(tilt) + p.z * cos(tilt));
  let spin = -0.45 + u.time * 0.09 + u.px * 0.35;
  p = vec3f(p.x * cos(spin) + p.z * sin(spin), p.y, -p.x * sin(spin) + p.z * cos(spin));
  let twist = -0.28;
  p = vec3f(p.x * cos(twist) - p.y * sin(twist), p.x * sin(twist) + p.y * cos(twist), p.z);
  let perspective = 2.6 / (2.6 - p.z);
  let size = 0.0048 * perspective;
  let point = (p.xy * 0.97 + corners[vi] * size) * perspective;
  var out: Output;
  out.position = vec4f(point.x / u.aspect, point.y, 0.0, 1.0);
  out.uv = corners[vi]; out.shade = clamp(0.42 + (p.z + 0.65) * 0.42, 0.25, 1.0);
  return out;
}
@fragment fn fragmentMain(input: Output) -> @location(0) vec4f {
  let d = length(input.uv); if (d > 1.0) { discard; }
  let color = mix(vec3f(0.70,0.29,0.18), vec3f(0.89,0.48,0.34), u.dark);
  return vec4f(color, input.shade * (1.0 - smoothstep(0.7, 1.0, d)));
}`;
export class AmbientRenderer {
  constructor(canvas, status = () => {}) {
    this.canvas = canvas; this.status = status; this.dead = false; this.last = -1000; this.pointer = [0, 0];
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.onPointer = event => { const r = canvas.getBoundingClientRect(); this.pointer = [(event.clientX - r.left) / r.width - .5, (event.clientY - r.top) / r.height - .5]; if (this.motion.matches) this.paint(performance.now()); };
    this.onLeave = () => { this.pointer = [0, 0]; };
    canvas.addEventListener('pointermove', this.onPointer, { passive: true }); canvas.addEventListener('pointerleave', this.onLeave);
    this.onVisible = () => { cancelAnimationFrame(this.frame); if (!document.hidden) this.loop(performance.now()); };
    this.onMotion = () => { cancelAnimationFrame(this.frame); this.paint(performance.now()); if (!this.motion.matches) this.loop(performance.now()); };
    document.addEventListener('visibilitychange', this.onVisible); this.motion.addEventListener('change', this.onMotion);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    this.initialize();
  }
  async initialize() {
    try {
      if (!navigator.gpu) throw new Error('Unavailable');
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      if (!adapter || this.dead) { if (!this.dead) throw new Error('No adapter'); return; }
      const device = await adapter.requestDevice();
      if (this.dead) { device.destroy(); return; }
      this.device = device;
      const module = device.createShaderModule({ code: SHADER });
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint: 'fragmentMain', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } });
      if (this.dead) return;
      this.context = this.canvas.getContext('webgpu');
      if (!this.context) throw new Error('No WebGPU canvas');
      this.context.configure({ device, format, alphaMode: 'premultiplied' });
      this.uniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
      this.kind = 'WebGPU'; this.status(this.kind); this.resize(); this.loop(performance.now());
      device.lost.then(() => { if (!this.dead && this.kind === 'WebGPU') this.fallback(); });
    } catch { if (!this.dead) this.fallback(); }
  }
  fallback() {
    cancelAnimationFrame(this.frame); this.kind = 'Canvas'; this.device?.destroy(); this.device = null;
    if (!this.fallbackCanvas) {
      this.fallbackCanvas = document.createElement('canvas'); this.fallbackCanvas.className = this.canvas.className;
      this.fallbackCanvas.setAttribute('aria-hidden', 'true'); this.fallbackCanvas.style.pointerEvents = 'none';
      this.canvas.after(this.fallbackCanvas); this.canvas.style.opacity = '0';
    }
    this.ctx = this.fallbackCanvas.getContext('2d'); this.status('Canvas'); this.resize(); this.loop(performance.now());
  }
  resize() {
    if (this.dead) return;
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.75);
    this.width = Math.max(1, Math.round(rect.width * dpr)); this.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.width = this.width; this.canvas.height = this.height;
    if (this.fallbackCanvas) { this.fallbackCanvas.width = this.width; this.fallbackCanvas.height = this.height; }
    this.paint(performance.now());
  }
  loop(now) {
    if (this.dead || document.hidden) return;
    if (now - this.last >= 32) { this.paint(now); this.last = now; }
    if (!this.motion.matches) this.frame = requestAnimationFrame(t => this.loop(t));
  }
  paint(now) {
    if (this.dead || !this.kind || !this.width || !this.height) return;
    const time = this.motion.matches ? 0 : now * .001;
    const dark = document.documentElement.dataset.theme === 'dark';
    if (this.kind === 'WebGPU') {
      try {
        this.device.queue.writeBuffer(this.uniform, 0, new Float32Array([time, this.width / this.height, Number(dark), ...this.pointer, 0, 0, 0]));
        const encoder = this.device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bind); pass.draw(6, PARTICLES); pass.end(); this.device.queue.submit([encoder.finish()]);
      } catch { this.fallback(); }
      return;
    }
    const ctx = this.ctx; if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    const tilt = .65 + this.pointer[1] * .3, spin = -.45 + time * .09 + this.pointer[0] * .35;
    const ct = Math.cos(tilt), st = Math.sin(tilt), cs = Math.cos(spin), ss = Math.sin(spin), cw = Math.cos(-.28), sw = Math.sin(-.28);
    ctx.fillStyle = dark ? '#e37b57' : '#b34a2e';
    for (let i = 0; i < PARTICLES; i++) {
      const a = i % 96 / 96 * TAU, b = Math.floor(i / 96) / 70 * TAU, tube = .225 + .022 * Math.sin(a * 4 + b * 2 + time * .25);
      const radius = .58 + tube * Math.cos(b); let x = radius * Math.cos(a), y = radius * Math.sin(a), z = tube * Math.sin(b);
      [y, z] = [y * ct - z * st, y * st + z * ct]; [x, z] = [x * cs + z * ss, -x * ss + z * cs]; [x, y] = [x * cw - y * sw, x * sw + y * cw];
      const p = 2.6 / (2.6 - z), scale = this.height * .485 * p;
      ctx.globalAlpha = Math.max(.25, Math.min(1, .42 + (z + .65) * .42));
      ctx.beginPath(); ctx.arc(this.width / 2 + x * scale, this.height / 2 - y * scale, Math.max(.55, this.height * .0024 * p * p), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  destroy() {
    this.dead = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); this.uniform?.destroy(); this.device?.destroy();
    this.canvas.removeEventListener('pointermove', this.onPointer); this.canvas.removeEventListener('pointerleave', this.onLeave);
    document.removeEventListener('visibilitychange', this.onVisible); this.motion.removeEventListener('change', this.onMotion);
    this.fallbackCanvas?.remove(); this.canvas.style.opacity = '';
  }
}
