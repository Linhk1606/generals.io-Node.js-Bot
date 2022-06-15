let io = require('socket.io-client');

let readline = require('readline');

let r1 = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

global.user_id = 'ReqweyIsntCuteBot';
global.username = '[Bot]ReqwAI2';
global.chatRoom;
const socket_port = 8009;

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
let TILE_EMPTY = -1;
let TILE_MOUNTAIN = -2;
let TILE_FOG = -3;
let TILE_FOG_OBSTACLE = -4; // Cities and Mountains show up as Obstacles in the fog of war.

// Game data.
global.playerIndex = 0;
global.generals = []; // The indicies of generals we have vision of.
global.generalSaved = [];
global.cities = []; // The indicies of cities we have vision of.
global.map = [];
global.armies = [];
global.terrain = [];
let width, height, size;
global.isInGame = false;
global.enemyDetected = -1;
global.enemyPos = 0;
global.enemyHomeFound = false;
global.lastPos = 0;
global.workQueFr = [];
global.workQueTo = [];
global.cheatArr = [];

/* Returns a new array created by patching the diff into the old array.
 * The diff formatted with alternating matching and mismatching segments:
 * <Number of matching elements>
 * <Number of mismatching elements>
 * <The mismatching elements>
 * ... repeated until the end of diff.
 * Example 1: patching a diff of [1, 1, 3] onto [0, 0] yields [0, 3].
 * Example 2: patching a diff of [0, 1, 2, 1] onto [0, 0] yields [2, 0].
 */
function patch(old, diff) {
  let out = [];
  let i = 0;
  while (i < diff.length) {
    if (diff[i]) {  // matching
      Array.prototype.push.apply(out, old.slice(out.length, out.length + diff[i]));
    }
    i++;
    if (i < diff.length && diff[i]) {  // mismatching
      Array.prototype.push.apply(out, diff.slice(i + 1, i + 1 + diff[i]));
      i += diff[i];
    }
    i++;
  }
  return out;
}

socket.on('game_start', async (data) => {
  // Get ready to start playing the game.
  global.isInGame = true;
  global.playerIndex = data.playerIndex;
  global.chatRoom = data.chat_room;
  let replay_url = 'http://bot.generals.io/replays/' + encodeURIComponent(data.replay_id);
  console.log('\nGame starting! The replay will be available after the game at ' + replay_url);
});

// const rubbish_message = ['hi rubbish', 'so weak', 'garbage'];

function gatherArmy(turns, pos) {
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
  if (global.terrain[pos] != global.playerIndex)
    mapp[pos] = new Mapp(-global.armies[pos], pos.toString(), 0);
  else
    mapp[pos] = new Mapp(global.armies[pos], pos.toString(), 0);
  let front = 0, end = 0;

  while (front <= end) {
    let a = queue[front++]; mapp[a.pos].tag = 1;
    if (a.turn >= turns) break;
    for (let delta of D) {
      let b = a.pos + delta;
      if (b < 0 || b >= size || global.terrain[b] == TILE_MOUNTAIN) continue;
      else if (delta == 1 && b % width == 0 || delta == -1 && b % width == width - 1) continue; // !!!
      let new_val = mapp[a.pos].val - 1;
      if (global.terrain[b] != global.playerIndex) {
        if (global.cities.indexOf(b) >= 0 || global.terrain[b] == TILE_FOG_OBSTACLE) continue;
        new_val -= global.armies[b];
      }
      else new_val += global.armies[b];
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
  console.log("\nGet max " + max.val + ' ' + max.way);
  if (max <= 0) return 0;
  let arr = max.way.split('|');
  let x = 0;
  for (let y of arr) {
    y = Number(y);
    if (x) global.workQueFr.push(x), global.workQueTo.push(y);
    x = y;
  }
  return arr.length;
}

socket.on('game_update', (data) => {
  // Patch the city and map diffs into our local variables.
  global.cities = patch(global.cities, data.cities_diff);
  global.map = patch(global.map, data.map_diff);
  global.generals = data.generals;
  if (!global.enemyHomeFound && global.enemyDetected != -1) {
    let h = global.generals[global.enemyDetected];
    if (h != -1) {
      console.log("\n" + global.enemyDetected + "'s home in vision");
      global.enemyHomeFound = true;
      gatherArmy(114514, h);
      return;
    }
    if (global.terrain[h] == global.playerIndex) {
      console.log("\nCaptured " + global.enemyDetected);
      global.enemyDetected = -1;
      global.enemyHomeFound = false;
    }
  } else if (global.workQueFr.length) {
    if (global.terrain[global.enemyPos] == global.playerIndex)
      global.workQueFr = [], global.workQueTo = [];
    else {
      socket.emit('attack', global.workQueFr[0], global.workQueTo[0]);
      // console.log("\nmove " + global.workQueFr[0] + " to " + global.workQueTo[0]);
      global.workQueFr.shift(), global.workQueTo.shift();

      return;
    }
  }
  // if (data.turn % 10 == 2)
  // 	socket.emit('chat_message', chatRoom, rubbish_message[Math.floor(Math.random() * 3)]);



  // The first two terms in |map| are the dimensions.
  width = map[0];
  height = map[1];
  size = width * height;
  let D = [-width, 1, width, -1];

  // The next |size| terms are army values.
  // armies[0] is the top-left corner of the map.
  global.armies = global.map.slice(2, size + 2);

  // The last |size| terms are terrain values.
  // terrain[0] is the top-left corner of the map.
  global.terrain = global.map.slice(size + 2, size + 2 + size);

  // Detect enemies
  if (global.enemyDetected != -1) {
    if (global.terrain[global.enemyPos] != global.playerIndex) {
      global.enemyDetected = -1;

      return;
    }
    let min = 998244353, minPos = -1;
    for (let delta of D) {
      let b = global.enemyPos + delta;
      if (b < 0 || b >= size || global.terrain[b] != global.enemyDetected) continue;
      if (global.armies[b] < min) min = global.armies[b], minPos = b;
    }
    if (minPos != -1) {
      console.log("\nmove forward to " + minPos);
      socket.emit('attack', global.enemyPos, minPos);
      global.lastPos = global.enemyPos;
      global.enemyPos = minPos;

      return;
    } else {
      global.enemyDetected = -1;

      return;
    }
  } else {
    for (let i = 0; i < global.terrain.length; ++i) {
      let x = global.terrain[i];
      if (x >= 0 && x != global.playerIndex && global.cheatArr.indexOf(x) == -1) {
        // console.log('\nEnemy " + x + ` detected on pos (${Math.floor(i / width) + 1}, ${i % width + 1})`);
        let tmp = gatherArmy(50, i);
        if (tmp > 1) {
          global.enemyDetected = x;
          global.enemyPos = i;
          global.lastPos = i;

          return;
        }/* else  console.log('\nIgnored"); */
      }
    }
  }

  let select = new Array();
  global.terrain.forEach((item, index) => {
    if (item === global.playerIndex && global.armies[index] > 1)
      select.push(index);
  });
  // Pick a random tile.
  let index = select[Math.floor(Math.random() * select.length)];
  // If we own this tile, make a random move starting from it.
  let row = Math.floor(index / width);
  let col = index % width;
  let endIndex = new Array();
  if (global.terrain[index - 1] != TILE_MOUNTAIN && col > 0) { // left
    endIndex.push(index - 1);
  }
  if (global.terrain[index + 1] != TILE_MOUNTAIN && col < width - 1) { // right
    endIndex.push(index + 1);
  }
  if (global.terrain[index + width] != TILE_MOUNTAIN && row < height - 1) { // down
    endIndex.push(index + width);
  }
  if (global.terrain[index - width] != TILE_MOUNTAIN && row > 0) { //up
    endIndex.push(index - width);
  }
  endIndex.sort(() => Math.random() - 0.5);

  let getOuter = 0;
  for (let i of endIndex) {
    if (global.terrain[i] != global.playerIndex) {
      getOuter = i;
      break;
    }
  }
  if (getOuter) socket.emit('attack', index, getOuter);
  else {
    // Would we be attacking a city? Don't attack cities.
    // if (cities.indexOf(endIndex) >= 0) {
    // 	continue;
    // }

    socket.emit('attack', index, endIndex[0]);
  }

});

function leaveGame() {
  socket.emit('leave_game');
  process.exit();
}

socket.on('game_lost', async () => {
  console.log('\nYou lost.');
  leaveGame();
});

socket.on('game_won', async () => {
  console.error('You won!');
  leaveGame();
});

r1.setPrompt('qwq>');
r1.prompt();
r1.on('line', function (line) {
  switch (line.trim()) {
    case 'armies':
      for (let i = 0; i < size; ++i) {
        if (i % width == 0) process.stdout.write('\n');
        process.stdout.write(global.armies[i] + '\t');
      }
      process.stdout.write('\n');
      break;
    case 'terrain':
      for (let i = 0; i < size; ++i) {
        if (i % width == 0) process.stdout.write('\n');
        process.stdout.write(global.terrain[i] + '\t');
      }
      process.stdout.write('\n');
      break;
    case 'playerIndex':
      console.log(playerIndex);
      break;
    case 'cheat':
      r1.question('With who?', (data) => {
        global.cheatArr = data.split('|');
        console.log('Cheat with ' + global.cheatArr);
      })
      break;
    case 'close':
      r1.close();
      break;
    default:
      console.log('\n没有找到命令');
      break;
  }
  r1.prompt();
});
