/**
 * LightboxEngine — the framework-agnostic gesture state machine.
 *
 * models three independent transform layers:
 *   - track  : horizontal paging (translateX of the whole carousel)
 *   - dismiss: vertical swipe-to-dismiss of the active slide
 *   - image  : per-image pinch-zoom + pan (innermost transform)
 *
 * arbitration: at scale 1 a drag axis-locks to paging
 * (horizontal) or dismiss (vertical) once it crosses `axisLockPx`; while zoomed
 * a drag pans the image and rubber-bands at its edges instead of paging.
 *
 * it owns its own rAF settle loop (injectable for tests/SSR) and emits an
 * immutable-ish snapshot via `subscribe`. no DOM, no React.
 */
import { SimpleEventEmitter } from '@mary-ext/simple-event-emitter';

import { SPRING, Spring, clamp, clampRubber, projectDecay, rubberBand } from './physics';
import {
	DEFAULT_CONFIG,
	type DragMode,
	IDENTITY,
	type LightboxConfig,
	type LightboxState,
	type Point,
	type Size,
	type Transform,
} from './types';
import { VelocityTracker } from './velocity';

export interface EngineOptions {
	/** cancels a frame scheduled by `raf` (defaults to cancelAnimationFrame). */
	caf?: (handle: number) => void;
	/** behavior overrides merged over {@link DEFAULT_CONFIG}. */
	config?: Partial<LightboxConfig>;
	/** initial active image index (defaults to 0). */
	index?: number;
	/** injectable clock (defaults to performance.now). */
	now?: () => number;
	/** called when a dismiss gesture commits. */
	onDismiss?: () => void;
	/** schedules a frame and returns a handle (defaults to requestAnimationFrame). */
	raf?: (cb: (t: number) => void) => number;
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
	startMid: Point; // relative to viewport center
	startPan: Point;
}

/**
 * the discrete phase of the active gesture — the explicit state machine driving
 * arbitration. springs (scale/pan/track/dismiss) are the separate *continuous*
 * layer this commits into; they are not part of the machine.
 *
 *   idle ──pointerDown──▶ pending ──axis lock──▶ pan │ page │ dismiss ──up──▶ idle
 *     └────2nd pointer───▶ pinch ──last up──▶ (settle) idle
 *
 * `pending` is the undecided single-pointer phase (down, not yet axis-locked).
 * `returningToFit` rides on it so a drag begun mid-unzoom arbitrates as
 * un-zoomed (page/dismiss) instead of panning the still-shrinking image.
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
/** floor for the pinch start distance so a two-finger touchdown at (near-)identical points can't divide by zero. */
const PINCH_MIN_DIST = 1e-3;

export class LightboxEngine {
	/** live behavior config; mutate via {@link setConfig}. */
	config: LightboxConfig;
	#onDismiss?: () => void;
	#now: () => number;
	#raf: (cb: (t: number) => void) => number;
	#caf: (handle: number) => void;

	#viewport: Size = { width: 0, height: 0 };
	#count = 1;
	#naturalSizes: (Size | undefined)[] = [];
	/** per-image rest (scale-1) display sizes; recomputed only on geometry/config change. */
	#fittedSizes: Size[] = [];

	/** active image index; change via {@link goTo}/{@link next}/{@link prev}. */
	index: number;
	/** resting transforms for every image; the active one is mirrored by springs. */
	#transforms: Transform[] = [];

	// animated channels.
	#trackX: Spring;
	#dismissY: Spring;
	#scale: Spring;
	#panX: Spring;
	#panY: Spring;
	/** every animated channel; the single source of truth for "still moving". */
	#channels: readonly Spring[];

	// gesture bookkeeping.
	#pointers = new Map<number, PointerInfo>();
	/** discrete gesture phase; see {@link Gesture}. all per-phase data lives here. */
	#gesture: Gesture = { kind: 'idle' };
	#velocity = new VelocityTracker();
	#lastTapTime = -Infinity;
	#lastTapPos: Point = { x: 0, y: 0 };

	// the rAF scheduling handle — pure mechanism (schedule/cancel/dedupe a frame).
	// whether we're *animating* is derived from the springs, not from this.
	#rafHandle: number | null = null;
	#lastFrameTime = 0;
	#emitter = new SimpleEventEmitter<[LightboxState]>();
	/**
	 * the last built snapshot, or null when invalidated. `getState` rebuilds
	 * lazily and caches here so it returns a stable reference between changes —
	 * exactly what `useSyncExternalStore`'s getSnapshot contract requires.
	 */
	#snapshot: LightboxState | null = null;

	/**
	 * @param opts initial config, starting index, dismiss callback, and injectable clock/scheduler.
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
	 * update the viewport, image count, and known natural sizes, re-snapping
	 * layout to rest when no gesture or animation is in flight.
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
			// snap layout to rest when idle (e.g. on resize / open).
			this.#trackX.set(-this.index * viewport.width);
			this.#clampActivePanInstant();
			this.#emit();
		}
	}

	/**
	 * merge behavior overrides into the live config, re-fitting when idle.
	 *
	 * @param config partial overrides applied over the current config.
	 */
	setConfig(config: Partial<LightboxConfig>): void {
		this.config = normalizeConfig({ ...this.config, ...config });
		// a fit-policy change (e.g. minCoverage) re-sizes images and pan bounds.
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
		const target = this.config.loop
			? ((index % this.#count) + this.#count) % this.#count
			: clamp(index, 0, this.#count - 1);
		if (target === this.index && animated) {
			return;
		}
		this.#resetTransform(this.index); // reset zoom when paging away.
		this.index = target;
		this.#loadActiveTransform();
		if (animated) {
			this.#trackX.animateTo(-target * this.#viewport.width, undefined, SPRING.default);
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
	 * clear all gesture state and transforms and jump to an index without animating.
	 *
	 * @param index index to rest at; clamped to range.
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
	 * register a pointer landing; a second pointer begins a pinch, and a quick
	 * second tap near the last triggers a double-tap zoom toggle.
	 *
	 * @param id pointer id.
	 * @param x pointer x relative to the viewport, in px.
	 * @param y pointer y relative to the viewport, in px.
	 */
	pointerDown(id: number, x: number, y: number): void {
		// capture before #stopSprings() freezes the spring: is an unzoom-to-fit
		// in flight? a touch landing now is almost certainly the start of a
		// swipe-to-page, so we let the settle finish rather than freeze a
		// half-shrunk image and capture the drag as a pan.
		const returningToFit =
			this.#scale.isAnimating &&
			this.#scale.value > this.config.minScale + 0.001 &&
			this.#scale.target <= this.config.minScale + 0.01;
		// likewise capture an in-flight paging settle: a touch landing while the
		// track is still springing to its target is almost certainly a tap or the
		// start of another swipe. we don't resume it here — that would let the
		// track drift during the undecided `pending` phase and fight a swipe that's
		// about to take over. instead we stash it and, only if the gesture turns
		// out to be a tap (no commit), resume it on release so the slide finishes.
		const paging = this.#trackX.isAnimating
			? { target: this.#trackX.target, velocity: this.#trackX.velocity }
			: null;
		this.#stopSprings();
		const t = this.#now();

		// double-tap toggle (single new pointer landing near the last tap).
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

		if (this.#pointers.size === 2) {
			this.#beginPinch();
		} else if (this.#pointers.size === 1) {
			const startPan: Point = { x: this.#panX.value, y: this.#panY.value };
			this.#gesture = { kind: 'pending', paging, returningToFit, startPan };
			if (returningToFit) {
				// resume the interrupted return-to-fit (scale + recentre) so it settles
				// underneath whatever the drag commits to (page/dismiss). unlike paging
				// above, this must run during `pending`: a drag arbitrates against the
				// shrinking image, so the scale has to keep moving, not freeze.
				this.#scale.animateTo(this.config.minScale, 0, SPRING.scale);
				this.#panX.animateTo(0, 0, SPRING.default);
				this.#panY.animateTo(0, 0, SPRING.default);
				this.#startLoop();
			}
		}
		// a 3rd+ pointer leaves the active pinch untouched.
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

		// only emit when something visible actually changed; a sub-threshold drag
		// still pending an axis lock moves nothing, so it must not wake consumers.
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
	 * release a tracked pointer, settling the gesture (commit page, settle zoom,
	 * dismiss, or spring back) once the last pointer lifts.
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
				// two → one finger: re-anchor the survivor and continue. still zoomed
				// → straight to pan; back at (or below) fit → undecided again (pending).
				const [survivor] = this.#pointers.values();
				survivor.startX = survivor.x;
				survivor.startY = survivor.y;
				const startPan: Point = { x: this.#panX.value, y: this.#panY.value };
				if (this.#scale.value > 1) {
					this.#gesture = { kind: 'pan', startPan };
				} else {
					// the surviving finger lifting an at/below-fit pinch (e.g. a pinch-out
					// overshoot) must settle back to fit, not freeze the shrunk image —
					// either if it lifts straight away or if it drags on as a page/dismiss.
					// resume the spring underneath `pending` and flag `returningToFit` so
					// a continued drag arbitrates as un-zoomed, mirroring pointerDown.
					this.#gesture = { kind: 'pending', paging: null, returningToFit: true, startPan };
					this.#scale.animateTo(this.config.minScale, 0, SPRING.scale);
					this.#panX.animateTo(0, 0, SPRING.default);
					this.#panY.animateTo(0, 0, SPRING.default);
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
	 * trackpad pinch (ctrl+wheel) / mouse-wheel zoom around the cursor.
	 *
	 * @param x cursor x relative to the viewport, in px.
	 * @param y cursor y relative to the viewport, in px.
	 * @param deltaY wheel delta; negative zooms in, positive zooms out.
	 */
	wheel(x: number, y: number, deltaY: number): void {
		this.#stopSprings();
		// a wheel zoom can interrupt a paging settle; snap the track to rest so the
		// cursor-anchored zoom (#toCenter) is taken against a centered slide. wheel
		// zooming is itself instant, so a snap — not a spring — keeps the two
		// consistent. a no-op when already at rest.
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
		// a pinch can begin mid-page (#stopSprings froze the track part-way through
		// its settle). snap it to rest before capturing the anchor below so the
		// pinch midpoint (#toCenter) and start pan are taken against a centered
		// slide, not one offset by the leftover paging distance. by the time two
		// fingers coordinate down the track has nearly settled, so this is a small
		// correction (a no-op when already at rest), and pinch tracks fingers
		// instantly, so a snap stays consistent with the gesture.
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
		// floor the divisor: two pointers landing at (near-)identical points make
		// startDist ~0, and an unguarded newDist / startDist poisons scale/pan with
		// NaN (or Infinity), corrupting the active transform and its pan bounds.
		const raw = pinch.startScale * (newDist / Math.max(pinch.startDist, PINCH_MIN_DIST));
		// allow slight overshoot past limits; it springs back on release.
		const s = clamp(raw, this.config.minScale * 0.85, this.config.maxScale * 1.1);
		// keep the content point originally under the midpoint pinned to the new midpoint.
		const c = this.#contentPoint(pinch.startMid, pinch.startPan, pinch.startScale);
		this.#scale.set(s);
		this.#panX.set(newMid.x - c.x * s);
		this.#panY.set(newMid.y - c.y * s);
	}

	/**
	 * @returns whether the drag changed any visible state (false while a pending
	 * single-pointer drag is still below the axis-lock threshold).
	 */
	#updateDrag(p: PointerInfo): boolean {
		const dx = p.x - p.startX;
		const dy = p.y - p.startY;

		// axis lock: pending → pan / page / dismiss once committed.
		let g = this.#gesture;
		if (g.kind === 'pending') {
			// a still-settling unzoom counts as un-zoomed: arbitrate to page/dismiss.
			const zoomed = this.#scale.value > 1.001 && !g.returningToFit;
			if (zoomed) {
				g = { kind: 'pan', startPan: g.startPan };
			} else if (Math.abs(dx) > this.config.axisLockPx || Math.abs(dy) > this.config.axisLockPx) {
				g = Math.abs(dx) > Math.abs(dy) ? { kind: 'page' } : { kind: 'dismiss' };
			} else {
				return false; // below the lock threshold: stay pending
			}
			this.#gesture = g;
		}

		switch (g.kind) {
			case 'pan': {
				const { maxX, maxY } = this.#panBounds(this.#scale.value);
				this.#panX.set(
					clampRubber(g.startPan.x + dx, -maxX, maxX, this.#viewport.width, this.config.rubberBand),
				);
				this.#panY.set(
					clampRubber(g.startPan.y + dy, -maxY, maxY, this.#viewport.height, this.config.rubberBand),
				);
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
			case 'dismiss': {
				this.#dismissY.set(dy);
				break;
			}
		}
		return true;
	}

	#endDrag(v: Point): void {
		const g = this.#gesture;
		this.#gesture = { kind: 'idle' };

		switch (g.kind) {
			case 'pan': {
				this.#settleZoom(v);
				break;
			}
			case 'page': {
				this.#commitPage(v.x);
				break;
			}
			case 'dismiss': {
				const pulled = this.#dismissY.value;
				const commit =
					Math.abs(pulled) > this.config.dismissThresholdPx || Math.abs(v.y) > this.config.dismissVelocity;
				if (commit) {
					this.#onDismiss?.();
				}
				// always spring the pull back to rest. when the owner closes (unmounts)
				// this is moot; when it doesn't — no handler wired, an async/declined
				// close, a controlled parent that ignores the request — the slide
				// returns to rest instead of hanging half-dismissed with a faded scrim.
				this.#dismissY.animateTo(0, v.y, SPRING.default);
				this.#startLoop();
				break;
			}
			default: {
				// pending (tap / sub-threshold drag): nothing committed. if this tap
				// interrupted a paging settle, resume it from where the touch froze it
				// so the slide finishes instead of stopping dead under the finger.
				if (g.kind === 'pending' && g.paging) {
					this.#trackX.animateTo(g.paging.target, g.paging.velocity, SPRING.default);
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
		this.#trackX.animateTo(-this.index * vw, vx, SPRING.default);
		this.#startLoop();
	}

	#settleZoom(v: Point): void {
		const minScale = this.config.minScale;
		if (this.#scale.value <= minScale + 0.001) {
			// snap fully back to fit.
			this.#scale.animateTo(minScale, 0, SPRING.scale);
			this.#panX.animateTo(0, v.x, SPRING.default);
			this.#panY.animateTo(0, v.y, SPRING.default);
		} else {
			const targetScale = clamp(this.#scale.value, minScale, this.config.maxScale);
			this.#scale.animateTo(targetScale, 0, SPRING.scale);
			const { maxX, maxY } = this.#panBounds(targetScale);
			const projX = this.#panX.value + projectDecay(v.x);
			const projY = this.#panY.value + projectDecay(v.y);
			this.#panX.animateTo(clamp(projX, -maxX, maxX), v.x, SPRING.default);
			this.#panY.animateTo(clamp(projY, -maxY, maxY), v.y, SPRING.default);
		}
		this.#startLoop();
	}

	#doubleTap(x: number, y: number): void {
		// reached only with zero pointers down, so the gesture is already idle; a
		// fresh zoom intent (in or out) is defined purely by the springs below.
		//
		// a double-tap can land mid-page (#stopSprings froze the track part-way
		// through its settle). the zoom anchors against a centered slide via
		// #toCenter, so spring the track home alongside it: this lands the zoom —
		// and the letterbox around a non-filling image — exactly where it would
		// have had the page finished first, instead of offset by the leftover
		// paging distance. a no-op when already at rest.
		this.#trackX.animateTo(-this.index * this.#viewport.width, 0, SPRING.default);
		const focal = this.#toCenter(x, y);
		if (this.#scale.value > this.config.minScale + 0.01) {
			this.#scale.animateTo(this.config.minScale, 0, SPRING.scale);
			this.#panX.animateTo(0, 0, SPRING.default);
			this.#panY.animateTo(0, 0, SPRING.default);
		} else {
			const s = this.config.doubleTapScale;
			const c = this.#contentPoint(focal, { x: this.#panX.value, y: this.#panY.value }, this.#scale.value);
			const { maxX, maxY } = this.#panBounds(s);
			this.#scale.animateTo(s, 0, SPRING.scale);
			this.#panX.animateTo(clamp(focal.x - c.x * s, -maxX, maxX), 0, SPRING.default);
			this.#panY.animateTo(clamp(focal.y - c.y * s, -maxY, maxY), 0, SPRING.default);
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

	/** screen point → coordinates relative to the viewport center. */
	#toCenter(x: number, y: number): Point {
		return { x: x - this.#viewport.width / 2, y: y - this.#viewport.height / 2 };
	}

	/**
	 * the content-space point currently sitting under a viewport-center-relative
	 * focal point, for a given pan/scale — the anchor kept fixed while zooming.
	 */
	#contentPoint(focal: Point, pan: Point, scale: number): Point {
		return { x: (focal.x - pan.x) / scale, y: (focal.y - pan.y) / scale };
	}

	/**
	 * displayed (scale-1) size of an image under the `minCoverage` fit policy.
	 * large images are downscaled to contain; small images are shown at natural
	 * size unless that would cover less than `minCoverage` of the viewport, in
	 * which case they're upscaled just enough to reach it.
	 */
	#fittedSize(i: number): Size {
		const nat = this.#naturalSizes[i];
		const vp = this.#viewport;
		if (!nat || !nat.width || !nat.height || !vp.width || !vp.height) {
			// size not yet known (no declared dimensions and the image hasn't
			// loaded, or the viewport isn't measured). report zero rather than the
			// viewport so the renderer leaves the <img> collapsed instead of
			// stretching it full-bleed for a frame and then snapping it down to the
			// real fitted size once the natural size lands.
			return { height: 0, width: 0 };
		}
		const containK = Math.min(vp.width / nat.width, vp.height / nat.height);
		const k =
			containK <= 1
				? containK // larger than viewport → downscale to fit
				: Math.min(containK, Math.max(1, this.config.minCoverage * containK));
		return { width: nat.width * k, height: nat.height * k };
	}

	/** rebuild the cached per-image fitted sizes and invalidate the snapshot. */
	#computeFittedSizes(): void {
		this.#fittedSizes = Array.from({ length: this.#count }, (_, i) => this.#fittedSize(i));
		this.#snapshot = null;
	}

	#panBounds(scale: number): { maxX: number; maxY: number } {
		const fit = this.#fittedSizes[this.index] ?? this.#fittedSize(this.index);
		return {
			maxX: Math.max(0, (fit.width * scale - this.#viewport.width) / 2),
			maxY: Math.max(0, (fit.height * scale - this.#viewport.height) / 2),
		};
	}

	#clampActivePanInstant(): void {
		const { maxX, maxY } = this.#panBounds(this.#scale.value);
		this.#panX.set(clamp(this.#panX.value, -maxX, maxX));
		this.#panY.set(clamp(this.#panY.value, -maxY, maxY));
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
		// freeze springs at their current values without snapping to target.
		for (const s of this.#channels) {
			s.animateTo(s.value); // target = value, then mark not-animating via set
			s.set(s.value);
		}
	}

	/** whether any animated channel is still settling — the canonical "animating". */
	#springsAnimating(): boolean {
		return this.#channels.some((s) => s.isAnimating);
	}

	#startLoop(): void {
		// a deferred-emit path (goTo/settle/commit) just changed state; drop the
		// cache so a synchronous getState() before the first tick rebuilds fresh.
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
		const transforms = this.#transforms.map((t, i) =>
			i === this.index ? { scale: this.#scale.value, x: this.#panX.value, y: this.#panY.value } : t,
		);
		const pulled = Math.abs(this.#dismissY.value);
		const backdropOpacity = clamp(1 - pulled / this.config.dismissFadeDistancePx, 0, 1);
		const g = this.#gesture;
		// only the axis-locked single-pointer phases surface as a DragMode; idle,
		// pending, and pinch all read as 'none' (pinch is flagged separately).
		const dragMode: DragMode =
			g.kind === 'dismiss' || g.kind === 'page' || g.kind === 'pan' ? g.kind : 'none';
		return {
			backdropOpacity,
			dismissY: this.#dismissY.value,
			dragMode,
			fittedSizes: this.#fittedSizes,
			index: this.index,
			isAnimating: this.#springsAnimating(),
			isDragging: this.#pointers.size > 0,
			isPinching: g.kind === 'pinch',
			isZoomed: this.#scale.value > 1.01,
			trackX: this.#trackX.value,
			transforms,
		};
	}

	#emit(): void {
		this.#snapshot = this.#buildState();
		this.#emitter.emit(this.#snapshot);
	}

	/** cancel any running loop, drop all subscribers, and release pointers. */
	destroy(): void {
		this.#cancelLoop();
		// drop every subscriber by swapping in a fresh emitter (it has no clear()).
		this.#emitter = new SimpleEventEmitter<[LightboxState]>();
		this.#pointers.clear();
	}

	// #endregion
}

const dist = (a: Point, b: Point): number => {
	return Math.hypot(a.x - b.x, a.y - b.y);
};

// per-field guards: a missing or out-of-range value falls back, else passes through.
// allow [0, Infinity] (Infinity is a valid "never" sentinel); reject missing/NaN/negative.
const cfgSpan = (v: number | undefined, fallback: number): number =>
	v === undefined || Number.isNaN(v) || v < 0 ? fallback : v;
// finite and strictly positive.
const cfgPositive = (v: number | undefined, fallback: number): number =>
	v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;
// finite, clamped to [lo, hi].
const cfgRatio = (v: number | undefined, fallback: number, lo: number, hi: number): number =>
	v !== undefined && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;

/**
 * the sole config defaulting + validation boundary: missing or out-of-range
 * fields fall back to {@link DEFAULT_CONFIG}, so callers pass a raw partial.
 *
 * @param config caller overrides; any field may be omitted, invalid, or out of range.
 * @returns a complete, sanitized config.
 */
const normalizeConfig = (config: Partial<LightboxConfig> = {}): LightboxConfig => {
	const minScale = cfgPositive(config.minScale, DEFAULT_CONFIG.minScale);
	const maxScale = Math.max(minScale, cfgPositive(config.maxScale, DEFAULT_CONFIG.maxScale));
	return {
		axisLockPx: cfgSpan(config.axisLockPx, DEFAULT_CONFIG.axisLockPx),
		closeOnBackdropClick: config.closeOnBackdropClick ?? DEFAULT_CONFIG.closeOnBackdropClick,
		// divides the backdrop fade — must be > 0; Infinity (never fade) is fine.
		dismissFadeDistancePx:
			config.dismissFadeDistancePx === undefined ||
			Number.isNaN(config.dismissFadeDistancePx) ||
			config.dismissFadeDistancePx <= 0
				? DEFAULT_CONFIG.dismissFadeDistancePx
				: config.dismissFadeDistancePx,
		dismissThresholdPx: cfgSpan(config.dismissThresholdPx, DEFAULT_CONFIG.dismissThresholdPx),
		dismissVelocity: cfgSpan(config.dismissVelocity, DEFAULT_CONFIG.dismissVelocity),
		doubleTapScale: clamp(
			cfgPositive(config.doubleTapScale, DEFAULT_CONFIG.doubleTapScale),
			minScale,
			maxScale,
		),
		loop: config.loop ?? DEFAULT_CONFIG.loop,
		maxScale,
		minCoverage: cfgRatio(config.minCoverage, DEFAULT_CONFIG.minCoverage, 0, 1),
		minScale,
		pageFlingVelocity: cfgSpan(config.pageFlingVelocity, DEFAULT_CONFIG.pageFlingVelocity),
		pageThresholdRatio: cfgRatio(config.pageThresholdRatio, DEFAULT_CONFIG.pageThresholdRatio, 0, 1),
		rubberBand: cfgRatio(config.rubberBand, DEFAULT_CONFIG.rubberBand, 0, 1),
	};
};

// re-export so the React layer can build rubber-band previews if needed.
export { rubberBand };
