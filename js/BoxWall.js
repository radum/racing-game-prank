import * as THREE from 'three';
import { rigidBody, box, MotionType, MotionQuality } from 'crashcat';
import { TRACK_CELLS, CELL_RAW, GRID_SCALE, ORIENT_DEG } from './Track.js';

const BOX_SIZE = 0.35;
const BOX_HALF = BOX_SIZE / 2;
const COLS = 7;
const ROWS = 3;
const SPACING = BOX_SIZE + 0.05;
const SPAWN_INTERVAL = 5;
const REMOVE_DELAY = 10;
const MAX_WALLS = 5;

const MESSAGES = [
	'CAUTION!',
	'SLOW DOWN!',
	'WATCH OUT!',
	'DANGER!',
	'YIKES!',
	'OOPS!',
	'CRASH!',
	'BOOM!',
];

const _boxGeo = new THREE.BoxGeometry( BOX_SIZE, BOX_SIZE, BOX_SIZE );

const _colors = [
	0xff4444, 0xff8844, 0xffcc44,
	0x44cc44, 0x4488ff, 0x8844ff,
];

function createLabelSprite( text ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 512;
	canvas.height = 128;

	const ctx = canvas.getContext( '2d' );
	ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
	ctx.beginPath();
	ctx.roundRect( 10, 10, 492, 108, 20 );
	ctx.fill();

	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 64px -apple-system, BlinkMacSystemFont, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( text, 256, 64 );

	const texture = new THREE.CanvasTexture( canvas );
	texture.needsUpdate = true;

	const material = new THREE.SpriteMaterial( {
		map: texture,
		transparent: true,
		depthTest: false,
	} );

	const sprite = new THREE.Sprite( material );
	sprite.scale.set( 3, 0.75, 1 );

	return sprite;

}

export class BoxWall {

	constructor( scene, world, trackCells ) {

		this.scene = scene;
		this.world = world;
		this.trackCells = trackCells || TRACK_CELLS;
		this.walls = [];
		this.spawnTimer = SPAWN_INTERVAL;

		// Shared materials for boxes
		this.boxMaterials = _colors.map( ( color ) =>
			new THREE.MeshStandardMaterial( { color, roughness: 0.6, metalness: 0.1 } )
		);

	}

	update( dt ) {

		this.spawnTimer -= dt;

		if ( this.spawnTimer <= 0 ) {

			this.spawnTimer = SPAWN_INTERVAL;

			// Only spawn if fewer than MAX_WALLS unhit walls on the track
			const activeCount = this.walls.filter( ( w ) => ! w.hit ).length;
			if ( activeCount < MAX_WALLS ) this.spawnWall();

		}

		// Update active walls
		for ( let i = this.walls.length - 1; i >= 0; i -- ) {

			const wall = this.walls[ i ];

			// Sync mesh positions with physics bodies
			for ( const b of wall.boxes ) {

				const pos = b.body.position;
				b.mesh.position.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );

				const quat = b.body.quaternion;
				b.mesh.quaternion.set( quat[ 0 ], quat[ 1 ], quat[ 2 ], quat[ 3 ] );

			}

			// Check if any box moved significantly (car hit the wall)
			if ( ! wall.hit ) {

				for ( const b of wall.boxes ) {

					const dx = b.mesh.position.x - b.originX;
					const dy = b.mesh.position.y - b.originY;
					const dz = b.mesh.position.z - b.originZ;
					const dist = dx * dx + dy * dy + dz * dz;

					if ( dist > 0.3 ) {

						wall.hit = true;
						wall.removeTimer = REMOVE_DELAY;
						break;

					}

				}

			}

			// Count down removal after hit
			if ( wall.hit ) {

				wall.removeTimer -= dt;

				// Fade out in last second
				if ( wall.removeTimer < 1.0 ) {

					const alpha = Math.max( 0, wall.removeTimer );

					for ( const b of wall.boxes ) {

						b.mesh.material.opacity = alpha;
						b.mesh.material.transparent = true;

					}

					wall.label.material.opacity = alpha;

				}

				if ( wall.removeTimer <= 0 ) {

					this.removeWall( wall );
					this.walls.splice( i, 1 );

				}

			}

		}

	}

	spawnWall() {

		// Pick a random straight track cell not already occupied by an active wall
		const occupied = new Set();
		for ( const w of this.walls ) occupied.add( w.cellKey );

		const straights = this.trackCells.filter(
			( c ) => c[ 2 ] === 'track-straight' && ! occupied.has( c[ 0 ] + ',' + c[ 1 ] )
		);
		if ( straights.length === 0 ) return;

		const cell = straights[ Math.floor( Math.random() * straights.length ) ];
		const [ gx, gz, , orient ] = cell;

		const cx = ( gx + 0.5 ) * CELL_RAW * GRID_SCALE;
		const cz = ( gz + 0.5 ) * CELL_RAW * GRID_SCALE;

		const deg = ORIENT_DEG[ orient ] ?? 0;
		const rad = deg * Math.PI / 180;
		const cr = Math.cos( rad );
		const sr = Math.sin( rad );

		// Wall spans across the track (perpendicular to road direction)
		// Road direction is along local Z; perpendicular is local X
		const wallWidth = COLS * SPACING;
		const startOffset = - wallWidth / 2 + SPACING / 2;

		const group = new THREE.Group();
		const boxes = [];

		for ( let row = 0; row < ROWS; row ++ ) {

			for ( let col = 0; col < COLS; col ++ ) {

				const lx = startOffset + col * SPACING;
				const ly = BOX_HALF + row * SPACING;

				// Transform local position to world
				const wx = cx + lx * cr;
				const wz = cz - lx * sr;
				const wy = ly - 0.5 + 0.15; // account for track Y offset

				const colorIndex = ( row + col ) % _colors.length;
				const mesh = new THREE.Mesh( _boxGeo, this.boxMaterials[ colorIndex ].clone() );
				mesh.castShadow = true;
				mesh.receiveShadow = true;
				mesh.position.set( wx, wy, wz );

				const quat = [ 0, Math.sin( rad / 2 ), 0, Math.cos( rad / 2 ) ];

				const body = rigidBody.create( this.world, {
					shape: box.create( { halfExtents: [ BOX_HALF, BOX_HALF, BOX_HALF ] } ),
					motionType: MotionType.DYNAMIC,
					objectLayer: this.world._OL_MOVING,
					position: [ wx, wy, wz ],
					quaternion: quat,
					mass: 5.0,
					friction: 0.5,
					restitution: 0.3,
					linearDamping: 0.2,
					angularDamping: 0.3,
					gravityFactor: 1.0,
					motionQuality: MotionQuality.LINEAR_CAST,
				} );

				group.add( mesh );

				boxes.push( {
					mesh,
					body,
					originX: wx,
					originY: wy,
					originZ: wz,
				} );

			}

		}

		// Label sprite above the wall
		const message = MESSAGES[ Math.floor( Math.random() * MESSAGES.length ) ];
		const label = createLabelSprite( message );

		const labelY = ROWS * SPACING + 0.5;
		label.position.set( cx, labelY - 0.5 + 0.15, cz );
		group.add( label );

		this.scene.add( group );

		this.walls.push( {
			group,
			boxes,
			label,
			cellKey: gx + ',' + gz,
			hit: false,
			removeTimer: 0,
		} );

	}

	removeWall( wall ) {

		for ( const b of wall.boxes ) {

			rigidBody.remove( this.world, b.body );

		}

		this.scene.remove( wall.group );

		// Dispose materials and textures
		for ( const b of wall.boxes ) {

			b.mesh.material.dispose();

		}

		wall.label.material.map.dispose();
		wall.label.material.dispose();

	}

}
