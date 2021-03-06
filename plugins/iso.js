'use strict';

class ISO {
	// this exists basically just for data storage
	/**
	 * @param {string} roomid
	 */
	constructor(roomid) {
		this.room = roomid;

		/** @type {string[][]} */
		this.authors = [/* string[][] */]; // contains the authors for each index, system messages are ~. lines with multiple authors are from lynches
		/** @type {string[]} */
		this.log = []; // contains just the lines. lines should be able to be directly output
		/** @type {string[]} */
		this.htmllog = []; // the above, but as safe html divs
		/** @type {string[]} */
		this.systemlog = [];
		this.startTime = 0;
		this.enabled = false;
	}

	startSession() {
		this.sendRoom(`Isolation session started`);
		this.enabled = true;
		this.startTime = Date.now();
		this.authors = [];
		this.log = [];
		this.htmllog = [];
		this.systemlog = [];
	}

	endSession() {
		this.sendRoom(`Isolation session ended. ${this.authors.length} messages recorded`);
		this.enabled = false;
	}

	/**
	 * @param {string} m
	 */
	sendRoom(m) {
		Chat.sendMessage(this.room, m);
	}

	getTimestamp() {
		if (!this.startTime) return '[]';

		/**
		 * @param {number} v
		 */
		function p02d(v) {
			return v < 10 ? '0' + v : v;
		}
		const delta = Date.now() - this.startTime;

		let s = Math.floor(delta / 1000);
		let h = Math.floor(s / (60 * 60));
		s = s - h * 60 * 60;
		let m = Math.floor(s / 60);
		s = s - m * 60;
		return `[${h ? `${p02d(h)}:` : ''}${p02d(m)}:${p02d(s)}]`;
	}

	/**
	 * @param {string} author
	 * @param {string} message
	 */
	addChatMessage(author, message) {
		if (!this.enabled) return;
		const time = this.getTimestamp();
		this.authors.push([toId(author)]);
		this.log.push(`${time} ${author}: ${message}`);
		message = Tools.escapeHTML(message).replace(/>here.?</ig, 'here  ').replace(/(click) (here)/ig, (m, p1, p2) => `${p1}  ${p2}`);
		this.htmllog.push(`<div class="chat"><small>${time} ${author.charAt(0)}</small><strong style="${Tools.colourName(author)}">${author.slice(1)}:</strong> ${message}</div>`);
	}

	/**
	 * @param {string[]} authors
	 * @param {string} message
	 */
	addMessage(authors, message) {
		if (!this.enabled) return;
		const time = this.getTimestamp();
		if (authors[0] !== '~') authors = authors.map(toId);
		this.authors.push(authors);
		this.log.push(`${time} ${message}`);
		this.htmllog.push(`<div class="chat"><small>${time} </small><em>${Tools.escapeHTML(message)}</em></div>`);
	}
	/**
	 * @param {string} message
	 */
	addSystemMessage(message) {
		if (!this.enabled) return;
		this.systemlog.push(`${this.getTimestamp()} ${message}`);
	}
}

/**
 * @param {string} messageType
 * @param {string} roomid
 * @param {string[]} parts
 */
function parseChat(messageType, roomid, parts) {
	const author = parts[0];
	const message = parts.slice(1).join('|');

	const room = Rooms(roomid);
	if (!room || !room.iso) return;

	if (author === '~') return;
	if (message.startsWith('/log')) return;
	room.iso.addChatMessage(author, message);
}
/**
 * @param {string} event
 * @param {string} roomid
 * @param {string[]} details
 * @param {string} message
 */
function addLynch(event, roomid, details, message) {
	const room = Rooms(roomid);
	if (!room || !room.iso) return;
	room.iso.addMessage(details, message);
}
/**
 * @param {string} event
 * @param {string} roomid
 * @param {string[]} details
 * @param {string} message
 */
function addDay(event, roomid, details, message) {
	const room = Rooms(roomid);
	if (!room || !room.iso) return;
	room.iso.addMessage(['~'], `Day ${details[0]}. The hammer count is set at ${details[1]}`);
}
/**
 * @param {string} event
 * @param {string} roomid
 * @param {string[]} details
 * @param {string} message
 */
function addSystemMessage(event, roomid, details, message) {
	const room = Rooms(roomid);
	if (!room || !room.iso) return;
	room.iso.addSystemMessage(Tools.stripHTML(message));
}
/**
 * @param {string} event
 * @param {string} roomid
 */
function handleGames(event, roomid) {
	const room = Rooms(roomid);
	if (!room || !room.iso) return;
	if (event === 'gamestart') return room.iso.startSession();
	room.iso.endSession();
}

const listeners = {
	"iso": {
		rooms: true,
		messageTypes: ['chat'],
		repeat: true,
		callback: parseChat,
	},
};
const mafiaListeners = {
	"iso#lynches": {
		rooms: true,
		events: ['lynch', 'unlynch', 'lynchshift', 'nolynch', 'unnolynch'],
		repeat: true,
		callback: addLynch,
	},
	"iso#day": {
		rooms: true,
		events: ['day'],
		repeat: true,
		callback: addDay,
	},
	"iso#system": {
		rooms: true,
		events: ['night', 'day', 'kick', 'treestump', 'spirit', 'spiritstump', 'kill', 'revive', 'add', 'hammer', 'sethammer', 'shifthammer'],
		repeat: true,
		callback: addSystemMessage,
	},
	"iso#init": {
		rooms: true,
		events: ['gamestart', 'gameend'],
		repeat: true,
		callback: handleGames,
	},
};

/** @typedef {((this: CommandContext, target: string, room: Room?, user: string, cmd: string, message: string) => any)} ChatCommand */
/** @typedef {{[k: string]: string | ChatCommand}} ChatCommands */

/** @type {ChatCommands} */
const commands = {
	enableiso: function (target, room) {
		if (!this.can('roommanagement')) return false;
		if (!room) return;
		if (room.iso) return this.reply(`ISO already exists`);
		room.iso = new ISO(room.roomid);
		this.reply('Listener created');
	},

	istart: function (target, room, user) {
		if (!room || !room.iso) return;
		if (!this.can('games')) return;
		room.iso.startSession();
	},
	istop: function (target, room, user) {
		if (!room || !room.iso) return;
		if (!this.can('games')) return;
		room.iso.endSession();
	},
	i: 'isolation',
	isolate: 'isolation',
	si: 'isolation',
	gamelog: 'isolation',
	systemisolation: 'isolation',
	isolation: function (target, room, user, cmd, message) {
		if (room) return this.replyPM(`Please use this command in PMs :)`);
		let args = target.split(',').map(s => s.trim());
		if (!args.length) return;
		const userid = toId(user);

		// @ts-ignore guaranteed at this point
		room = Rooms(args[0]);
		if (room && room.iso) args.shift();

		if (!room) room = [...Rooms.rooms.values()].find(r => r.iso && r.mafiaTracker && r.mafiaTracker.players[userid]) || null;
		if (!room) room = Rooms(Config.primaryRoom);
		if (!room || !room.iso) return this.replyPM(`No room found, specify it as your first argument.`);

		let iso = room.iso;
		if (!iso) return false;
		if (!iso.authors.length) return this.reply(`No entries`);


		if (!Rooms.canPMInfobox(user)) return this.replyPM(`Can't PM you html, make sure you share a room in which I have the bot rank.`);
		const log = iso.htmllog;

		args = [...args.map(toId), '~'];
		let foundNames = {};
		let foundLog = [];
		let countLine = 'System messages';
		let system = false;
		if (cmd === 'si' || cmd === 'systemisolation' || cmd === 'gamelog') {
			foundLog = iso.systemlog;
			system = true;
		} else {
			for (let i = 0; i < iso.authors.length; i++) {
				const authors = iso.authors[i];
				for (const author of args) {
					if (authors.includes(author)) {
						if (!foundNames[author]) foundNames[author] = 0;
						foundNames[author]++;
						foundLog.push(log[i]);
						break;
					}
				}
			}
			delete foundNames['~'];
			if (!Object.keys(foundNames).length) return this.reply(`No entries found`);
			countLine = `ISO for ${Object.entries(foundNames).reduce((acc, [a, n]) => {
				if (a === '~') return acc;
				// @ts-ignore ???
				acc.push(`${a}: ${n} lines`);
				return acc;
			}, []).join('; ')}`;
		}
		let buf = `<details><summary>${countLine}</summary><div role="log">${foundLog.join(system ? '<br/>' : '')}</div></details>`;
		this.replyHTMLPM(buf);
	},
};

module.exports = {
	commands,
	listeners,
	mafiaListeners,
};
