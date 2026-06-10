import {
	type ComponentPropsWithoutRef,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type Ref,
	useCallback,
	useEffect,
	useRef,
} from 'react';

import { useLightbox, useLightboxState } from './context.ts';

/** a tap (pointerdown→up with no drag) on the viewport. */
export interface LightboxTapInfo {
	/** the tap landed on the image (vs. the backdrop area / chrome). */
	onImage: boolean;
	/** 'mouse' | 'touch' | 'pen'. */
	pointerType: string;
}

export interface LightboxViewportProps extends ComponentPropsWithoutRef<'div'> {
	/**
	 * fired on a tap (no drag, no pinch) anywhere on the viewport. use it to
	 * build app-level behaviors the headless core stays out of — e.g. toggling
	 * chrome visibility on touch tap. note: the first tap of a double-tap-to-zoom
	 * also fires this, so debounce if that matters.
	 */
	onTap?: (info: LightboxTapInfo) => void;
	/** forwarded to the root element (e.g. so a dialog can set initial focus here). */
	ref?: Ref<HTMLDivElement>;
}

const TAP_SLOP = 6;

/**
 * gesture surface and clip region: a focusable `<div>` that routes pointer,
 * wheel, and arrow-key input into the engine. it is *not* a modal — it provides
 * no focus trap, `aria-modal`, or Escape handling. render it inside something
 * that does (the Base UI preset's `Viewport`, your own dialog, etc.); the
 * wrapping modal owns Escape so it isn't handled twice.
 *
 * accepts arbitrary `<div>` props and forwards them, so it can serve as a Base
 * UI `render` target — its own pointer/key handlers chain after any passed in.
 *
 * @param props see {@link LightboxViewportProps}.
 */
export const Viewport = (props: LightboxViewportProps) => {
	const {
		children,
		onContextMenu,
		onKeyDown,
		onPointerCancel,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onTap,
		ref,
		style,
		...rest
	} = props;
	const { close, config, engine, setViewportSize } = useLightbox();
	// gesture-boundary flags only (not per-frame values), so the surface
	// re-renders on axis-lock / zoom / pinch changes, not on every move.
	const isZoomed = useLightboxState((state) => state.isZoomed);
	const isDragging = useLightboxState((state) => state.isDragging);
	const isPinching = useLightboxState((state) => state.isPinching);
	const localRef = useRef<HTMLDivElement>(null);
	const rect = useRef<DOMRect | null>(null);
	const down = useRef<{ onImage: boolean; pointerType: string; x: number; y: number } | null>(null);
	// pointer ids currently down on the surface, and whether the active gesture
	// ever involved more than one of them — so a pinch is never misread as a tap.
	const pointersDown = useRef(new Set<number>());
	const multiTouch = useRef(false);

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			localRef.current = node;
			// cleanup-aware forward (React 19): always return a cleanup so React
			// drives detach through it rather than the legacy `setRefs(null)` path.
			if (typeof ref !== 'function') {
				if (ref) {
					ref.current = node;
				}
				return () => {
					localRef.current = null;
					if (ref) {
						ref.current = null;
					}
				};
			}
			// capture the forwarded ref's own cleanup if it returns one; otherwise
			// fall back to calling it with null on detach.
			const cleanup = ref(node);
			return () => {
				localRef.current = null;
				if (typeof cleanup === 'function') {
					cleanup();
				} else {
					ref(null);
				}
			};
		},
		[ref],
	);

	const local = useCallback((clientX: number, clientY: number): [number, number] => {
		const r = rect.current;
		return r ? [clientX - r.left, clientY - r.top] : [clientX, clientY];
	}, []);

	// measure the viewport from the ResizeObserver's fractional contentRect. paging
	// translates the track by -index * width, so a rounded width (clientWidth) drifts
	// by its fractional remainder every slide, bleeding a neighbour in by a growing
	// sliver. contentRect is fractional yet still a layout box, so — like clientWidth,
	// unlike getBoundingClientRect — the open-animation's scale(0.92) can't corrupt it.
	useEffect(() => {
		const el = localRef.current;
		if (!el) {
			return undefined;
		}
		const ro = new ResizeObserver(([entry]) => {
			const { height, width } = entry.contentRect;
			setViewportSize({ height, width });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [setViewportSize]);

	// wheel needs a non-passive native listener to preventDefault trackpad zoom.
	useEffect(() => {
		const el = localRef.current;
		if (!el) {
			return undefined;
		}
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey) {
				return;
			} // ctrlKey set by trackpad pinch / browser zoom gesture
			e.preventDefault();
			const r = el.getBoundingClientRect();
			engine.wheel(e.clientX - r.left, e.clientY - r.top, e.deltaY);
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}, [engine]);

	// `touch-action: none` isn't enough on Chromium: a fast swipe is recognized as
	// a fling upstream of the touch-action filter (which only drops scroll events,
	// never tap events). The fling stays live, so the next quick tap fires a
	// `GestureFlingCancel`, and `TouchscreenTapSuppressionController` swallows that
	// tap's `GestureTapDown`/`GestureTap` — Blink never synthesizes its click and
	// the tap is silently lost. Cancelling `touchmove` (non-passive) stops the
	// browser from ever treating the drag as a scroll/fling, which is the only
	// thing that reliably prevents the suppression. The engine is pointer-driven,
	// so suppressing touch events leaves gesture handling untouched; taps don't
	// move, so they're unaffected.
	useEffect(() => {
		const el = localRef.current;
		if (!el) {
			return undefined;
		}
		const onTouchMove = (e: TouchEvent) => {
			if (e.cancelable) {
				e.preventDefault();
			}
		};
		el.addEventListener('touchmove', onTouchMove, { passive: false });
		return () => el.removeEventListener('touchmove', onTouchMove);
	}, []);

	const handlePointerDown = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			onPointerDown?.(e);
			// let overlay controls (close, nav, custom buttons) handle their own
			// clicks — capturing the pointer here would swallow them.
			const target = e.target instanceof Element ? e.target : null;
			if (target?.closest('button, a, input, [role="button"], [data-lightbox-control]')) {
				down.current = null;
				return;
			}
			pointersDown.current.add(e.pointerId);
			if (pointersDown.current.size > 1) {
				// a second finger landed: this gesture is a pinch/multi-touch, so it
				// can never resolve to a tap. drop any pending tap candidate.
				multiTouch.current = true;
				down.current = null;
			} else {
				down.current = {
					x: e.clientX,
					y: e.clientY,
					pointerType: e.pointerType,
					onImage: !!target?.closest('[data-lightbox-image]'),
				};
			}
			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {
				/* synthetic / already-released pointer */
			}
			rect.current = e.currentTarget.getBoundingClientRect();
			engine.pointerDown(e.pointerId, ...local(e.clientX, e.clientY));
		},
		[engine, local, onPointerDown],
	);

	// settle any gesture whose matching pointerup never reached us — a native
	// context menu (right-click) swallows it, and the release can also be lost off
	// window. settling through engine.pointerUp runs the normal page/zoom commit so
	// the slide returns to a resting position instead of freezing mid-drag.
	const endStuckGesture = useCallback(
		(clientX: number, clientY: number) => {
			const [lx, ly] = local(clientX, clientY);
			for (const id of pointersDown.current) {
				try {
					localRef.current?.releasePointerCapture(id);
				} catch {
					/* already released */
				}
				engine.pointerUp(id, lx, ly);
			}
			pointersDown.current.clear();
			multiTouch.current = false;
			down.current = null;
		},
		[engine, local],
	);

	const handlePointerMove = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			onPointerMove?.(e);
			// a mouse drag whose button came up without a pointerup reaching us leaves
			// the gesture stuck live; the first move with no buttons pressed is the cue
			// to settle it rather than keep dragging. (touch reports buttons === 0
			// always, so this is mouse-only — long-press menus go through onContextMenu.)
			if (e.pointerType === 'mouse' && e.buttons === 0 && pointersDown.current.has(e.pointerId)) {
				endStuckGesture(e.clientX, e.clientY);
				return;
			}
			engine.pointerMove(e.pointerId, ...local(e.clientX, e.clientY));
		},
		[endStuckGesture, engine, local, onPointerMove],
	);

	const handlePointerUp = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			onPointerUp?.(e);
			// read drag/zoom state before pointerUp resets the gesture to idle: was
			// this a tap (no axis-locked drag, no real movement)?
			const pre = engine.getState();
			const wasDrag = pre.dragMode !== 'none';
			// a pinch reports dragMode 'none', so it would otherwise pass the tap
			// gate; exclude any gesture that is — or ever was — multi-touch.
			const wasMultiTouch = multiTouch.current || pre.isPinching;
			engine.pointerUp(e.pointerId, ...local(e.clientX, e.clientY));
			pointersDown.current.delete(e.pointerId);
			if (pointersDown.current.size === 0) {
				multiTouch.current = false;
			}
			const d = down.current;
			down.current = null;
			if (!d || wasDrag || wasMultiTouch) {
				return;
			}
			if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) {
				return;
			}
			onTap?.({ pointerType: d.pointerType, onImage: d.onImage });
			// backdrop click → close (mouse/pen, off the image, not while zoomed).
			if (config.closeOnBackdropClick && d.pointerType !== 'touch' && !d.onImage && !pre.isZoomed) {
				close();
			}
		},
		[close, config, engine, local, onPointerUp, onTap],
	);

	const handlePointerCancel = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			onPointerCancel?.(e);
			down.current = null;
			pointersDown.current.delete(e.pointerId);
			if (pointersDown.current.size === 0) {
				multiTouch.current = false;
			}
			engine.pointerUp(e.pointerId, ...local(e.clientX, e.clientY));
		},
		[engine, local, onPointerCancel],
	);

	const handleContextMenu = useCallback(
		(e: ReactMouseEvent<HTMLDivElement>) => {
			onContextMenu?.(e);
			// don't preventDefault — let the native menu open; just settle the drag
			// underneath it now, since its matching pointerup won't arrive.
			endStuckGesture(e.clientX, e.clientY);
		},
		[endStuckGesture, onContextMenu],
	);

	const handleKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLDivElement>) => {
			// chain any handler from the wrapping modal (e.g. focus-trap / Escape)
			// first; we only own arrow paging and deliberately leave Escape alone.
			onKeyDown?.(e);
			// respect a handler that already consumed the key (Base UI-managed
			// widgets call preventDefault), and never hijack arrows aimed at a
			// focused text field / select / editable region inside the surface.
			if (e.defaultPrevented) {
				return;
			}
			const target = e.target instanceof Element ? e.target : null;
			if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) {
				return;
			}
			if (e.key === 'ArrowRight') {
				engine.next();
			} else if (e.key === 'ArrowLeft') {
				engine.prev();
			}
		},
		[engine, onKeyDown],
	);

	return (
		// the surface has no intrinsic role; semantics (dialog/aria-modal) come from
		// the wrapping modal — when composed via Base UI's `render`, the preset's
		// Popup supplies them through {...rest}.
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions
		<div
			{...rest}
			ref={setRefs}
			// focusable so arrow-key paging has somewhere to land; not in the tab
			// order (the wrapping modal sets initial focus here).
			tabIndex={-1}
			data-zoomed={isZoomed ? '' : undefined}
			data-dragging={isDragging ? '' : undefined}
			data-pinching={isPinching ? '' : undefined}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerCancel}
			onContextMenu={handleContextMenu}
			onKeyDown={handleKeyDown}
			// merges the caller's `style`, so a fresh object is unavoidable. note:
			// layout (size/position) is deliberately left to the caller — this part
			// owns only gesture-critical styles. defaults fill the parent box.
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
				width: '100%',
				height: '100%',
				overflow: 'hidden',
				touchAction: 'none',
				userSelect: 'none',
				outline: 'none',
				...style,
			}}
		>
			{children}
		</div>
	);
};
