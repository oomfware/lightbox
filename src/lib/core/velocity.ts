import type { Point } from './types.ts';

const WINDOW_MS = 100;

interface Sample extends Point {
	next: Sample | null;
	t: number;
}

/**
 * rolling pointer-velocity estimator. keeps a short window of samples and
 * reports px/s at release, so flings/flicks carry momentum into the springs.
 */
export class VelocityTracker {
	#head: Sample | null = null;
	#tail: Sample | null = null;

	/**
	 * clear the window and seed it with a starting sample.
	 *
	 * @param x pointer x in px.
	 * @param y pointer y in px.
	 * @param t timestamp in ms.
	 */
	reset(x: number, y: number, t: number): void {
		this.#head = this.#tail = { next: null, t, x, y };
	}

	/**
	 * record a sample, dropping any that fall outside the rolling window.
	 *
	 * @param x pointer x in px.
	 * @param y pointer y in px.
	 * @param t timestamp in ms.
	 */
	add(x: number, y: number, t: number): void {
		const sample: Sample = { next: null, t, x, y };
		if (this.#tail) {
			this.#tail.next = sample;
		} else {
			this.#head = sample;
		}
		this.#tail = sample;

		// advance to the last sample still inside the window, keeping at least
		// two, then drop the rest in one assignment instead of per-shift.
		const cutoff = t - WINDOW_MS;
		let head = this.#head;
		while (head && head.next?.next && head.t < cutoff) {
			head = head.next;
		}
		this.#head = head;
	}

	/**
	 * average velocity across the retained window.
	 *
	 * @returns velocity in px/s per axis; zero when fewer than two samples remain.
	 */
	velocity(): Point {
		const first = this.#head;
		const last = this.#tail;
		if (!first || !last || first === last) {
			return { x: 0, y: 0 };
		}
		const dt = (last.t - first.t) / 1000;
		if (dt <= 0) {
			return { x: 0, y: 0 };
		}
		return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
	}
}
