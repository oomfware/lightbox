/**
 * core geometry + transform types for the headless lightbox.
 * framework-agnostic — no React, no DOM beyond plain numbers.
 */

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	height: number;
	width: number;
}

/**
 * the per-image transform. `scale` is relative to the fitted (contain) size,
 * so `scale: 1` means "fit to viewport". `x`/`y` are translation in CSS px
 * applied *after* scaling, measured from the centered rest position.
 */
export interface Transform {
	scale: number;
	x: number;
	y: number;
}

/** the rest transform: fit-to-viewport scale, no pan. */
export const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

/** which gesture a single-pointer drag has committed to (axis lock). */
export type DragMode = 'none' | 'pan' | 'page' | 'dismiss';

/** tunable behavior; defaults live in `DEFAULT_CONFIG`. */
export interface LightboxConfig {
	/** horizontal travel (px) at which a not-zoomed drag locks to an axis. */
	axisLockPx: number;
	/**
	 * close when a mouse click lands on the backdrop area (anywhere that isn't
	 * the image or a control) without dragging. mouse/pen only — touch taps are
	 * left for the app to handle (e.g. toggling chrome). see `Viewport`'s
	 * `onTap`.
	 */
	closeOnBackdropClick: boolean;
	/** distance (px) over which the backdrop fully fades during a dismiss pull. */
	dismissFadeDistancePx: number;
	/** vertical travel (px) past which release dismisses. */
	dismissThresholdPx: number;
	/** release velocity (px/s) that dismisses regardless of distance. */
	dismissVelocity: number;
	/** scale applied by a double-tap / double-click toggle. */
	doubleTapScale: number;
	/** whether the carousel wraps from last → first and back. */
	loop: boolean;
	/** max zoom relative to fitted size. */
	maxScale: number;
	/**
	 * rest-fit policy for images smaller than the viewport — the minimum
	 * fraction of the viewport's binding dimension a rest image must cover:
	 *
	 *   - `1`   → always fit-to-viewport (force-upscale small images; "contain")
	 *   - `0`   → never upscale (small images shown at natural 1:1 size)
	 *   - `0.5` → natural size, but bump genuinely tiny images up to 50% coverage
	 *
	 * images larger than the viewport are always downscaled to fit, regardless.
	 * (user zoom — double-tap / pinch / wheel — is unaffected by this.)
	 */
	minCoverage: number;
	/** min zoom before snap-back to 1. */
	minScale: number;
	/** release velocity (px/s) that flips a page regardless of distance. */
	pageFlingVelocity: number;
	/** fraction of viewport width a page drag must cross to advance. */
	pageThresholdRatio: number;
	/** rubber-band tension for over-drag past bounds/ends (0–1, lower = stiffer). */
	rubberBand: number;
}

/** default {@link LightboxConfig}; spread under caller overrides. */
export const DEFAULT_CONFIG: LightboxConfig = {
	axisLockPx: 10,
	closeOnBackdropClick: true,
	dismissFadeDistancePx: 400,
	dismissThresholdPx: 50,
	dismissVelocity: 700,
	doubleTapScale: 2.5,
	loop: false,
	maxScale: 4,
	minCoverage: 0.5,
	minScale: 1,
	pageFlingVelocity: 500,
	pageThresholdRatio: 0.2,
	rubberBand: 0.55,
};

/** snapshot the React layer renders from. */
export interface LightboxState {
	/** 1 at rest, → 0 as the dismiss pull approaches the fade distance. */
	backdropOpacity: number;
	/** vertical dismiss pull of the active slide in px. */
	dismissY: number;
	/** committed axis for the active single-pointer drag. */
	dragMode: DragMode;
	/**
	 * per-image rest (scale-1) display size in CSS px, after the `minCoverage`
	 * fit policy. the renderer sizes each <img> to this so the engine's pan
	 * bounds and the on-screen pixels agree exactly.
	 */
	fittedSizes: Size[];
	/** active image index. */
	index: number;
	/** a spring/decay animation is settling. */
	isAnimating: boolean;
	/** a single-pointer or pinch gesture is actively in progress. */
	isDragging: boolean;
	/** a two-pointer pinch is in progress. */
	isPinching: boolean;
	/** convenience: active image is zoomed beyond fit. */
	isZoomed: boolean;
	/** paging offset of the track in px (rest = -index * viewportWidth). */
	trackX: number;
	/** per-image zoom/pan transforms, indexed like the image list. */
	transforms: Transform[];
}
