import { SimpleEventEmitter } from '@mary-ext/simple-event-emitter';

import { SPRING, Spring, clamp, clampRubber, projectDecay } from './physics.ts';
import {
	DEFAULT_CONFIG,
	type DragMode,
	IDENTITY,
	type Insets,
	type LightboxConfig,
	type LightboxState,
	type Point,
	type Size,
	type Transform,
} from './types.ts';
import { VelocityTracker } from './velocity.ts';

/** options for {@link LightboxEngine}. */
export interface EngineOptions {
	/** initial active image index (defaults to 0). */
	index?: number;
	/** behavior overrides merged over {@link DEFAULT_CONFIG}. */
	config?: Partial<LightboxConfig>;
	/** called when a dismiss gesture commits. */
	onDismiss?: () => void;

	/** injectable clock (defaults to performance.now). */
	now?: () => number;
	/** schedules a frame and returns a handle (defaults to requestAnimationFrame). */
	raf?: (cb: (t: number) => void) => number;
	/** cancels a frame scheduled by `raf` (defaults to cancelAnimationFrame). */
	caf?: (handle: number) => void;
}

interface PointerInfo {
	x: number;
	y: number;
	startX: number;
	startY: number;
}

interface PinchInfo {
	startDist: number;
	startScale: number;
	/** midpoint relative to the viewport center. */
	startMid: Point;
	startPan: Point;
}

/**
 *   idle ──pointerDown──▶ pending ──axis lock──▶ pan │ page │ dismiss ──up──▶ idle
 *     └────2nd pointer───▶ pinch ──last up──▶ (settle) idle
 */
type Gesture =
	| { kind: 'dismiss' }
	| { kind: 'idle' }
	| { kind: 'page' }
	| { kind: 'pan'; startPan: Point }
	| {
			kind: 'pending';
			paging: { target: number; velocity: number } | null;
			returningToFit: boolean;
			startPan: Point;
	  }
	| ({ kind: 'pinch' } & PinchInfo);

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;
/** prevents division by zero when pinch points overlap. */
const PINCH_MIN_DIST = 1e-3;

/** framework-agnostic lightbox gesture and animation state machine. */
export class LightboxEngine {
	/** live behavior config; mutate via {@link setConfig}. */
	config: LightboxConfig;

	// #region state

	#caf: (handle: number) => void;
	#now: () => number;
	#onDismiss?: () => void;
	#raf: (cb: (t: number) => void) => number;

	#count = 1;
	#fittedSizes: Size[] = [];
	#naturalSizes: (Size | undefined)[] = [];
	#viewport: Size = { width: 0, height: 0 };

	/** active image index; change via {@link goTo}/{@link next}/{@link prev}. */
	index: number;
	#transforms: Transform[] = [];

	#trackX: Spring;
	#dismissY: Spring;
	#scale: Spring;
	#panX: Spring;
	#panY: Spring;
	#channels: readonly Spring[];

	#lastTapTime = -Infinity;
	#lastTapPos: Point = { x: 0, y: 0 };
	#gesture: Gesture = { kind: 'idle' };
	#pointers = new Map<number, PointerInfo>();
	#velocity = new VelocityTracker();

	#emitter = new SimpleEventEmitter<[LightboxState]>();
	#lastFrameTime = 0;
	#rafHandle: number | null = null;
	// `useSyncExternalStore` requires a stable snapshot between changes.
	#snapshot: LightboxState | null = null;

	// #endregion

	/**
	 * creates an engine.
	 *
	 * @param opts initial behavior and scheduler options.
	 */
	constructor(opts: EngineOptions = {}) {
		this.config = normalizeConfig(opts.config);
		this.#onDismiss = opts.onDismiss;
		this.#now = opts.now ?? (() => performance.now());
		this.#raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
		this.#caf = opts.caf ?? ((h) => cancelAnimationFrame(h));
		this.index = opts.index ?? 0;

		this.#trackX = new Spring(0);
		this.#dismissY = new Spring(0);
		this.#scale = new Spring(1, SPRING.scale);
		this.#panX = new Spring(0);
		this.#panY = new Spring(0);
		this.#channels = [this.#trackX, this.#dismissY, this.#scale, this.#panX, this.#panY];
		this.#computeFittedSizes();
	}

	// #region configuration / geometry

	/**
	 * updates image geometry and restores idle layout.
	 *
	 * @param viewport current viewport size in px.
	 * @param count number of images (floored at 1).
	 * @param naturalSizes per-image intrinsic sizes; entries may be undefined until measured.
	 */
	setGeometry(viewport: Size, count: number, naturalSizes: (Size | undefined)[] = []): void {
		this.#viewport = viewport;
		this.#count = Math.max(1, count);
		this.#naturalSizes = naturalSizes;
		if (this.#transforms.length !== this.#count) {
			this.#transforms = Array.from(
				{ length: this.#count },
				(_, i) => this.#transforms[i] ?? { ...IDENTITY },
			);
		}
		this.#computeFittedSizes();
		if (!this.#isActive()) {
			this.#trackX.set(-this.index * viewport.width);
			this.#clampActivePanInstant();
			this.#emit();
		}
	}

	/**
	 * updates behavior and refits idle images.
	 *
	 * @param config overrides for the current config.
	 */
	setConfig(config: Partial<LightboxConfig>): void {
		this.config = normalizeConfig({ ...this.config, ...config });
		this.#computeFittedSizes();
		if (!this.#isActive()) {
			this.#clampActivePanInstant();
			this.#emit();
		}
	}

	// #endregion

	// #region programmatic navigation

	/**
	 * page to an image, resetting the departing image's zoom.
	 *
	 * @param index target index; wrapped when `loop` is set, else clamped to range.
	 * @param animated whether to spring the track across; jumps instantly when false.
	 */
	goTo(index: number, animated = true): void {
		let target: number;
		if (this.config.loop) {
			target = ((index % this.#count) + this.#count) % this.#count;
		} else {
			target = clamp(index, 0, this.#count - 1);
		}
		if (target === this.index && animated) {
			return;
		}
		this.#resetTransform(this.index);
		this.index = target;
		this.#loadActiveTransform();
		if (animated) {
			this.#trackX.animateTo(-target * this.#viewport.width, { config: SPRING.default });
			this.#startLoop();
		} else {
			this.#trackX.set(-target * this.#viewport.width);
			this.#emit();
		}
	}

	/** page to the next image. */
	next(): void {
		this.goTo(this.index + 1);
	}

	/** page to the previous image. */
	prev(): void {
		this.goTo(this.index - 1);
	}

	/**
	 * resets all state at a clamped index.
	 *
	 * @param index index to rest at.
	 */
	reset(index = 0): void {
		this.#cancelLoop();
		this.#pointers.clear();
		this.#gesture = { kind: 'idle' };
		this.index = clamp(index, 0, this.#count - 1);
		this.#transforms = this.#transforms.map(() => ({ ...IDENTITY }));
		this.#trackX.set(-this.index * this.#viewport.width);
		this.#dismissY.set(0);
		this.#loadActiveTransform();
		this.#emit();
	}

	// #endregion

	// #region pointer input

	/**
	 * registers a pointer and starts a drag, pinch, or double-tap.
	 *
	 * @param id pointer id.
	 * @param x pointer x relative to the viewport, in px.
	 * @param y pointer y relative to the viewport, in px.
	 */
	pointerDown(id: number, x: number, y: number): void {
		// a drag started during unzoom must arbitrate as an unzoomed drag.
		const returningToFit =
			this.#scale.isAnimating &&
			this.#scale.value > this.config.minScale + 0.001 &&
			this.#scale.target <= this.config.minScale + 0.01;
		// pause paging until the new gesture commits or ends as a tap.
		let paging: { target: number; velocity: number } | null = null;
		if (this.#trackX.isAnimating) {
			paging = { target: this.#trackX.target, velocity: this.#trackX.velocity };
		}
		this.#stopSprings();
		const t = this.#now();

		if (this.#pointers.size === 0) {
			if (t - this.#lastTapTime < DOUBLE_TAP_MS && dist({ x, y }, this.#lastTapPos) < DOUBLE_TAP_DIST) {
				this.#lastTapTime = -Infinity;
				this.#doubleTap(x, y);
				return;
			}
			this.#lastTapTime = t;
			this.#lastTapPos = { x, y };
		}

		this.#pointers.set(id, { x, y, startX: x, startY: y });
		this.#velocity.reset(x, y, t);

		switch (this.#pointers.size) {
			case 1: {
				const startPan: Point = { x: this.#panX.value, y: this.#panY.value };
				this.#gesture = { kind: 'pending', paging, returningToFit, startPan };
				if (returningToFit) {
					// continue unzoom while the new gesture waits for its axis lock.
					this.#scale.animateTo(this.config.minScale, { velocity: 0, config: SPRING.scale });
					this.#panX.animateTo(0, { velocity: 0, config: SPRING.default });
					this.#panY.animateTo(0, { velocity: 0, config: SPRING.default });
					this.#startLoop();
				}
				break;
			}
			case 2: {
				this.#beginPinch();
				break;
			}
		}
		this.#emit();
	}

	/**
	 * advance a tracked pointer, driving the active pinch or drag.
	 *
	 * @param id pointer id; ignored if not currently tracked.
	 * @param x pointer x relative to the viewport, in px.
	 * @param y pointer y relative to the viewport, in px.
	 */
	pointerMove(id: number, x: number, y: number): void {
		const p = this.#pointers.get(id);
		if (!p) {
			return;
		}
		p.x = x;
		p.y = y;
		this.#velocity.add(x, y, this.#now());

		// pending motion does not change visible state.
		let changed: boolean;
		if (this.#gesture.kind === 'pinch' && this.#pointers.size >= 2) {
			this.#updatePinch(this.#gesture);
			changed = true;
		} else {
			changed = this.#updateDrag(p);
		}
		if (changed) {
			this.#emit();
		}
	}

	/**
	 * releases a tracked pointer and settles the gesture.
	 *
	 * @param id pointer id; ignored if not currently tracked.
	 * @param x final pointer x in px, used to refine the release velocity when provided.
	 * @param y final pointer y in px, used to refine the release velocity when provided.
	 */
	pointerUp(id: number, x?: number, y?: number): void {
		const p = this.#pointers.get(id);
		if (!p) {
			return;
		}
		if (x !== undefined && y !== undefined) {
			this.#velocity.add(x, y, this.#now());
		}
		this.#pointers.delete(id);
		const v = this.#velocity.velocity();

		if (this.#gesture.kind === 'pinch' && this.#pointers.size < 2) {
			if (this.#pointers.size === 1) {
				// a pointer that survives a pinch remains an image pan.
				const [survivor] = this.#pointers.values();
				survivor.startX = survivor.x;
				survivor.startY = survivor.y;
				// pinch samples contain both pointers, so restart velocity tracking.
				this.#velocity.reset(survivor.x, survivor.y, this.#now());
				const startPan: Point = { x: this.#panX.value, y: this.#panY.value };
				this.#gesture = { kind: 'pan', startPan };
				if (this.#scale.value <= 1) {
					// keep an at-fit image settling while the remaining pointer pans.
					this.#scale.animateTo(this.config.minScale, { velocity: 0, config: SPRING.scale });
					this.#panX.animateTo(0, { velocity: 0, config: SPRING.default });
					this.#panY.animateTo(0, { velocity: 0, config: SPRING.default });
					this.#startLoop();
				}
				this.#emit();
				return;
			}
			this.#gesture = { kind: 'idle' };
			this.#settleZoom(v);
			return;
		}

		if (this.#pointers.size === 0) {
			this.#endDrag(v);
		}
	}

	/**
	 * zooms around the cursor from wheel input.
	 *
	 * @param x cursor x relative to the viewport, in px.
	 * @param y cursor y relative to the viewport, in px.
	 * @param deltaY wheel delta; negative zooms in, positive zooms out.
	 */
	wheel(x: number, y: number, deltaY: number): void {
		this.#stopSprings();
		// wheel zoom must anchor against a centered slide.
		this.#trackX.set(-this.index * this.#viewport.width);
		const focal = this.#toCenter(x, y);
		const factor = Math.exp(-deltaY * 0.01);
		this.#zoomAbout(focal, this.#scale.value * factor);
		this.#clampActivePanInstant();
		this.#emit();
	}

	// #endregion

	// #region gesture internals

	#beginPinch(): void {
		// pinch anchors must use a centered slide after interrupted paging.
		this.#trackX.set(-this.index * this.#viewport.width);
		const [a, b] = [...this.#pointers.values()];
		this.#gesture = {
			kind: 'pinch',
			startDist: dist(a, b),
			startScale: this.#scale.value,
			startMid: this.#toCenter((a.x + b.x) / 2, (a.y + b.y) / 2),
			startPan: { x: this.#panX.value, y: this.#panY.value },
		};
	}

	#updatePinch(pinch: Extract<Gesture, { kind: 'pinch' }>): void {
		const [a, b] = [...this.#pointers.values()];
		const newDist = dist(a, b);
		const newMid = this.#toCenter((a.x + b.x) / 2, (a.y + b.y) / 2);
		// floor the divisor when pinch points overlap.
		const raw = pinch.startScale * (newDist / Math.max(pinch.startDist, PINCH_MIN_DIST));
		const s = clamp(raw, this.config.minScale * 0.85, this.config.maxScale * 1.1);
		const c = this.#contentPoint(pinch.startMid, pinch.startPan, pinch.startScale);
		// clamping prevents a snap when pinch becomes a single-pointer pan.
		const { maxX, maxY, minX, minY } = this.#panBounds(s);
		this.#scale.set(s);
		this.#panX.set(clamp(newMid.x - c.x * s, minX, maxX));
		this.#panY.set(clamp(newMid.y - c.y * s, minY, maxY));
	}

	#updateDrag(p: PointerInfo): boolean {
		const dx = p.x - p.startX;
		const dy = p.y - p.startY;

		let g = this.#gesture;
		if (g.kind === 'pending') {
			const zoomed = this.#scale.value > 1.001 && !g.returningToFit;
			if (zoomed) {
				g = { kind: 'pan', startPan: g.startPan };
			} else if (Math.abs(dx) > this.config.axisLockPx || Math.abs(dy) > this.config.axisLockPx) {
				g = Math.abs(dx) > Math.abs(dy) ? { kind: 'page' } : { kind: 'dismiss' };
			} else {
				return false;
			}
			this.#gesture = g;
		}

		switch (g.kind) {
			case 'dismiss': {
				this.#dismissY.set(dy);
				break;
			}
			case 'page': {
				const base = -this.index * this.#viewport.width;
				let tx = base + dx;
				if (!this.config.loop) {
					const min = -(this.#count - 1) * this.#viewport.width;
					const max = 0;
					tx = clampRubber(tx, min, max, this.#viewport.width, this.config.rubberBand);
				}
				this.#trackX.set(tx);
				break;
			}
			case 'pan': {
				const { maxX, maxY, minX, minY } = this.#panBounds(this.#scale.value);
				this.#panX.set(
					clampRubber(g.startPan.x + dx, minX, maxX, this.#viewport.width, this.config.rubberBand),
				);
				this.#panY.set(
					clampRubber(g.startPan.y + dy, minY, maxY, this.#viewport.height, this.config.rubberBand),
				);
				break;
			}
		}
		return true;
	}

	#endDrag(v: Point): void {
		const g = this.#gesture;
		this.#gesture = { kind: 'idle' };

		switch (g.kind) {
			case 'dismiss': {
				const pulled = this.#dismissY.value;
				const commit =
					Math.abs(pulled) > this.config.dismissThresholdPx || Math.abs(v.y) > this.config.dismissVelocity;
				if (commit) {
					this.#onDismiss?.();
				}
				// restore the slide if the owner does not close it.
				this.#dismissY.animateTo(0, { velocity: v.y, config: SPRING.default });
				this.#startLoop();
				break;
			}
			case 'page': {
				this.#commitPage(v.x);
				break;
			}
			case 'pan': {
				this.#settleZoom(v);
				break;
			}
			default: {
				if (g.kind === 'pending' && g.paging) {
					this.#trackX.animateTo(g.paging.target, {
						velocity: g.paging.velocity,
						config: SPRING.default,
					});
					this.#startLoop();
				} else {
					this.#emit();
				}
			}
		}
	}

	#commitPage(vx: number): void {
		const vw = this.#viewport.width;
		const dragged = this.#trackX.value - -this.index * vw;
		const ratio = dragged / vw;
		const fling = Math.abs(vx) > this.config.pageFlingVelocity;
		let target = this.index;
		if (Math.abs(ratio) > this.config.pageThresholdRatio || fling) {
			target = this.index + (dragged < 0 ? 1 : -1);
		}
		if (this.config.loop) {
			target = ((target % this.#count) + this.#count) % this.#count;
		} else {
			target = clamp(target, 0, this.#count - 1);
		}
		if (target !== this.index) {
			this.#resetTransform(this.index);
			this.index = target;
			this.#loadActiveTransform();
		}
		this.#trackX.animateTo(-this.index * vw, { velocity: vx, config: SPRING.default });
		this.#startLoop();
	}

	#settleZoom(v: Point): void {
		const minScale = this.config.minScale;
		if (this.#scale.value <= minScale + 0.001) {
			this.#scale.animateTo(minScale, { velocity: 0, config: SPRING.scale });
			this.#panX.animateTo(0, { velocity: v.x, config: SPRING.default });
			this.#panY.animateTo(0, { velocity: v.y, config: SPRING.default });
		} else {
			const targetScale = clamp(this.#scale.value, minScale, this.config.maxScale);
			this.#scale.animateTo(targetScale, { velocity: 0, config: SPRING.scale });
			const { maxX, maxY, minX, minY } = this.#panBounds(targetScale);
			const projX = this.#panX.value + projectDecay(v.x);
			const projY = this.#panY.value + projectDecay(v.y);
			this.#panX.animateTo(clamp(projX, minX, maxX), { velocity: v.x, config: SPRING.default });
			this.#panY.animateTo(clamp(projY, minY, maxY), { velocity: v.y, config: SPRING.default });
		}
		this.#startLoop();
	}

	#doubleTap(x: number, y: number): void {
		// complete interrupted paging so zoom anchors to the slide center.
		this.#trackX.animateTo(-this.index * this.#viewport.width, { velocity: 0, config: SPRING.default });
		const focal = this.#toCenter(x, y);
		if (this.#scale.value > this.config.minScale + 0.01) {
			this.#scale.animateTo(this.config.minScale, { velocity: 0, config: SPRING.scale });
			this.#panX.animateTo(0, { velocity: 0, config: SPRING.default });
			this.#panY.animateTo(0, { velocity: 0, config: SPRING.default });
		} else {
			const s = this.config.doubleTapScale;
			const c = this.#contentPoint(focal, { x: this.#panX.value, y: this.#panY.value }, this.#scale.value);
			const { maxX, maxY, minX, minY } = this.#panBounds(s);
			this.#scale.animateTo(s, { velocity: 0, config: SPRING.scale });
			this.#panX.animateTo(clamp(focal.x - c.x * s, minX, maxX), {
				velocity: 0,
				config: SPRING.default,
			});
			this.#panY.animateTo(clamp(focal.y - c.y * s, minY, maxY), {
				velocity: 0,
				config: SPRING.default,
			});
		}
		this.#startLoop();
	}

	#zoomAbout(focal: Point, nextScale: number): void {
		const s = clamp(nextScale, this.config.minScale, this.config.maxScale);
		const c = this.#contentPoint(focal, { x: this.#panX.value, y: this.#panY.value }, this.#scale.value);
		this.#scale.set(s);
		this.#panX.set(focal.x - c.x * s);
		this.#panY.set(focal.y - c.y * s);
	}

	// #endregion

	// #region geometry helpers

	#toCenter(x: number, y: number): Point {
		const off = this.#safeOffset();
		return { x: x - this.#viewport.width / 2 - off.x, y: y - this.#viewport.height / 2 - off.y };
	}

	#safeOffset(): Point {
		const { top, right, bottom, left } = this.config.safeAreaInsets;
		return { x: (left - right) / 2, y: (top - bottom) / 2 };
	}

	#contentPoint(focal: Point, pan: Point, scale: number): Point {
		return { x: (focal.x - pan.x) / scale, y: (focal.y - pan.y) / scale };
	}

	#fittedSize(i: number): Size {
		const nat = this.#naturalSizes[i];
		const vp = this.#viewport;
		if (!nat || !nat.width || !nat.height || !vp.width || !vp.height) {
			// keep unknown images collapsed until both sizes are available.
			return { width: 0, height: 0 };
		}
		const { top, right, bottom, left } = this.config.safeAreaInsets;
		const usableW = Math.max(0, vp.width - left - right);
		const usableH = Math.max(0, vp.height - top - bottom);
		const containK = Math.min(usableW / nat.width, usableH / nat.height);
		let k: number;
		if (containK <= 1) {
			k = containK;
		} else {
			k = Math.min(containK, Math.max(1, this.config.minCoverage * containK));
		}
		return { width: nat.width * k, height: nat.height * k };
	}

	#computeFittedSizes(): void {
		this.#fittedSizes = Array.from({ length: this.#count }, (_, i) => this.#fittedSize(i));
		this.#snapshot = null;
	}

	#panBounds(scale: number): { maxX: number; maxY: number; minX: number; minY: number } {
		const fit = this.#fittedSizes[this.index] ?? this.#fittedSize(this.index);
		const { top, right, bottom, left } = this.config.overpanInsets;
		const off = this.#safeOffset();
		// overpan applies only where the image reaches the viewport edge.
		const overflowX = Math.max(0, (fit.width * scale - this.#viewport.width) / 2);
		const overflowY = Math.max(0, (fit.height * scale - this.#viewport.height) / 2);
		return {
			maxX: overflowX > 0 ? overflowX + left - off.x : 0,
			maxY: overflowY > 0 ? overflowY + top - off.y : 0,
			minX: overflowX > 0 ? -(overflowX + right) - off.x : 0,
			minY: overflowY > 0 ? -(overflowY + bottom) - off.y : 0,
		};
	}

	#clampActivePanInstant(): void {
		const { maxX, maxY, minX, minY } = this.#panBounds(this.#scale.value);
		this.#panX.set(clamp(this.#panX.value, minX, maxX));
		this.#panY.set(clamp(this.#panY.value, minY, maxY));
	}

	#resetTransform(i: number): void {
		this.#transforms[i] = { ...IDENTITY };
	}

	#loadActiveTransform(): void {
		const t = this.#transforms[this.index] ?? IDENTITY;
		this.#scale.set(t.scale);
		this.#panX.set(t.x);
		this.#panY.set(t.y);
	}

	// #endregion

	// #region animation loop

	#stopSprings(): void {
		this.#cancelLoop();
		for (const s of this.#channels) {
			s.set(s.value);
		}
	}

	#springsAnimating(): boolean {
		return this.#channels.some((s) => s.isAnimating);
	}

	#startLoop(): void {
		// invalidate before the first deferred frame.
		this.#snapshot = null;
		if (this.#rafHandle !== null) {
			return;
		}
		this.#lastFrameTime = this.#now();
		const tick = (t: number) => {
			const dt = Math.max(0, (t - this.#lastFrameTime) / 1000);
			this.#lastFrameTime = t;
			let moving = false;
			for (const s of this.#channels) {
				if (s.step(dt)) {
					moving = true;
				}
			}
			this.#emit();
			if (moving) {
				this.#rafHandle = this.#raf(tick);
			} else {
				this.#rafHandle = null;
				this.#emit();
			}
		};
		this.#rafHandle = this.#raf(tick);
	}

	#cancelLoop(): void {
		if (this.#rafHandle !== null) {
			this.#caf(this.#rafHandle);
			this.#rafHandle = null;
		}
	}

	#isActive(): boolean {
		return this.#pointers.size > 0 || this.#springsAnimating();
	}

	// #endregion

	// #region snapshot / subscription

	/**
	 * subscribe to state snapshots emitted on every change.
	 *
	 * @param fn listener invoked with each new {@link LightboxState}.
	 * @returns an unsubscribe function.
	 */
	subscribe = (fn: (s: LightboxState) => void): (() => void) => {
		return this.#emitter.subscribe(fn);
	};

	/**
	 * the current render snapshot.
	 *
	 * @returns {@link LightboxState} for the active frame.
	 */
	getState(): LightboxState {
		return (this.#snapshot ??= this.#buildState());
	}

	#buildState(): LightboxState {
		const off = this.#safeOffset();
		const transforms = this.#transforms.map((t, i) => {
			let base = t;
			if (i === this.index) {
				base = { scale: this.#scale.value, x: this.#panX.value, y: this.#panY.value };
			}
			return { scale: base.scale, x: base.x + off.x, y: base.y + off.y };
		});
		const pulled = Math.abs(this.#dismissY.value);
		const backdropOpacity = clamp(1 - pulled / this.config.dismissFadeDistancePx, 0, 1);
		const g = this.#gesture;
		let dragMode: DragMode = 'none';
		switch (g.kind) {
			case 'dismiss':
			case 'page':
			case 'pan': {
				dragMode = g.kind;
				break;
			}
		}
		return {
			index: this.index,
			transforms,
			fittedSizes: this.#fittedSizes,
			trackX: this.#trackX.value,
			dismissY: this.#dismissY.value,
			backdropOpacity,
			dragMode,
			isDragging: this.#pointers.size > 0,
			isPinching: g.kind === 'pinch',
			isZoomed: this.#scale.value > 1.01,
			isAnimating: this.#springsAnimating(),
		};
	}

	#emit(): void {
		this.#snapshot = this.#buildState();
		this.#emitter.emit(this.#snapshot);
	}

	/** releases animation, subscribers, and pointers. */
	destroy(): void {
		this.#cancelLoop();
		// the emitter has no clear operation.
		this.#emitter = new SimpleEventEmitter<[LightboxState]>();
		this.#pointers.clear();
	}

	// #endregion
}

const dist = (a: Point, b: Point): number => {
	return Math.hypot(a.x - b.x, a.y - b.y);
};

// #region config validation

const cfgFiniteSpan = (v: number | undefined, fallback: number): number =>
	v !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback;
const cfgInsets = (
	v: Insets | undefined,
	guard: (n: number | undefined, fallback: number) => number,
): Insets => ({
	top: guard(v?.top, 0),
	right: guard(v?.right, 0),
	bottom: guard(v?.bottom, 0),
	left: guard(v?.left, 0),
});
const cfgPositive = (v: number | undefined, fallback: number): number =>
	v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;
const cfgRatio = (v: number | undefined, fallback: number, lo: number, hi: number): number =>
	v !== undefined && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
// infinity is a valid sentinel for thresholds and velocities.
const cfgSpan = (v: number | undefined, fallback: number): number =>
	v === undefined || Number.isNaN(v) || v < 0 ? fallback : v;

const normalizeConfig = (config: Partial<LightboxConfig> = {}): LightboxConfig => {
	const minScale = cfgPositive(config.minScale, DEFAULT_CONFIG.minScale);
	const maxScale = Math.max(minScale, cfgPositive(config.maxScale, DEFAULT_CONFIG.maxScale));
	let dismissFadeDistancePx = DEFAULT_CONFIG.dismissFadeDistancePx;
	if (
		config.dismissFadeDistancePx !== undefined &&
		!Number.isNaN(config.dismissFadeDistancePx) &&
		config.dismissFadeDistancePx > 0
	) {
		// infinity disables fading.
		dismissFadeDistancePx = config.dismissFadeDistancePx;
	}
	return {
		axisLockPx: cfgSpan(config.axisLockPx, DEFAULT_CONFIG.axisLockPx),
		pageThresholdRatio: cfgRatio(config.pageThresholdRatio, DEFAULT_CONFIG.pageThresholdRatio, 0, 1),
		pageFlingVelocity: cfgSpan(config.pageFlingVelocity, DEFAULT_CONFIG.pageFlingVelocity),
		loop: config.loop ?? DEFAULT_CONFIG.loop,
		dismissThresholdPx: cfgSpan(config.dismissThresholdPx, DEFAULT_CONFIG.dismissThresholdPx),
		dismissVelocity: cfgSpan(config.dismissVelocity, DEFAULT_CONFIG.dismissVelocity),
		dismissFadeDistancePx,
		closeOnBackdropClick: config.closeOnBackdropClick ?? DEFAULT_CONFIG.closeOnBackdropClick,
		minScale,
		maxScale,
		doubleTapScale: clamp(
			cfgPositive(config.doubleTapScale, DEFAULT_CONFIG.doubleTapScale),
			minScale,
			maxScale,
		),
		minCoverage: cfgRatio(config.minCoverage, DEFAULT_CONFIG.minCoverage, 0, 1),
		rubberBand: cfgRatio(config.rubberBand, DEFAULT_CONFIG.rubberBand, 0, 1),
		overpanInsets: cfgInsets(config.overpanInsets, cfgSpan),
		safeAreaInsets: cfgInsets(config.safeAreaInsets, cfgFiniteSpan),
	};
};

// #endregion
