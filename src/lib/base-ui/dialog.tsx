import { Dialog } from '@base-ui/react/dialog';
import { type CSSProperties, type ReactNode, useCallback, useRef, useState } from 'react';

import type { LightboxConfig } from '../core/types.ts';
import { type LightboxImage, useLightboxState } from '../react/context.ts';
import { Provider } from '../react/provider.tsx';
import { Scrim } from '../react/scrim.tsx';
import { Viewport as GestureViewport, type LightboxViewportProps } from '../react/viewport.tsx';

// #region root

export interface LightboxDialogRootProps {
	children?: ReactNode;
	images: LightboxImage[];
	config?: Partial<LightboxConfig>;

	index?: number;
	defaultIndex?: number;
	onIndexChange?: (index: number) => void;

	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/**
 * renders the lightbox with Base UI dialog behavior.
 *
 * @param props dialog properties.
 * @returns the lightbox dialog root.
 */
export const Root = (props: LightboxDialogRootProps) => {
	const {
		children,
		images,
		config,
		index,
		defaultIndex,
		onIndexChange,
		open,
		defaultOpen = false,
		onOpenChange,
	} = props;

	const [openState, setOpenState] = useState(defaultOpen);
	const isOpen = open ?? openState;
	const handleOpenChange = useCallback(
		(next: boolean) => {
			onOpenChange?.(next);
			if (open === undefined) {
				setOpenState(next);
			}
		},
		[onOpenChange, open],
	);
	const handleDismiss = useCallback(() => handleOpenChange(false), [handleOpenChange]);

	return (
		<Provider
			images={images}
			config={config}
			index={index}
			defaultIndex={defaultIndex}
			active={isOpen}
			onIndexChange={onIndexChange}
			onDismiss={handleDismiss}
		>
			<Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
				{children}
			</Dialog.Root>
		</Provider>
	);
};

// #endregion

// #region viewport

const FULLSCREEN: CSSProperties = { position: 'fixed', inset: 0 };

/**
 * renders the gesture surface as a Base UI dialog popup.
 *
 * @param props viewport properties.
 * @returns the dialog viewport.
 */
export const Viewport = ({ children, ref: forwardedRef, style, ...rest }: LightboxViewportProps) => {
	const ref = useRef<HTMLDivElement>(null);
	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			ref.current = node;
			if (typeof forwardedRef === 'function') {
				const cleanup = forwardedRef(node);
				return () => {
					ref.current = null;
					if (typeof cleanup === 'function') {
						cleanup();
					} else {
						forwardedRef(null);
					}
				};
			}
			if (forwardedRef) {
				forwardedRef.current = node;
			}
			return () => {
				ref.current = null;
				if (forwardedRef) {
					forwardedRef.current = null;
				}
			};
		},
		[forwardedRef],
	);
	return (
		<Dialog.Popup
			initialFocus={ref}
			style={FULLSCREEN}
			render={
				// oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop
				<GestureViewport ref={setRefs} style={style} {...rest}>
					{children}
				</GestureViewport>
			}
		/>
	);
};

// #endregion

// #region backdrop

export interface LightboxDialogBackdropProps {
	className?: string;
	style?: CSSProperties;
}

/**
 * renders modal and gesture opacity as nested backdrop layers.
 *
 * @param props backdrop properties.
 * @returns the backdrop.
 */
export const Backdrop = ({ className, style }: LightboxDialogBackdropProps) => {
	const zoomed = useLightboxState((state) => state.isZoomed);
	return (
		<Dialog.Backdrop
			className={className}
			data-zoomed={zoomed ? '' : undefined}
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{ position: 'fixed', inset: 0, ...style }}
		>
			<Scrim />
		</Dialog.Backdrop>
	);
};

// #endregion

// #region exports

export const Close = Dialog.Close;
export const Description = Dialog.Description;
export const Portal = Dialog.Portal;
export const Title = Dialog.Title;
export const Trigger = Dialog.Trigger;

export { Image, Slide, Track } from '../react/track.tsx';
export { Scrim } from '../react/scrim.tsx';

// #endregion
