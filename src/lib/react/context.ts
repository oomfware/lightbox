import { createContext, use, useSyncExternalStore } from 'react';

import type { LightboxEngine } from '../core/engine';
import type { LightboxConfig, LightboxState, Size } from '../core/types';

export interface LightboxImage {
	src: string;
	alt?: string;
	srcSet?: string;
	sizes?: string;
	/** optional natural dimensions; if omitted they're read from the loaded <img>. */
	width?: number;
	height?: number;
}

/**
 * the lightbox controller: the actions, configuration, and wiring the parts act
 * on. holds no live gesture state — read that with {@link useLightboxState} — so
 * a component reading the controller alone does not re-render per frame.
 */
export interface LightboxContextValue {
	images: LightboxImage[];
	config: LightboxConfig;
	// actions
	next: () => void;
	prev: () => void;
	goTo: (index: number) => void;
	close: () => void;
	// meta / internal wiring used by the parts
	engine: LightboxEngine;
	setViewportSize: (size: Size) => void;
	reportNaturalSize: (index: number, size: Size) => void;
}

export const LightboxContext = createContext<LightboxContextValue | null>(null);

/**
 * read the lightbox controller provided by `Lightbox.Root`.
 *
 * @returns the {@link LightboxContextValue}.
 * @throws if called outside a `<Lightbox.Root>`.
 */
export const useLightbox = (): LightboxContextValue => {
	const ctx = use(LightboxContext);
	if (!ctx) {
		throw new Error(`useLightbox must be used within <Lightbox.Root>`);
	}
	return ctx;
};

/**
 * subscribe to the live engine state, whole or sliced. with a selector the
 * caller re-renders only when the selected slice changes; the selector must
 * return a referentially stable value when its input is unchanged.
 *
 * @param selector optional picker for a slice of {@link LightboxState}.
 * @returns the full state, or the selected slice.
 */
export function useLightboxState(): LightboxState;
export function useLightboxState<T>(selector: (state: LightboxState) => T): T;
export function useLightboxState<T>(selector?: (state: LightboxState) => T): T | LightboxState {
	const { engine } = useLightbox();

	const get = () => (selector ? selector(engine.getState()) : engine.getState());

	return useSyncExternalStore(engine.subscribe, get, get);
}
