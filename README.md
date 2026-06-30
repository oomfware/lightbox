# @oomfware/lightbox

headless React image lightbox.

```sh
npm install @oomfware/lightbox
```

## usage

### quick start (Base UI preset)

the preset is the fastest way to a working, accessible lightbox. `Root` takes the image list and the
open state; the parts below it compose into the modal:

```tsx
import { LightboxDialog as Lightbox, type LightboxImage } from '@oomfware/lightbox/base-ui';
import { useState } from 'react';

const images: LightboxImage[] = [
	{ src: '/photos/river.jpg', alt: 'River between cliffs', width: 1200, height: 1600 },
	{ src: '/photos/pug.jpg', alt: 'Pug in a blanket', width: 1600, height: 1067 },
];

function Gallery() {
	const [open, setOpen] = useState(false);
	const [index, setIndex] = useState(0);

	const openAt = (i: number) => {
		setIndex(i);
		setOpen(true);
	};

	return (
		<>
			{images.map((img, i) => (
				<button key={img.src} onClick={() => openAt(i)}>
					<img src={img.src} alt={img.alt} />
				</button>
			))}

			<Lightbox.Root
				images={images}
				open={open}
				onOpenChange={setOpen}
				index={index}
				onIndexChange={setIndex}
			>
				<Lightbox.Portal>
					<Lightbox.Backdrop className="lb-backdrop" />
					<Lightbox.Viewport className="lb-viewport">
						<Lightbox.Title className="sr-only">Image viewer</Lightbox.Title>
						<Lightbox.Track />
						<Lightbox.Close className="lb-close" aria-label="Close">
							✕
						</Lightbox.Close>
					</Lightbox.Viewport>
				</Lightbox.Portal>
			</Lightbox.Root>
		</>
	);
}
```

`Track` renders one `Slide` containing one `Image` per entry by default, so the example above is a
complete, gesture-enabled viewer. everything visual — sizing, the backdrop color, the close button —
is yours to style.

> [!NOTE]  
> the gesture parts (`Track`, `Slide`, `Image`, `Scrim`, `Close`) come from the primitive and work
> unchanged inside the preset. only the modal shell — `Root`, `Viewport`, `Backdrop`, `Portal`,
> `Title`, `Description`, `Trigger` — is Base-UI-specific.

### the headless primitive

the primitive has no dialog at all: mount `Provider` + `Viewport` wherever you like. this embeds a
fully interactive viewer directly in the page — no modal, portal, focus trap, or backdrop:

```tsx
import { Lightbox } from '@oomfware/lightbox';
import { useState } from 'react';

function InlineViewer() {
	const [index, setIndex] = useState(0);

	return (
		<Lightbox.Provider images={images} index={index} onIndexChange={setIndex}>
			<div style={{ width: 600, height: 400 }}>
				<Lightbox.Viewport>
					<Lightbox.Track />
				</Lightbox.Viewport>
			</div>
		</Lightbox.Provider>
	);
}
```

the same primitive powers a custom modal: render `Provider` + `Viewport` inside your own overlay and
wire `onDismiss` to your close logic. the `Viewport` is _not_ a modal — it adds no focus trap,
`aria-modal`, or Escape handling, so the wrapping shell owns those (this is exactly what the Base UI
preset does for you).

### gestures

the engine arbitrates between four gestures by scale and axis:

- **zoom** — pinch (touch), double-tap / double-click, or ctrl-scroll (trackpad pinch). zoom is
  relative to the fitted size, so `scale: 1` always means "fit to viewport".
- **pan** — drag a zoomed image; over-drag past the bounds rubber-bands back.
- **page** — drag sideways on a non-zoomed image, or press the arrow keys, to move between images. a
  fast flick flings to the next page regardless of distance.
- **dismiss** — swipe up or down (touch) past the threshold to fire `onDismiss`; the backdrop fades
  proportionally as you pull.

### styling

the parts emit data attributes and a CSS variable so you can style every gesture state from your own
stylesheet without reading any JS:

| selector                          | meaning                                             |
| --------------------------------- | --------------------------------------------------- |
| `[data-zoomed]` on the viewport   | the active image is zoomed beyond fit               |
| `[data-dragging]` on the viewport | a single-pointer or pinch gesture is in flight      |
| `[data-pinching]` on the viewport | a two-pointer pinch is in flight                    |
| `[data-active]` on a slide        | this slide is the current page                      |
| `--lightbox-backdrop`             | scrim / backdrop color (default `rgba(0,0,0,0.96)`) |

the `Scrim` (nested inside the preset's `Backdrop`) carries the live swipe-to-dismiss fade; it is
_only_ the gesture-coupled layer, so the modal's open/close transition stays the dialog's concern
and the two opacities multiply rather than fight.

### configuration

pass a partial `config` to `Provider` / `Root` to tune behavior. dropping a key reverts it to its
default — overrides are merged over `DEFAULT_CONFIG`, never retained:

```tsx
<Lightbox.Provider images={images} config={{ loop: true, maxScale: 6, doubleTapScale: 3 }}>
	{/* ... */}
</Lightbox.Provider>
```

| option                  | default | description                                                               |
| ----------------------- | ------- | ------------------------------------------------------------------------- |
| `axisLockPx`            | `10`    | horizontal travel (px) at which a non-zoomed drag locks to an axis        |
| `closeOnBackdropClick`  | `true`  | close on a mouse/pen click off the image (touch taps are left to you)     |
| `dismissFadeDistancePx` | `400`   | distance (px) over which the backdrop fully fades during a dismiss pull   |
| `dismissThresholdPx`    | `50`    | vertical travel (px) past which release dismisses                         |
| `dismissVelocity`       | `700`   | release velocity (px/s) that dismisses regardless of distance             |
| `doubleTapScale`        | `2.5`   | scale applied by a double-tap / double-click toggle                       |
| `loop`                  | `false` | wrap the carousel from last → first and back                              |
| `maxScale`              | `4`     | max zoom relative to fitted size                                          |
| `minCoverage`           | `0.5`   | rest-fit policy for images smaller than the viewport (see below)          |
| `minScale`              | `1`     | min zoom before snap-back to 1                                            |
| `overpanInsets`         | all `0` | per-edge gap a zoomed image can be panned past the viewport (see below)   |
| `pageFlingVelocity`     | `500`   | release velocity (px/s) that flips a page regardless of distance          |
| `pageThresholdRatio`    | `0.2`   | fraction of viewport width a page drag must cross to advance              |
| `rubberBand`            | `0.55`  | rubber-band tension for over-drag past bounds/ends (0–1, lower = stiffer) |

#### `minCoverage` — the rest-fit policy

images larger than the viewport are always downscaled to fit. `minCoverage` decides what happens to
images _smaller_ than the viewport — the minimum fraction of the viewport's binding dimension a
resting image must cover:

- `1` → always fit to viewport (force-upscale small images; "contain")
- `0` → never upscale (small images shown at natural 1:1 size)
- `0.5` → natural size, but bump genuinely tiny images up to 50% coverage

user zoom (double-tap / pinch / wheel) is unaffected by this policy.

#### `overpanInsets` — breathing room past the edges

every other option is a scalar; this one is a per-edge `Insets` object
(`{ top, right, bottom, left }` in px, defaulting to all `0`). by default a zoomed image stops with
its edge flush against the viewport edge. a positive inset lets the pan continue that much further,
so a gap opens between the two — `bottom: 80`, say, to clear a toolbar. it applies per axis only
where the image overflows the viewport; a letterboxed axis already shows a gap, so it's left
centered.

all four edges are required — spread the exported `NO_INSETS` to fill the ones you don't set:

```tsx
<Lightbox.Provider images={images} config={{ overpanInsets: { ...NO_INSETS, bottom: 80 } }}>
	{/* ... */}
</Lightbox.Provider>
```

### custom slides and chrome

`Track` accepts a render function to customize each slide — add a caption, a loading skeleton, or
anything else alongside the `Image`:

```tsx
<Lightbox.Track>
	{(image, i) => (
		<Lightbox.Slide key={image.src} index={i}>
			<Lightbox.Image index={i} />
			<figcaption>{image.alt}</figcaption>
		</Lightbox.Slide>
	)}
</Lightbox.Track>
```

overlay chrome (counters, nav arrows, captions) reads live state through two hooks. `useLightbox`
returns the controller — the actions and config, with no per-frame state, so a component reading it
alone does not re-render every frame:

```tsx
import { useLightbox, useLightboxState } from '@oomfware/lightbox';

function Counter() {
	const { images, next, prev } = useLightbox();
	const index = useLightboxState((state) => state.index);

	return (
		<div>
			<button onClick={prev} disabled={index === 0}>
				‹
			</button>
			{index + 1} / {images.length}
			<button onClick={next} disabled={index === images.length - 1}>
				›
			</button>
		</div>
	);
}
```

`useLightboxState` subscribes to the live engine state. pass a selector to re-render only when the
slice you care about changes — the selector must return a referentially stable value when its input
is unchanged:

```tsx
const isZoomed = useLightboxState((state) => state.isZoomed);
const dismissY = useLightboxState((state) => state.dismissY);

// or read the whole snapshot (re-renders every frame a gesture is live)
const state = useLightboxState();
```

### handling taps

`Viewport` exposes an `onTap` hook — a pointerdown→up with no drag or pinch — so you can build
app-level behaviors the headless core stays out of, like toggling chrome visibility on touch:

```tsx
<Lightbox.Viewport
	onTap={(info) => {
		// info.onImage: did the tap land on the image (vs. the backdrop / chrome)?
		// info.pointerType: 'mouse' | 'touch' | 'pen'
		if (info.pointerType === 'touch') {
			setChromeHidden((hidden) => !hidden);
		}
	}}
>
	{/* ... */}
</Lightbox.Viewport>
```

note that the first tap of a double-tap-to-zoom also fires `onTap`, so debounce if that matters.

### the core engine

for a fully custom renderer (a different framework, a canvas, a `<video>` carousel), drive
`LightboxEngine` directly. it is framework-agnostic — plain numbers in, a state snapshot out — and
is what the React layer is built on:

```ts
import { LightboxEngine } from '@oomfware/lightbox';

const engine = new LightboxEngine({ index: 0, config: { loop: true } });

engine.setGeometry(viewportSize, imageCount, naturalSizes);
const unsubscribe = engine.subscribe(() => render(engine.getState()));

// feed it pointer / wheel input, then read state.transforms / state.trackX each frame
engine.pointerDown(pointerId, x, y);

// release the rAF loop and subscribers when you're done
engine.destroy();
```
