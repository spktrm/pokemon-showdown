'use strict';
// Plays the same seeded random battles on two built Showdown checkouts and reports, for each
// battle, the first line where their logs differ (|t:| timestamps left out).
// usage: node compare-sims.js <checkout A> <checkout B> [--suite core|wide|all] [--battles N] [--jobs N]
//   core: 60 battles in each of 5 random formats, comparing the spectator log
//   wide: 30 battles in each random format and random-team OM, comparing everything the battle
//         sends (requests included), with two mixes of random choices
// Each checkout needs `node build` run first. Exits 1 if any battle differs.
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');

const CORE_FORMATS = [
	'gen9randombattle', 'gen9randomdoublesbattle', 'gen8randombattle',
	'gen7randombattle', 'gen4randombattle',
];
const WIDE_FORMATS = [
	'gen1randombattle', 'gen2randombattle', 'gen3randombattle', 'gen4randombattle', 'gen5randombattle',
	'gen6randombattle', 'gen7randombattle', 'gen8randombattle', 'gen9randombattle',
	'gen8randomdoublesbattle', 'gen9randomdoublesbattle', 'gen9freeforallrandombattle', 'gen9multirandombattle',
	'gen9championsrandombattle', 'gen9championsrandomdoublesbattle', 'gen9babyrandombattle',
	'gen9partnersincrime', 'gen9pokebilities', 'gen9sharedpower', 'gen9almostanyability', 'gen9mixandmega',
	'gen9godlygift', 'gen9inheritance', 'gen9stabmons', 'gen9balancedhackmons', 'gen9trademarked', 'gen9biomechmons',
	'gen9pokemoves', 'gen9linked', 'gen9thecardgame', 'gen9convergence', 'gen9tiershift', 'gen9camomons',
];

function option(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i < 0 ? fallback : process.argv[i + 1];
}

function load(dir) {
	dir = path.resolve(dir);
	return {
		...require(`${dir}/dist/sim`),
		RandomPlayerAI: require(`${dir}/dist/sim/tools/random-player-ai`).RandomPlayerAI,
		extractChannelMessages: require(`${dir}/dist/sim/battle`).extractChannelMessages,
	};
}

// The seeds of core battle n: the battle's own, each player's team, and each player's choices.
function coreSeeds(n) {
	const battle = [n, n * 7 + 1, n * 13 + 2, n * 31 + 3].map(x => x & 0xffff);
	return {
		battle,
		team: { p1: battle.map(x => x ^ 5), p2: battle.map(x => x ^ 6) },
		ai: { p1: battle.map(x => x ^ 1), p2: battle.map(x => x ^ 2) },
	};
}

function playCore(sim, format, n) {
	const s = coreSeeds(n);
	const log = [];
	const battle = new sim.Battle({
		formatid: format, seed: s.battle,
		send: (type, data) => {
			if (type !== 'update') return;
			if (Array.isArray(data)) data = data.join('\n');
			for (const line of sim.extractChannelMessages(data, [0])[0]) {
				if (!line.startsWith('|t:|')) log.push(line);
			}
		},
	});
	battle.setPlayer('p1', { name: 'A', seed: s.team.p1 });
	battle.setPlayer('p2', { name: 'B', seed: s.team.p2 });
	const ais = {};
	for (const id of ['p1', 'p2']) {
		ais[id] = new sim.RandomPlayerAI(null, { seed: s.ai[id], move: 0.85, mega: 0.6 });
		ais[id].choose = c => { ais[id].choice = c; };
	}
	for (let step = 0; step < 2000 && !battle.ended; step++) {
		battle.sendUpdates();
		for (const side of battle.sides) {
			if (!side.activeRequest || side.activeRequest.wait || side.isChoiceDone()) continue;
			const ai = ais[side.id];
			ai.choice = undefined;
			ai.receiveRequest(side.activeRequest);
			if (!ai.choice || !battle.choose(side.id, ai.choice)) battle.choose(side.id, 'default');
		}
	}
	battle.sendUpdates();
	return log;
}

// Odd battles use the Gen 5 PRNG and even battles the sodium one, which is what new battles use.
function wideSeed(n, k) {
	if (n % 2) return [n, k, 3, 4];
	return `sodium,${(n * 7919 + k * 104729 + 1).toString(16).padStart(32, '0')}`;
}

// Wide battles go through BattleStream, so requests and choice errors are compared too.
// Every other pair of battles chooses moves less often, to cover more switching.
function playWide(sim, formatid, n) {
	const format = sim.Dex.formats.get(formatid);
	class Player extends sim.RandomPlayerAI {
		chooseTeamPreview(team) { return `team ${this.prng.random(team.length) + 1}`; }
	}
	const stream = new sim.BattleStream();
	const out = [];
	const queue = [];
	stream.push = chunk => { out.push(chunk); };
	const players = ['multi', 'freeforall'].includes(format.gameType) ? ['p1', 'p2', 'p3', 'p4'] : ['p1', 'p2'];
	const mix = (n >> 1) % 2 ? { move: 0.7, mega: 0.6 } : { move: 0.85, mega: 0.5 };
	const ais = {};
	for (const [i, side] of players.entries()) {
		ais[side] = new Player({ write: c => queue.push(`>${side} ${c}`) }, { seed: wideSeed(n, i + 1), ...mix });
	}
	stream._write(`>start ${JSON.stringify({ formatid: format.id, seed: wideSeed(n, 9) })}`);
	const teamFormat = format.gameType === 'doubles' ? 'gen9randomdoublesbattle' : 'gen9randombattle';
	for (const [i, side] of players.entries()) {
		const opts = { name: side.toUpperCase(), seed: wideSeed(n, 21 + i) };
		if (!format.team) opts.team = sim.Teams.pack(sim.Teams.generate(teamFormat, { seed: wideSeed(n, 41 + i) }));
		stream._write(`>player ${side} ${JSON.stringify(opts)}`);
	}
	let read = 0;
	for (let step = 0; step < 5000; step++) {
		for (; read < out.length; read++) {
			if (out[read].startsWith('sideupdate\n')) {
				const [, side, ...rest] = out[read].split('\n');
				try {
					ais[side].receive(rest.join('\n'));
				} catch (e) {
					out.push(`harness error: ${e.message}`);
				}
			}
		}
		if (!queue.length) break;
		stream._write(queue.shift());
	}
	return out.join('\n').split('\n').filter(line => !line.startsWith('|t:|'));
}

// Plays one format's battles on both checkouts and returns the battles that differ.
function compareFormat(a, b, suite, format, battles) {
	const play = suite === 'core' ? playCore : playWide;
	const run = (sim, n) => {
		try {
			return play(sim, format, n);
		} catch (e) {
			return [`crash: ${e.stack.split('\n')[0]}`];
		}
	};
	const differences = [];
	for (let n = 1; n <= battles; n++) {
		const [x, y] = [run(a, n), run(b, n)];
		const i = x.findIndex((line, j) => line !== y[j]);
		if (i < 0 && x.length === y.length) continue;
		const at = i < 0 ? Math.min(x.length, y.length) : i;
		differences.push({ n, line: at + 1, a: x[at] ?? '(end)', b: y[at] ?? '(end)' });
	}
	return differences;
}

const [dirA, dirB] = process.argv.slice(2);
const only = option('only');
if (only) {
	// one format, run by the parent process below
	const [suite, format] = only.split(':');
	const a = load(dirA);
	const b = load(dirB);
	if (!a.Dex.formats.get(format).exists || !b.Dex.formats.get(format).exists) {
		console.log(JSON.stringify({ missing: true }));
	} else {
		console.log(JSON.stringify({ differences: compareFormat(a, b, suite, format, Number(option('battles'))) }));
	}
} else {
	const suite = option('suite', 'all');
	const jobs = Number(option('jobs', Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 3)))));
	const tasks = [];
	for (const [name, formats, battles] of [['core', CORE_FORMATS, 60], ['wide', WIDE_FORMATS, 30]]) {
		if (suite !== 'all' && suite !== name) continue;
		for (const format of formats) tasks.push({ suite: name, format, battles: Number(option('battles', battles)) });
	}
	let total = 0;
	let differ = 0;
	let next = 0;
	const runTask = () => {
		const task = tasks[next++];
		if (!task) return Promise.resolve();
		const args = [__filename, dirA, dirB, '--only', `${task.suite}:${task.format}`, '--battles', `${task.battles}`];
		return new Promise(resolve => {
			execFile(process.execPath, args, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
				let result;
				try {
					result = JSON.parse(stdout);
				} catch {
					result = { differences: [{ n: '-', line: 0, a: `harness failed: ${err?.message || stderr}`, b: '' }] };
				}
				if (result.missing) {
					console.log(`${task.suite} ${task.format}: missing from a checkout, skipped`);
				} else {
					total += task.battles;
					differ += result.differences.length;
					for (const d of result.differences) {
						console.log(`${task.suite} ${task.format} #${d.n} line ${d.line}:\n  A: ${d.a}\n  B: ${d.b}`);
					}
				}
				resolve();
			});
		}).then(runTask);
	};
	void Promise.all(Array.from({ length: jobs }, runTask)).then(() => {
		console.log(`${total - differ} of ${total} battles identical`);
		process.exitCode = differ ? 1 : 0;
	});
}
