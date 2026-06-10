import { useMemo, useRef, useState } from 'react';

import { Lightbox as Inline } from './lib/index.ts';
import {
	LightboxDialog as Lightbox,
	type LightboxImage,
	type LightboxTapInfo,
	useLightbox,
	useLightboxState,
} from './lib/base-ui.ts';
import './app.css';

// Mixed orientations AND sizes: the big ones exercise zoom/pan + paging; the
// small/tiny ones demonstrate the rest-fit policy (we don't force-upscale a
// small image, but a genuinely tiny one still gets bumped up to stay visible).
const IMAGES: LightboxImage[] = [
	{ src: 'https://picsum.photos/id/1015/1200/1600', alt: 'River between cliffs', width: 1200, height: 1600 },
	{ src: 'https://picsum.photos/id/1025/1600/1067', alt: 'Pug in a blanket', width: 1600, height: 1067 },
	{ src: 'https://picsum.photos/id/1039/1600/1067', alt: 'Waterfall valley', width: 1600, height: 1067 },
	{ src: 'https://picsum.photos/id/237/640/426', alt: 'Small photo (640×426)', width: 640, height: 426 },
	{ src: 'https://picsum.photos/id/24/96/96', alt: 'Tiny photo (96×96)', width: 96, height: 96 },
];

const thumb = (src: string) => src.replace(/\/\d+\/\d+$/, '/400/400');

// Three fit policies, mapped to the engine's `minCoverage` config.
const FIT_MODES = [
	{ key: 'natural', label: 'Natural (0)', minCoverage: 0, hint: 'small images shown 1:1' },
	{ key: 'smart', label: 'Smart (0.5)', minCoverage: 0.5, hint: 'tiny images bumped to 50%' },
	{ key: 'fill', label: 'Fill (1)', minCoverage: 1, hint: 'always fit to viewport' },
] as const;

/** Counter + prev/next arrows (chrome that reads lightbox state). */
function Controls({ chromeCls }: { chromeCls: string }) {
	const { images, next, prev } = useLightbox();
	const index = useLightboxState((s) => s.index);
	return (
		<>
			<div className={`lb-counter ${chromeCls}`}>
				{index + 1} / {images.length}
			</div>
			{index > 0 && (
				<button className={`lb-nav lb-prev ${chromeCls}`} aria-label="Previous image" onClick={prev}>
					‹
				</button>
			)}
			{index < images.length - 1 && (
				<button className={`lb-nav lb-next ${chromeCls}`} aria-label="Next image" onClick={next}>
					›
				</button>
			)}
		</>
	);
}

/** Caption that reports what the fit policy did to this image. */
function Caption({ index, image, chromeCls }: { index: number; image: LightboxImage; chromeCls: string }) {
	const fit = useLightboxState((s) => s.fittedSizes[index]);
	const nat = image.width;
	let note = '';
	if (nat && fit?.width) {
		const ratio = fit.width / nat;
		if (ratio > 1.01) {
			note = `upscaled ×${ratio.toFixed(2)} to stay visible`;
		} else if (ratio < 0.99) {
			note = 'downscaled to fit viewport';
		} else {
			note = 'shown at natural size (×1)';
		}
	}
	return (
		<figcaption className={`lb-cap ${chromeCls}`}>
			{image.width}×{image.height} — {note}
		</figcaption>
	);
}

/** Prev/next + counter for the inline demo, reading the same hook as any chrome. */
function InlineControls() {
	const { images, next, prev } = useLightbox();
	const index = useLightboxState((s) => s.index);
	return (
		<div className="inline-controls">
			<button onClick={prev} disabled={index === 0} aria-label="Previous image">
				‹
			</button>
			<span>
				{index + 1} / {images.length}
			</span>
			<button onClick={next} disabled={index === images.length - 1} aria-label="Next image">
				›
			</button>
		</div>
	);
}

/**
 * The same engine + gesture parts, mounted *inline* with no dialog at all —
 * `Lightbox.Provider` + `Lightbox.Viewport` straight in the page. Proof the
 * primitive is dialog-agnostic: there's no modal, portal, focus trap, or
 * backdrop here. (Swipe-to-dismiss is disabled — nothing to dismiss to inline.)
 */
function InlineDemo() {
	const [index, setIndex] = useState(0);
	// stable config object so the engine only re-applies it once.
	const config = useMemo(
		() => ({ closeOnBackdropClick: false, dismissThresholdPx: Infinity, dismissVelocity: Infinity }),
		[],
	);
	return (
		<section className="inline-demo" aria-label="Inline lightbox (no dialog)">
			<h2>Embedded directly — no dialog</h2>
			<p>
				Mounted inline via <code>Lightbox.Provider</code> + <code>Lightbox.Viewport</code> from{' '}
				<code>@oomfware/lightbox</code> (no Base UI). Drag to page, double-click / ctrl-scroll to zoom, drag
				to pan, or use the arrows.
			</p>
			<Inline.Provider images={IMAGES} index={index} onIndexChange={setIndex} config={config}>
				<div className="inline-stage">
					<Inline.Viewport className="inline-viewport">
						<Inline.Track />
					</Inline.Viewport>
				</div>
				<InlineControls />
			</Inline.Provider>
		</section>
	);
}

export default function App() {
	const [open, setOpen] = useState(false);
	const [index, setIndex] = useState(0);
	const [minCoverage, setMinCoverage] = useState(0.5);
	const [chromeHidden, setChromeHidden] = useState(false);

	// Memoize so the engine only re-applies config when the policy actually changes.
	const config = useMemo(() => ({ minCoverage }), [minCoverage]);

	const openAt = (i: number) => {
		setIndex(i);
		setChromeHidden(false);
		setOpen(true);
	};

	// Tap-to-toggle-chrome built on the Viewport's onTap hook. We debounce so the
	// first tap of a double-tap-to-zoom doesn't also flip the chrome.
	const tapTimer = useRef<number | null>(null);
	const lastTap = useRef(0);
	const handleTap = (t: LightboxTapInfo) => {
		// Mouse/pen clicks on the backdrop already close (closeOnBackdropClick);
		// only toggle on touch taps, or on taps that land on the image.
		if (t.pointerType !== 'touch' && !t.onImage) {
			return;
		}
		const now = Date.now();
		if (now - lastTap.current < 300) {
			if (tapTimer.current) {
				window.clearTimeout(tapTimer.current);
			}
			tapTimer.current = null;
			lastTap.current = 0;
			return; // second tap → let the engine zoom
		}
		lastTap.current = now;
		tapTimer.current = window.setTimeout(() => {
			setChromeHidden((h) => !h);
			tapTimer.current = null;
		}, 280);
	};

	const chromeCls = chromeHidden ? 'lb-chrome lb-chrome--hidden' : 'lb-chrome';

	return (
		<main className="page">
			<header className="masthead">
				<h1>Headless Lightbox</h1>
				<p>
					A touch-friendly image viewer. Click a photo, then{' '}
					<strong>pinch / double-tap / ctrl-scroll to zoom</strong>, <strong>drag to pan</strong>,{' '}
					<strong>swipe sideways</strong> to page, and <strong>swipe up/down</strong> (touch) to dismiss.
				</p>
				<p className="fit-hint">
					Open the last two images (small 640×426 &amp; tiny 96×96) and use the{' '}
					<strong>fit-policy switch (top-left)</strong> to see how small images are handled — natural size by
					default, never force-upscaled. <strong>Tap the image</strong> (or backdrop on touch) to hide/show
					the chrome; click the backdrop with a mouse to close.
				</p>
			</header>

			<section className="gallery" aria-label="Photo gallery">
				{IMAGES.map((img, i) => (
					<button key={img.src} className="tile" onClick={() => openAt(i)}>
						<img src={thumb(img.src)} alt={img.alt} loading="lazy" />
					</button>
				))}
			</section>

			<InlineDemo />

			<Lightbox.Root
				images={IMAGES}
				open={open}
				onOpenChange={setOpen}
				index={index}
				onIndexChange={setIndex}
				config={config}
			>
				<Lightbox.Portal>
					<Lightbox.Backdrop className="lb-backdrop" />
					<Lightbox.Viewport className="lb-viewport" onTap={handleTap}>
						<Lightbox.Title className="sr-only">Image viewer</Lightbox.Title>
						<div className={`lb-fit seg ${chromeCls}`} role="group" aria-label="Fit policy">
							{FIT_MODES.map((m) => (
								<button
									key={m.key}
									className="seg-btn"
									aria-pressed={minCoverage === m.minCoverage}
									title={m.hint}
									onClick={() => setMinCoverage(m.minCoverage)}
								>
									{m.label}
								</button>
							))}
						</div>
						<Lightbox.Track>
							{(image, i) => (
								<Lightbox.Slide key={i} index={i}>
									<Lightbox.Image index={i} />
									<Caption index={i} image={image} chromeCls={chromeCls} />
								</Lightbox.Slide>
							)}
						</Lightbox.Track>
						<Lightbox.Close className={`lb-close ${chromeCls}`} aria-label="Close">
							✕
						</Lightbox.Close>
						<Controls chromeCls={chromeCls} />
					</Lightbox.Viewport>
				</Lightbox.Portal>
			</Lightbox.Root>
		</main>
	);
}
