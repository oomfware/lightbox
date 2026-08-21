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

/** a viewport tap without a drag or pinch. */
export interface LightboxTapInfo {
	onImage: boolean;
	pointerType: string;
}

export interface LightboxViewportProps extends ComponentPropsWithoutRef<'div'> {
	ref?: Ref<HTMLDivElement>;
	/**
	 * called after a tap. the first tap of a double-tap also calls it.
	 */
	onTap?: (info: LightboxTapInfo) => void;
}

const TAP_SLOP = 6;

const PASSTHROUGH_SELECTOR =
	'button, a, input, [role="button"], [data-lightbox-control], [data-lightbox-passthrough]';

/**
 * renders the gesture and keyboard input surface.
 *
 * @param props viewport properties.
 * @returns the viewport.
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
	const {
		close,
		config: { closeOnBackdropClick },
		engine,
		setViewportSize,
	} = useLightbox();
	const isDragging = useLightboxState((state) => state.isDragging);
	const isPinching = useLightboxState((state) => state.isPinching);
	const isZoomed = useLightboxState((state) => state.isZoomed);

	// #region refs

	const localRef = useRef<HTMLDivElement>(null);
	const rect = useRef<DOMRect | null>(null);
	const down = useRef<{ onImage: boolean; pointerType: string; x: number; y: number } | null>(null);
	const pointersDown = useRef(new Set<number>());
	const multiTouch = useRef(false);

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			localRef.current = node;
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

	// #endregion

	// #region native events

	// fractional layout size prevents page drift without including CSS transforms.
	useEffect(() => {
		const el = localRef.current;
		if (!el) {
			return undefined;
		}
		const ro = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			setViewportSize({ width, height });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [setViewportSize]);

	// trackpad zoom requires a non-passive wheel listener.
	useEffect(() => {
		const el = localRef.current;
		if (!el) {
			return undefined;
		}
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey) {
				return;
			}
			e.preventDefault();
			const r = el.getBoundingClientRect();
			engine.wheel(e.clientX - r.left, e.clientY - r.top, e.deltaY);
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}, [engine]);

	// Chromium can suppress the tap after a fast swipe unless touchmove is canceled.
	useEffect(() => {
		const el = localRef.current;
		if (!el) {
			return undefined;
		}
		const onTouchMove = (e: TouchEvent) => {
			const target = e.target instanceof Element ? e.target : null;
			if (e.cancelable && !target?.closest(PASSTHROUGH_SELECTOR)) {
				e.preventDefault();
			}
		};
		el.addEventListener('touchmove', onTouchMove, { passive: false });
		return () => el.removeEventListener('touchmove', onTouchMove);
	}, []);

	// #endregion

	// #region pointer input

	const handlePointerDown = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			onPointerDown?.(e);
			const target = e.target instanceof Element ? e.target : null;
			if (target?.closest(PASSTHROUGH_SELECTOR)) {
				down.current = null;
				return;
			}
			pointersDown.current.add(e.pointerId);
			if (pointersDown.current.size > 1) {
				multiTouch.current = true;
				down.current = null;
			} else {
				down.current = {
					onImage: !!target?.closest('[data-lightbox-image]'),
					pointerType: e.pointerType,
					x: e.clientX,
					y: e.clientY,
				};
			}
			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {
				/* pointer already released */
			}
			rect.current = e.currentTarget.getBoundingClientRect();
			engine.pointerDown(e.pointerId, ...local(e.clientX, e.clientY));
		},
		[engine, local, onPointerDown],
	);

	// settle gestures when a context menu or lost event hides pointerup.
	const endStuckGesture = useCallback(
		(clientX: number, clientY: number) => {
			const [lx, ly] = local(clientX, clientY);
			for (const id of pointersDown.current) {
				try {
					localRef.current?.releasePointerCapture(id);
				} catch {
					/* pointer already released */
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
			// a buttonless mouse move identifies a lost pointerup.
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
			const pre = engine.getState();
			const wasDrag = pre.dragMode !== 'none';
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
			onTap?.({ onImage: d.onImage, pointerType: d.pointerType });
			if (closeOnBackdropClick && d.pointerType !== 'touch' && !d.onImage && !pre.isZoomed) {
				close();
			}
		},
		[close, closeOnBackdropClick, engine, local, onPointerUp, onTap],
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
			endStuckGesture(e.clientX, e.clientY);
		},
		[endStuckGesture, onContextMenu],
	);

	const handleKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLDivElement>) => {
			onKeyDown?.(e);
			if (e.defaultPrevented) {
				return;
			}
			const target = e.target instanceof Element ? e.target : null;
			if (
				target?.closest(
					'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-lightbox-passthrough]',
				)
			) {
				return;
			}
			switch (e.key) {
				case 'ArrowLeft': {
					engine.prev();
					break;
				}
				case 'ArrowRight': {
					engine.next();
					break;
				}
			}
		},
		[engine, onKeyDown],
	);

	// #endregion

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions
		<div
			{...rest}
			ref={setRefs}
			tabIndex={-1}
			data-dragging={isDragging ? '' : undefined}
			data-pinching={isPinching ? '' : undefined}
			data-zoomed={isZoomed ? '' : undefined}
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
				width: '100%',
				height: '100%',
				overflow: 'hidden',
				touchAction: 'none',
				userSelect: 'none',
				...style,
			}}
			onContextMenu={handleContextMenu}
			onKeyDown={handleKeyDown}
			onPointerCancel={handlePointerCancel}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
		>
			{children}
		</div>
	);
};
