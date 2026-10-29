/**
 * PRNG
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * This simulates the on-cartridge PRNG used in the real games.
 *
 * In addition to potentially allowing us to read replays from in-game,
 * this also makes it possible to record an "input log" (a seed +
 * initial teams + move/switch decisions) and "replay" a simulation to
 * get the same result.
 *
 * @license MIT license
 */

import { Utils } from '../lib/utils';

export type PRNGSeed = `${'sodium' | 'gen5' | number},${string}`;
export type SodiumRNGSeed = ['sodium', string];
/** 64-bit big-endian [high -> low] int */
export type Gen5RNGSeed = [number, number, number, number];

/**
 * Low-level source of 32-bit random numbers.
 */
interface RNG {
	getSeed(): PRNGSeed;
	/** random 32-bit number */
	next(): number;
}

/**
 * High-level PRNG API, for getting random numbers.
 *
 * Chooses the RNG implementation based on the seed passed to the constructor.
 * Seeds starting with 'sodium' use sodium. Other seeds use the Gen 5 RNG.
 * If a seed isn't given, defaults to sodium.
 *
 * The actual randomness source is in this.rng.
 */
export class PRNG {
	readonly startingSeed: PRNGSeed;
	rng!: RNG;
	/** Creates a new source of randomness for the given seed. */
	constructor(seed: PRNGSeed | null = null, initialSeed?: PRNGSeed) {
		if (!seed) seed = PRNG.generateSeed();
		if (Array.isArray(seed)) {
			// compat for old inputlogs
			seed = seed.join(',') as PRNGSeed;
		}
		if (typeof seed !== 'string') {
			throw new Error(`PRNG: Seed ${seed} must be a string`);
		}
		this.startingSeed = initialSeed ?? seed;
		this.setSeed(seed);
	}

	setSeed(seed: PRNGSeed) {
		if (seed.startsWith('sodium,')) {
			this.rng = new SodiumRNG(seed.split(',') as SodiumRNGSeed);
		} else if (seed.startsWith('gen5,')) {
			const gen5Seed = [seed.slice(5, 9), seed.slice(9, 13), seed.slice(13, 17), seed.slice(17, 21)];
			this.rng = new Gen5RNG(gen5Seed.map(n => parseInt(n, 16)) as Gen5RNGSeed);
		} else if (/[0-9]/.test(seed.charAt(0))) {
			this.rng = new Gen5RNG(seed.split(',').map(Number) as Gen5RNGSeed);
		} else {
			throw new Error(`Unrecognized RNG seed ${seed}`);
		}
	}
	getSeed(): PRNGSeed {
		return this.rng.getSeed();
	}

	/**
	 * Creates a clone of the current PRNG.
	 *
	 * The new PRNG will have its initial seed set to the seed of the current instance.
	 */
	clone(): PRNG {
		return new PRNG(this.rng.getSeed(), this.startingSeed);
	}

	/**
	 * Retrieves the next random number in the sequence.
	 * This function has three different results, depending on arguments:
	 * - random() returns a real number in [0, 1), just like Math.random()
	 * - random(n) returns an integer in [0, n)
	 * - random(m, n) returns an integer in [m, n)
	 * m and n are converted to integers via Math.floor. If the result is NaN, they are ignored.
	 */
	random(from?: number, to?: number): number {
		const result = this.rng.next();

		if (from) from = Math.floor(from);
		if (to) to = Math.floor(to);
		if (from === undefined) {
			return result / 2 ** 32;
		} else if (!to) {
			return Math.floor(result * from / 2 ** 32);
		} else {
			return Math.floor(result * (to - from) / 2 ** 32) + from;
		}
	}

	/**
	 * Flip a coin (two-sided die), returning true or false.
	 *
	 * This function returns true with probability `P`, where `P = numerator
	 * / denominator`. This function returns false with probability `1 - P`.
	 *
	 * The numerator must be a non-negative integer (`>= 0`).
	 *
	 * The denominator must be a positive integer (`> 0`).
	 */
	randomChance(numerator: number, denominator: number): boolean {
		return this.random(denominator) < numerator;
	}

	/**
	 * Return a random item from the given array.
	 *
	 * This function chooses items in the array with equal probability.
	 *
	 * If there are duplicate items in the array, each duplicate is
	 * considered separately. For example, sample(['x', 'x', 'y']) returns
	 * 'x' 67% of the time and 'y' 33% of the time.
	 *
	 * The array must contain at least one item.
	 *
	 * The array must not be sparse.
	 */
	sample<T>(items: readonly T[]): T {
		if (items.length === 0) {
			throw new RangeError(`Cannot sample an empty array`);
		}
		const index = this.random(items.length);
		const item = items[index];
		if (item === undefined && !Object.prototype.hasOwnProperty.call(items, index)) {
			throw new RangeError(`Cannot sample a sparse array`);
		}
		return item;
	}

	/**
	 * A Fisher-Yates shuffle. This is how the game resolves speed ties.
	 *
	 * At least according to V4 in
	 * https://github.com/smogon/pokemon-showdown/issues/1157#issuecomment-214454873
	 */
	shuffle<T>(items: T[], start = 0, end: number = items.length) {
		while (start < end - 1) {
			const nextIndex = this.random(start, end);
			if (start !== nextIndex) {
				[items[start], items[nextIndex]] = [items[nextIndex], items[start]];
			}
			start++;
		}
	}

	static generateSeed(): PRNGSeed {
		return PRNG.convertSeed(SodiumRNG.generateSeed());
	}
	static convertSeed(seed: SodiumRNGSeed | Gen5RNGSeed): PRNGSeed {
		return seed.join(',') as PRNGSeed;
	}
	static get(prng?: PRNG | PRNGSeed | null) {
		return prng && typeof prng !== 'string' && !Array.isArray(prng) ? prng : new PRNG(prng as PRNGSeed);
	}
}

/**
 * This is a drop-in replacement for libsodium's randombytes_buf_deterministic,
 * but it's implemented in plain JS instead, so it doesn't need NodeJS native
 * modules, for better portability.
 */
export class SodiumRNG implements RNG {
	// nonce chosen to be compatible with libsodium's randombytes_buf_deterministic
	// https://github.com/jedisct1/libsodium/blob/ce07d6c82c0e6c75031cf627913bf4f9d3f1e754/src/libsodium/randombytes/randombytes.c#L178
	static readonly NONCE = Uint8Array.from([..."LibsodiumDRG"].map(c => c.charCodeAt(0)));
	seed!: Uint8Array;
	/** Creates a new source of randomness for the given seed. */
	constructor(seed: SodiumRNGSeed) {
		this.setSeed(seed);
	}

	setSeed(seed: SodiumRNGSeed) {
		// randombytes_buf_deterministic requires 32 bytes, but
		// generateSeed generates 16 bytes, so the last 16 bytes will be 0
		// when starting out. This shouldn't cause any problems.
		const seedBuf = new Uint8Array(32);
		Utils.bufWriteHex(seedBuf, seed[1].padEnd(64, '0'));
		this.seed = seedBuf;
	}
	getSeed(): PRNGSeed {
		return `sodium,${Utils.bufReadHex(this.seed)}`;
	}

	next() {
		// This is the first ChaCha20 block for the seed, which is what
		// sodium.randombytes_buf_deterministic(buf, this.seed) gives for 36 bytes.
		// It's kept in local variables because that's much faster than using arrays.
		const seed = this.seed;
		const k0 = readUint32LE(seed, 0), k1 = readUint32LE(seed, 4), k2 = readUint32LE(seed, 8);
		const k3 = readUint32LE(seed, 12), k4 = readUint32LE(seed, 16), k5 = readUint32LE(seed, 20);
		const k6 = readUint32LE(seed, 24), k7 = readUint32LE(seed, 28);
		let x0 = 0x61707865, x1 = 0x3320646e, x2 = 0x79622d32, x3 = 0x6b206574;
		let x4 = k0, x5 = k1, x6 = k2, x7 = k3, x8 = k4, x9 = k5, x10 = k6, x11 = k7;
		let x12 = 0, x13 = NONCE0, x14 = NONCE1, x15 = NONCE2;
		for (let i = 0; i < 10; i++) {
			// columns
			x0 = x0 + x4 | 0; x12 = rotl(x12 ^ x0, 16);
			x8 = x8 + x12 | 0; x4 = rotl(x4 ^ x8, 12);
			x0 = x0 + x4 | 0; x12 = rotl(x12 ^ x0, 8);
			x8 = x8 + x12 | 0; x4 = rotl(x4 ^ x8, 7);
			x1 = x1 + x5 | 0; x13 = rotl(x13 ^ x1, 16);
			x9 = x9 + x13 | 0; x5 = rotl(x5 ^ x9, 12);
			x1 = x1 + x5 | 0; x13 = rotl(x13 ^ x1, 8);
			x9 = x9 + x13 | 0; x5 = rotl(x5 ^ x9, 7);
			x2 = x2 + x6 | 0; x14 = rotl(x14 ^ x2, 16);
			x10 = x10 + x14 | 0; x6 = rotl(x6 ^ x10, 12);
			x2 = x2 + x6 | 0; x14 = rotl(x14 ^ x2, 8);
			x10 = x10 + x14 | 0; x6 = rotl(x6 ^ x10, 7);
			x3 = x3 + x7 | 0; x15 = rotl(x15 ^ x3, 16);
			x11 = x11 + x15 | 0; x7 = rotl(x7 ^ x11, 12);
			x3 = x3 + x7 | 0; x15 = rotl(x15 ^ x3, 8);
			x11 = x11 + x15 | 0; x7 = rotl(x7 ^ x11, 7);
			// diagonals
			x0 = x0 + x5 | 0; x15 = rotl(x15 ^ x0, 16);
			x10 = x10 + x15 | 0; x5 = rotl(x5 ^ x10, 12);
			x0 = x0 + x5 | 0; x15 = rotl(x15 ^ x0, 8);
			x10 = x10 + x15 | 0; x5 = rotl(x5 ^ x10, 7);
			x1 = x1 + x6 | 0; x12 = rotl(x12 ^ x1, 16);
			x11 = x11 + x12 | 0; x6 = rotl(x6 ^ x11, 12);
			x1 = x1 + x6 | 0; x12 = rotl(x12 ^ x1, 8);
			x11 = x11 + x12 | 0; x6 = rotl(x6 ^ x11, 7);
			x2 = x2 + x7 | 0; x13 = rotl(x13 ^ x2, 16);
			x8 = x8 + x13 | 0; x7 = rotl(x7 ^ x8, 12);
			x2 = x2 + x7 | 0; x13 = rotl(x13 ^ x2, 8);
			x8 = x8 + x13 | 0; x7 = rotl(x7 ^ x8, 7);
			x3 = x3 + x4 | 0; x14 = rotl(x14 ^ x3, 16);
			x9 = x9 + x14 | 0; x4 = rotl(x4 ^ x9, 12);
			x3 = x3 + x4 | 0; x14 = rotl(x14 ^ x3, 8);
			x9 = x9 + x14 | 0; x4 = rotl(x4 ^ x9, 7);
		}

		// use the first 32 bytes for the next seed, and the next 4 bytes for the output
		const nextSeed = new Uint8Array(32);
		writeUint32LE(nextSeed, 0, x0 + 0x61707865);
		writeUint32LE(nextSeed, 4, x1 + 0x3320646e);
		writeUint32LE(nextSeed, 8, x2 + 0x79622d32);
		writeUint32LE(nextSeed, 12, x3 + 0x6b206574);
		writeUint32LE(nextSeed, 16, x4 + k0);
		writeUint32LE(nextSeed, 20, x5 + k1);
		writeUint32LE(nextSeed, 24, x6 + k2);
		writeUint32LE(nextSeed, 28, x7 + k3);
		this.seed = nextSeed;
		// reading big-endian
		const out = x8 + k4;
		return (out & 0xff) * 0x1000000 + ((out >>> 8 & 0xff) << 16 | (out >>> 16 & 0xff) << 8 | out >>> 24);
	}

	static generateSeed(): SodiumRNGSeed {
		const seed = new Uint32Array(4);
		// TODO: Fix that @types/node >14 issue
		// oxlint-disable-next-line typescript/ban-ts-comment
		// @ts-ignore Web Crypto isn't actually in Node 18
		if (typeof crypto === 'undefined') globalThis.crypto = require('node:crypto');
		// oxlint-disable-next-line typescript/ban-ts-comment
		// @ts-ignore Web Crypto _is_ available in newer Node
		crypto.getRandomValues(seed);
		// 32 bits each, 128 bits total (16 bytes)
		const strSeed = seed[0].toString(16).padStart(8, '0') +
			seed[1].toString(16).padStart(8, '0') +
			seed[2].toString(16).padStart(8, '0') +
			seed[3].toString(16).padStart(8, '0');
		return [
			'sodium',
			strSeed,
		];
	}
}

function rotl(x: number, n: number) {
	return x << n | x >>> (32 - n);
}
function readUint32LE(buf: Uint8Array, i: number) {
	return buf[i] | buf[i + 1] << 8 | buf[i + 2] << 16 | buf[i + 3] << 24;
}
function writeUint32LE(buf: Uint8Array, i: number, x: number) {
	buf[i] = x;
	buf[i + 1] = x >>> 8;
	buf[i + 2] = x >>> 16;
	buf[i + 3] = x >>> 24;
}
const NONCE0 = readUint32LE(SodiumRNG.NONCE, 0);
const NONCE1 = readUint32LE(SodiumRNG.NONCE, 4);
const NONCE2 = readUint32LE(SodiumRNG.NONCE, 8);

/**
 * A PRNG intended to emulate the on-cartridge PRNG for Gen 5 with a 64-bit
 * initial seed.
 */
export class Gen5RNG implements RNG {
	seed: Gen5RNGSeed;
	/** Creates a new source of randomness for the given seed. */
	constructor(seed: Gen5RNGSeed | null = null) {
		this.seed = [...seed || Gen5RNG.generateSeed()];
	}

	getSeed(): PRNGSeed {
		return this.seed.join(',') as PRNGSeed;
	}

	next(): number {
		this.seed = this.nextFrame(this.seed); // Advance the RNG
		return (this.seed[0] << 16 >>> 0) + this.seed[1]; // Use the upper 32 bits
	}

	/**
	 * Calculates `a * b + c` (with 64-bit 2's complement integers)
	 */
	multiplyAdd(a: Gen5RNGSeed, b: Gen5RNGSeed, c: Gen5RNGSeed) {
		// If you've done long multiplication, this is the same thing.
		const out: Gen5RNGSeed = [0, 0, 0, 0];
		let carry = 0;

		for (let outIndex = 3; outIndex >= 0; outIndex--) {
			for (let bIndex = outIndex; bIndex < 4; bIndex++) {
				const aIndex = 3 - (bIndex - outIndex);

				carry += a[aIndex] * b[bIndex];
			}
			carry += c[outIndex];

			out[outIndex] = carry & 0xFFFF;
			carry >>>= 16;
		}

		return out;
	}

	/**
	 * The RNG is a Linear Congruential Generator (LCG) in the form: `x_{n + 1} = (a x_n + c) % m`
	 *
	 * Where: `x_0` is the seed, `x_n` is the random number after n iterations,
	 *
	 * ````
	 * a = 0x5D588B656C078965
	 * c = 0x00269EC3
	 * m = 2^64
	 * ````
	 */
	nextFrame(seed: Gen5RNGSeed, framesToAdvance = 1): Gen5RNGSeed {
		const a: Gen5RNGSeed = [0x5D58, 0x8B65, 0x6C07, 0x8965];
		const c: Gen5RNGSeed = [0, 0, 0x26, 0x9EC3];

		for (let i = 0; i < framesToAdvance; i++) {
			// seed = seed * a + c
			seed = this.multiplyAdd(seed, a, c);
		}

		return seed;
	}

	static generateSeed(): Gen5RNGSeed {
		return [
			Math.trunc(Math.random() * 2 ** 16),
			Math.trunc(Math.random() * 2 ** 16),
			Math.trunc(Math.random() * 2 ** 16),
			Math.trunc(Math.random() * 2 ** 16),
		];
	}
}

// The following commented-out class is designed to emulate the on-cartridge
// PRNG for Gens 3 and 4, as described in
// https://www.smogon.com/ingame/rng/pid_iv_creation#pokemon_random_number_generator
// This RNG uses a 32-bit initial seed
// m and n are converted to integers via Math.floor. If the result is NaN, they
// are ignored.
/*
export type Gen3RNGSeed = ['gen3', number];
export class Gen3RNG implements RNG {
	seed: number;
	constructor(seed: Gen3RNGSeed | null = null) {
		this.seed = seed ? seed[1] : Math.trunc(Math.random() * 2 ** 32);
	}
	getSeed() {
		return ['gen3', this.seed];
	}
	next(): number {
		this.seed = this.seed * 0x41C64E6D + 0x6073) >>> 0; // truncate the result to the last 32 bits
		const val = this.seed >>> 16; // the first 16 bits of the seed are the random value
		return val << 16 >>> 0; // PRNG#random expects a 32-bit number and will divide accordingly
	}
}
*/
