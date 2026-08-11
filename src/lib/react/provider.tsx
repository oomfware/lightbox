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
	children?: ReactNode;
	images: LightboxImage[];
	config?: Partial<LightboxConfig>;

	/** controlled active index. */
	index?: number;
	/** uncontrolled index used on activation. */
	defaultIndex?: number;
	onIndexChange?: (index: number) => void;

	/** activation signal that resets the engine when it becomes true. */
	active?: boolean;
	/** called when a swipe-to-dismiss gesture commits. */
	onDismiss?: () => void;
}

/**
 * provides the lightbox engine without modal behavior.
 *
 * @param props provider properties.
 * @returns the context provider.
 */
export const Provider = (props: LightboxProviderProps) => {
	const { children, images, config, index, defaultIndex = 0, onIndexChange, active, onDismiss } = props;

	// #region engine

	const handleDismiss = useEffectEvent(() => onDismiss?.());

	const [engine] = useState(
		() =>
			new LightboxEngine({
				index: index ?? defaultIndex,
				config,
				onDismiss: handleDismiss,
			}),
	);

	useEffect(() => () => engine.destroy(), [engine]);

	// #endregion

	// #region geometry

	const viewportSize = useRef<Size>({ width: 0, height: 0 });
	// source keys prevent reordered images from inheriting sizes by index.
	const naturalSizes = useRef<Map<string, Size>>(new Map());
	const syncGeometry = useCallback(() => {
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

	// sync count before viewport measurement can clamp the initial index.
	useEffect(() => {
		syncGeometry();
	}, [syncGeometry]);

	// #endregion

	// #region synchronization

	const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);
	useEffect(() => {
		engine.setConfig(mergedConfig);
	}, [engine, mergedConfig]);

	// track both values because activation and default-index updates can use separate commits.
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

	useEffect(() => {
		if (index !== undefined && index !== engine.index) {
			engine.goTo(index);
		}
	}, [index, engine]);

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

	// #endregion

	// #region context

	const value = useMemo<LightboxContextValue>(
		() => ({
			images,
			config: mergedConfig,
			next: () => engine.next(),
			prev: () => engine.prev(),
			goTo: (i: number) => engine.goTo(i),
			close: handleDismiss,
			engine,
			reportNaturalSize,
			setViewportSize,
		}),
		[engine, images, mergedConfig, reportNaturalSize, setViewportSize],
	);

	// #endregion

	return <LightboxContext.Provider value={value}>{children}</LightboxContext.Provider>;
};
