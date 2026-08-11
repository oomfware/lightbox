import type { CSSProperties } from 'react';

import { useLightboxState } from './context.ts';

export interface LightboxScrimProps {
	className?: string;
	style?: CSSProperties;
}

/**
 * renders the gesture-driven backdrop fade.
 *
 * @param props scrim properties.
 * @returns the scrim.
 */
export const Scrim = ({ className, style }: LightboxScrimProps) => {
	const opacity = useLightboxState((state) => state.backdropOpacity);
	const zoomed = useLightboxState((state) => state.isZoomed);
	return (
		<div
			className={className}
			data-zoomed={zoomed ? '' : undefined}
			// opacity changes every animation frame.
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{
				position: 'absolute',
				inset: 0,
				background: 'var(--lightbox-backdrop, rgba(0, 0, 0, 0.96))',
				opacity,
				...style,
			}}
		/>
	);
};
