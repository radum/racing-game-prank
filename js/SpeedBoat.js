import * as THREE from 'three';
import { rigidBody, box, MotionType } from 'crashcat';
import { TRACK_CELLS, CELL_RAW, GRID_SCALE, ORIENT_DEG } from './Track.js';
import { createExplosion, updateExplosion, cleanupExplosion } from './Explosion.js';

const SPAWN_INTERVAL = 60;

// --- SpeedBoat class ---------------------------------------------------

export class SpeedBoat {

	constructor( scene, world, trackCells, boatModel ) {

		this.scene = scene;
		this.world = world;
		this.trackCells = trackCells || TRACK_CELLS;
		this.boatModel = boatModel;

		this.spawnTimer = SPAWN_INTERVAL;
		this.boat = null;
		this.explosion = null;

	}

	update( dt ) {

		this.spawnTimer -= dt;

		if ( this.spawnTimer <= 0 ) {

			this.spawnTimer = SPAWN_INTERVAL;

			if ( ! this.boat && ! this.explosion ) this.spawn();

		}

		// Update explosion
		if ( this.explosion ) {

			this.explosion.timer -= dt;
			updateExplosion( this.explosion, dt );

			if ( this.explosion.timer <= 0 ) {

				cleanupExplosion( this.scene, this.world, this.explosion );
				this.explosion = null;

			}

		}

	}

	onContact( bodyA, bodyB ) {

		if ( ! this.boat ) return;

		if ( bodyA === this.boat.body || bodyB === this.boat.body ) {

			this.explode();

		}

	}

	spawn() {

		if ( ! this.boatModel ) return;

		const straights = this.trackCells.filter( ( c ) => c[ 2 ] === 'track-straight' );
		if ( straights.length === 0 ) return;

		const cell = straights[ Math.floor( Math.random() * straights.length ) ];
		const [ gx, gz, , orient ] = cell;

		const cx = ( gx + 0.5 ) * CELL_RAW * GRID_SCALE;
		const cz = ( gz + 0.5 ) * CELL_RAW * GRID_SCALE;

		const deg = ORIENT_DEG[ orient ] ?? 0;
		const rad = deg * Math.PI / 180;

		const group = new THREE.Group();
		group.position.set( cx, - 0.15, cz );
		group.rotation.y = rad;

		// Clone the GLB model
		const model = this.boatModel.clone();

		model.traverse( ( child ) => {

			if ( child.isMesh ) {

				child.castShadow = true;
				child.receiveShadow = true;

			}

		} );

		group.add( model );

		// Measure the model to size the physics collider
		const bbox = new THREE.Box3().setFromObject( model );
		const size = new THREE.Vector3();
		bbox.getSize( size );
		const halfExtents = [ size.x / 2, size.y / 2, size.z / 2 ];

		// Physics body so the car can collide
		const body = rigidBody.create( this.world, {
			shape: box.create( { halfExtents } ),
			motionType: MotionType.STATIC,
			objectLayer: this.world._OL_STATIC,
			position: [ cx, 0.15, cz ],
			quaternion: [ 0, Math.sin( rad / 2 ), 0, Math.cos( rad / 2 ) ],
			friction: 0.5,
			restitution: 0.3,
		} );

		this.scene.add( group );

		this.boat = { group, body, x: cx, z: cz };

	}

	explode() {

		const boat = this.boat;
		const x = boat.x;
		const z = boat.z;

		// Remove boat visuals and physics
		this.scene.remove( boat.group );
		rigidBody.remove( this.world, boat.body );

		this.boat = null;

		// Create explosion using shared utility
		this.explosion = createExplosion( this.scene, this.world, x, 0, z );

	}

}
