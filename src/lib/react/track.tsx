import { type CSSProperties, type ReactNode, type SyntheticEvent, useCallback, useMemo } from 'react';

import { IDENTITY } from '../core/types.ts';

import { type LightboxImage, useLightbox, useLightboxState } from './context.ts';

// #region track

export interface LightboxTrackProps {
	/**
	 * custom slide renderer. keep its identity stable to preserve slide memoization.
	 */
	children?: (image: LightboxImage, index: number) => ReactNode;
	className?: string;
	style?: CSSProperties;
}

/**
 * renders the paged carousel track.
 *
 * @param props track properties.
 * @returns the track.
 */
export const Track = ({ children, className, style }: LightboxTrackProps) => {
	const { images } = useLightbox();
	const trackX = useLightboxState((state) => state.trackX);
	const slides = useMemo(
		() =>
			images.map((image, i) => {
				if (children) {
					return children(image, i);
				}
				return (
					<Slide key={image.src} index={i}>
						<Image index={i} />
					</Slide>
				);
			}),
		[children, images],
	);
	return (
		<ul
			// Safari drops list semantics when list markers are removed.
			role="list"
			aria-roledescription="carousel"
			className={className}
			// transform changes every animation frame.
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
				display: 'flex',
				width: '100%',
				height: '100%',
				margin: 0,
				padding: 0,
				listStyle: 'none',
				transform: `translate3d(${trackX}px, 0, 0)`,
				...style,
			}}
		>
			{slides}
		</ul>
	);
};

// #endregion

// #region slide

export interface LightboxSlideProps {
	index: number;
	children?: ReactNode;
	className?: string;
	style?: CSSProperties;
}

/**
 * renders one carousel slide.
 *
 * @param props slide properties.
 * @returns the slide.
 */
export const Slide = ({ children, className, index, style }: LightboxSlideProps) => {
	const active = useLightboxState((state) => state.index === index);
	const dismissY = useLightboxState((state) => (state.index === index ? state.dismissY : 0));
	return (
		<li
			role="listitem"
			data-testid="swipe-to-dismiss"
			data-active={active ? '' : undefined}
			className={className}
			// transform changes every animation frame.
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
				position: 'relative',
				display: 'grid',
				placeItems: 'center',
				flex: '0 0 100%',
				width: '100%',
				height: '100%',
				transform: `translate3d(0, ${dismissY}px, 0)`,
				...style,
			}}
		>
			{children}
		</li>
	);
};

// #endregion

// #region image

export interface LightboxImageProps {
	index: number;
	className?: string;
	style?: CSSProperties;
}

/**
 * renders an image with engine-driven size and transform.
 *
 * @param props image properties.
 * @returns the image, or `null` for an invalid index.
 */
export const Image = ({ className, index, style }: LightboxImageProps) => {
	const { images, reportNaturalSize } = useLightbox();
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
			// size and transform can change every animation frame.
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
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
			onLoad={handleLoad}
		/>
	);
};

// #endregion
