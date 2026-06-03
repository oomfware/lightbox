/**
 * zero-dependency physics: a damped-spring channel, inertial decay
 * projection, and iOS-style rubber-banding. all lightbox animation is
 * driven imperatively in JS (every layer reports
 * `transition-duration: 0s`) with springs instead of fixed CSS easings.
 */

export interface SpringConfig {
	stiffness: number;
	damping: number;
	mass: number;
	/** velocity (px/s) below which, near target, the spring is considered at rest. */
	restVelocity: number;
	/** distance (px) from target below which, when slow, the spring rests. */
	restDistance: number;
}

export const SPRING: Record<'default' | 'gentle' | 'scale' | 'stiff', SpringConfig> = {
	default: { stiffness: 220, damping: 30, mass: 1, restVelocity: 0.5, restDistance: 0.5 },
	gentle: { stiffness: 140, damping: 26, mass: 1, restVelocity: 0.4, restDistance: 0.4 },
	// same dynamics as `default`, but the rest thresholds live in scale-factor
	// units, not px: the other channels translate (where snapping the last 0.5px
	// is invisible), whereas this one drives `scale`, where 0.5 is ~half the
	// image — resting that early snaps the final frames into a visible pop. the
	// thresholds are sized so the leftover jump stays sub-pixel on a viewport-
	// sized image.
	scale: { stiffness: 220, damping: 30, mass: 1, restVelocity: 0.01, restDistance: 0.001 },
	stiff: { stiffness: 400, damping: 36, mass: 1, restVelocity: 0.5, restDistance: 0.5 },
};

/**
 * a single animated scalar. holds live `value` + `velocity`; you either drive
 * it directly during a gesture (`set`) or hand it a `target` and `step` it each
 * frame until `atRest`. velocity carries over from gesture to release so flings
 * feel continuous.
 */
export class Spring {
	value: number;
	velocity = 0;
	target: number;
	config: SpringConfig;
	#animating = false;

	constructor(value = 0, config: SpringConfig = SPRING.default) {
		this.value = value;
		this.target = value;
		this.config = config;
	}

	/**
	 * hard-set the value, cancelling any motion.
	 *
	 * @param value new resting value.
	 */
	set(value: number): void {
		this.value = value;
		this.target = value;
		this.velocity = 0;
		this.#animating = false;
	}

	/**
	 * begin springing toward a target.
	 *
	 * @param target value to settle at.
	 * @param velocity initial velocity (px/s) to seed; preserves the current velocity when omitted.
	 * @param config spring constants to switch to; keeps the current config when omitted.
	 */
	animateTo(target: number, velocity?: number, config?: SpringConfig): void {
		this.target = target;
		if (velocity !== undefined) {
			this.velocity = velocity;
		}
		if (config) {
			this.config = config;
		}
		this.#animating = true;
	}

	/** whether the spring is currently settling toward its target. */
	get isAnimating(): boolean {
		return this.#animating;
	}

	/**
	 * advance the simulation by one frame (semi-implicit Euler).
	 *
	 * @param dt elapsed seconds; clamped to avoid instability on long frame gaps.
	 * @returns whether the spring is still moving.
	 */
	step(dt: number): boolean {
		if (!this.#animating) {
			return false;
		}
		const h = Math.min(dt, 1 / 30);
		const { stiffness, damping, mass, restVelocity, restDistance } = this.config;

		const springForce = -stiffness * (this.value - this.target);
		const dampingForce = -damping * this.velocity;
		const accel = (springForce + dampingForce) / mass;

		this.velocity += accel * h;
		this.value += this.velocity * h;

		if (Math.abs(this.velocity) < restVelocity && Math.abs(this.value - this.target) < restDistance) {
			this.value = this.target;
			this.velocity = 0;
			this.#animating = false;
			return false;
		}
		return true;
	}
}

/**
 * constrain a value to a closed range.
 *
 * @param v value to constrain.
 * @param min lower bound.
 * @param max upper bound.
 * @returns `v` clamped to `[min, max]`.
 */
export const clamp = (v: number, min: number, max: number): number => {
	return v < min ? min : v > max ? max : v;
};

/**
 * project where momentum would carry a flick if left to friction; used to pick
 * the settle target (then we spring there, clamped to bounds).
 *
 * @param velocity release velocity in px/s.
 * @param friction per-frame velocity retention at ~60fps.
 * @returns offset from the current position the flick would reach.
 */
export const projectDecay = (velocity: number, friction = 0.92): number => {
	// sum of a geometric series of per-frame velocity decay at ~60fps.
	return (velocity * friction) / (1 - friction) / 60;
};

/**
 * iOS-style rubber-band resistance.
 *
 * @param overflow how far past the bound the drag has gone, in px.
 * @param dimension the relevant viewport extent in px, governing how quickly resistance ramps.
 * @param constant tension factor (0–1, lower = stiffer).
 * @returns the damped visual offset to apply past the bound.
 */
export const rubberBand = (overflow: number, dimension: number, constant = 0.55): number => {
	if (overflow === 0 || dimension === 0) {
		return overflow;
	}
	const sign = Math.sign(overflow);
	const abs = Math.abs(overflow);
	return sign * (1 - 1 / (abs / dimension / constant + 1)) * dimension;
};

/**
 * apply rubber-banding only to the part of a value that exceeds `[min, max]`;
 * within bounds it is returned untouched.
 *
 * @param value value to constrain.
 * @param min lower bound.
 * @param max upper bound.
 * @param dimension the relevant viewport extent in px, governing resistance ramp past a bound.
 * @param constant tension factor (0–1, lower = stiffer).
 * @returns `value` within bounds, else the bound plus a damped overflow.
 */
export const clampRubber = (
	value: number,
	min: number,
	max: number,
	dimension: number,
	constant = 0.55,
): number => {
	if (value < min) {
		return min + rubberBand(value - min, dimension, constant);
	}
	if (value > max) {
		return max + rubberBand(value - max, dimension, constant);
	}
	return value;
};
