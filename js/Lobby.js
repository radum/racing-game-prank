// --- Lobby.js ------------------------------------------------------------
// DOM-based lobby UI for multiplayer: host/join screen, room code, player
// list, and start game button. Returns a promise that resolves with the
// chosen mode and network details.

const MAX_PLAYERS = 4;

const PLAYER_COLORS = [ '#ff4444', '#44aaff', '#44cc44', '#ffaa00' ];
const PLAYER_NAMES = [ 'Player 1', 'Player 2', 'Player 3', 'Player 4' ];

// --- CSS -----------------------------------------------------------------

const LOBBY_CSS = `
	.lobby-overlay {
		position: absolute; inset: 0;
		display: flex; align-items: center; justify-content: center;
		background: rgba(0, 0, 0, 0.85);
		z-index: 100;
		font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		color: #fff;
	}
	.lobby-panel {
		background: #1a1a2e;
		border-radius: 16px;
		padding: 32px 40px;
		min-width: 340px;
		max-width: 420px;
		text-align: center;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}
	.lobby-title {
		font-size: 28px;
		font-weight: bold;
		margin-bottom: 8px;
	}
	.lobby-subtitle {
		font-size: 14px;
		opacity: 0.5;
		margin-bottom: 24px;
	}
	.lobby-btn {
		display: block;
		width: 100%;
		padding: 14px;
		margin-bottom: 12px;
		border: none;
		border-radius: 10px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s, transform 0.1s;
	}
	.lobby-btn:hover { transform: scale(1.02); }
	.lobby-btn:active { transform: scale(0.98); }
	.lobby-btn-primary {
		background: #4488ff;
		color: #fff;
	}
	.lobby-btn-primary:hover { background: #5599ff; }
	.lobby-btn-secondary {
		background: #2a2a4a;
		color: #ccc;
		border: 1px solid #444;
	}
	.lobby-btn-secondary:hover { background: #3a3a5a; }
	.lobby-btn-solo {
		background: transparent;
		color: #888;
		font-size: 13px;
		margin-top: 8px;
	}
	.lobby-btn-solo:hover { color: #bbb; }
	.lobby-input {
		width: 100%;
		padding: 14px;
		border: 2px solid #444;
		border-radius: 10px;
		background: #0f0f23;
		color: #fff;
		font-size: 22px;
		font-weight: bold;
		text-align: center;
		letter-spacing: 8px;
		text-transform: uppercase;
		margin-bottom: 12px;
		box-sizing: border-box;
		outline: none;
	}
	.lobby-input:focus { border-color: #4488ff; }
	.lobby-input::placeholder {
		letter-spacing: 2px;
		font-size: 14px;
		opacity: 0.4;
	}
	.lobby-room-code {
		font-size: 48px;
		font-weight: bold;
		letter-spacing: 10px;
		color: #ffcc00;
		margin: 16px 0;
		user-select: all;
	}
	.lobby-room-label {
		font-size: 12px;
		text-transform: uppercase;
		opacity: 0.5;
		margin-bottom: 4px;
	}
	.lobby-players {
		list-style: none;
		padding: 0;
		margin: 16px 0;
		text-align: left;
	}
	.lobby-players li {
		padding: 8px 12px;
		margin-bottom: 4px;
		border-radius: 8px;
		background: #0f0f23;
		font-size: 14px;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.lobby-player-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
	}
	.lobby-player-you {
		font-size: 11px;
		opacity: 0.4;
		margin-left: auto;
	}
	.lobby-waiting {
		font-size: 13px;
		opacity: 0.5;
		margin: 8px 0;
	}
	.lobby-error {
		color: #ff4444;
		font-size: 13px;
		margin: 8px 0;
	}
	.lobby-back {
		background: none;
		border: none;
		color: #888;
		font-size: 13px;
		cursor: pointer;
		margin-top: 8px;
		padding: 4px 12px;
	}
	.lobby-back:hover { color: #ccc; }
	.lobby-status {
		font-size: 13px;
		opacity: 0.6;
		margin: 12px 0;
	}
`;

// --- Lobby class ---------------------------------------------------------

export class Lobby {

	constructor() {

		this.overlay = null;
		this.panel = null;
		this._resolve = null;
		this._network = null;

	}

	// Show the lobby and return a promise that resolves with the result
	// { mode: 'singleplayer' } or { mode: 'multiplayer', network, isHost }
	show( network ) {

		this._network = network;

		return new Promise( ( resolve ) => {

			this._resolve = resolve;
			this._injectCSS();
			this._showMainMenu();

		} );

	}

	_injectCSS() {

		if ( document.getElementById( 'lobby-css' ) ) return;

		const style = document.createElement( 'style' );
		style.id = 'lobby-css';
		style.textContent = LOBBY_CSS;
		document.head.appendChild( style );

	}

	_createOverlay() {

		this.destroy();

		this.overlay = document.createElement( 'div' );
		this.overlay.className = 'lobby-overlay';

		this.panel = document.createElement( 'div' );
		this.panel.className = 'lobby-panel';

		this.overlay.appendChild( this.panel );
		document.body.appendChild( this.overlay );

		return this.panel;

	}

	// --- Main Menu -----------------------------------------------------------

	_showMainMenu() {

		const panel = this._createOverlay();

		panel.innerHTML = `
			<div class="lobby-title">Beyond Zero Racing</div>
			<div class="lobby-subtitle">Multiplayer Arena</div>
			<button class="lobby-btn lobby-btn-primary" id="lobby-host">Host Game</button>
			<button class="lobby-btn lobby-btn-secondary" id="lobby-join">Join Game</button>
			<button class="lobby-btn lobby-btn-solo" id="lobby-solo">Play Solo</button>
		`;

		panel.querySelector( '#lobby-host' ).onclick = () => this._showHostScreen();
		panel.querySelector( '#lobby-join' ).onclick = () => this._showJoinScreen();
		panel.querySelector( '#lobby-solo' ).onclick = () => {

			this.destroy();
			this._resolve( { mode: 'singleplayer' } );

		};

	}

	// --- Host Screen ---------------------------------------------------------

	_showHostScreen() {

		const panel = this._createOverlay();

		panel.innerHTML = `
			<div class="lobby-title">Hosting...</div>
			<div class="lobby-status">Creating room...</div>
		`;

		this._network.host().then( ( roomCode ) => {

			this._showHostLobby( roomCode );

		} ).catch( ( err ) => {

			panel.innerHTML = `
				<div class="lobby-title">Error</div>
				<div class="lobby-error">${ err.message || 'Could not create room' }</div>
				<button class="lobby-back" id="lobby-back">Back</button>
			`;

			panel.querySelector( '#lobby-back' ).onclick = () => this._showMainMenu();

		} );

	}

	_showHostLobby( roomCode ) {

		const panel = this._createOverlay();
		const players = [ this._network.localId ];

		const render = () => {

			const playerListHTML = players.map( ( pid, i ) => {

				const color = PLAYER_COLORS[ i ] || '#888';
				const name = PLAYER_NAMES[ i ] || ( 'Player ' + ( i + 1 ) );
				const you = pid === this._network.localId ? '<span class="lobby-player-you">(you)</span>' : '';
				return `<li><span class="lobby-player-dot" style="background:${ color }"></span>${ name }${ you }</li>`;

			} ).join( '' );

			const canStart = players.length >= 2;

			panel.innerHTML = `
				<div class="lobby-room-label">Room Code</div>
				<div class="lobby-room-code">${ roomCode }</div>
				<div class="lobby-subtitle">Share this code with friends to join</div>
				<ul class="lobby-players">${ playerListHTML }</ul>
				<div class="lobby-waiting">Waiting for players... (${ players.length }/${ MAX_PLAYERS })</div>
				<button class="lobby-btn lobby-btn-primary" id="lobby-start" ${ canStart ? '' : 'disabled style="opacity:0.4;cursor:not-allowed"' }>Start Game</button>
				<button class="lobby-back" id="lobby-back">Cancel</button>
			`;

			if ( canStart ) {

				panel.querySelector( '#lobby-start' ).onclick = () => {

					const mapParam = new URLSearchParams( window.location.search ).get( 'map' );
					this._network.startGame( mapParam );
					this.destroy();
					this._resolve( { mode: 'multiplayer', network: this._network, isHost: true } );

				};

			}

			panel.querySelector( '#lobby-back' ).onclick = () => {

				this._network.destroy();
				this._showMainMenu();

			};

		};

		render();

		this._network.onPlayerJoined = ( playerId ) => {

			if ( ! players.includes( playerId ) ) players.push( playerId );
			render();

		};

		this._network.onPlayerLeft = ( playerId ) => {

			const idx = players.indexOf( playerId );
			if ( idx !== - 1 ) players.splice( idx, 1 );
			render();

		};

	}

	// --- Join Screen ---------------------------------------------------------

	_showJoinScreen() {

		const panel = this._createOverlay();

		panel.innerHTML = `
			<div class="lobby-title">Join Game</div>
			<div class="lobby-subtitle">Enter the 4-letter room code</div>
			<input class="lobby-input" id="lobby-code" type="text" maxlength="4" placeholder="ABCD" autocomplete="off" autocapitalize="characters" spellcheck="false">
			<button class="lobby-btn lobby-btn-primary" id="lobby-connect">Connect</button>
			<div class="lobby-error" id="lobby-error" style="display:none"></div>
			<button class="lobby-back" id="lobby-back">Back</button>
		`;

		const input = panel.querySelector( '#lobby-code' );
		const errorEl = panel.querySelector( '#lobby-error' );

		input.focus();

		panel.querySelector( '#lobby-connect' ).onclick = () => {

			const code = input.value.trim().toUpperCase();

			if ( code.length !== 4 ) {

				errorEl.textContent = 'Room code must be 4 characters';
				errorEl.style.display = 'block';
				return;

			}

			errorEl.style.display = 'none';
			this._showJoining( code );

		};

		input.addEventListener( 'keydown', ( e ) => {

			if ( e.key === 'Enter' ) {

				panel.querySelector( '#lobby-connect' ).click();

			}

		} );

		panel.querySelector( '#lobby-back' ).onclick = () => this._showMainMenu();

	}

	_showJoining( code ) {

		const panel = this._createOverlay();

		panel.innerHTML = `
			<div class="lobby-title">Connecting...</div>
			<div class="lobby-status">Joining room ${ code }...</div>
		`;

		this._network.join( code ).then( () => {

			this._showClientLobby( code );

		} ).catch( ( err ) => {

			panel.innerHTML = `
				<div class="lobby-title">Connection Failed</div>
				<div class="lobby-error">${ err.message || 'Could not connect to room' }</div>
				<button class="lobby-back" id="lobby-back">Back</button>
			`;

			panel.querySelector( '#lobby-back' ).onclick = () => this._showMainMenu();

		} );

	}

	_showClientLobby( code ) {

		const panel = this._createOverlay();
		let players = [];

		const render = () => {

			const playerListHTML = players.map( ( pid, i ) => {

				const color = PLAYER_COLORS[ i ] || '#888';
				const name = PLAYER_NAMES[ i ] || ( 'Player ' + ( i + 1 ) );
				const you = pid === this._network.localId ? '<span class="lobby-player-you">(you)</span>' : '';
				return `<li><span class="lobby-player-dot" style="background:${ color }"></span>${ name }${ you }</li>`;

			} ).join( '' );

			panel.innerHTML = `
				<div class="lobby-room-label">Room</div>
				<div class="lobby-room-code">${ code }</div>
				<ul class="lobby-players">${ playerListHTML }</ul>
				<div class="lobby-waiting">Waiting for host to start...</div>
				<button class="lobby-back" id="lobby-back">Leave</button>
			`;

			panel.querySelector( '#lobby-back' ).onclick = () => {

				this._network.destroy();
				this._showMainMenu();

			};

		};

		render();

		this._network.onPlayerJoined = ( playerId, playerList ) => {

			if ( playerList ) players = playerList;
			else if ( ! players.includes( playerId ) ) players.push( playerId );
			render();

		};

		this._network.onPlayerLeft = ( playerId ) => {

			const idx = players.indexOf( playerId );
			if ( idx !== - 1 ) players.splice( idx, 1 );
			render();

		};

		this._network.onGameStart = ( data ) => {

			this.destroy();
			this._resolve( { mode: 'multiplayer', network: this._network, isHost: false, gameData: data } );

		};

	}

	// --- Multiplayer HUD (shown during game) ---------------------------------

	static createGameHUD() {

		const container = document.createElement( 'div' );
		container.id = 'mp-hud';
		container.style.cssText = 'position:absolute;top:16px;left:16px;z-index:20;pointer-events:none;' +
			'font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;';
		document.body.appendChild( container );

		return container;

	}

	static updateGameHUD( container, players ) {

		if ( ! container ) return;

		let html = '';

		for ( let i = 0; i < players.length; i ++ ) {

			const p = players[ i ];
			const color = PLAYER_COLORS[ i ] || '#888';
			const name = PLAYER_NAMES[ i ] || ( 'Player ' + ( i + 1 ) );
			const status = p.alive ? '' : '<span style="color:#ff4444;font-size:11px;margin-left:6px">DESTROYED</span>';
			const respawn = ( ! p.alive && p.respawnTimer > 0 )
				? '<span style="color:#ffaa00;font-size:11px;margin-left:4px">' + Math.ceil( p.respawnTimer ) + 's</span>'
				: '';

			html += '<div style="margin-bottom:4px;font-size:13px;opacity:0.9">' +
				'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:6px"></span>' +
				name + status + respawn + '</div>';

		}

		container.innerHTML = html;

	}

	// --- Destroy overlay -----------------------------------------------------

	destroy() {

		if ( this.overlay ) {

			this.overlay.remove();
			this.overlay = null;
			this.panel = null;

		}

	}

}

export { PLAYER_COLORS, PLAYER_NAMES, MAX_PLAYERS };
