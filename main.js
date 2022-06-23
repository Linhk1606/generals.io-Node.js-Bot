Array.prototype.forEachAsync = Array.prototype.mapAsync = async function (fn) {
	return Promise.all(this.map(fn));
};

Array.prototype.filterAsync = async function (fn) {
	let a = await this.mapAsync(fn);
	return this.filter((x, i) => a[i]);
};

let io = require('socket.io-client');

let readline = require('readline');

let r1 = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

let user_id = '';
let username = '';
let chatRoom;
const socket_port = ;

function pause(data) {
	if (data)
		return new Promise((res) => setTimeout(res, data));
	return new Promise((res) => setTimeout(res, 1000));
}

let socket = io('https://botws.generals.io', {
	port: socket_port,
	'connect timeout': 5000,
	'flash policy port': 10843
});

socket.on('connect_error', async (error) => {
	console.log('\nConnection Failed: ' + error);
	leaveGame();
});

socket.on('disconnect', async () => {
	console.error('Disconnected from server.');
	leaveGame();
});

socket.on('connect', async () => {
	console.log('\nConnected to server.');

	/* Don't lose this user_id or let other people see it!
	 * Anyone with your user_id can play on your bot's account and pretend to be your bot.
	 * If you plan on open sourcing your bot's code (which we strongly support), we recommend
	 * replacing this line with something that instead supplies the user_id via an environment variable, e.g.
	 * let user_id = process.env.BOT_USER_ID;
	 */

	// Set the username for the bot.
	// This should only ever be done once. See the API reference for more details.
	socket.emit('set_username', user_id, username);

	await joinGame("edw2", user_id);
});

async function joinGame(custom_game_id, user_id) {
	// Join a custom game and force start immediately.
	// Custom games are a great way to test your bot while you develop it because you can play against your bot!

	socket.emit('join_private', custom_game_id, user_id);
	console.log('\nJoined custom game at https://bot.generals.io/games/' + encodeURIComponent(custom_game_id));

	for (let i = 1; i <= 5; ++i) {
		await pause();
		socket.emit('set_force_start', custom_game_id, true);
		console.log('\nForce Start Hitted');
	}

	// When you're ready, you can have your bot join other game modes.
	// Here are some examples of how you'D do that:

	// Join the 1v1 queue.
	// socket.emit('join_1v1', user_id);

	// Join the FFA queue.
	// socket.emit('play', user_id);

	// Join a 2v2 team.
	// socket.emit('join_team', 'team_name', user_id);
}

// Terrain Constants.
// Any tile with a nonnegative value is owned by the player corresponding to its value.
// For example, a tile with value 1 is owned by the player with playerIndex = 1.
const TILE_EMPTY = -1;
const TILE_MOUNTAIN = -2;
const TILE_FOG = -3;
const TILE_FOG_OBSTACLE = -4; // Cities and Mountains show up as Obstacles in the fog of war.
const QUE_DEFEND = 1;
const QUE_ATTACK = 2;
const QUE_ATTACK_GATHER = 2.5;
const QUE_ATTACK_HOME = 3;
const QUE_EXPAND_CITY = 4;
const QUE_EXPAND_LAND = 5;
const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;

// Game data.
let playerIndex = 0;
let generals = []; // The indicies of generals we have vision of.
let generalSaved = [];
let cities = []; // The indicies of cities we have vision of.
let map = [];
let armies = [];
let terrain = [];
let width, height, size;
let rescueHome = false;
let enemyDetected = -1;
let enemyPos = 0;
let enemyDir = 0;
let enemyDetectTurn = 0;
let enemyHomeFound = -1;
let attackCity = false;
let workQue = [];
let cheatArr = [];
let visited = [];

/* Returns a new array created by patching the diff into the old array.
 * The diff formatted with alternating matching and mismatching segments:
 * <Number of matching elements>
 * <Number of mismatching elements>
 * <The mismatching elements>
 * ... repeated until the end of diff.
 * Example 1: patching a diff of [1, 1, 3] onto [0, 0] yields [0, 3].
 * Example 2: patching a diff of [0, 1, 2, 1] onto [0, 0] yields [2, 0].
 */
async function patch(arr, diff) {
	let i = 0, j = 0;
	while (i < diff.length) {
		if (diff[i]) {  // matching
			j += diff[i];
		}
		i++;
		if (i < diff.length && diff[i]) {  // mismatching
			for (let k = 1; k <= diff[i]; ++k)
				arr[j + k - 1] = diff[k + i];
			
			j += diff[i];
			i += diff[i];
		}
		i++;
	}
	return arr;
}

socket.on('game_start', async (data) => {
	// Get ready to start playing the game.
	isInGame = true;
	playerIndex = data.playerIndex;
	chatRoom = data.chat_room;
	let replay_url = 'http://bot.generals.io/replays/' + encodeURIComponent(data.replay_id);
	console.log('\nGame starting! The replay will be available after the game at ' + replay_url);
});

// const rubbish_message = ['hi rubbish', 'so weak', 'garbage'];

async function gatherArmy(purpose, turns, pos, limit) {
	let D = [-width, 1, width, -1];
	class Step {
		constructor(turn, pos) {
			this.turn = turn;
			this.pos = pos;
		}
	}
	class Mapp {
		constructor(val, way, tag) {
			this.val = val;
			this.way = way;
			this.tag = tag;
		}
	}

	let queue = new Array(), mapp = new Array(size).fill(new Mapp(-9998244353, '', 0));
	queue.push(new Step(0, pos));
	if (terrain[pos] != playerIndex)
		mapp[pos] = new Mapp(-armies[pos], pos.toString(), 0);
	else
		mapp[pos] = new Mapp(armies[pos], pos.toString(), 0);
	let front = 0, end = 0;

	while (front <= end) {
		let a = queue[front++]; mapp[a.pos].tag = 1;
		if (a.turn >= turns) break;
		else if (limit != undefined && mapp[a.pos].val > limit) break;
		for (let delta of D) {
			let b = a.pos + delta;
			if (b < 0 || b >= size || terrain[b] == TILE_MOUNTAIN) continue;
			else if (delta == 1 && b % width == 0 || delta == -1 && b % width == width - 1) continue; // !!!
			let new_val = mapp[a.pos].val - 1;
			if (terrain[b] != playerIndex) {
				if (cities.indexOf(b) >= 0 || terrain[b] == TILE_FOG_OBSTACLE) continue;
				new_val -= armies[b];
			}
			else new_val += armies[b];
			if (mapp[b].tag || mapp[b].val > new_val) continue;
			let new_way = b + '|' + mapp[a.pos].way;
			queue.push(new Step(a.turn + 1, b)), ++end;
			mapp[b] = new Mapp(new_val, new_way, 0);
		}
	}
	let max = new Mapp(0, '', 0);
	for (let x of mapp) {
		if (x.val > max.val) max = x;
	}
	// console.log("\nGet max " + max.val + ' ' + max.way);
	if (max <= 0) return 0;
	let arr = max.way.split('|');
	let x = -1;
	for (let y of arr) {
		y = Number(y);
		if (x != -1) workQue.push({ fr: x, to: y, goal: pos, pur: purpose });
		x = y;
	}
	return arr.length;
}

async function detectThreat() {
	let D = [-width, 1, width, -1];
	let queue = new Array(), book = new Array();
	queue.push({ pos: generals[playerIndex], step: -1 }), book.push(generals[playerIndex]);
	let front = 0, end = 0;
	let select = new Array();
	while (front <= end) {
		let a = queue[front++];
		for (let d of D) {
			let b = a.pos + d;
			if (book.includes(b) || b < 0 || b >= size || terrain[b] == TILE_MOUNTAIN || terrain[b] == TILE_FOG || terrain[b] == TILE_FOG_OBSTACLE) continue;
			else if (d == 1 && b % width == 0 || d == -1 && b % width == width - 1) continue; // !!!
			queue.push({ pos: b, step: a.step + 1 }), book.push(b), ++end;
			if (terrain[b] >= 0 && terrain[b] != playerIndex && armies[b] - a.step >= 0) {
				select.push({ pos: b, val: armies[b] - a.step });
			}
		}
	}
	if (select.length) console.log('pos ' + select[0].val + ' ' + select[0].pos);
	select.sort((a, b) => b.val - a.val);
	await pause(300);
	if (select.length) return select[0];
	else return -1;
}

async function startExpand(turn) {
	let D = [-width, 1, width, -1];
	let queue = new Array(), book = new Array();
	queue.push({ pos: generals[playerIndex], step: 0, way: generals[playerIndex].toString() }), book.push(generals[playerIndex]);
	let front = 0, end = 0;
	while (front <= end) {
		let a = queue[front];
		++front;
		D.sort(() => Math.random() - 0.5);
		for (let d of D) {
			let b = a.pos + d;
			if (book.includes(b) || b < 0 || b >= size || terrain[b] == TILE_MOUNTAIN || terrain[b] == TILE_FOG_OBSTACLE) continue;
			else if (d == 1 && b % width == 0 || d == -1 && b % width == width - 1) continue; // !!!
			queue.push({ pos: b, step: a.step + 1, way: a.way + '|' + b }), book.push(b), ++end;
		}
	}
	let arr = queue[end].way.split('|');
	let goal = arr[arr.length - 1];
	let x = 0, cnt = 0;
	for (let y of arr) {
		y = Number(y);
		if (x) workQue.push({ fr: x, to: y, goal: goal, pur: QUE_EXPAND_LAND }), ++cnt;
		x = y;
		if (cnt >= turn) return;
	}
}

async function expandLand() {
	console.log("expand");
	let select = new Array(), ok = false;
	let tmp = terrain.map((value, index) => {
		return { t: value, p: index };
	});
	tmp.sort(() => Math.random() - 0.5);
	for (let index = 0; index < tmp.length; ++index) {
		let t = tmp[index].t, p = tmp[index].p;
		if (t === TILE_EMPTY) {
			select.push(p);
			if (await gatherArmy(QUE_EXPAND_LAND, 1, p) > 1) {
				ok = true;
				break;
			}
		}
	}
	if (!ok) {
		let index = select[Math.floor(Math.random() * select.length)];
		await gatherArmy(QUE_EXPAND_LAND, 50, index, 1);
	}
	socket.emit('attack', workQue[0].fr, workQue[0].to);
	workQue.shift();
}

async function calcDis(a, b) {
	let xa = Math.floor(a / width), ya = a % width;
	let xb = Math.floor(b / width), yb = b % width;
	return Math.abs(xa - xb) + Math.abs(ya - yb);
}

async function calcDir(a, b, dir) {
	console.log("Dir is " + dir);
	let xa = Math.floor(a / width), ya = a % width;
	let xb = Math.floor(b / width), yb = b % width;
	if (dir & UP && xa < xb) return false;
	if (dir & RIGHT && ya > yb) return false;
	if (dir & DOWN && xa > xb) return false;
	if (dir & LEFT && ya < yb) return false;
	return true;
}

async function attack(enemy, turn) {
	let D = [-width, 1, width, -1];
	let queue = [], book = [];
	let border = [];
	queue.push({ pos: enemy, step: 0, way: enemy.toString() }), book.push(enemy);
	let front = 0, end = 0;
	while (front <= end) {
		let a = queue[front++];
		if (a.step >= turn || Math.floor(a.pos / width) == 0 || Math.ceil(a.pos / width) == height - 1 || a.pos % width == 0 || a.pos % width == width - 1) {
			if (!visited.includes(a.pos) && await calcDir(enemy, a.pos, enemyDir)) border.push(a), console.log('%d is in selection.', a.pos);
		}
		for (let d of D) {
			let b = a.pos + d;
			if (book.includes(b) || b < 0 || b >= size || terrain[b] == TILE_MOUNTAIN || terrain[b] == TILE_FOG_OBSTACLE) continue;
			else if (d == 1 && b % width == 0 || d == -1 && b % width == width - 1) continue; // !!!
			queue.push({ pos: b, step: a.step + 1, way: a.way + '|' + b }), book.push(b), ++end;
		}
	}
	let maxDis = 0, maxWay;
	for (let a of border) {
		let d = await calcDis(generals[playerIndex], a.pos);
		if (d > maxDis) maxDis = d, maxWay = a.way;
	}
	let arr = maxWay.split('|');
	let goal = arr[arr.length - 1];
	let x = 0, cnt = 0;
	for (let y of arr) {
		y = Number(y);
		if (x) workQue.push({ fr: x, to: y, goal: goal, pur: QUE_ATTACK }), ++cnt;
		x = y;
		if (cnt >= turn) return;
	}
}

socket.on('game_update', async (data) => {
	data.scores.sort((a, b) => a.i - b.i);
	// Patch the city and map diffs into our local variables.
	cities = await patch(cities, data.cities_diff);
	map = await patch(map, data.map_diff);
	generals = data.generals;
	// The first two terms in |map| are the dimensions.
	width = map[0];
	height = map[1];
	size = width * height;
	let D = [-width, 1, width, -1];

	// The next |size| terms are army values.
	// armies[0] is the top-left corner of the map.
	armies = map.slice(2, size + 2);

	// The last |size| terms are terrain values.
	// terrain[0] is the top-left corner of the map.
	terrain = map.slice(size + 2, size + 2 + size);

	await terrain.forEachAsync((val, i) => {
		if (val != TILE_FOG && val != TILE_FOG_OBSTACLE) visited[i] = val;
	});

	// Defence
	let det = await detectThreat();
	if (rescueHome && det == -1) {
		rescueHome = false;
	} else if (!rescueHome && det != -1) {
		console.log("Rescue Home!!!");
		rescueHome = true;
		workQue = [];
		if (armies[generals[playerIndex]] < det.val + 2)
			await gatherArmy(QUE_DEFEND, 30, generals[playerIndex], det.val + 2 - armies[generals[playerIndex]]);
		await gatherArmy(QUE_DEFEND, 30, det.pos, armies[det.pos] + 2);
		return;
	}
	// Find home
	if (enemyHomeFound == -1 && enemyDetected != -1) {
		let h = generals[enemyDetected];
		if (h != -1) {
			if (terrain[h] == playerIndex || data.scores[enemyDetected].dead) {
				console.log("\n" + enemyDetected + " died.");
				enemyDetected = -1;
				enemyHomeFound = -1;
			}
			console.log("\n" + enemyDetected + "'s home in vision");
			enemyHomeFound = h;
			workQue = [];
			await gatherArmy(QUE_ATTACK_HOME, 114514, h, armies[h] + 1);
			return;
		}
	}

	if (data.turn == 1) {
		console.log("ST");
		await startExpand(17);
		return;
	} else if (data.turn <= 17) return;

	if (workQue.length) {
		// console.log("\nmove " + workQueFr[0] + " to " + workQueTo[0]);
		if (workQue[0].purpose === QUE_EXPAND_CITY && workQue[0].goal === workQue[0].to) {
			attackCity = false;
		}
		socket.emit('attack', workQue[0].fr, workQue[0].to);
		workQue.shift();
		return;
	} else if (enemyHomeFound != -1) {
		await gatherArmy(QUE_ATTACK_HOME, 114514, enemyHomeFound, armies[enemyHomeFound] + 1);
		return;
	}

	// City
	if (!attackCity && enemyDetected != -1) {
		let delta = (data.scores[enemyDetected].total - data.scores[playerIndex].total) / data.scores[playerIndex].total;
		if (delta > 0.3) {
			await expandLand(); return;
		} else if (delta < -0.3 && Math.random() > 0.5 && cities.length > 0) {
			let minArmy = 9999999, minPos = -1;
			for (let a of cities) {
				if (armies[a] < minArmy) minArmy = armies[a], minPos = a;
			}
			await gatherArmy(QUE_EXPAND_CITY, 50, minPos, minArmy + 1);
			attackCity = true;
		}
	}
	// if (data.turn % 10 == 2)
	// 	socket.emit('chat_message', chatRoom, rubbish_message[Math.floor(Math.random() * 3)]);




	// Attack
	if (enemyDetected != -1) {
		if (!enemyDetectTurn) enemyDetectTurn = data.turn;
		await attack(enemyPos, 10);
		enemyDetected = -1;
		return;
	} else {
		try {
			await terrain.forEachAsync(async (x, i) => {
				if (x >= 0 && x != playerIndex && !cheatArr.includes(x)) {
					// console.log('\nEnemy " + x + ` detected on pos (${Math.floor(i / width) + 1}, ${i % width + 1})`);
					await gatherArmy(QUE_ATTACK_GATHER, 50, i);
					enemyDir = 0;
					if (terrain[i - width] != playerIndex && terrain[i - width] != TILE_MOUNTAIN && terrain[i - width] != TILE_EMPTY) enemyDir |= UP;
					if (terrain[i + 1] != playerIndex && terrain[i + 1] != TILE_MOUNTAIN && terrain[i + 1] != TILE_EMPTY) enemyDir |= RIGHT;
					if (terrain[i + width] != playerIndex && terrain[i + width] != TILE_MOUNTAIN && terrain[i + width] != TILE_EMPTY) enemyDir |= DOWN;
					if (terrain[i - 1] != playerIndex && terrain[i - 1] != TILE_MOUNTAIN && terrain[i - 1] != TILE_EMPTY) enemyDir |= LEFT;
					if (enemyDir & LEFT && enemyDir & RIGHT) {
						if (Math.random() > 0.5) enemyDir ^= LEFT;
						else enemyDir ^= RIGHT;
					}
					if (enemyDir & UP && enemyDir & DOWN) {
						if (Math.random() > 0.5) enemyDir ^= UP;
						else enemyDir ^= DOWN;
					}
					enemyDetected = x;
					enemyPos = i;
					lastPos = i;
					throw 'Found enemy ' + x;
				}
			});
		} catch (e) {
			console.log(e);
			return;
		}
	}

	// expand its land
	if (data.turn % 25 == 0) await startExpand(17);
	else await expandLand();
});

function leaveGame() {
	socket.emit('leave_game');
	process.exit();
}

socket.on('game_lost', async () => {
	console.log('\nI lost.');
	leaveGame();
});

socket.on('game_won', async () => {
	console.error('\nI won!');
	leaveGame();
});

r1.setPrompt('qwq>');
r1.prompt();
r1.on('line', function (line) {
	switch (line.trim()) {
		case 'arm':
			for (let i = 0; i < size; ++i) {
				if (i % width == 0) process.stdout.write('\n');
				process.stdout.write(armies[i] + '\t');
			}
			process.stdout.write('\n');
			break;
		case 'ter':
			for (let i = 0; i < size; ++i) {
				if (i % width == 0) process.stdout.write('\n');
				process.stdout.write(terrain[i] + '\t');
			}
			process.stdout.write('\n');
			break;
		case 'pi':
			console.log(playerIndex);
			break;
		case 'ch':
			r1.question('With who?', (data) => {
				cheatArr = data.split('|').map((x) => { return parseInt(x) });
				console.log('Cheat with ' + cheatArr);
			})
			break;
		case 'fr':
			socket.emit('set_force_start', "edw2", true);
			console.log('\nForce Start Hitted');
			break;
		case 'cl':
			r1.close();
			break;
		default:
			console.log('\n没有找到命令');
			break;
	}
	r1.prompt();
});
