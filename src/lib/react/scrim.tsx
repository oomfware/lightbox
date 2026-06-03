import type { CSSProperties } from 'react';

import { useLightboxState } from './context';

export interface LightboxScrimProps {
	className?: string;
	style?: CSSProperties;
}

/**
 * the engine-driven dimming layer: carries the live swipe-to-dismiss fade
 * (`state.backdropOpacity`). it is *only* the gesture-coupled layer — it does
 * not provide the open/close transition. nest it inside whatever backdrop your
 * modal renders so the two opacities multiply rather than fight:
 *
 * ```tsx
 * <Dialog.Backdrop>     // open/close fade, the modal's concern
 *   <Lightbox.Scrim />  // gesture fade, ours
 * </Dialog.Backdrop>
 * ```
 *
 * fills its positioned parent; recolor via the `--lightbox-backdrop` CSS var.
 *
 * @param props see {@link LightboxScrimProps}.
 */
export const Scrim = ({ className, style }: LightboxScrimProps) => {
	const opacity = useLightboxState((state) => state.backdropOpacity);
	const zoomed = useLightboxState((state) => state.isZoomed);
	return (
		<div
			className={className}
			data-zoomed={zoomed ? '' : undefined}
			// carries the engine's live dismiss opacity; new every frame by design
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
