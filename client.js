'use strict';

const WebSocketClient = require('websocket').client;
const https = require('https');

/**
 * @param {string} roomid
 * @return {string}
 */
function quickToRoomid(roomid) {
	return roomid.toLowerCase().replace(/[^a-z0-9-]+/g, '');
}

/**
 * @typedef {function} ParserCallback
 * @param {string} roomid
 * @param {string} messageType
 * @param {string[]} parts
 */

/**
 * @typedef {function} PageParserCallback
 * @param {string} roomid
 * @param {string} body
 */

class Client {
	/**
	 * @param {ParserCallback} parser
	 * @param {PageParserCallback} pageParser
	 */
	constructor(parser, pageParser) {
		this.connected = false;
		this.closed = false;
		/** @type {WebSocketClient?} */
		this.socket = null;
		/** @type {any?} */ // not sure what this would be called
		this.connection = null;
		this.challstr = '';
		/** @type {string[]} */
		this.sendQueue = [];
		/** @type {NodeJS.Timer?} */
		this.sendTimeout = null;
		/** @type {string[]?} */
		this.extraJoin = null;
		/**
		 * @param {string} roomid
		 * @param {string} messageType
		 * @param {string[]} parts
		 */
		/** @type {ParserCallback} */
		this.messageCallback = parser;
		/** @type {PageParserCallback} */
		this.pageCallback = pageParser;
	}

	connect() {
		this.socket = new WebSocketClient();
		this.socket.on('connectionFailed', (/** @type {string} */e) => {
			console.log(`Connection failed!`);
		});
		this.socket.on('connect', (/** @type {object} */connection) => {
			console.log(`Connected!`);
			this.connected = true;
			this.connection = connection;

			connection.on('close', () => {
				console.log(`Connection closed`);
				if (Config.reconnectTime) {
					console.log(`Retrying in ${Config.reconnectTime} seconds...`);
					setTimeout(() => this.connect(), Config.reconnectTime * 1000);
				}
			});
			connection.on('message', (/** @type {object }*/message) => this.onMessage(message));
		});
		this.socket.on('error', (/** @type {string} */e) => {
			console.log(`Error with connection: ${e}`);
		});
		this.socket.on('connectFailed', (/** @type {string} */e) => {
			console.log(`Connection failed: ${e}`);
			if (Config.reconnectTime) {
				console.log(`Retrying in ${Config.reconnectTime} seconds...`);
				setTimeout(() => this.connect(), Config.reconnectTime * 1000);
			}
		});
		this.closed = false;
		const conStr = `ws://${Config.server}:${Config.port}/showdown/websocket`;
		console.log(`Connecting to ${Config.server}:${Config.port}...`);
		this.socket.connect(conStr);
	}

	disconnect() {
		this.closed = true;
		if (this.connection) this.connection.close();
	}

	/**
	 * @param {string | string[]} data
	 */
	send(data) {
		if (!(data && this.connection && this.connection.connected)) {
			return debug(`Failed to send data: ${data ? 'disconnected from the server' : 'no data to send'}`);
		}
		if (Array.isArray(data)) {
			for (const toSend of data) this.send(toSend);
			return;
		}
		if (this.sendTimeout) {
			this.sendQueue.push(data);
			return;
		}
		this.connection.send(data);
		this.sendTimeout = setTimeout(() => {
			this.sendTimeout = null;
			const toSend = this.sendQueue.shift();
			if (toSend) this.send(toSend);
		}, 600);
	}

	/**
	 * @param {object} message
	 */
	onMessage(message) {
		if (!(message.type === 'utf8' && message.utf8Data)) return;
		let roomid = 'lobby';
		if (!message.utf8Data.includes('\n')) return this.parseMessage(roomid, message.utf8Data);

		let lines = message.utf8Data.split('\n');
		if (lines[0].charAt(0) === '>') roomid = quickToRoomid(lines.shift());

		// Cheap hack
		if (roomid.startsWith('view-')) return this.pageCallback(roomid, lines.join('\n'));

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].startsWith('|init|')) {
				this.parseMessage(roomid, lines[i]);
				lines = lines.slice(i + 1);
				for (let i = 0; i < lines.length; i++) {
					if (lines[i].startsWith('|users|')) {
						this.parseMessage(roomid, lines[i]);
						break;
					}
				}
				return;
			}
			if (lines[i]) this.parseMessage(roomid, lines[i]);
		}
	}

	/**
	 * @param {string} roomid
	 * @param {string} message
	 */
	parseMessage(roomid, message) {
		let [messageType, ...parts] = message.split('|').slice(1);
		if (!messageType) {
			messageType = '';
			parts = [message];
		}
		log(`roomid = ${roomid} | messageType = ${messageType} | parts = ${JSON.stringify(parts)}`);

		switch (messageType) {
		case 'challstr': {
			this.challstr = parts.join('|');
			const reqOptions = {
				hostname: "play.pokemonshowdown.com",
				path: "/~~showdown/action.php",
				agent: false,
			};

			let loginQuerystring;
			if (!Config.pass) {
				reqOptions.method = 'GET';
				reqOptions.path += `?act=getassertion&userid=${toId(Config.nick)}&challstr=${this.challstr}`;
			} else {
				reqOptions.method = 'POST';
				loginQuerystring = `act=login&name=${toId(Config.nick)}&pass=${Config.pass}&challstr=${this.challstr}`;
				reqOptions.headers = {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Content-Length': loginQuerystring.length,
				};
			}
			debug(`Sending login to ${reqOptions.hostname}`);

			const req = https.request(reqOptions, res => {
				res.setEncoding('utf8');
				let data = '';
				res.on('data', chunk => {
					data += chunk;
				});
				res.on('end', () => {
					if (data === ';') {
						console.log(`LOGIN FAILED - The name ${Config.nick} is registered and ${Config.pass ? 'an invalid' : 'no'} password was provided.`);
						process.exit(1);
					}
					if (data.length < 50) {
						console.log(`LOGIN FAILED - ${data}`);
						process.exit(1);
					}
					if (data.indexOf('heavy load') > -1) {
						console.log(`LOGIN FAILED - The login server is experiencing heavy load and cannot accommodate the bot's connection right now.`);
						process.exit(1);
					}
					try {
						const dataObject = JSON.parse(data.slice(1));
						if (dataObject.actionsuccess) {
							data = dataObject.assertion;
						} else {
							console.log(`Unable to login; the request was unsuccessful\n${JSON.stringify(data)}\n`);
							process.exit(1);
						}
					} catch (e) {}
					// Autojoining should be handled before sending /trn; since only
					// eleven rooms can be autojoined at a time, leave any extras to
					// be joined manually. (This allows the server to remember the first
					// eleven if you happen to cut back on rooms)
					if (Config.autojoin.length) {
						const [autojoin, extra] = [Config.autojoin.slice(0, 11), Config.autojoin.slice(11)];
						this.send(`|/autojoin ${autojoin.join(',')}`);
						if (extra.length) this.extraJoin = extra;
					}
					this.send(`|/trn ${Config.nick},0,${data}`);
				});
			});
			req.on('error', e => {
				console.error(`Error while logging in: ${e.stack}`);
				return;
			});
			if (loginQuerystring) req.write(loginQuerystring);
			req.end();
			break;
		}
		case 'updateuser': {
			// |updateuser| is sent twice by the server; the first time is sent to tell the client
			// that the websocket has connected to the server as a guest, since they haven't logged
			// in yet.
			// The formatting is `|updateuser|USERNAME|LOGINSTATUS|AVATAR`, where REGISTERED is either
			// '0' (guest user) or '1' (actually logged in). We only want the latter so we can actually
			// do stuff.
			const [serverName, loginStatus] = parts;
			if (serverName !== Config.nick) return;
			if (loginStatus !== '1') {
				console.log("UPDATEUSER - failed to log in, still a guest");
				process.exit(1);
			}
			if (Config.avatar) this.send(`|/avatar ${Config.avatar}`);

			// Since autojoining happened before sending /trn, now we can join any extra rooms.
			if (this.extraJoin) this.send(this.extraJoin.map(roomid => `|/join ${roomid}`));
			break;
		}
		case 'nametaken': {
			if (parts[1].includes('inappropriate')) {
				console.log(`FORCE-RENAMED - A global staff member considered this bot's username (${Config.nick}) inappropriate\nPlease rename the bot to something more appropriate`);
				process.exit(1);
			}
			debug(`NAMETAKEN: ${JSON.stringify(parts)}`);
			break;
		}
		default:
			this.messageCallback(roomid, messageType, parts);
		}
	}
}

module.exports = Client;
