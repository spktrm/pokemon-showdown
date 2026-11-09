'use strict';

const assert = require('./../../assert');
const common = require('./../../common');
const Battle = require('./../../../dist/sim/battle').Battle;
const State = require('./../../../dist/sim/state').State;
const Pokemon = require('./../../../dist/sim/pokemon').Pokemon;

const TEAMS = [[
	{ species: 'Mew', ability: 'synchronize', item: 'assaultvest', moves: ['psychic'] },
	{ species: 'Ditto', ability: 'imposter', item: 'choicescarf', moves: ['transform'] },
	{ species: 'Amoonguss', ability: 'effectspore', item: 'blacksludge', moves: ['toxic'] },
	{ species: 'Gliscor', ability: 'poisonheal', item: 'toxicorb', moves: ['curse'] },
	{ species: 'Zoroark', ability: 'illusion', item: 'leftovers', moves: ['knockoff'] },
	{ species: 'Gengar', ability: 'cursedbody', item: 'brightpowder', moves: ['disable'] },
], [
	{ species: 'Ninjask', ability: 'speedboost', item: 'rockyhelmet', moves: ['batonpass'] },
	{ species: 'Hippowdon', ability: 'sandstream', item: 'choiceband', moves: ['earthquake'] },
	{ species: 'Jirachi', ability: 'serenegrace', item: 'choicescarf', moves: ['ironhead'] },
	{ species: 'Chansey', ability: 'naturalcure', item: 'eviolite', moves: ['seismictoss'] },
	{ species: 'Vaporeon', ability: 'waterabsorb', item: 'wacanberry', moves: ['surf'] },
	{ species: 'Snorlax', ability: 'thickfat', item: 'leftovers', moves: ['rest'] },
]];

describe('State', () => {
	describe('Battles', () => {
		it('should be able to be serialized and deserialized without affecting functionality (slow)', function () {
			this.timeout(5000);
			const control = common.createBattle({ seed: 'sodium,00000001000000020000000300000004' }, TEAMS);
			let test = common.createBattle({ seed: 'sodium,00000001000000020000000300000004' }, TEAMS);

			while (!(control.ended || test.ended)) {
				control.makeChoices();
				test.makeChoices();

				assert.deepEqual(State.normalize(test.toJSON()), State.normalize(control.toJSON()));

				// Roundtrip the test battle to confirm it still works.
				const send = test.send;
				test = Battle.fromJSON(JSON.stringify(test));
				test.restart(send);
			}

			control.destroy();
			test.destroy();
		});
		it('should be able to be restored more than once from the same state', () => {
			const battle = common.createBattle({ seed: 'sodium,00000001000000020000000300000004' }, TEAMS);
			battle.makeChoices();
			const state = battle.toJSON();
			const serialized = JSON.stringify(state);
			const first = Battle.fromJSON(state);
			const second = Battle.fromJSON(state);
			for (let i = 0; i < 3; i++) {
				first.makeChoices();
				second.makeChoices();
			}

			assert.equal(JSON.stringify(state), serialized);
			assert.deepEqual(State.normalize(first.toJSON()), State.normalize(second.toJSON()));
			battle.destroy();
			first.destroy();
			second.destroy();
		});
		it('should be able to be cloned without affecting functionality', () => {
			const control = common.createBattle({ seed: 'sodium,00000001000000020000000300000004' }, TEAMS);
			let test = common.createBattle({ seed: 'sodium,00000001000000020000000300000004' }, TEAMS);

			while (!(control.ended || test.ended)) {
				control.makeChoices();
				test.makeChoices();

				assert.deepEqual(State.normalize(test.toJSON()), State.normalize(control.toJSON()));

				const send = test.send;
				const original = test;
				test = test.clone();
				test.restart(send);
				original.destroy();
			}

			control.destroy();
			test.destroy();
		});
		it('should not change the original battle when a clone is played', () => {
			const battle = common.createBattle({ seed: 'sodium,00000001000000020000000300000004' }, TEAMS);
			battle.makeChoices();
			const state = JSON.stringify(battle.toJSON());
			const clone = battle.clone();
			for (let i = 0; i < 3; i++) clone.makeChoices();

			assert.equal(JSON.stringify(battle.toJSON()), state);
			const restored = Battle.fromJSON(state);
			const second = battle.clone();
			for (let i = 0; i < 3; i++) {
				restored.makeChoices();
				second.makeChoices();
			}
			assert.deepEqual(State.normalize(second.toJSON()), State.normalize(restored.toJSON()));
			battle.destroy();
			clone.destroy();
			restored.destroy();
			second.destroy();
		});
		it('should not change the moves the original battle has used when a clone is played', () => {
			const battle = common.createBattle({ seed: 'sodium,00000001000000020000000300000004' }, TEAMS);
			battle.makeChoices();
			const movesOf = b => JSON.stringify([b.lastMove, ...b.getAllActive().map(p => [p.lastMove, p.lastMoveUsed])],
				(key, value) => (value instanceof Pokemon ? `${value}` : value));
			const moves = movesOf(battle);
			const clone = battle.clone();
			for (let i = 0; i < 3; i++) clone.makeChoices();

			assert.equal(movesOf(battle), moves);
			battle.destroy();
			clone.destroy();
		});
		it('should not show changes to a request to the clone or battle that shares it', () => {
			const battle = common.createBattle(TEAMS);
			const request = JSON.stringify(battle.p1.activeRequest);
			const disableFirstMove = req => {
				req.moves[0].disabled = true;
			};
			const clone = battle.clone();
			clone.p1.updateRequestForPokemon(clone.p1.active[0], disableFirstMove);
			clone.p1.emitRequest(clone.p1.activeRequest, true);
			assert(clone.p1.activeRequest.update);
			assert(clone.p1.activeRequest.active[0].moves[0].disabled);
			assert.equal(JSON.stringify(battle.p1.activeRequest), request);

			const second = battle.clone();
			battle.p1.updateRequestForPokemon(battle.p1.active[0], disableFirstMove);
			assert(battle.p1.activeRequest.active[0].moves[0].disabled);
			assert.equal(JSON.stringify(second.p1.activeRequest), request);
			battle.destroy();
			clone.destroy();
			second.destroy();
		});
		it('should require special treatment for complex objects', () => {
			const battle = common.createBattle(TEAMS);
			battle.foo = new Map();
			assert.throws(() => battle.toJSON(), /Unsupported type Map/);
		});
	});
});
