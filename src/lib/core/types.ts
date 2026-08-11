// #region geometry

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

/** per-edge offsets in CSS px, laid out like CSS `inset`. */
export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** all-zero {@link Insets}. */
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** an image transform relative to its fitted, centered position. */
export interface Transform {
	scale: number;
	x: number;
	y: number;
}

/** the rest transform: fit-to-viewport scale, no pan. */
export const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

/** which gesture a single-pointer drag has committed to (axis lock). */
export type DragMode = 'none' | 'pan' | 'page' | 'dismiss';

// #endregion

// #region configuration

/** tunable behavior; defaults live in `DEFAULT_CONFIG`. */
export interface LightboxConfig {
	/** horizontal travel (px) at which a not-zoomed drag locks to an axis. */
	axisLockPx: number;
	/** fraction of viewport width a page drag must cross to advance. */
	pageThresholdRatio: number;
	/** release velocity (px/s) that flips a page regardless of distance. */
	pageFlingVelocity: number;
	/** whether the carousel wraps from last → first and back. */
	loop: boolean;

	/** vertical travel (px) past which release dismisses. */
	dismissThresholdPx: number;
	/** release velocity (px/s) that dismisses regardless of distance. */
	dismissVelocity: number;
	/** distance (px) over which the backdrop fully fades during a dismiss pull. */
	dismissFadeDistancePx: number;
	/** whether a mouse or pen tap outside the image closes the lightbox. */
	closeOnBackdropClick: boolean;

	/** min zoom before snap-back to 1. */
	minScale: number;
	/** max zoom relative to fitted size. */
	maxScale: number;
	/** scale applied by a double-tap / double-click toggle. */
	doubleTapScale: number;
	/** minimum viewport coverage for a resting small image: `0` preserves natural size and `1` fills. */
	minCoverage: number;
	/** rubber-band tension for over-drag past bounds/ends (0–1, lower = stiffer). */
	rubberBand: number;
	/** per-edge pan travel in px beyond the viewport. */
	overpanInsets: Insets;
	/** per-edge region in px that a resting image must avoid. */
	safeAreaInsets: Insets;
}

/** default {@link LightboxConfig}; spread under caller overrides. */
export const DEFAULT_CONFIG: LightboxConfig = {
	axisLockPx: 10,
	pageThresholdRatio: 0.2,
	pageFlingVelocity: 500,
	loop: false,
	dismissThresholdPx: 50,
	dismissVelocity: 700,
	dismissFadeDistancePx: 400,
	closeOnBackdropClick: true,
	minScale: 1,
	maxScale: 4,
	doubleTapScale: 2.5,
	minCoverage: 0.5,
	rubberBand: 0.55,
	overpanInsets: NO_INSETS,
	safeAreaInsets: NO_INSETS,
};

// #endregion

// #region state

/** snapshot the React layer renders from. */
export interface LightboxState {
	/** active image index. */
	index: number;
	/** final per-image transforms, including safe-area offsets. */
	transforms: Transform[];
	/** fitted image sizes in CSS px after coverage and safe-area rules. */
	fittedSizes: Size[];

	/** paging offset of the track in px (rest = -index * viewportWidth). */
	trackX: number;
	/** vertical dismiss pull of the active slide in px. */
	dismissY: number;
	/** 1 at rest, → 0 as the dismiss pull approaches the fade distance. */
	backdropOpacity: number;

	/** committed axis for the active single-pointer drag. */
	dragMode: DragMode;
	/** a single-pointer or pinch gesture is actively in progress. */
	isDragging: boolean;
	/** a two-pointer pinch is in progress. */
	isPinching: boolean;
	/** whether the active image is zoomed beyond fit. */
	isZoomed: boolean;
	/** a spring/decay animation is settling. */
	isAnimating: boolean;
}

// #endregion
