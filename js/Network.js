// --- Network.js ----------------------------------------------------------
// PeerJS-based host/client networking for multiplayer (max 4 players).
// The host creates a room; clients join with a room code.
// All game state flows through the host who is authoritative.

import Peer from 'peerjs';

const ROOM_PREFIX = 'bzr-';
const MAX_PLAYERS = 4;
const STATE_SEND_RATE = 50; // ms between host state broadcasts (~20 Hz)

// --- Message types -------------------------------------------------------

export const MSG = {
	// Client -> Host
	INPUT: 'input',
	HELLO: 'hello',
	// Host -> Client
	STATE: 'state',
	PLAYER_JOINED: 'player_joined',
	PLAYER_LEFT: 'player_left',
	PLAYER_DESTROYED: 'player_destroyed',
	PLAYER_RESPAWNED: 'player_respawned',
	GAME_START: 'game_start',
	POWERUP_COLLECTED: 'powerup_collected',
	POWERUP_FIRED: 'powerup_fired',
	OBSTACLE_SYNC: 'obstacle_sync',
};

// --- Generate a short room code ------------------------------------------

function generateRoomCode() {

	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';

	for ( let i = 0; i < 4; i ++ ) {

		code += chars[ Math.floor( Math.random() * chars.length ) ];

	}

	return code;

}

// --- Network class -------------------------------------------------------

export class Network {

	constructor() {

		this.peer = null;
		this.isHost = false;
		this.roomCode = '';
		this.localId = '';
		this.localName = '';

		// Player names: playerId -> display name
		this.playerNames = new Map();

		// Host-only: connections keyed by peerId
		this.connections = new Map();
		// Host-only: peerId -> playerId mapping
		this.peerToPlayer = new Map();

		// Client-only: connection to host
		this.hostConnection = null;

		// Callbacks set by the consumer (main.js / PlayerManager).
		// Messages that arrive before a callback is set are queued
		// and replayed as soon as the callback is assigned.
		this._callbacks = {
			onPlayerJoined: null,
			onPlayerLeft: null,
			onInputReceived: null,
			onStateReceived: null,
			onGameStart: null,
			onPlayerDestroyed: null,
			onPlayerRespawned: null,
			onPowerupCollected: null,
			onPowerupFired: null,
			onObstacleSync: null,
			onConnected: null,
			onError: null,
		};

		// Queue of { name, args } for messages received before callback set
		this._pendingMessages = [];

		this._nextPlayerId = 1;
		this._stateInterval = null;

	}

	// --- Callback property accessors -----------------------------------------
	// When a callback is assigned, any queued messages for it are replayed
	// immediately. This solves the race condition where the host sends
	// PLAYER_JOINED before the client lobby has set onPlayerJoined.

	_setCallback( name, fn ) {

		this._callbacks[ name ] = fn;

		if ( ! fn ) return;

		// Replay any pending messages for this callback
		const remaining = [];

		for ( let i = 0; i < this._pendingMessages.length; i ++ ) {

			const msg = this._pendingMessages[ i ];

			if ( msg.name === name ) {

				fn( ...msg.args );

			} else {

				remaining.push( msg );

			}

		}

		this._pendingMessages = remaining;

	}

	_fireCallback( name, ...args ) {

		const fn = this._callbacks[ name ];

		if ( fn ) {

			fn( ...args );

		} else {

			this._pendingMessages.push( { name, args } );

		}

	}

	get onPlayerJoined() { return this._callbacks.onPlayerJoined; }
	set onPlayerJoined( fn ) { this._setCallback( 'onPlayerJoined', fn ); }

	get onPlayerLeft() { return this._callbacks.onPlayerLeft; }
	set onPlayerLeft( fn ) { this._setCallback( 'onPlayerLeft', fn ); }

	get onInputReceived() { return this._callbacks.onInputReceived; }
	set onInputReceived( fn ) { this._setCallback( 'onInputReceived', fn ); }

	get onStateReceived() { return this._callbacks.onStateReceived; }
	set onStateReceived( fn ) { this._setCallback( 'onStateReceived', fn ); }

	get onGameStart() { return this._callbacks.onGameStart; }
	set onGameStart( fn ) { this._setCallback( 'onGameStart', fn ); }

	get onPlayerDestroyed() { return this._callbacks.onPlayerDestroyed; }
	set onPlayerDestroyed( fn ) { this._setCallback( 'onPlayerDestroyed', fn ); }

	get onPlayerRespawned() { return this._callbacks.onPlayerRespawned; }
	set onPlayerRespawned( fn ) { this._setCallback( 'onPlayerRespawned', fn ); }

	get onPowerupCollected() { return this._callbacks.onPowerupCollected; }
	set onPowerupCollected( fn ) { this._setCallback( 'onPowerupCollected', fn ); }

	get onPowerupFired() { return this._callbacks.onPowerupFired; }
	set onPowerupFired( fn ) { this._setCallback( 'onPowerupFired', fn ); }

	get onObstacleSync() { return this._callbacks.onObstacleSync; }
	set onObstacleSync( fn ) { this._setCallback( 'onObstacleSync', fn ); }

	get onConnected() { return this._callbacks.onConnected; }
	set onConnected( fn ) { this._setCallback( 'onConnected', fn ); }

	get onError() { return this._callbacks.onError; }
	set onError( fn ) { this._setCallback( 'onError', fn ); }

	// --- Host: create a room -------------------------------------------------

	host() {

		return new Promise( ( resolve, reject ) => {

			this.isHost = true;
			this.roomCode = generateRoomCode();
			const peerId = ROOM_PREFIX + this.roomCode;

			this.peer = new Peer( peerId );

			this.peer.on( 'open', ( id ) => {

				this.localId = 'player0';
				this.peerToPlayer.set( id, this.localId );
				this.playerNames.set( this.localId, this.localName || 'Host' );
				resolve( this.roomCode );

			} );

			this.peer.on( 'connection', ( conn ) => {

				if ( this.connections.size >= MAX_PLAYERS - 1 ) {

					conn.close();
					return;

				}

				this._setupHostConnection( conn );

			} );

			this.peer.on( 'error', ( err ) => {

				this._fireCallback( 'onError', err );
				reject( err );

			} );

		} );

	}

	// --- Client: join a room -------------------------------------------------

	join( roomCode ) {

		return new Promise( ( resolve, reject ) => {

			this.isHost = false;
			this.roomCode = roomCode.toUpperCase();
			const hostPeerId = ROOM_PREFIX + this.roomCode;

			this.peer = new Peer();

			this.peer.on( 'open', () => {

				const conn = this.peer.connect( hostPeerId, { reliable: true } );

				conn.on( 'open', () => {

					this.hostConnection = conn;

					// Send our name to the host
					conn.send( { type: MSG.HELLO, name: this.localName || 'Player' } );

					conn.on( 'data', ( data ) => {

						this._handleClientMessage( data );

					} );

					conn.on( 'close', () => {

						this._fireCallback( 'onError', new Error( 'Host disconnected' ) );

					} );

					this._fireCallback( 'onConnected' );
					resolve();

				} );

				conn.on( 'error', ( err ) => {

					this._fireCallback( 'onError', err );
					reject( err );

				} );

			} );

			this.peer.on( 'error', ( err ) => {

				this._fireCallback( 'onError', err );
				reject( err );

			} );

		} );

	}

	// --- Host: setup a new peer connection -----------------------------------

	_setupHostConnection( conn ) {

		conn.on( 'open', () => {

			// Wait for the client to send HELLO with their name before
			// assigning a playerId and announcing them to the lobby.
			let registered = false;

			conn.on( 'data', ( data ) => {

				if ( ! registered && data.type === MSG.HELLO ) {

					registered = true;
					const clientName = data.name || 'Player';

					const playerId = 'player' + this._nextPlayerId;
					this._nextPlayerId ++;

					this.connections.set( conn.peer, conn );
					this.peerToPlayer.set( conn.peer, playerId );
					this.playerNames.set( playerId, clientName );

					// Build current player list and names map
					const players = [ this.localId ];
					const names = {};
					names[ this.localId ] = this.playerNames.get( this.localId );

					for ( const [ , pid ] of this.peerToPlayer ) {

						if ( pid !== this.localId && pid !== playerId ) {

							players.push( pid );
							names[ pid ] = this.playerNames.get( pid );

						}

					}

					players.push( playerId );
					names[ playerId ] = clientName;

					conn.send( {
						type: MSG.PLAYER_JOINED,
						playerId,
						players,
						names,
					} );

					// Tell existing clients about the new player
					this._broadcastExcept( conn.peer, {
						type: MSG.PLAYER_JOINED,
						playerId,
						players,
						names,
					} );

					this._fireCallback( 'onPlayerJoined', playerId );

				} else if ( registered ) {

					this._handleHostMessage( conn.peer, data );

				}

			} );

			conn.on( 'close', () => {

				const pid = this.peerToPlayer.get( conn.peer );
				this.connections.delete( conn.peer );
				this.peerToPlayer.delete( conn.peer );

				if ( pid ) this.playerNames.delete( pid );

				this._broadcast( {
					type: MSG.PLAYER_LEFT,
					playerId: pid,
				} );

				this._fireCallback( 'onPlayerLeft', pid );

			} );

		} );

	}

	// --- Host: handle message from a client ----------------------------------

	_handleHostMessage( peerId, data ) {

		const playerId = this.peerToPlayer.get( peerId );

		if ( data.type === MSG.INPUT ) {

			this._fireCallback( 'onInputReceived', playerId, data.input );

		}

	}

	// --- Client: handle message from host ------------------------------------

	_handleClientMessage( data ) {

		switch ( data.type ) {

			case MSG.PLAYER_JOINED:
				this.localId = this.localId || data.playerId;
				if ( data.names ) {

					for ( const pid in data.names ) {

						this.playerNames.set( pid, data.names[ pid ] );

					}

				}

				this._fireCallback( 'onPlayerJoined', data.playerId, data.players );
				break;

			case MSG.PLAYER_LEFT:
				this._fireCallback( 'onPlayerLeft', data.playerId );
				break;

			case MSG.STATE:
				this._fireCallback( 'onStateReceived', data.state );
				break;

			case MSG.GAME_START:
				if ( data.names ) {

					for ( const pid in data.names ) {

						this.playerNames.set( pid, data.names[ pid ] );

					}

				}

				this._fireCallback( 'onGameStart', data );
				break;

			case MSG.PLAYER_DESTROYED:
				this._fireCallback( 'onPlayerDestroyed', data.playerId );
				break;

			case MSG.PLAYER_RESPAWNED:
				this._fireCallback( 'onPlayerRespawned', data.playerId );
				break;

			case MSG.POWERUP_COLLECTED:
				this._fireCallback( 'onPowerupCollected', data );
				break;

			case MSG.POWERUP_FIRED:
				this._fireCallback( 'onPowerupFired', data );
				break;

			case MSG.OBSTACLE_SYNC:
				this._fireCallback( 'onObstacleSync', data );
				break;

		}

	}

	// --- Host: broadcast to all clients --------------------------------------

	_broadcast( data ) {

		for ( const [ , conn ] of this.connections ) {

			if ( conn.open ) conn.send( data );

		}

	}

	_broadcastExcept( peerId, data ) {

		for ( const [ pid, conn ] of this.connections ) {

			if ( pid !== peerId && conn.open ) conn.send( data );

		}

	}

	// --- Host: start game broadcast ------------------------------------------

	startGame( mapParam ) {

		const players = [ this.localId ];

		for ( const [ , pid ] of this.peerToPlayer ) {

			if ( pid !== this.localId ) players.push( pid );

		}

		const names = {};

		for ( const pid of players ) {

			names[ pid ] = this.playerNames.get( pid ) || pid;

		}

		const data = {
			type: MSG.GAME_START,
			players,
			names,
			mapParam: mapParam || null,
		};

		this._broadcast( data );

		this._fireCallback( 'onGameStart', data );

	}

	// --- Host: send authoritative state to all clients -----------------------

	sendState( stateObj ) {

		this._broadcast( {
			type: MSG.STATE,
			state: stateObj,
		} );

	}

	// --- Client: send input to host ------------------------------------------

	sendInput( input ) {

		if ( this.hostConnection && this.hostConnection.open ) {

			this.hostConnection.send( {
				type: MSG.INPUT,
				input,
			} );

		}

	}

	// --- Host: notify player destroyed / respawned ---------------------------

	sendPlayerDestroyed( playerId ) {

		this._broadcast( { type: MSG.PLAYER_DESTROYED, playerId } );

	}

	sendPlayerRespawned( playerId ) {

		this._broadcast( { type: MSG.PLAYER_RESPAWNED, playerId } );

	}

	// --- Host: notify powerup events -----------------------------------------

	sendPowerupCollected( playerId, powerupType ) {

		this._broadcast( { type: MSG.POWERUP_COLLECTED, playerId, powerupType } );

	}

	sendPowerupFired( playerId, powerupType, position, direction ) {

		this._broadcast( {
			type: MSG.POWERUP_FIRED,
			playerId,
			powerupType,
			position,
			direction,
		} );

	}

	// --- Host: obstacle sync (box wall, speedboat spawn/destroy) -------------

	sendObstacleSync( data ) {

		this._broadcast( { type: MSG.OBSTACLE_SYNC, ...data } );

	}

	// --- Get current player count --------------------------------------------

	getPlayerCount() {

		if ( this.isHost ) {

			return this.connections.size + 1; // +1 for host

		}

		return 0; // clients don't track this

	}

	// --- Get all player IDs --------------------------------------------------

	getPlayerIds() {

		if ( this.isHost ) {

			const ids = [ this.localId ];

			for ( const [ , pid ] of this.peerToPlayer ) {

				if ( pid !== this.localId ) ids.push( pid );

			}

			return ids;

		}

		return [];

	}

	// --- Get display name for a player ---------------------------------------

	getPlayerName( playerId ) {

		return this.playerNames.get( playerId ) || playerId;

	}

	// --- Cleanup -------------------------------------------------------------

	destroy() {

		if ( this._stateInterval ) {

			clearInterval( this._stateInterval );
			this._stateInterval = null;

		}

		if ( this.peer ) {

			this.peer.destroy();
			this.peer = null;

		}

	}

}
