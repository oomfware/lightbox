// public API for the Base UI Dialog preset (accessible, batteries-included).

import {
	Backdrop,
	Close,
	Description,
	Image,
	Portal,
	Root,
	Scrim,
	Slide,
	Title,
	Track,
	Trigger,
	Viewport,
} from './base-ui/dialog.tsx';

/** compound-component namespace bundling the Base UI preset parts. */
export const LightboxDialog = {
	Backdrop,
	Close,
	Description,
	Image,
	Portal,
	Root,
	Scrim,
	Slide,
	Title,
	Track,
	Trigger,
	Viewport,
};

export {
	Backdrop,
	Close,
	Description,
	Image,
	type LightboxDialogBackdropProps,
	type LightboxDialogRootProps,
	Portal,
	Root,
	Scrim,
	Slide,
	Title,
	Track,
	Trigger,
	Viewport,
} from './base-ui/dialog.tsx';

// shared primitive utilities a preset consumer also needs.
export {
	type LightboxContextValue,
	type LightboxImage,
	useLightbox,
	useLightboxState,
} from './react/context.ts';
export { type LightboxScrimProps } from './react/scrim.tsx';
export { type LightboxImageProps, type LightboxSlideProps, type LightboxTrackProps } from './react/track.tsx';
export { type LightboxTapInfo, type LightboxViewportProps } from './react/viewport.tsx';
export { type LightboxConfig, type LightboxState } from './core/types.ts';
