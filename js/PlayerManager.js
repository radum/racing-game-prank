// --- PlayerManager.js ----------------------------------------------------
// Manages multiple players for multiplayer: vehicles, physics bodies,
// per-player state (alive, powerup, respawn timer), destruction and respawn.

import * as THREE from 'three';
import { rigidBody } from 'crashcat';
import { Vehicle } from './Vehicle.js';
import { createSphereBody } from './Physics.js';
import { createExplosion, updateExplosion, cleanupExplosion } from './Explosion.js';
import { PLAYER_COLORS } from './Lobby.js';

const RESPAWN_DELAY = 10;
const INVINCIBLE_DURATION = 3;

const _tmpColor = new THREE.Color();

// --- Player entry --------------------------------------------------------

function createPlayerEntry( id, index ) {

	return {
		id,
		index,
		name: '',
		vehicle: null,
		sphereBody: null,
		alive: true,
		respawnTimer: 0,
		invincibleTimer: 0,
		spawnPosition: null,
		spawnAngle: 0,
		powerup: null,
		explosion: null,
		input: { x: 0, z: 0, fire: false },
	};

}

// --- PlayerManager class -------------------------------------------------

export class PlayerManager {

	constructor( scene, world, models ) {

		this.scene = scene;
		this.world = world;
		this.models = models;
		this.players = new Map(); // playerId -> playerEntry
		this.playerOrder = [];    // ordered list of player IDs

	}

	// --- Add a player --------------------------------------------------------

	addPlayer( playerId, spawnPosition, spawnAngle, playerName ) {

		if ( this.players.has( playerId ) ) return this.players.get( playerId );

		const index = this.playerOrder.length;
		const entry = createPlayerEntry( playerId, index );
		entry.name = playerName || ( 'Player ' + ( index + 1 ) );
		entry.spawnPosition = spawnPosition;
		entry.spawnAngle = spawnAngle;

		// Create physics sphere
		entry.sphereBody = createSphereBody( this.world, spawnPosition );

		// Create vehicle
		entry.vehicle = new Vehicle();
		entry.vehicle.rigidBody = entry.sphereBody;
		entry.vehicle.physicsWorld = this.world;
		entry.vehicle.spawnPosition = spawnPosition;
		entry.vehicle.spawnAngle = spawnAngle;

		const [ sx, sy, sz ] = spawnPosition;
		entry.vehicle.spherePos.set( sx, sy, sz );
		entry.vehicle.prevModelPos.set( sx, 0, sz );
		entry.vehicle.container.rotation.y = spawnAngle;

		const vehicleGroup = entry.vehicle.init( this.models[ 'vehicle-toyota_bz4x' ] );

		// Tint the vehicle to the player's colour
		this._tintVehicle( vehicleGroup, index );

		// Add a name tag sprite above the vehicle
		this._addNameTag( entry.vehicle, index, entry.name );

		this.scene.add( vehicleGroup );

		this.players.set( playerId, entry );
		this.playerOrder.push( playerId );

		return entry;

	}

	// --- Remove a player -----------------------------------------------------

	removePlayer( playerId ) {

		const entry = this.players.get( playerId );
		if ( ! entry ) return;

		if ( entry.vehicle ) {

			this.scene.remove( entry.vehicle.container );

		}

		if ( entry.sphereBody ) {

			rigidBody.remove( this.world, entry.sphereBody );

		}

		if ( entry.explosion ) {

			cleanupExplosion( this.scene, this.world, entry.explosion );

		}

		this.players.delete( playerId );
		const idx = this.playerOrder.indexOf( playerId );
		if ( idx !== - 1 ) this.playerOrder.splice( idx, 1 );

	}

	// --- Update all players --------------------------------------------------

	update( dt ) {

		for ( const [ , entry ] of this.players ) {

			if ( entry.alive ) {

				entry.vehicle.update( dt, entry.input );

				// Tick down invincibility
				if ( entry.invincibleTimer > 0 ) {

					entry.invincibleTimer -= dt;

					// Flash the vehicle to indicate invincibility
					const flash = Math.sin( entry.invincibleTimer * 12 ) > 0;
					entry.vehicle.container.visible = flash;

				} else {

					entry.vehicle.container.visible = true;

				}

			} else {

				// Dead: tick respawn timer
				entry.respawnTimer -= dt;

			}

			// Update active explosion
			if ( entry.explosion ) {

				entry.explosion.timer -= dt;
				updateExplosion( entry.explosion, dt );

				if ( entry.explosion.timer <= 0 ) {

					cleanupExplosion( this.scene, this.world, entry.explosion );
					entry.explosion = null;

				}

			}

		}

	}

	// --- Destroy a player ----------------------------------------------------

	destroyPlayer( playerId ) {

		const entry = this.players.get( playerId );
		if ( ! entry || ! entry.alive ) return;
		if ( entry.invincibleTimer > 0 ) return;

		entry.alive = false;
		entry.respawnTimer = RESPAWN_DELAY;
		entry.powerup = null;

		// Hide the vehicle
		entry.vehicle.container.visible = false;

		// Zero out the sphere velocity and move it away
		rigidBody.setLinearVelocity( this.world, entry.sphereBody, [ 0, 0, 0 ] );
		rigidBody.setAngularVelocity( this.world, entry.sphereBody, [ 0, 0, 0 ] );
		rigidBody.setPosition( this.world, entry.sphereBody, [ 0, - 100, 0 ], false );

		// Create explosion at last known position
		const pos = entry.vehicle.spherePos;
		entry.explosion = createExplosion( this.scene, this.world, pos.x, pos.y, pos.z, {
			duration: 3,
			debrisCount: 10,
			particleCount: 24,
			flashRadius: 1.0,
		} );

	}

	// --- Respawn a player ----------------------------------------------------

	respawnPlayer( playerId ) {

		const entry = this.players.get( playerId );
		if ( ! entry || entry.alive ) return;

		entry.alive = true;
		entry.respawnTimer = 0;
		entry.invincibleTimer = INVINCIBLE_DURATION;

		const [ sx, sy, sz ] = entry.spawnPosition;

		// Reset physics body
		rigidBody.setPosition( this.world, entry.sphereBody, entry.spawnPosition, false );
		rigidBody.setLinearVelocity( this.world, entry.sphereBody, [ 0, 0, 0 ] );
		rigidBody.setAngularVelocity( this.world, entry.sphereBody, [ 0, 0, 0 ] );

		// Reset vehicle state
		entry.vehicle.spherePos.set( sx, sy, sz );
		entry.vehicle.sphereVel.set( 0, 0, 0 );
		entry.vehicle.prevModelPos.set( sx, 0, sz );
		entry.vehicle.linearSpeed = 0;
		entry.vehicle.angularSpeed = 0;
		entry.vehicle.acceleration = 0;
		entry.vehicle.container.rotation.set( 0, entry.spawnAngle, 0 );
		entry.vehicle.container.quaternion.setFromEuler( entry.vehicle.container.rotation );
		entry.vehicle.container.visible = true;

		entry.input = { x: 0, z: 0, fire: false };

	}

	// --- Check if a respawn is due (host calls this) -------------------------

	checkRespawns() {

		const respawned = [];

		for ( const [ playerId, entry ] of this.players ) {

			if ( ! entry.alive && entry.respawnTimer <= 0 ) {

				respawned.push( playerId );

			}

		}

		return respawned;

	}

	// --- Set input for a player ----------------------------------------------

	setInput( playerId, input ) {

		const entry = this.players.get( playerId );
		if ( entry ) entry.input = input;

	}

	// --- Get a player entry --------------------------------------------------

	getPlayer( playerId ) {

		return this.players.get( playerId ) ?? null;

	}

	// --- Get all vehicles (for particles, powerup detection, etc.) -----------

	getAliveVehicles() {

		const vehicles = [];

		for ( const [ , entry ] of this.players ) {

			if ( entry.alive && entry.vehicle ) vehicles.push( entry.vehicle );

		}

		return vehicles;

	}

	// --- Get all sphere bodies (for contact detection) -----------------------

	getAllSphereBodies() {

		const bodies = new Map();

		for ( const [ playerId, entry ] of this.players ) {

			if ( entry.sphereBody ) bodies.set( entry.sphereBody, playerId );

		}

		return bodies;

	}

	// --- Build authoritative state for network broadcast ----------------------

	buildState() {

		const state = {};

		for ( const [ playerId, entry ] of this.players ) {

			const v = entry.vehicle;

			state[ playerId ] = {
				alive: entry.alive,
				respawnTimer: entry.respawnTimer,
				powerup: entry.powerup,
				pos: entry.alive ? [ v.spherePos.x, v.spherePos.y, v.spherePos.z ] : null,
				quat: entry.alive ? [
					v.container.quaternion.x,
					v.container.quaternion.y,
					v.container.quaternion.z,
					v.container.quaternion.w,
				] : null,
				speed: entry.alive ? v.linearSpeed : 0,
				angSpeed: entry.alive ? v.angularSpeed : 0,
			};

		}

		return state;

	}

	// --- Apply received state from host (client-side) ------------------------

	applyState( state ) {

		for ( const playerId in state ) {

			const entry = this.players.get( playerId );
			if ( ! entry ) continue;

			const s = state[ playerId ];

			entry.powerup = s.powerup;

			if ( s.alive && ! entry.alive ) {

				// Player respawned on server
				this.respawnPlayer( playerId );

			} else if ( ! s.alive && entry.alive ) {

				// Player was destroyed on server
				this.destroyPlayer( playerId );

			}

			if ( s.alive && entry.alive && s.pos ) {

				// Interpolate toward authoritative position
				const v = entry.vehicle;
				const target = new THREE.Vector3( s.pos[ 0 ], s.pos[ 1 ], s.pos[ 2 ] );
				v.spherePos.lerp( target, 0.3 );

				// Apply authoritative quaternion
				const targetQuat = new THREE.Quaternion( s.quat[ 0 ], s.quat[ 1 ], s.quat[ 2 ], s.quat[ 3 ] );
				v.container.quaternion.slerp( targetQuat, 0.3 );

				v.linearSpeed = THREE.MathUtils.lerp( v.linearSpeed, s.speed, 0.3 );
				v.angularSpeed = THREE.MathUtils.lerp( v.angularSpeed, s.angSpeed, 0.3 );

				// Also update the physics body to match
				rigidBody.setPosition( this.world, entry.sphereBody, s.pos, false );

			}

			entry.respawnTimer = s.respawnTimer;

		}

	}

	// --- Tint a vehicle's meshes to a player colour --------------------------

	_tintVehicle( vehicleGroup, playerIndex ) {

		const color = PLAYER_COLORS[ playerIndex ] || '#ffffff';
		_tmpColor.set( color );

		vehicleGroup.traverse( ( child ) => {

			if ( child.isMesh && child.material ) {

				// Clone the material to avoid shared state
				child.material = child.material.clone();

				// Blend the player colour into the emissive channel
				child.material.emissive = _tmpColor.clone();
				child.material.emissiveIntensity = 0.15;

			}

		} );

	}

	// --- Add a floating name tag above the vehicle ---------------------------

	_addNameTag( vehicle, playerIndex, playerName ) {

		const canvas = document.createElement( 'canvas' );
		canvas.width = 256;
		canvas.height = 64;

		const ctx = canvas.getContext( '2d' );
		const color = PLAYER_COLORS[ playerIndex ] || '#ffffff';
		const name = playerName || ( 'Player ' + ( playerIndex + 1 ) );

		ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		ctx.beginPath();
		ctx.roundRect( 4, 4, 248, 56, 12 );
		ctx.fill();

		ctx.fillStyle = color;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		// Shrink font until the text fits within the padded area
		const maxWidth = 236;
		let fontSize = 28;

		ctx.font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';

		while ( ctx.measureText( name ).width > maxWidth && fontSize > 12 ) {

			fontSize -= 2;
			ctx.font = 'bold ' + fontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';

		}

		ctx.fillText( name, 128, 32 );

		const texture = new THREE.CanvasTexture( canvas );
		texture.needsUpdate = true;

		const material = new THREE.SpriteMaterial( {
			map: texture,
			transparent: true,
			depthTest: false,
		} );

		const sprite = new THREE.Sprite( material );
		sprite.scale.set( 1.5, 0.375, 1 );
		sprite.position.y = 1.2;

		vehicle.container.add( sprite );

	}

	// --- Get player HUD data for the Lobby HUD updater -----------------------

	getHUDData() {

		const data = [];

		for ( const playerId of this.playerOrder ) {

			const entry = this.players.get( playerId );
			if ( ! entry ) continue;

			data.push( {
				id: playerId,
				name: entry.name,
				alive: entry.alive,
				respawnTimer: entry.respawnTimer,
				powerup: entry.powerup,
			} );

		}

		return data;

	}

}
