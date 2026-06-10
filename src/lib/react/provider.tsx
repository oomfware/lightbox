import {
	type ReactNode,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';

import { LightboxEngine } from '../core/engine.ts';
import { DEFAULT_CONFIG, type LightboxConfig, type Size } from '../core/types.ts';

import { LightboxContext, type LightboxContextValue, type LightboxImage } from './context.ts';

export interface LightboxProviderProps {
	/**
	 * whether the surface is currently visible. transitioning to `true` resets
	 * the engine to the starting index. this is an *activation* signal, not modal
	 * state — the provider never gates rendering on it (the wrapping dialog owns
	 * mount/unmount). omit it to reset on mount only. a Base UI preset maps the
	 * dialog's `open` to this.
	 */
	active?: boolean;
	children?: ReactNode;
	config?: Partial<LightboxConfig>;
	/**
	 * uncontrolled starting index. used to reset on activation; changing it while
	 * `active` re-resets to the new index, so a consumer can point a fresh open at
	 * a different image even if the activation edge and the index update land in
	 * separate commits. ignored when `index` is supplied (that path is controlled).
	 */
	defaultIndex?: number;
	images: LightboxImage[];
	/** controlled active index. */
	index?: number;
	onIndexChange?: (index: number) => void;
	/** called when a swipe-to-dismiss gesture commits. */
	onDismiss?: () => void;
}

/**
 * dialog-agnostic provider: owns the engine and supplies the lightbox context
 * every other part reads from. knows nothing about modals — wrap it in whatever
 * dialog/route/overlay you like (or use the Base UI preset's `Root`).
 *
 * @param props see {@link LightboxProviderProps}.
 */
export const Provider = (props: LightboxProviderProps) => {
	const { active, children, config, defaultIndex = 0, images, index, onDismiss, onIndexChange } = props;

	// the engine is built once, so route dismiss through an effect event: it always
	// calls the latest onDismiss prop without rebuilding the engine.
	const handleDismiss = useEffectEvent(() => onDismiss?.());

	const [engine] = useState(
		() =>
			new LightboxEngine({
				index: index ?? defaultIndex,
				config,
				onDismiss: handleDismiss,
			}),
	);

	// release the engine's rAF loop and subscribers when the tree unmounts.
	useEffect(() => () => engine.destroy(), [engine]);

	// geometry plumbing: Viewport reports its size, Images report natural sizes.
	const viewportSize = useRef<Size>({ width: 0, height: 0 });
	// keyed by image src, not index: a list whose entries change at the same index
	// (replace/reorder) must not reuse the previous image's measured size.
	const naturalSizes = useRef<Map<string, Size>>(new Map());
	const syncGeometry = useCallback(() => {
		// prefer measured natural sizes; fall back to declared width/height so
		// pan bounds are correct before the image network-loads.
		const sizes = images.map(
			(img) =>
				naturalSizes.current.get(img.src) ??
				(img.width && img.height ? { width: img.width, height: img.height } : undefined),
		);
		engine.setGeometry(viewportSize.current, images.length, sizes);
	}, [engine, images]);
	const setViewportSize = useCallback(
		(size: Size) => {
			viewportSize.current = size;
			syncGeometry();
		},
		[syncGeometry],
	);
	const reportNaturalSize = useCallback(
		(i: number, size: Size) => {
			const src = images[i]?.src;
			if (src === undefined) {
				return;
			}
			naturalSizes.current.set(src, size);
			syncGeometry();
		},
		[images, syncGeometry],
	);

	// sync the image count to the engine as soon as the images are known —
	// before the Viewport mounts and measures — so opening at a given index
	// isn't clamped against a stale (default) count.
	useEffect(() => {
		syncGeometry();
	}, [syncGeometry]);

	// keep engine config in sync. merging over DEFAULT_CONFIG means dropping an
	// override reverts that key to its default rather than retaining the old value.
	const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);
	useEffect(() => {
		engine.setConfig(mergedConfig);
	}, [engine, mergedConfig]);

	// reset the engine to the starting index when the surface (re)activates, or
	// when the uncontrolled starting index moves while already active. `active`
	// undefined → reset once on mount; a false→true edge re-resets. tracking
	// `defaultIndex` too covers consumers that update the starting index and flip
	// `active` in separate commits: the activation edge alone would reset to the
	// stale index. controlled `index` is excluded — the effect below drives it
	// (animated), so re-resetting on its change would fight that path.
	const wasActive = useRef(false);
	const lastDefaultIndex = useRef(defaultIndex);
	useEffect(() => {
		const isActive = active ?? true;
		const activated = isActive && !wasActive.current;
		const startMoved = isActive && defaultIndex !== lastDefaultIndex.current;
		if (activated || startMoved) {
			engine.reset(index ?? defaultIndex);
		}
		wasActive.current = isActive;
		lastDefaultIndex.current = defaultIndex;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active, defaultIndex, engine]);

	// controlled index → drive the engine.
	useEffect(() => {
		if (index !== undefined && index !== engine.index) {
			engine.goTo(index);
		}
	}, [index, engine]);

	// report index changes outward. subscribing to just the index keeps the
	// provider off the per-frame render path while still tracking page changes.
	const engineIndex = useSyncExternalStore(
		engine.subscribe,
		() => engine.getState().index,
		() => engine.getState().index,
	);
	const lastIndex = useRef(engineIndex);
	useEffect(() => {
		if (engineIndex !== lastIndex.current) {
			lastIndex.current = engineIndex;
			onIndexChange?.(engineIndex);
		}
	}, [engineIndex, onIndexChange]);

	const value = useMemo<LightboxContextValue>(
		() => ({
			images,
			config: mergedConfig,
			next: () => engine.next(),
			prev: () => engine.prev(),
			goTo: (i: number) => engine.goTo(i),
			close: handleDismiss,
			engine,
			setViewportSize,
			reportNaturalSize,
		}),
		[engine, images, mergedConfig, reportNaturalSize, setViewportSize],
	);

	return <LightboxContext.Provider value={value}>{children}</LightboxContext.Provider>;
};
