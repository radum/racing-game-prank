import * as THREE from 'three';
import { rigidBody, box, sphere, MotionType, MotionQuality } from 'crashcat';
import { TRACK_CELLS, CELL_RAW, GRID_SCALE, ORIENT_DEG } from './Track.js';
import { createExplosion, updateExplosion, cleanupExplosion } from './Explosion.js';

// --- Constants -----------------------------------------------------------

const PICKUP_SPAWN_INTERVAL = 10;
const MAX_PICKUPS = 3;
const PICKUP_SIZE = 0.4;
const PICKUP_HALF = PICKUP_SIZE / 2;
const PICKUP_COLLECT_DIST_SQ = 2.5;

const MISSILE_SPEED = 25;
const MISSILE_LIFETIME = 5;

const BOMB_SPEED = 12;
const BOMB_LOB_Y = 6;
const BOMB_LIFETIME = 6;
const BOMB_MAX_BOUNCES = 3;

const SHOCKWAVE_RADIUS = 6;
const SHOCKWAVE_FORCE = 12;
const SHOCKWAVE_DURATION = 0.8;

const POWERUP_TYPES = [ 'missile', 'shockwave', 'bomb' ];
const POWERUP_COLORS = { missile: 0xff4444, shockwave: 0x44aaff, bomb: 0xff8800 };
const POWERUP_LABELS = { missile: 'MISSILE', shockwave: 'SHOCKWAVE', bomb: 'BOMB' };

// --- Shared geometry -----------------------------------------------------

const _pickupGeo = new THREE.BoxGeometry( PICKUP_SIZE, PICKUP_SIZE, PICKUP_SIZE );
const _pickupMat = new THREE.MeshStandardMaterial( {
	color: 0xffcc00,
	roughness: 0.3,
	metalness: 0.5,
	emissive: 0xffcc00,
	emissiveIntensity: 0.3,
} );

const _missileGeo = new THREE.CylinderGeometry( 0.06, 0.06, 0.5, 8 );
_missileGeo.rotateX( Math.PI / 2 );
const _missileMat = new THREE.MeshStandardMaterial( { color: 0xff2222, roughness: 0.4, metalness: 0.6 } );

const _bombGeo = new THREE.SphereGeometry( 0.15, 10, 8 );
const _bombMat = new THREE.MeshStandardMaterial( { color: 0x333333, roughness: 0.5, metalness: 0.3 } );

const _smokeMap = new THREE.TextureLoader().load( 'sprites/smoke.png' );

const _tmpVec = new THREE.Vector3();
const _forward = new THREE.Vector3();

// --- HUD -----------------------------------------------------------------

function createHUD() {

	const container = document.createElement( 'div' );
	container.style.cssText = 'position:absolute;top:16px;left:50%;transform:translateX(-50%);' +
		'padding:8px 20px;border-radius:8px;background:rgba(0,0,0,0.6);' +
		'color:#fff;font:bold 16px -apple-system,BlinkMacSystemFont,sans-serif;' +
		'text-align:center;pointer-events:none;z-index:20;opacity:0;transition:opacity 0.3s;';

	const label = document.createElement( 'div' );
	label.style.cssText = 'font-size:12px;opacity:0.6;margin-bottom:2px;';
	label.textContent = 'POWERUP';

	const name = document.createElement( 'div' );
	name.textContent = '---';

	container.appendChild( label );
	container.appendChild( name );
	document.body.appendChild( container );

	return { container, name };

}

// --- Powerups class ------------------------------------------------------

export class Powerups {

	constructor( scene, world, vehicle, trackCells ) {

		this.scene = scene;
		this.world = world;
		this.vehicle = vehicle;
		this.trackCells = trackCells || TRACK_CELLS;

		this.pickups = [];
		this.pickupTimer = PICKUP_SPAWN_INTERVAL;

		// Singleplayer powerup (used when playerManager is null)
		this.currentPowerup = null;

		// Multiplayer per-player powerup inventory
		this.playerPowerups = new Map();

		this.missiles = [];
		this.bombs = [];
		this.shockwaves = [];
		this.explosions = [];

		this.hud = createHUD();

		// References set by main.js so projectiles can trigger target destruction
		this.boxWall = null;
		this.speedBoat = null;

		// Multiplayer: set by main.js to enable vehicle-as-target and multi-vehicle pickup
		this.playerManager = null;
		this.localPlayerId = null;
		this.isHost = false;
		this.network = null;

	}

	update( dt, vehicle, input ) {

		this.pickupTimer -= dt;

		if ( this.pickupTimer <= 0 ) {

			this.pickupTimer = PICKUP_SPAWN_INTERVAL;

			if ( this.pickups.length < MAX_PICKUPS ) this.spawnPickup();

		}

		this.updatePickups( dt );
		this.updateMissiles( dt );
		this.updateBombs( dt );
		this.updateShockwaves( dt );
		this.updateExplosions( dt );

		// Singleplayer fire
		if ( ! this.playerManager && input.fire && this.currentPowerup ) {

			this.fire( vehicle );

		}

	}

	// --- Multiplayer: update with PlayerManager ------------------------------

	updateMultiplayer( dt ) {

		this.pickupTimer -= dt;

		if ( this.pickupTimer <= 0 ) {

			this.pickupTimer = PICKUP_SPAWN_INTERVAL;

			if ( this.pickups.length < MAX_PICKUPS ) this.spawnPickup();

		}

		this.updatePickupsMultiplayer( dt );
		this.updateMissiles( dt );
		this.updateBombs( dt );
		this.updateShockwaves( dt );
		this.updateExplosions( dt );

		// Fire powerups for each player that has fire input
		if ( this.playerManager ) {

			for ( const [ playerId, entry ] of this.playerManager.players ) {

				if ( ! entry.alive ) continue;

				if ( entry.input.fire && this.playerPowerups.has( playerId ) ) {

					this.fireForPlayer( playerId, entry.vehicle );

				}

			}

		}

	}

	updatePickupsMultiplayer( dt ) {

		if ( ! this.playerManager ) return;

		for ( let i = this.pickups.length - 1; i >= 0; i -- ) {

			const p = this.pickups[ i ];

			// Rotate and bob
			p.angle += dt * 3;
			p.mesh.rotation.y += dt * 2;
			p.mesh.position.y = 0.5 + Math.sin( p.angle ) * 0.15;

			// Check collection by any alive vehicle
			let collected = false;

			for ( const [ playerId, entry ] of this.playerManager.players ) {

				if ( ! entry.alive ) continue;

				const dx = entry.vehicle.spherePos.x - p.x;
				const dz = entry.vehicle.spherePos.z - p.z;
				const distSq = dx * dx + dz * dz;

				if ( distSq < PICKUP_COLLECT_DIST_SQ ) {

					// Only assign if player has no powerup
					if ( ! this.playerPowerups.has( playerId ) ) {

						const type = POWERUP_TYPES[ Math.floor( Math.random() * POWERUP_TYPES.length ) ];
						this.playerPowerups.set( playerId, type );

						// Update HUD only for local player
						if ( playerId === this.localPlayerId ) {

							this.currentPowerup = type;
							this.updateHUD();

						}

					}

					collected = true;
					break;

				}

			}

			if ( collected ) {

				this.scene.remove( p.mesh );
				p.mesh.material.dispose();
				this.pickups.splice( i, 1 );

			}

		}

	}

	fireForPlayer( playerId, vehicle ) {

		const type = this.playerPowerups.get( playerId );
		if ( ! type ) return;

		this.playerPowerups.delete( playerId );

		// Update HUD for local player
		if ( playerId === this.localPlayerId ) {

			this.currentPowerup = null;
			this.updateHUD();

		}

		const pos = vehicle.spherePos;
		_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
		_forward.y = 0;
		_forward.normalize();

		if ( type === 'missile' ) this.fireMissile( pos, _forward );
		if ( type === 'shockwave' ) this.fireShockwave( pos );
		if ( type === 'bomb' ) this.fireBomb( pos, _forward );

	}

	// --- Contact listener callback ---------------------------------------

	onContact( bodyA, bodyB ) {

		// Check missiles
		for ( const m of this.missiles ) {

			if ( m.dead ) continue;

			if ( bodyA === m.body || bodyB === m.body ) {

				// In multiplayer, check if the other body is a player sphere and destroy them
				if ( this.playerManager && this.isHost ) {

					const other = bodyA === m.body ? bodyB : bodyA;
					const bodyMap = this.playerManager.getAllSphereBodies();
					const hitPlayerId = bodyMap.get( other );

					if ( hitPlayerId ) {

						const entry = this.playerManager.getPlayer( hitPlayerId );
						if ( entry && entry.alive && entry.invincibleTimer <= 0 ) {

							this.playerManager.destroyPlayer( hitPlayerId );
							if ( this.network ) this.network.sendPlayerDestroyed( hitPlayerId );

						}

					}

				}

				m.dead = true;

			}

		}

		// Check bombs
		for ( const b of this.bombs ) {

			if ( b.dead ) continue;

			if ( bodyA === b.body || bodyB === b.body ) {

				b.bounces ++;

				const other = bodyA === b.body ? bodyB : bodyA;

				// In multiplayer, check if the other body is a player sphere and destroy them
				if ( this.playerManager && this.isHost ) {

					const bodyMap = this.playerManager.getAllSphereBodies();
					const hitPlayerId = bodyMap.get( other );

					if ( hitPlayerId ) {

						const entry = this.playerManager.getPlayer( hitPlayerId );
						if ( entry && entry.alive && entry.invincibleTimer <= 0 ) {

							this.playerManager.destroyPlayer( hitPlayerId );
							if ( this.network ) this.network.sendPlayerDestroyed( hitPlayerId );

						}

					}

				}

				// Explode on contact with target bodies, or after max bounces
				const isTarget = this.isTargetBody( other );

				if ( isTarget || b.bounces >= BOMB_MAX_BOUNCES ) {

					b.dead = true;

				}

			}

		}

	}

	// --- Pickups ---------------------------------------------------------

	spawnPickup() {

		const straights = this.trackCells.filter( ( c ) => c[ 2 ] === 'track-straight' );
		if ( straights.length === 0 ) return;

		const cell = straights[ Math.floor( Math.random() * straights.length ) ];
		const [ gx, gz ] = cell;

		const cx = ( gx + 0.5 ) * CELL_RAW * GRID_SCALE;
		const cz = ( gz + 0.5 ) * CELL_RAW * GRID_SCALE;

		const mesh = new THREE.Mesh( _pickupGeo, _pickupMat.clone() );
		mesh.position.set( cx, 0.5, cz );
		mesh.castShadow = true;
		this.scene.add( mesh );

		this.pickups.push( { mesh, x: cx, z: cz, angle: 0 } );

	}

	updatePickups( dt ) {

		for ( let i = this.pickups.length - 1; i >= 0; i -- ) {

			const p = this.pickups[ i ];

			// Rotate and bob
			p.angle += dt * 3;
			p.mesh.rotation.y += dt * 2;
			p.mesh.position.y = 0.5 + Math.sin( p.angle ) * 0.15;

			// Check collection
			const dx = this.vehicle.spherePos.x - p.x;
			const dz = this.vehicle.spherePos.z - p.z;
			const distSq = dx * dx + dz * dz;

			if ( distSq < PICKUP_COLLECT_DIST_SQ ) {

				this.scene.remove( p.mesh );
				p.mesh.material.dispose();
				this.pickups.splice( i, 1 );

				// Only assign if player has no powerup
				if ( ! this.currentPowerup ) {

					this.currentPowerup = POWERUP_TYPES[ Math.floor( Math.random() * POWERUP_TYPES.length ) ];
					this.updateHUD();

				}

			}

		}

	}

	updateHUD() {

		if ( this.currentPowerup ) {

			this.hud.name.textContent = POWERUP_LABELS[ this.currentPowerup ];
			this.hud.name.style.color = '#' + POWERUP_COLORS[ this.currentPowerup ].toString( 16 ).padStart( 6, '0' );
			this.hud.container.style.opacity = '1';

		} else {

			this.hud.container.style.opacity = '0';

		}

	}

	// --- Fire ------------------------------------------------------------

	fire( vehicle ) {

		const type = this.currentPowerup;
		this.currentPowerup = null;
		this.updateHUD();

		const pos = vehicle.spherePos;
		_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
		_forward.y = 0;
		_forward.normalize();

		if ( type === 'missile' ) this.fireMissile( pos, _forward );
		if ( type === 'shockwave' ) this.fireShockwave( pos );
		if ( type === 'bomb' ) this.fireBomb( pos, _forward );

	}

	// --- Missile ---------------------------------------------------------

	fireMissile( pos, dir ) {

		const mesh = new THREE.Mesh( _missileGeo, _missileMat.clone() );
		mesh.position.set( pos.x + dir.x * 1.5, 0.4, pos.z + dir.z * 1.5 );
		mesh.lookAt( mesh.position.x + dir.x, 0.4, mesh.position.z + dir.z );
		mesh.castShadow = true;
		this.scene.add( mesh );

		// Smoke trail sprite
		const trailMat = new THREE.SpriteMaterial( {
			map: _smokeMap,
			transparent: true,
			opacity: 0.4,
			color: 0xffffff,
			depthWrite: false,
		} );
		const trail = new THREE.Sprite( trailMat );
		trail.scale.setScalar( 0.3 );
		this.scene.add( trail );

		const body = rigidBody.create( this.world, {
			shape: box.create( { halfExtents: [ 0.06, 0.06, 0.25 ] } ),
			motionType: MotionType.DYNAMIC,
			objectLayer: this.world._OL_MOVING,
			position: [ mesh.position.x, 0.4, mesh.position.z ],
			mass: 5.0,
			friction: 0.0,
			restitution: 0.0,
			linearDamping: 0.0,
			angularDamping: 10.0,
			gravityFactor: 0.0,
			motionQuality: MotionQuality.LINEAR_CAST,
		} );

		rigidBody.setLinearVelocity( this.world, body, [
			dir.x * MISSILE_SPEED,
			0,
			dir.z * MISSILE_SPEED,
		] );

		this.missiles.push( {
			mesh, body, trail, trailMat,
			dir: new THREE.Vector3( dir.x, 0, dir.z ),
			life: MISSILE_LIFETIME,
			dead: false,
		} );

	}

	updateMissiles( dt ) {

		for ( let i = this.missiles.length - 1; i >= 0; i -- ) {

			const m = this.missiles[ i ];
			m.life -= dt;

			if ( m.dead || m.life <= 0 ) {

				const pos = m.body.position;
				this.spawnExplosion( pos[ 0 ], pos[ 1 ], pos[ 2 ] );
				this.blastNearbyTargets( pos[ 0 ], pos[ 2 ], 3 );

				this.scene.remove( m.mesh );
				this.scene.remove( m.trail );
				m.mesh.material.dispose();
				m.trailMat.dispose();
				rigidBody.remove( this.world, m.body );
				this.missiles.splice( i, 1 );
				continue;

			}

			const pos = m.body.position;
			m.mesh.position.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );

			// Trail follows behind
			m.trail.position.set(
				pos[ 0 ] - m.dir.x * 0.4,
				pos[ 1 ],
				pos[ 2 ] - m.dir.z * 0.4
			);
			m.trail.material.opacity = 0.3 + Math.random() * 0.2;
			m.trail.scale.setScalar( 0.2 + Math.random() * 0.15 );

		}

	}

	// --- Shockwave -------------------------------------------------------

	fireShockwave( pos ) {

		// Expanding ring visual
		const ringGeo = new THREE.TorusGeometry( 0.5, 0.15, 8, 32 );
		ringGeo.rotateX( Math.PI / 2 );
		const ringMat = new THREE.MeshBasicMaterial( {
			color: 0x44aaff,
			transparent: true,
			opacity: 0.8,
		} );
		const ring = new THREE.Mesh( ringGeo, ringMat );
		ring.position.set( pos.x, 0.3, pos.z );
		this.scene.add( ring );

		// Apply force to all box wall boxes and speedboat in radius
		this.blastNearbyTargets( pos.x, pos.z, SHOCKWAVE_RADIUS );

		this.shockwaves.push( {
			ring, ringMat, ringGeo,
			x: pos.x, z: pos.z,
			timer: SHOCKWAVE_DURATION,
		} );

	}

	updateShockwaves( dt ) {

		for ( let i = this.shockwaves.length - 1; i >= 0; i -- ) {

			const sw = this.shockwaves[ i ];
			sw.timer -= dt;

			const t = 1 - ( sw.timer / SHOCKWAVE_DURATION );
			const scale = 1 + t * SHOCKWAVE_RADIUS * 2;
			sw.ring.scale.setScalar( scale );
			sw.ringMat.opacity = Math.max( 0, 0.8 * ( 1 - t ) );

			if ( sw.timer <= 0 ) {

				this.scene.remove( sw.ring );
				sw.ringGeo.dispose();
				sw.ringMat.dispose();
				this.shockwaves.splice( i, 1 );

			}

		}

	}

	// --- Bouncing Bomb ---------------------------------------------------

	fireBomb( pos, dir ) {

		const mesh = new THREE.Mesh( _bombGeo, _bombMat.clone() );
		const sx = pos.x + dir.x * 1.5;
		const sz = pos.z + dir.z * 1.5;
		mesh.position.set( sx, 0.5, sz );
		mesh.castShadow = true;
		this.scene.add( mesh );

		const body = rigidBody.create( this.world, {
			shape: sphere.create( { radius: 0.15 } ),
			motionType: MotionType.DYNAMIC,
			objectLayer: this.world._OL_MOVING,
			position: [ sx, 0.5, sz ],
			mass: 8.0,
			friction: 0.3,
			restitution: 0.8,
			linearDamping: 0.05,
			angularDamping: 0.5,
			gravityFactor: 1.0,
			motionQuality: MotionQuality.LINEAR_CAST,
		} );

		rigidBody.setLinearVelocity( this.world, body, [
			dir.x * BOMB_SPEED,
			BOMB_LOB_Y,
			dir.z * BOMB_SPEED,
		] );

		rigidBody.setAngularVelocity( this.world, body, [
			( Math.random() - 0.5 ) * 10,
			( Math.random() - 0.5 ) * 10,
			( Math.random() - 0.5 ) * 10,
		] );

		this.bombs.push( {
			mesh, body,
			life: BOMB_LIFETIME,
			bounces: 0,
			dead: false,
		} );

	}

	updateBombs( dt ) {

		for ( let i = this.bombs.length - 1; i >= 0; i -- ) {

			const b = this.bombs[ i ];
			b.life -= dt;

			if ( b.dead || b.life <= 0 ) {

				const pos = b.body.position;
				this.spawnExplosion( pos[ 0 ], pos[ 1 ], pos[ 2 ] );
				this.blastNearbyTargets( pos[ 0 ], pos[ 2 ], 4 );

				this.scene.remove( b.mesh );
				b.mesh.material.dispose();
				rigidBody.remove( this.world, b.body );
				this.bombs.splice( i, 1 );
				continue;

			}

			const pos = b.body.position;
			b.mesh.position.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );

			const quat = b.body.quaternion;
			b.mesh.quaternion.set( quat[ 0 ], quat[ 1 ], quat[ 2 ], quat[ 3 ] );

			// Pulsing glow as warning
			const pulse = 0.5 + Math.sin( b.life * 10 ) * 0.5;
			b.mesh.material.emissive = b.mesh.material.emissive ?? new THREE.Color();
			b.mesh.material.emissive.setHex( 0xff4400 );
			b.mesh.material.emissiveIntensity = pulse * 0.5;

		}

	}

	// --- Explosions (managed) --------------------------------------------

	spawnExplosion( x, y, z ) {

		const exp = createExplosion( this.scene, this.world, x, y, z, {
			duration: 3,
			debrisCount: 8,
			particleCount: 20,
			flashRadius: 0.8,
		} );
		this.explosions.push( exp );

	}

	updateExplosions( dt ) {

		for ( let i = this.explosions.length - 1; i >= 0; i -- ) {

			const exp = this.explosions[ i ];
			exp.timer -= dt;
			updateExplosion( exp, dt );

			if ( exp.timer <= 0 ) {

				cleanupExplosion( this.scene, this.world, exp );
				this.explosions.splice( i, 1 );

			}

		}

	}

	// --- Target interaction ----------------------------------------------

	isTargetBody( body ) {

		// Check if body belongs to a box wall box
		if ( this.boxWall ) {

			for ( const wall of this.boxWall.walls ) {

				for ( const b of wall.boxes ) {

					if ( b.body === body ) return true;

				}

			}

		}

		// Check if body belongs to the speedboat
		if ( this.speedBoat && this.speedBoat.boat ) {

			if ( this.speedBoat.boat.body === body ) return true;

		}

		// Check if body belongs to a player vehicle sphere
		if ( this.playerManager ) {

			const bodyMap = this.playerManager.getAllSphereBodies();
			if ( bodyMap.has( body ) ) return true;

		}

		return false;

	}

	blastNearbyTargets( x, z, radius ) {

		const radiusSq = radius * radius;

		// Blast box wall boxes
		if ( this.boxWall ) {

			for ( const wall of this.boxWall.walls ) {

				for ( const b of wall.boxes ) {

					const pos = b.body.position;
					const dx = pos[ 0 ] - x;
					const dz = pos[ 2 ] - z;
					const distSq = dx * dx + dz * dz;

					if ( distSq < radiusSq ) {

						const dist = Math.sqrt( distSq ) + 0.1;
						const force = SHOCKWAVE_FORCE * ( 1 - dist / radius );
						const dirX = dx / dist;
						const dirZ = dz / dist;

						const vel = b.body.motionProperties.linearVelocity;
						rigidBody.setLinearVelocity( this.world, b.body, [
							vel[ 0 ] + dirX * force,
							vel[ 1 ] + force * 0.8,
							vel[ 2 ] + dirZ * force,
						] );

						// Mark wall as hit
						if ( ! wall.hit ) {

							wall.hit = true;
							wall.removeTimer = 10;

						}

					}

				}

			}

		}

		// Blast speedboat
		if ( this.speedBoat && this.speedBoat.boat ) {

			const bx = this.speedBoat.boat.x;
			const bz = this.speedBoat.boat.z;
			const dx = bx - x;
			const dz = bz - z;
			const distSq = dx * dx + dz * dz;

			if ( distSq < radiusSq ) {

				this.speedBoat.explode();

			}

		}

		// Blast player vehicles (multiplayer, host-only)
		if ( this.playerManager && this.isHost ) {

			for ( const [ playerId, entry ] of this.playerManager.players ) {

				if ( ! entry.alive ) continue;
				if ( entry.invincibleTimer > 0 ) continue;

				const vx = entry.vehicle.spherePos.x;
				const vz = entry.vehicle.spherePos.z;
				const dx = vx - x;
				const dz = vz - z;
				const distSq = dx * dx + dz * dz;

				if ( distSq < radiusSq ) {

					// Apply knockback force to the vehicle sphere
					const dist = Math.sqrt( distSq ) + 0.1;
					const force = SHOCKWAVE_FORCE * ( 1 - dist / radius );
					const dirX = dx / dist;
					const dirZ = dz / dist;

					const vel = entry.sphereBody.motionProperties.linearVelocity;
					rigidBody.setLinearVelocity( this.world, entry.sphereBody, [
						vel[ 0 ] + dirX * force,
						vel[ 1 ] + force * 0.8,
						vel[ 2 ] + dirZ * force,
					] );

					// Destroy the player
					this.playerManager.destroyPlayer( playerId );
					if ( this.network ) this.network.sendPlayerDestroyed( playerId );

				}

			}

		}

	}

}
