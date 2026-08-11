import type { Point } from './types.ts';

const WINDOW_MS = 100;

interface Sample extends Point {
	next: Sample | null;
	t: number;
}

/** estimates pointer velocity from recent samples. */
export class VelocityTracker {
	#head: Sample | null = null;
	#tail: Sample | null = null;

	reset(x: number, y: number, t: number): void {
		this.#head = this.#tail = { next: null, t, x, y };
	}

	add(x: number, y: number, t: number): void {
		const sample: Sample = { next: null, t, x, y };
		if (this.#tail) {
			this.#tail.next = sample;
		} else {
			this.#head = sample;
		}
		this.#tail = sample;

		const cutoff = t - WINDOW_MS;
		let head = this.#head;
		while (head && head.next?.next && head.t < cutoff) {
			head = head.next;
		}
		this.#head = head;
	}

	/** returns average velocity in px/s, or zero with fewer than two samples. */
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
