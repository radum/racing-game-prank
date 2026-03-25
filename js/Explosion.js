import * as THREE from 'three';
import { rigidBody, box, MotionType, MotionQuality } from 'crashcat';

const _smokeMap = new THREE.TextureLoader().load( 'sprites/smoke.png' );
const _debrisGeo = new THREE.BoxGeometry( 0.15, 0.15, 0.15 );
const _debrisColors = [ 0x2266cc, 0xeeeeee, 0xcc2222, 0x444444, 0xff6600 ];

const DEBRIS_COUNT = 12;
const PARTICLE_COUNT = 32;

// --- Explosion factory ---------------------------------------------------

export function createExplosion( scene, world, x, y, z, opts ) {

	const duration = ( opts && opts.duration ) ?? 4;
	const debrisCount = ( opts && opts.debrisCount ) ?? DEBRIS_COUNT;
	const particleCount = ( opts && opts.particleCount ) ?? PARTICLE_COUNT;
	const flashRadius = ( opts && opts.flashRadius ) ?? 1.2;

	const group = new THREE.Group();
	scene.add( group );

	// Flash sphere
	const flashMat = new THREE.MeshBasicMaterial( {
		color: 0xffaa22,
		transparent: true,
		opacity: 1.0,
	} );
	const flash = new THREE.Mesh(
		new THREE.SphereGeometry( flashRadius, 12, 8 ),
		flashMat
	);
	flash.position.set( x, y + 0.5, z );
	group.add( flash );

	// Debris chunks with physics
	const debris = [];

	for ( let i = 0; i < debrisCount; i ++ ) {

		const colorIndex = i % _debrisColors.length;
		const mat = new THREE.MeshStandardMaterial( {
			color: _debrisColors[ colorIndex ],
			roughness: 0.7,
			transparent: true,
		} );

		const mesh = new THREE.Mesh( _debrisGeo, mat );
		mesh.castShadow = true;
		group.add( mesh );

		const angle = ( i / debrisCount ) * Math.PI * 2;
		const speed = 2 + Math.random() * 4;
		const px = x + Math.cos( angle ) * 0.3;
		const pz = z + Math.sin( angle ) * 0.3;
		const py = y + 0.3 + Math.random() * 0.3;

		const body = rigidBody.create( world, {
			shape: box.create( { halfExtents: [ 0.075, 0.075, 0.075 ] } ),
			motionType: MotionType.DYNAMIC,
			objectLayer: world._OL_MOVING,
			position: [ px, py, pz ],
			mass: 2.0,
			friction: 0.5,
			restitution: 0.4,
			linearDamping: 0.3,
			angularDamping: 0.5,
			gravityFactor: 1.0,
			motionQuality: MotionQuality.LINEAR_CAST,
		} );

		rigidBody.setLinearVelocity( world, body, [
			Math.cos( angle ) * speed,
			3 + Math.random() * 4,
			Math.sin( angle ) * speed,
		] );

		rigidBody.setAngularVelocity( world, body, [
			( Math.random() - 0.5 ) * 15,
			( Math.random() - 0.5 ) * 15,
			( Math.random() - 0.5 ) * 15,
		] );

		debris.push( { mesh, body } );

	}

	// Fire and smoke particles
	const particles = [];

	for ( let i = 0; i < particleCount; i ++ ) {

		const isFire = i < particleCount * 0.6;

		const mat = new THREE.SpriteMaterial( {
			map: _smokeMap,
			transparent: true,
			depthWrite: false,
			opacity: 0,
			color: isFire ? 0xff6622 : 0x444444,
			blending: isFire ? THREE.AdditiveBlending : THREE.NormalBlending,
		} );

		const sprite = new THREE.Sprite( mat );
		sprite.scale.setScalar( 0.1 );
		sprite.position.set(
			x + ( Math.random() - 0.5 ) * 0.6,
			y + 0.2 + Math.random() * 0.3,
			z + ( Math.random() - 0.5 ) * 0.6
		);
		group.add( sprite );

		const pAngle = Math.random() * Math.PI * 2;
		const hSpeed = isFire ? 1.5 + Math.random() * 2 : 0.5 + Math.random() * 1;
		const vSpeed = isFire ? 2 + Math.random() * 3 : 1 + Math.random() * 2;

		const life = 0.8 + Math.random() * 1.2;

		particles.push( {
			sprite,
			velocity: new THREE.Vector3(
				Math.cos( pAngle ) * hSpeed,
				vSpeed,
				Math.sin( pAngle ) * hSpeed
			),
			life,
			maxLife: life,
			initialScale: isFire ? 0.5 + Math.random() * 0.5 : 0.8 + Math.random() * 0.7,
			isFire,
		} );

	}

	return {
		group,
		flash,
		flashMat,
		debris,
		particles,
		timer: duration,
		duration,
	};

}

// --- Update an active explosion ------------------------------------------

export function updateExplosion( exp, dt ) {

	const t = 1 - ( exp.timer / exp.duration );

	// Flash: bright at start, fade quickly
	if ( t < 0.15 ) {

		const flashScale = 1.2 + t * 8;
		exp.flash.scale.setScalar( flashScale );
		exp.flashMat.opacity = 1 - ( t / 0.15 );

	} else {

		exp.flash.visible = false;

	}

	// Sync debris with physics
	for ( const d of exp.debris ) {

		const pos = d.body.position;
		d.mesh.position.set( pos[ 0 ], pos[ 1 ], pos[ 2 ] );

		const quat = d.body.quaternion;
		d.mesh.quaternion.set( quat[ 0 ], quat[ 1 ], quat[ 2 ], quat[ 3 ] );

		if ( exp.timer < 1.0 ) {

			d.mesh.material.opacity = Math.max( 0, exp.timer );

		}

	}

	// Update fire/smoke particles
	for ( const p of exp.particles ) {

		if ( p.life <= 0 ) continue;

		p.life -= dt;

		if ( p.life <= 0 ) {

			p.sprite.visible = false;
			continue;

		}

		const pt = 1 - ( p.life / p.maxLife );

		const damping = Math.max( 0, 1 - 2 * dt );
		p.velocity.multiplyScalar( damping );

		if ( ! p.isFire ) p.velocity.y += 0.5 * dt;

		p.sprite.position.addScaledVector( p.velocity, dt );

		const alpha = pt < 0.2 ? pt * 5 : ( 1 - pt ) * 1.25;
		p.sprite.material.opacity = Math.max( 0, Math.min( 1, alpha ) );

		const scale = p.initialScale * ( 0.3 + pt * 1.5 );
		p.sprite.scale.setScalar( scale );

	}

}

// --- Cleanup an explosion ------------------------------------------------

export function cleanupExplosion( scene, world, exp ) {

	for ( const d of exp.debris ) {

		rigidBody.remove( world, d.body );
		d.mesh.material.dispose();

	}

	for ( const p of exp.particles ) {

		p.sprite.material.dispose();

	}

	exp.flash.geometry.dispose();
	exp.flashMat.dispose();

	scene.remove( exp.group );

}
