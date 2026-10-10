/** Position of the d-th cell on a Hilbert curve filling a side x side grid (side a power of two). */
export function hilbert(side: number, d: number): [number, number] {
	let x = 0;
	let y = 0;
	for (let s = 1, t = d; s < side; s *= 2, t = Math.floor(t / 4)) {
		const rx = 1 & Math.floor(t / 2);
		const ry = 1 & (t ^ rx);
		if (ry === 0) {
			if (rx === 1) {
				x = s - 1 - x;
				y = s - 1 - y;
			}
			[x, y] = [y, x];
		}
		x += s * rx;
		y += s * ry;
	}
	return [x, y];
}
