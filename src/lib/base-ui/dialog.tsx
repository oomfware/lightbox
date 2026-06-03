import { Dialog } from '@base-ui/react/dialog';
import { type CSSProperties, type ReactNode, useCallback, useRef, useState } from 'react';

import type { LightboxConfig } from '../core/types';
import { type LightboxImage, useLightboxState } from '../react/context';
import { Provider } from '../react/provider';
import { Scrim } from '../react/scrim';
import { Viewport as GestureViewport, type LightboxViewportProps } from '../react/viewport';

export interface LightboxDialogRootProps {
	children?: ReactNode;
	config?: Partial<LightboxConfig>;
	defaultIndex?: number;
	/** uncontrolled initial open state. */
	defaultOpen?: boolean;
	images: LightboxImage[];
	/** controlled active index. */
	index?: number;
	onIndexChange?: (index: number) => void;
	onOpenChange?: (open: boolean) => void;
	/** controlled open state. */
	open?: boolean;
}

/**
 * batteries-included preset: wires the dialog-agnostic {@link Provider} into a
 * Base UI `Dialog.Root`, so you get focus trapping, `aria-modal`,
 * Escape-to-close, scroll locking, and focus restoration for free. drop-in
 * replacement for hand-rolling the modal shell.
 *
 * @param props see {@link LightboxDialogRootProps}.
 */
export const Root = (props: LightboxDialogRootProps) => {
	const {
		children,
		config,
		defaultIndex,
		defaultOpen = false,
		images,
		index,
		onIndexChange,
		onOpenChange,
		open,
	} = props;

	// mirror open so the Provider gets an activation signal even when uncontrolled.
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
			active={isOpen}
			config={config}
			defaultIndex={defaultIndex}
			images={images}
			index={index}
			onDismiss={handleDismiss}
			onIndexChange={onIndexChange}
		>
			<Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
				{children}
			</Dialog.Root>
		</Provider>
	);
};

const FULLSCREEN: CSSProperties = { position: 'fixed', inset: 0 };

/**
 * the gesture surface as a Base UI `Dialog.Popup`: a single element that is both
 * the focus-trapped, `aria-modal` popup *and* the lightbox gesture surface
 * (composed via Base UI's `render` prop). fullscreen by default; initial focus
 * lands here so arrow-key paging works immediately.
 *
 * @param props see {@link LightboxViewportProps}.
 */
export const Viewport = ({ children, style, ...rest }: LightboxViewportProps) => {
	const ref = useRef<HTMLDivElement>(null);
	return (
		<Dialog.Popup
			initialFocus={ref}
			// the preset re-adds the fullscreen positioning the primitive shed; the
			// caller's own `style` still wins via the gesture surface below.
			style={FULLSCREEN}
			// Base UI's `render` composition: the gesture surface IS the popup
			// element, so it carries both the open/close and the gesture attrs.
			render={
				// oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop
				<GestureViewport ref={ref} style={style} {...rest}>
					{children}
				</GestureViewport>
			}
		/>
	);
};

export interface LightboxDialogBackdropProps {
	className?: string;
	style?: CSSProperties;
}

/**
 * the modal backdrop: an outer `Dialog.Backdrop` carrying the open/close fade
 * (Base UI's `[data-starting-style]`/`[data-ending-style]`) with the engine's
 * live gesture {@link Scrim} nested inside, so the two opacities multiply rather
 * than fight. recolor via the `--lightbox-backdrop` CSS variable.
 *
 * @param props see {@link LightboxDialogBackdropProps}.
 */
export const Backdrop = ({ className, style }: LightboxDialogBackdropProps) => {
	const zoomed = useLightboxState((state) => state.isZoomed);
	return (
		<Dialog.Backdrop
			className={className}
			data-zoomed={zoomed ? '' : undefined}
			// merges the caller's `style`, so a fresh object is unavoidable
			// oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
			style={{ position: 'fixed', inset: 0, ...style }}
		>
			<Scrim />
		</Dialog.Backdrop>
	);
};

// Base UI Dialog parts that need no lightbox wiring.
export const Close = Dialog.Close;
export const Description = Dialog.Description;
export const Portal = Dialog.Portal;
export const Title = Dialog.Title;
export const Trigger = Dialog.Trigger;

// primitive parts that work unchanged inside the preset.
export { Image, Slide, Track } from '../react/track';
export { Scrim } from '../react/scrim';
