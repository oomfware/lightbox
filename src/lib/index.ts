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

export {
	type LightboxContextValue,
	type LightboxImage,
	useLightbox,
	useLightboxState,
} from './react/context.ts';

export { type EngineOptions, LightboxEngine } from './core/engine.ts';
export {
	DEFAULT_CONFIG,
	type DragMode,
	IDENTITY,
	type Insets,
	type LightboxConfig,
	type LightboxState,
	NO_INSETS,
	type Point,
	type Size,
	type Transform,
} from './core/types.ts';
