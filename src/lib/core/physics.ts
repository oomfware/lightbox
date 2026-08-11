// #region spring

export interface SpringConfig {
	stiffness: number;
	damping: number;
	mass: number;
	restVelocity: number;
	restDistance: number;
}

export const SPRING: Record<'default' | 'gentle' | 'scale' | 'stiff', SpringConfig> = {
	default: { stiffness: 220, damping: 30, mass: 1, restVelocity: 0.5, restDistance: 0.5 },
	gentle: { stiffness: 140, damping: 26, mass: 1, restVelocity: 0.4, restDistance: 0.4 },
	// scale needs tighter unitless thresholds to prevent a visible final snap.
	scale: { stiffness: 220, damping: 30, mass: 1, restVelocity: 0.01, restDistance: 0.001 },
	stiff: { stiffness: 400, damping: 36, mass: 1, restVelocity: 0.5, restDistance: 0.5 },
};

interface SpringAnimationOptions {
	velocity?: number;
	config?: SpringConfig;
}

/** an animated scalar with spring velocity. */
export class Spring {
	value: number;
	velocity = 0;
	target: number;
	config: SpringConfig;
	#animating = false;

	constructor(value: number, config: SpringConfig = SPRING.default) {
		this.value = value;
		this.target = value;
		this.config = config;
	}

	set(value: number): void {
		this.value = value;
		this.target = value;
		this.velocity = 0;
		this.#animating = false;
	}

	/** animates toward a target while preserving omitted velocity and config values. */
	animateTo(target: number, options: SpringAnimationOptions = {}): void {
		const { velocity, config } = options;
		this.target = target;
		if (velocity !== undefined) {
			this.velocity = velocity;
		}
		if (config) {
			this.config = config;
		}
		this.#animating = true;
	}

	get isAnimating(): boolean {
		return this.#animating;
	}

	/** advances the simulation by `dt` seconds and reports whether it is moving. */
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

// #endregion

// #region helpers

export const clamp = (v: number, min: number, max: number): number => {
	if (v < min) {
		return min;
	}
	if (v > max) {
		return max;
	}
	return v;
};

/** projects the travel from inertial decay. */
export const projectDecay = (velocity: number, friction = 0.92): number => {
	return (velocity * friction) / (1 - friction) / 60;
};

/** applies iOS-style rubber-band resistance. */
export const rubberBand = (overflow: number, dimension: number, constant = 0.55): number => {
	if (overflow === 0 || dimension === 0) {
		return overflow;
	}
	const sign = Math.sign(overflow);
	const abs = Math.abs(overflow);
	return sign * (1 - 1 / (abs / dimension / constant + 1)) * dimension;
};

/** clamps a value with rubber-band resistance outside the range. */
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

// #endregion
