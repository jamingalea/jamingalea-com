/*
 * <baf-sphere> — Books About Food spinning sphere.
 *
 * Usage:
 *   <script type="module" src="/baf-sphere.js"></script>
 *   (on jamingalea.com: src="/embeds/baf-sphere.js")
 *   <baf-sphere style="width:240px"></baf-sphere>
 *
 * Keep baf-sphere-texture.png in the same folder as this file
 * (or point the `texture` attribute at it).
 *
 * Attributes (all optional):
 *   duration     seconds per full turn at rest speed      (default 4)
 *   direction    1 = left→right, -1 = right→left          (default 1)
 *   tilt         spin-axis tilt in degrees                 (default -21)
 *   interactive  set to "false" to turn off drag-to-spin
 *   texture      URL of the surface image
 *   label        accessible description
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const DEFAULT_TEXTURE = new URL('./baf-sphere-texture.png', import.meta.url).href;
const FOV = 26;
const FILL = 0.996;      // sphere diameter as a share of the frame (hugs the edges)
const SETTLE = 1.1;      // seconds for a flick to ease back towards rest speed
const MAX_SPIN = 40;     // rad/s cap on flick speed

class BafSphere extends HTMLElement {
  static get observedAttributes() { return ['duration', 'direction', 'tilt', 'texture', 'label']; }

  connectedCallback() {
    if (this._ready) return;
    this._ready = true;

    if (!this.style.display) this.style.display = 'block';
    this.style.aspectRatio = this.style.aspectRatio || '1 / 1';
    this.style.position = this.style.position || 'relative';
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Books About Food logo on a spinning ball');

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y;-webkit-tap-highlight-color:transparent';
    this.appendChild(canvas);
    this._canvas = canvas;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    this._renderer = renderer;

    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    const half = THREE.MathUtils.degToRad(FOV / 2);
    this._camera.position.set(0, 0, 1 / Math.sin(Math.atan(FILL * Math.tan(half))));
    this._camera.lookAt(0, 0, 0);

    this._pivot = new THREE.Group();
    this._scene.add(this._pivot);
    this._material = new THREE.MeshBasicMaterial({ color: 0xecd16f });
    this._sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this._material);
    this._pivot.add(this._sphere);

    this._angle = 0;
    this._omega = this._restOmega();
    this._dragging = false;
    this._visible = true;
    this._loadTexture();
    this._applyTilt();
    this._bindPointer();

    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(this);
    this._io = new IntersectionObserver(([e]) => { this._visible = e.isIntersecting; this._kick(); });
    this._io.observe(this);
    this._onVis = () => this._kick();
    document.addEventListener('visibilitychange', this._onVis);
    this._motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

    this._last = performance.now();
    this._resize();
    this._kick();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    this._resizeObs?.disconnect(); this._io?.disconnect();
    document.removeEventListener('visibilitychange', this._onVis);
    this._material?.map?.dispose(); this._material?.dispose();
    this._sphere?.geometry.dispose(); this._renderer?.dispose();
    this._canvas?.remove();
    this._ready = false;
  }

  attributeChangedCallback(name) {
    if (!this._ready) return;
    if (name === 'texture') this._loadTexture();
    if (name === 'tilt') this._applyTilt();
    if (name === 'label') this.setAttribute('aria-label', this.getAttribute('label'));
  }

  _num(name, fallback) { const v = parseFloat(this.getAttribute(name)); return Number.isFinite(v) ? v : fallback; }
  _restOmega() {
    if (this._motionQuery?.matches) return 0;
    const dir = this._num('direction', 1) < 0 ? -1 : 1;
    return dir * (2 * Math.PI) / Math.max(0.5, this._num('duration', 4));
  }
  _applyTilt() { this._pivot.rotation.z = THREE.MathUtils.degToRad(-this._num('tilt', -21)); this._kick(); }

  _loadTexture() {
    const url = this.getAttribute('texture') || DEFAULT_TEXTURE;
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this._renderer.capabilities.getMaxAnisotropy();
      this._material.map?.dispose();
      this._material.map = tex; this._material.color.set(0xffffff); this._material.needsUpdate = true;
      this._kick();
    });
  }

  _resize() {
    const w = Math.max(1, this.clientWidth), h = Math.max(1, this.clientHeight);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setSize(w, h, false);
    this._camera.aspect = w / h;
    // keep the sphere hugging the shorter side
    const half = THREE.MathUtils.degToRad(FOV / 2);
    const fill = FILL * Math.min(1, w / h);
    this._camera.position.z = 1 / Math.sin(Math.atan(fill * Math.tan(half)));
    this._camera.updateProjectionMatrix();
    this._radiusPx = Math.min(w, h) / 2 * FILL;
    this._kick();
  }

  _bindPointer() {
    const c = this._canvas;
    let startX = 0, lastX = 0, lastT = 0, pending = false, vel = 0;
    const enabled = () => this.getAttribute('interactive') !== 'false';
    c.style.cursor = 'grab';

    c.addEventListener('pointerdown', (e) => {
      if (!enabled() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      startX = lastX = e.clientX; lastT = performance.now(); vel = 0;
      pending = true;
      if (e.pointerType === 'mouse') this._begin(e);
    });
    c.addEventListener('pointermove', (e) => {
      if (!pending) return;
      if (!this._dragging) {
        if (Math.abs(e.clientX - startX) < 6) return;   // touch: wait for a sideways drag before taking over
        this._begin(e);
      }
      const now = performance.now();
      const d = (e.clientX - lastX) / Math.max(20, this._radiusPx);   // surface follows the pointer
      this._angle += d;
      const dt = Math.max(8, now - lastT) / 1000;
      vel = vel * 0.35 + (d / dt) * 0.65;   // smoothed pointer speed in rad/s
      lastX = e.clientX; lastT = now;
      this._kick();
    });
    const end = () => {
      if (!pending) return;
      pending = false;
      if (!this._dragging) return;
      this._dragging = false; c.style.cursor = 'grab';
      if (performance.now() - lastT < 120) {
        this._omega = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, vel));
      } else {
        this._omega = 0;   // released while still: ease back up from a stop
      }
      this._last = performance.now();
      this._kick();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
  }

  _begin(e) {
    this._dragging = true;
    this._canvas.style.cursor = 'grabbing';
    try { this._canvas.setPointerCapture(e.pointerId); } catch {}
  }

  _kick() {
    if (this._raf || !this._ready) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  _frame(now) {
    this._raf = 0;
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    const rest = this._restOmega();
    if (!this._dragging) {
      this._omega += (rest - this._omega) * (1 - Math.exp(-dt / SETTLE));
      if (Math.abs(rest - this._omega) < 0.002) this._omega = rest;
      this._angle += this._omega * dt;
    }
    this._angle %= Math.PI * 2;
    this._sphere.rotation.y = this._angle;
    this._renderer.render(this._scene, this._camera);
    const moving = this._dragging || this._omega !== 0;
    if (moving && this._visible && !document.hidden) this._raf = requestAnimationFrame((t) => this._frame(t));
  }
}

if (!customElements.get('baf-sphere')) customElements.define('baf-sphere', BafSphere);
export default BafSphere;
