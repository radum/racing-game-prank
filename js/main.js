import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle } from './Vehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, decodeCells, computeSpawnPosition, computeSpawnPositions, computeTrackBounds } from './Track.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { GameAudio } from './Audio.js';
import { BoxWall } from './BoxWall.js';
import { SpeedBoat } from './SpeedBoat.js';
import { Powerups } from './Powerups.js';
import { Network } from './Network.js';
import { Lobby } from './Lobby.js';
import { PlayerManager } from './PlayerManager.js';


const renderer = new THREE.WebGLRenderer( { antialias: true, outputBufferType: THREE.HalfFloatType } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ) );
bloomPass.strength = 0.02;
bloomPass.radius = 0.02;
bloomPass.threshold = 0.5;

renderer.setEffects( [ bloomPass ] );

document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xadb2ba );
scene.fog = new THREE.Fog( 0xadb2ba, 30, 55 );

const dirLight = new THREE.DirectionalLight( 0xffffff, 5 );
dirLight.position.set( 11.4, 15, -5.3 );
dirLight.castShadow = true;
dirLight.shadow.mapSize.setScalar( 4096 );
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 60;
scene.add( dirLight );

const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 1.5 );
scene.add( hemiLight );


window.addEventListener( 'resize', () => {

	renderer.setSize( window.innerWidth, window.innerHeight );

} );

const loader = new GLTFLoader();
const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	'track-straight', 'track-corner', 'track-bump', 'track-finish',
	'decoration-empty', 'decoration-forest', 'decoration-tents',
	'speed_boat_03',
	'vehicle-toyota_bz4x'
];

const models = {};

async function loadModels() {

	const promises = modelNames.map( ( name ) =>
		new Promise( ( resolve, reject ) => {

			loader.load( `models/${ name }.glb`, ( gltf ) => {

				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh ) {

						child.material.side = THREE.FrontSide;

					}

				} );

				// Godot imports vehicle models at root_scale=0.5
				if ( name.startsWith( 'vehicle-' ) ) {

					gltf.scene.scale.setScalar( 0.35 );

				}

				models[ name ] = gltf.scene;
				resolve();

			}, undefined, reject );

		} )
	);

	await Promise.all( promises );

}

// --- Shared scene setup --------------------------------------------------

function setupScene( customCells ) {

	const bounds = computeTrackBounds( customCells );
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;
	const groundSize = Math.max( hw, hd ) * 2 + 20;

	const shadowExtent = Math.max( hw, hd ) + 10;
	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();

	scene.fog.near = groundSize * 0.4;
	scene.fog.far = groundSize * 0.8;

	buildTrack( scene, models, customCells );

	return { bounds, groundSize };

}

function setupPhysics( bounds, groundSize, customCells ) {

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, - 9.81, 0 ];

	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );

	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );

	const world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	buildWallColliders( world, null, customCells );

	const roadHalf = groundSize / 2;
	rigidBody.create( world, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, - 0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	return world;

}

// --- Parse map parameter -------------------------------------------------

function parseMapParam() {

	const mapParam = new URLSearchParams( window.location.search ).get( 'map' );
	let customCells = null;
	let spawn = null;

	if ( mapParam ) {

		try {

			customCells = decodeCells( mapParam );
			spawn = computeSpawnPosition( customCells );

		} catch ( e ) {

			console.warn( 'Invalid map parameter, using default track' );

		}

	}

	return { customCells, spawn, mapParam };

}

// --- Singleplayer init (unchanged from original) -------------------------

function initSingleplayer( customCells, spawn ) {

	const { bounds, groundSize } = setupScene( customCells );
	const world = setupPhysics( bounds, groundSize, customCells );

	const sphereBody = createSphereBody( world, spawn ? spawn.position : null );

	const vehicle = new Vehicle();
	vehicle.rigidBody = sphereBody;
	vehicle.physicsWorld = world;

	if ( spawn ) {

		const [ sx, sy, sz ] = spawn.position;
		vehicle.spherePos.set( sx, sy, sz );
		vehicle.prevModelPos.set( sx, 0, sz );
		vehicle.container.rotation.y = spawn.angle;

	}

	const vehicleGroup = vehicle.init( models[ 'vehicle-toyota_bz4x' ] );
	scene.add( vehicleGroup );

	dirLight.target = vehicleGroup;

	const cam = new Camera();
	cam.targetPosition.copy( vehicle.spherePos );

	const controls = new Controls();

	const particles = new SmokeTrails( scene );

	const audio = new GameAudio();
	audio.init( cam.camera );

	const boxWall = new BoxWall( scene, world, customCells );
	const speedBoat = new SpeedBoat( scene, world, customCells, models[ 'speed_boat_03' ] );
	const powerups = new Powerups( scene, world, vehicle, customCells );
	powerups.boxWall = boxWall;
	powerups.speedBoat = speedBoat;

	const _forward = new THREE.Vector3();

	const contactListener = {
		onContactAdded( bodyA, bodyB ) {

			// Vehicle impacts (audio)
			if ( bodyA === sphereBody || bodyB === sphereBody ) {

				_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
				_forward.y = 0;
				_forward.normalize();

				const impactVelocity = Math.abs( vehicle.modelVelocity.dot( _forward ) );
				audio.playImpact( impactVelocity );

			}

			// Speedboat explosion (vehicle or projectile contact)
			speedBoat.onContact( bodyA, bodyB );

			// Powerup projectile impacts
			powerups.onContact( bodyA, bodyB );

		}
	};

	const timer = new THREE.Timer();

	function animate() {

		requestAnimationFrame( animate );

		timer.update();
		const dt = Math.min( timer.getDelta(), 1 / 30 );

		const input = controls.update();

		updateWorld( world, contactListener, dt );

		vehicle.update( dt, input );

		dirLight.position.set(
			vehicle.spherePos.x + 11.4,
			15,
			vehicle.spherePos.z - 5.3
		);

		cam.update( dt, vehicle.spherePos );
		particles.update( dt, vehicle );
		audio.update( dt, vehicle.linearSpeed, input.z, vehicle.driftIntensity );
		boxWall.update( dt );
		speedBoat.update( dt );
		powerups.update( dt, vehicle, input );

		renderer.render( scene, cam.camera );

	}

	animate();

}

// --- Multiplayer init ----------------------------------------------------

const STATE_SEND_INTERVAL = 1 / 20; // 20 Hz

function initMultiplayer( network, isHost, playerList, customCells ) {

	const { bounds, groundSize } = setupScene( customCells );
	const world = setupPhysics( bounds, groundSize, customCells );

	const playerManager = new PlayerManager( scene, world, models );

	// Compute spawn positions for all players
	const spawns = computeSpawnPositions( customCells, playerList.length );

	for ( let i = 0; i < playerList.length; i ++ ) {

		const pid = playerList[ i ];
		const sp = spawns[ i ] || spawns[ 0 ];
		const name = network.getPlayerName( pid );
		playerManager.addPlayer( pid, sp.position, sp.angle, name );

	}

	// Local player reference
	const localId = network.localId;
	const localEntry = playerManager.getPlayer( localId );
	const localVehicle = localEntry.vehicle;

	dirLight.target = localVehicle.container;

	const cam = new Camera();
	cam.targetPosition.copy( localVehicle.spherePos );

	const controls = new Controls();

	const particles = new SmokeTrails( scene );

	const audio = new GameAudio();
	audio.init( cam.camera );

	const boxWall = new BoxWall( scene, world, customCells );
	const speedBoat = new SpeedBoat( scene, world, customCells, models[ 'speed_boat_03' ] );
	const powerups = new Powerups( scene, world, localVehicle, customCells );
	powerups.boxWall = boxWall;
	powerups.speedBoat = speedBoat;
	powerups.playerManager = playerManager;
	powerups.localPlayerId = localId;
	powerups.isHost = isHost;
	powerups.network = network;

	// Clients don't auto-spawn obstacles
	if ( ! isHost ) {

		boxWall.disableAutoSpawn = true;
		speedBoat.disableAutoSpawn = true;

	}

	// Multiplayer HUD
	const hudContainer = Lobby.createGameHUD();

	const _forward = new THREE.Vector3();

	// --- Contact listener ------------------------------------------------

	const contactListener = {
		onContactAdded( bodyA, bodyB ) {

			// Vehicle impacts (audio) — only for local player
			if ( bodyA === localEntry.sphereBody || bodyB === localEntry.sphereBody ) {

				_forward.set( 0, 0, 1 ).applyQuaternion( localVehicle.container.quaternion );
				_forward.y = 0;
				_forward.normalize();

				const impactVelocity = Math.abs( localVehicle.modelVelocity.dot( _forward ) );
				audio.playImpact( impactVelocity );

			}

			// Speedboat explosion
			speedBoat.onContact( bodyA, bodyB );

			// Powerup projectile impacts (includes player vehicle targeting)
			powerups.onContact( bodyA, bodyB );

		}
	};

	// --- Network callbacks -----------------------------------------------

	let stateSendTimer = 0;

	if ( isHost ) {

		// Host: receive input from clients
		network.onInputReceived = ( playerId, input ) => {

			playerManager.setInput( playerId, input );

		};

		// Host: player disconnects
		network.onPlayerLeft = ( playerId ) => {

			playerManager.removePlayer( playerId );

		};

	} else {

		// Client: receive authoritative state from host
		network.onStateReceived = ( state ) => {

			playerManager.applyState( state );

		};

		// Client: player destroyed
		network.onPlayerDestroyed = ( playerId ) => {

			playerManager.destroyPlayer( playerId );

		};

		// Client: player respawned
		network.onPlayerRespawned = ( playerId ) => {

			playerManager.respawnPlayer( playerId );

		};

		// Client: new player joined mid-game
		network.onPlayerJoined = ( playerId ) => {

			if ( ! playerManager.getPlayer( playerId ) ) {

				const count = playerManager.playerOrder.length + 1;
				const spawns = computeSpawnPositions( customCells, count );
				const sp = spawns[ spawns.length - 1 ] || spawns[ 0 ];
				const name = network.getPlayerName( playerId );
				playerManager.addPlayer( playerId, sp.position, sp.angle, name );

			}

		};

		// Client: player left mid-game
		network.onPlayerLeft = ( playerId ) => {

			playerManager.removePlayer( playerId );

		};

	}

	// --- Game loop -------------------------------------------------------

	const timer = new THREE.Timer();

	function animate() {

		requestAnimationFrame( animate );

		timer.update();
		const dt = Math.min( timer.getDelta(), 1 / 30 );

		// Read local input
		const input = controls.update();

		if ( isHost ) {

			// Host: apply local input and step physics
			playerManager.setInput( localId, input );

			updateWorld( world, contactListener, dt );

			playerManager.update( dt );

			// Check for respawns
			const respawned = playerManager.checkRespawns();

			for ( const pid of respawned ) {

				playerManager.respawnPlayer( pid );
				network.sendPlayerRespawned( pid );

			}

			// Broadcast state at ~20 Hz
			stateSendTimer += dt;

			if ( stateSendTimer >= STATE_SEND_INTERVAL ) {

				stateSendTimer = 0;
				network.sendState( playerManager.buildState() );

			}

			// Update powerups using multiplayer path
			powerups.updateMultiplayer( dt );

		} else {

			// Client: send input to host
			network.sendInput( input );

			// Client still steps physics locally for responsive feel
			// but state is overridden by host broadcasts
			playerManager.setInput( localId, input );

			updateWorld( world, contactListener, dt );

			playerManager.update( dt );

			// Client uses singleplayer powerup path for local visuals
			powerups.updateMultiplayer( dt );

		}

		// Update local camera to follow local vehicle
		dirLight.position.set(
			localVehicle.spherePos.x + 11.4,
			15,
			localVehicle.spherePos.z - 5.3
		);

		cam.update( dt, localVehicle.spherePos );
		particles.update( dt, playerManager.getAliveVehicles() );
		audio.update( dt, localVehicle.linearSpeed, input.z, localVehicle.driftIntensity );
		boxWall.update( dt );
		speedBoat.update( dt );

		// Update HUD
		Lobby.updateGameHUD( hudContainer, playerManager.getHUDData() );

		renderer.render( scene, cam.camera );

	}

	animate();

}

// --- Entry point ---------------------------------------------------------

async function init() {

	registerAll();
	await loadModels();

	// Remove loading screen
	const loadingScreen = document.getElementById( 'loading-screen' );

	if ( loadingScreen ) {

		setTimeout( () => { loadingScreen.classList.add( 'fade-out' ); loadingScreen.remove(); }, 4000 );

	}

	const { customCells, spawn, mapParam } = parseMapParam();

	const network = new Network();
	const lobby = new Lobby();

	const result = await lobby.show( network );

	if ( result.mode === 'singleplayer' ) {

		initSingleplayer( customCells, spawn );

	} else {

		// Multiplayer
		const isHost = result.isHost;
		let playerList;
		let mpCells = customCells;

		if ( isHost ) {

			// Host already has the player list from startGame
			playerList = network.getPlayerIds();

		} else {

			// Client received gameData from GAME_START
			playerList = result.gameData.players;

			// Use the host's map parameter if available
			const hostMapParam = result.gameData.mapParam;

			if ( hostMapParam ) {

				try {

					mpCells = decodeCells( hostMapParam );

				} catch ( e ) {

					console.warn( 'Invalid host map parameter, using local track' );

				}

			}

		}

		initMultiplayer( network, isHost, playerList, mpCells );

	}

}

init();
