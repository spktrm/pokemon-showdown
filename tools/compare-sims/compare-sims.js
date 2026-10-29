'use strict';
// Plays the same seeded random battles on two built Showdown checkouts and reports, for each
// battle, the first line where their spectator logs differ (|t:| timestamps left out).
// usage: node compare-sims.js <checkout A> <checkout B> [battles per format]
// Each checkout needs `node build` run first. Exits 1 if any battle differs.
const path = require('path');

const FORMATS = [
	'gen9randombattle', 'gen9randomdoublesbattle', 'gen8randombattle',
	'gen7randombattle', 'gen4randombattle',
];
const PER_FORMAT = Number(process.argv[4]) || 60;

function load(dir) {
	dir = path.resolve(dir);
	return {
		...require(`${dir}/dist/sim`),
		RandomPlayerAI: require(`${dir}/dist/sim/tools/random-player-ai`).RandomPlayerAI,
		extractChannelMessages: require(`${dir}/dist/sim/battle`).extractChannelMessages,
	};
}

// The seeds of battle n: the battle's own, each player's team, and each player's choices.
function seeds(n) {
	const battle = [n, n * 7 + 1, n * 13 + 2, n * 31 + 3].map(x => x & 0xffff);
	return {
		battle,
		team: { p1: battle.map(x => x ^ 5), p2: battle.map(x => x ^ 6) },
		ai: { p1: battle.map(x => x ^ 1), p2: battle.map(x => x ^ 2) },
	};
}

function play(sim, format, n) {
	const s = seeds(n);
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

const [a, b] = [load(process.argv[2]), load(process.argv[3])];
let differ = 0;
let total = 0;
for (const format of FORMATS) {
	for (let n = 1; n <= PER_FORMAT; n++) {
		total++;
		const [x, y] = [play(a, format, n), play(b, format, n)];
		const i = x.findIndex((line, j) => line !== y[j]);
		if (i < 0 && x.length === y.length) continue;
		differ++;
		const at = i < 0 ? Math.min(x.length, y.length) : i;
		console.log(`${format} #${n} line ${at + 1}:\n  A: ${x[at] ?? '(end)'}\n  B: ${y[at] ?? '(end)'}`);
	}
}
console.log(`${total - differ} of ${total} battles identical`);
process.exitCode = differ ? 1 : 0;
