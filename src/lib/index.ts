// public API for the headless lightbox primitive (dialog-agnostic, no Base UI).

import { Close, type LightboxCloseProps } from './react/close.tsx';
import { type LightboxProviderProps, Provider } from './react/provider.tsx';
import { type LightboxScrimProps, Scrim } from './react/scrim.tsx';
import {
	Image,
	type LightboxImageProps,
	type LightboxSlideProps,
	type LightboxTrackProps,
	Slide,
	Track,
} from './react/track.tsx';
import { type LightboxTapInfo, type LightboxViewportProps, Viewport } from './react/viewport.tsx';

/** compound-component namespace bundling the primitive parts under one import. */
export const Lightbox = {
	Close,
	Image,
	Provider,
	Scrim,
	Slide,
	Track,
	Viewport,
};

export {
	Close,
	Image,
	type LightboxCloseProps,
	type LightboxImageProps,
	type LightboxProviderProps,
	type LightboxScrimProps,
	type LightboxSlideProps,
	type LightboxTapInfo,
	type LightboxTrackProps,
	type LightboxViewportProps,
	Provider,
	Scrim,
	Slide,
	Track,
	Viewport,
};

// hook + context types for advanced/headless usage.
export {
	type LightboxContextValue,
	type LightboxImage,
	useLightbox,
	useLightboxState,
} from './react/context.ts';

// core engine + types for fully custom renderers.
export { type EngineOptions, LightboxEngine } from './core/engine.ts';
export {
	DEFAULT_CONFIG,
	type DragMode,
	IDENTITY,
	type LightboxConfig,
	type LightboxState,
	type Point,
	type Size,
	type Transform,
} from './core/types.ts';
