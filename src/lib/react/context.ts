import { createContext, use, useSyncExternalStore } from 'react';

import type { LightboxEngine } from '../core/engine.ts';
import type { LightboxConfig, LightboxState, Size } from '../core/types.ts';

/** an image displayed by the lightbox. */
export interface LightboxImage {
	src: string;
	alt?: string;
	srcSet?: string;
	sizes?: string;
	width?: number;
	height?: number;
}

/** controller and internal wiring for lightbox parts. */
export interface LightboxContextValue {
	images: LightboxImage[];
	config: LightboxConfig;

	next: () => void;
	prev: () => void;
	goTo: (index: number) => void;
	close: () => void;

	engine: LightboxEngine;
	reportNaturalSize: (index: number, size: Size) => void;
	setViewportSize: (size: Size) => void;
}

export const LightboxContext = createContext<LightboxContextValue | null>(null);

/**
 * reads the current lightbox controller.
 *
 * @returns the controller.
 * @throws when used outside a lightbox provider.
 */
export const useLightbox = (): LightboxContextValue => {
	const ctx = use(LightboxContext);
	if (!ctx) {
		throw new Error(`useLightbox must be used within <Lightbox.Root>`);
	}
	return ctx;
};

/**
 * subscribes to the full engine state or a stable selected value.
 *
 * @param selector optional picker for a slice of {@link LightboxState}.
 * @returns the full state, or the selected slice.
 */
export function useLightboxState(): LightboxState;
export function useLightboxState<T>(selector: (state: LightboxState) => T): T;
export function useLightboxState<T>(selector?: (state: LightboxState) => T): T | LightboxState {
	const { engine } = useLightbox();

	const get = () => {
		const state = engine.getState();
		return selector ? selector(state) : state;
	};

	return useSyncExternalStore(engine.subscribe, get, get);
}
