import { type CSSProperties, type ReactNode, type SyntheticEvent, useCallback, useMemo } from 'react';

import { IDENTITY } from '../core/types.ts';

import { type LightboxImage, useLightbox, useLightboxState } from './context.ts';

export interface LightboxTrackProps {
	/**
	 * custom slide renderer; defaults to <Slide><Image/></Slide> per image.
	 * hoist this or wrap it in `useCallback` — the slide list is memoized on the
	 * function's identity, so a fresh inline renderer each render re-creates every
	 * slide on the per-frame paging path, defeating the optimization.
	 */
	children?: (image: LightboxImage, index: number) => ReactNode;
	className?: string;
	style?: CSSProperties;
}

/**
 * paged carousel (a `ul[role=list]`) translated horizontally by the engine's
 * paging offset; renders one {@link Slide} per image by default.
 *
 * @param props see {@link LightboxTrackProps}.
 */
export const Track = ({ children, className, style }: LightboxTrackProps) => {
	const { images } = useLightbox();
	const trackX = useLightboxState((state) => state.trackX);
	// memoized so the per-frame paging re-render doesn't recreate (and thus
	// re-render) every slide; only the <ul> transform updates each frame.
	const slides = useMemo(
		() =>
			images.map((image, i) =>
				children ? (
					children(image, i)
				) : (
					<Slide key={image.src} index={i}>
						<Image index={i} />
					</Slide>
				),
			),
		[children, images],
	);
	return (
		<ul
			// `list-style: none` strips list semantics in Safari + VoiceOver; the
			// explicit role restores them despite jsx-a11y deeming it redundant.
			role="list"
			aria-roledescription="carousel"
			className={className}
			// carries the engine's live paging offset; new every frame by design
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
				display: 'flex',
				listStyle: 'none',
				margin: 0,
				padding: 0,
				width: '100%',
				height: '100%',
				transform: `translate3d(${trackX}px, 0, 0)`,
				...style,
			}}
		>
			{slides}
		</ul>
	);
};

export interface LightboxSlideProps {
	children?: ReactNode;
	className?: string;
	index: number;
	style?: CSSProperties;
}

/**
 * one carousel cell (a `li[role=listitem]`); the active cell carries the live
 * swipe-to-dismiss pull.
 *
 * @param props see {@link LightboxSlideProps}.
 */
export const Slide = ({ children, className, index, style }: LightboxSlideProps) => {
	const active = useLightboxState((state) => state.index === index);
	// inactive slides read a constant 0, so they never re-render mid-dismiss.
	const dismissY = useLightboxState((state) => (state.index === index ? state.dismissY : 0));
	return (
		<li
			// see Track: explicit role keeps list-item semantics under list-style:none
			role="listitem"
			data-testid="swipe-to-dismiss"
			data-active={active ? '' : undefined}
			className={className}
			// carries the active slide's live dismiss pull; new every frame by design
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
				flex: '0 0 100%',
				width: '100%',
				height: '100%',
				position: 'relative',
				display: 'grid',
				placeItems: 'center',
				transform: `translate3d(0, ${dismissY}px, 0)`,
				...style,
			}}
		>
			{children}
		</li>
	);
};

export interface LightboxImageProps {
	className?: string;
	index: number;
	style?: CSSProperties;
}

/**
 * innermost zoom/pan transform layer: the `<img>` itself, sized to the engine's
 * fit-policy result and reporting its natural size back on load.
 *
 * @param props see {@link LightboxImageProps}.
 */
export const Image = ({ className, index, style }: LightboxImageProps) => {
	const { images, reportNaturalSize } = useLightbox();
	// the engine reuses the same transform/size references for inactive images,
	// so these selectors only re-render the image actually being zoomed/panned.
	const t = useLightboxState((state) => state.transforms[index] ?? IDENTITY);
	const fitted = useLightboxState((state) => state.fittedSizes[index]);
	const data = images[index];
	const handleLoad = useCallback(
		(e: SyntheticEvent<HTMLImageElement>) => {
			const el = e.currentTarget;
			reportNaturalSize(index, { width: el.naturalWidth, height: el.naturalHeight });
		},
		[index, reportNaturalSize],
	);
	if (!data) {
		return null;
	}
	return (
		<img
			className={className}
			data-lightbox-image=""
			src={data.src}
			srcSet={data.srcSet}
			sizes={data.sizes}
			alt={data.alt ?? ''}
			draggable={false}
			onLoad={handleLoad}
			// sized + transformed from the engine's live fit/zoom state every frame
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
				// sized to the engine's fit-policy result (px) and centered by the
				// Slide's grid, so the on-screen pixels and the engine's pan bounds are
				// identical. explicit px (never %) means small images aren't upscaled
				// and the grid percentage-height circularity can't bite. sizes are
				// always ≤ the viewport, so it can't overflow. a 0px fallback keeps the
				// <img> collapsed until its size is known (no declared dimensions and
				// not yet loaded), avoiding a full-viewport flash before the real fit.
				display: 'block',
				width: fitted?.width ? `${fitted.width}px` : '0px',
				height: fitted?.height ? `${fitted.height}px` : '0px',
				transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})`,
				transformOrigin: 'center center',
				willChange: 'transform',
				userSelect: 'none',
				WebkitUserSelect: 'none',
				touchAction: 'none',
				...style,
			}}
		/>
	);
};
